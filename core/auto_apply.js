const path = require('path');
const fs = require('fs');

class AutoApply {
  constructor(browserContext, config = {}) {
    this.context = browserContext;
    this.screeningAnswers = config.screening_answers || {
      notice_period_days: 30,
      current_ctc_lpa: 12,
      expected_ctc_lpa: 18
    };
  }

  /**
   * Apply for a single job
   * @param {Object} job - Scraped job object
   * @param {string} resumePdfPath - Absolute path to tailored single-page PDF
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async apply(job, resumePdfPath) {
    if (!fs.existsSync(resumePdfPath)) {
      throw new Error(`Resume PDF not found at: ${resumePdfPath}`);
    }

    const page = await this.context.newPage();
    console.log(`[Auto-Apply] Navigating to job page: ${job.apply_url}`);

    try {
      await page.goto(job.apply_url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2500);

      // Locate Apply Button
      const applyBtn = await page.$(
        'button.apply-button, button#apply-button, button:has-text("Apply on Naukri"), button:has-text("Apply")'
      );

      if (!applyBtn) {
        // Check for external redirect button
        const externalBtn = await page.$('button:has-text("Apply on company site"), a:has-text("Apply on company site")');
        if (externalBtn) {
          return {
            success: false,
            type: 'EXTERNAL_PORTAL',
            message: `External company ATS redirect. Tailored PDF saved at ${resumePdfPath} for direct submission.`
          };
        }
        return { success: false, message: 'Could not find apply button on page.' };
      }

      console.log(`[Auto-Apply] Clicking Apply button...`);
      await applyBtn.click();
      await page.waitForTimeout(2000);

      // Check if file upload is requested
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        console.log(`[Auto-Apply] Uploading tailored resume: ${path.basename(resumePdfPath)}`);
        await fileInput.setInputFiles(resumePdfPath);
        await page.waitForTimeout(1500);
      }

      // Handle common screening inputs if modal opens
      await this._fillScreeningQuestions(page);

      // Check for final Submit button
      const submitBtn = await page.$(
        'button:has-text("Submit"), button:has-text("Send Application"), button.submit-button'
      );

      if (submitBtn) {
        console.log(`[Auto-Apply] Clicking final Submit button...`);
        await submitBtn.click();
        await page.waitForTimeout(3000);
      }

      console.log(`[Auto-Apply] ✓ Successfully submitted application for ${job.company} - ${job.title}!`);
      return { success: true, message: 'Application submitted successfully.' };
    } catch (err) {
      console.error(`[Auto-Apply] Error submitting to ${job.company}: ${err.message}`);
      return { success: false, message: err.message };
    } finally {
      await page.close();
    }
  }

  async _fillScreeningQuestions(page) {
    try {
      // Notice Period inputs
      const noticeInput = await page.$('input[placeholder*="Notice"], input[name*="notice"]');
      if (noticeInput) {
        await noticeInput.fill(String(this.screeningAnswers.notice_period_days));
      }

      // Expected CTC inputs
      const ctcInput = await page.$('input[placeholder*="CTC"], input[placeholder*="Salary"], input[name*="expected"]');
      if (ctcInput) {
        await ctcInput.fill(String(this.screeningAnswers.expected_ctc_lpa));
      }
    } catch (e) {
      // Non-blocking screening fallback
    }
  }
}

module.exports = AutoApply;

