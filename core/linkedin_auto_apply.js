const path = require('path');
const fs = require('fs');

class LinkedinAutoApply {
  constructor(browserContext, config = {}) {
    this.context = browserContext;
    this.screeningAnswers = config.screening_answers || {};
    this.userProfile = config.user_profile || {};
  }

  /**
   * Automatically submit LinkedIn Easy Apply application
   * @param {Object} job - Scraped LinkedIn job object
   * @param {string} resumePdfPath - Absolute path to tailored single-page PDF
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async apply(job, resumePdfPath) {
    if (!fs.existsSync(resumePdfPath)) {
      throw new Error(`Resume PDF not found at: ${resumePdfPath}`);
    }

    const page = await this.context.newPage();
    console.log(`[LinkedIn Apply] Navigating to: ${job.apply_url}`);

    try {
      await page.goto(job.apply_url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(3000);

      // Locate Easy Apply button
      const applyBtn = await page.$(
        'button.jobs-apply-button, button:has-text("Easy Apply"), button[aria-label*="Easy Apply"]'
      );

      if (!applyBtn) {
        return {
          success: false,
          message: 'Easy Apply button not found or already applied to this job.'
        };
      }

      console.log(`[LinkedIn Apply] Clicking "Easy Apply"...`);
      await applyBtn.click();
      await page.waitForTimeout(2000);

      // Handle multi-step modal dialog
      const modal = await page.$('div[role="dialog"]');
      if (!modal) {
        return { success: false, message: 'Easy Apply modal did not open.' };
      }

      let step = 0;
      const maxSteps = 7;

      while (step < maxSteps) {
        step++;
        console.log(`[LinkedIn Apply] Processing Easy Apply Step ${step}...`);

        // Check for resume upload input
        const fileInput = await modal.$('input[type="file"]');
        if (fileInput) {
          console.log(`[LinkedIn Apply] Uploading tailored resume: ${path.basename(resumePdfPath)}`);
          await fileInput.setInputFiles(resumePdfPath);
          await page.waitForTimeout(1500);
        }

        // Fill standard numeric questions (e.g. Years of experience)
        const numericInputs = await modal.$$('input[type="text"]:not([disabled])');
        for (const input of numericInputs) {
          const val = await input.inputValue();
          if (!val) {
            await input.fill(String(this.userProfile.years_of_experience || 3));
            await page.waitForTimeout(300);
          }
        }

        // Check for Submit Application button
        const submitBtn = await modal.$(
          'button:has-text("Submit application"), button[aria-label="Submit application"]'
        );

        if (submitBtn) {
          console.log(`[LinkedIn Apply] Found "Submit application" button. Submitting...`);
          await submitBtn.click();
          await page.waitForTimeout(3000);

          // Close confirmation dialog if any
          const dismissBtn = await page.$('button[aria-label="Dismiss"], button:has-text("Done")');
          if (dismissBtn) await dismissBtn.click().catch(() => {});

          console.log(`[LinkedIn Apply] ✓ Successfully submitted Easy Apply application for ${job.company}!`);
          return { success: true, message: 'Easy Apply application submitted successfully.' };
        }

        // Check for Next or Review button
        const nextBtn = await modal.$(
          'button:has-text("Next"), button[aria-label="Continue to next step"], button:has-text("Review"), button[aria-label="Review your application"]'
        );

        if (nextBtn) {
          await nextBtn.click();
          await page.waitForTimeout(1500);
        } else {
          // No next or submit button found
          break;
        }
      }

      return {
        success: false,
        message: 'Could not complete all modal steps automatically. Tailored PDF is ready for 1-click manual submission.'
      };
    } catch (err) {
      console.error(`[LinkedIn Apply] Error during application: ${err.message}`);
      return { success: false, message: err.message };
    } finally {
      await page.close();
    }
  }
}

module.exports = LinkedinAutoApply;
