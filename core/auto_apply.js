const path = require('path');
const fs = require('fs');
const readline = require('readline');

class AutoApply {
  constructor(browserContext, config = {}) {
    this.context = browserContext;
    this.screeningAnswers = config.screening_answers || {
      notice_period_days: 60,
      current_ctc_lpa: 4.5,
      current_ctc_raw: 450000,
      expected_ctc_lpa: 9.0,
      expected_ctc_raw: 900000
    };
    this.userProfile = config.user_profile || {
      full_name: 'Rajat Kumar Sahu',
      email: 'rajatroshan2002@gmail.com',
      phone: '+91 76088 20376',
      linkedin: 'https://www.linkedin.com/in/rajat-kumar-sahu-19ab62226/'
    };
  }

  _promptUser(query) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    return new Promise(resolve => rl.question(query, ans => {
      rl.close();
      resolve(ans.trim());
    }));
  }

  /**
   * Apply for a single job
   * @param {Object} job - Scraped job object
   * @param {string} resumePdfPath - Absolute path to tailored single-page PDF
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async apply(job, resumePdfPath) {
    const page = await this.context.newPage();
    console.log(`[Auto-Apply] Navigating to job page: ${job.apply_url}`);

    try {
      await page.goto(job.apply_url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2500);

      // 1. Check for Direct Apply on Naukri
      const directApplyBtn = await page.$(
        'button.apply-button, button#apply-button, button:has-text("Apply on Naukri"), button:has-text("Apply")'
      );

      // 2. Check for External Company Redirect Button
      const externalBtn = await page.$(
        'button:has-text("Apply on company site"), a:has-text("Apply on company site"), button:has-text("Company site"), a[id*="company-site"]'
      );

      if (directApplyBtn && !externalBtn) {
        return await this._handleDirectApply(page, job, resumePdfPath, directApplyBtn);
      } else if (externalBtn) {
        return await this._handleExternalApply(page, job, resumePdfPath, externalBtn);
      } else {
        return { success: false, message: 'Could not locate Apply or Company Site button on page.' };
      }
    } catch (err) {
      console.error(`[Auto-Apply] Error applying to ${job.company}: ${err.message}`);
      return { success: false, message: err.message };
    } finally {
      await page.close().catch(() => {});
    }
  }

  async _handleDirectApply(page, job, resumePdfPath, applyBtn) {
    console.log(`[Auto-Apply] Found Direct Apply on Naukri for ${job.company}. Clicking...`);
    await applyBtn.click();
    await page.waitForTimeout(2500);

    // If file upload is explicitly requested
    const fileInput = await page.$('input[type="file"]');
    if (fileInput && resumePdfPath && fs.existsSync(resumePdfPath)) {
      console.log(`[Auto-Apply] Uploading tailored resume: ${path.basename(resumePdfPath)}`);
      await fileInput.setInputFiles(resumePdfPath).catch(() => {});
      await page.waitForTimeout(1500);
    } else {
      console.log(`[Auto-Apply] Using pre-uploaded resume on your Naukri profile.`);
    }

    // Autofill standard screening questions if popup modal appears
    await this._fillScreeningQuestions(page);

    // Submit button
    const submitBtn = await page.$(
      'button:has-text("Submit"), button:has-text("Send Application"), button.submit-button, button:has-text("Apply now")'
    );

    if (submitBtn) {
      console.log(`[Auto-Apply] Submitting application...`);
      await submitBtn.click();
      await page.waitForTimeout(3000);
    }

    console.log(`[Auto-Apply] ✓ Successfully submitted direct application for ${job.company}!`);
    return { success: true, message: 'Applied directly on Naukri.' };
  }

  async _handleExternalApply(page, job, resumePdfPath, externalBtn) {
    console.log(`\n🌐 [Auto-Apply] "${job.company}" requires application on their company career site.`);
    console.log(`[Auto-Apply] Redirecting to company portal...`);

    // Listen for new tab if it opens in a new window
    const [newPage] = await Promise.all([
      this.context.waitForEvent('page', { timeout: 15000 }).catch(() => null),
      externalBtn.click()
    ]);

    const targetPage = newPage || page;
    await targetPage.waitForLoadState('domcontentloaded').catch(() => {});
    await targetPage.waitForTimeout(3000);

    console.log(`[Auto-Apply] Opened company site: ${targetPage.url()}`);

    // Autofill standard known fields
    await this._autofillCompanySite(targetPage, resumePdfPath);

    // Human-in-the-loop: prompt user if company asks custom details
    console.log('\n======================================================');
    console.log(`🔔 COMPANY SITE OPENED FOR: ${job.company} - ${job.title}`);
    console.log('👉 Review the open Chrome window. Fill any company-specific questions.');
    console.log('• Press [ENTER] when done/submitted to continue.');
    console.log('• Type [s] and press [ENTER] to skip this job and move to next.');
    console.log('======================================================\n');

    const choice = await this._promptUser('Your action (Enter to proceed / s to skip): ');
    if (choice.toLowerCase() === 's' || choice.toLowerCase() === 'skip') {
      console.log(`[Auto-Apply] Job skipped by user. Moving to next job.`);
      if (newPage) await newPage.close().catch(() => {});
      return { success: false, message: 'Skipped by user on company site.' };
    }

    // Try clicking submit on company page if still visible
    const companySubmit = await targetPage.$(
      'button[type="submit"], button:has-text("Submit Application"), button:has-text("Submit"), input[type="submit"]'
    );
    if (companySubmit) {
      await companySubmit.click().catch(() => {});
      await targetPage.waitForTimeout(2500);
    }

    if (newPage) await newPage.close().catch(() => {});
    return { success: true, message: `Completed application on ${job.company} company site.` };
  }

  async _autofillCompanySite(page, resumePdfPath) {
    try {
      // 1. Name
      const nameInput = await page.$('input[name*="name" i], input[placeholder*="name" i], input[id*="name" i]');
      if (nameInput) await nameInput.fill(this.userProfile.full_name).catch(() => {});

      // 2. Email
      const emailInput = await page.$('input[type="email"], input[name*="email" i], input[placeholder*="email" i]');
      if (emailInput) await emailInput.fill(this.userProfile.email).catch(() => {});

      // 3. Phone
      const phoneInput = await page.$('input[type="tel"], input[name*="phone" i], input[placeholder*="phone" i], input[name*="mobile" i]');
      if (phoneInput) await phoneInput.fill(this.userProfile.phone.replace(/[^0-9]/g, '')).catch(() => {});

      // 4. LinkedIn
      const linkedinInput = await page.$('input[name*="linkedin" i], input[placeholder*="linkedin" i]');
      if (linkedinInput) await linkedinInput.fill(this.userProfile.linkedin).catch(() => {});

      // 5. Resume upload
      const fileInput = await page.$('input[type="file"]');
      if (fileInput && resumePdfPath && fs.existsSync(resumePdfPath)) {
        console.log(`[Auto-Apply] Attaching resume to company site: ${path.basename(resumePdfPath)}`);
        await fileInput.setInputFiles(resumePdfPath).catch(() => {});
      }

      // 6. CTC & Notice Period
      const ctcInput = await page.$('input[name*="ctc" i], input[placeholder*="ctc" i], input[name*="salary" i]');
      if (ctcInput) await ctcInput.fill(String(this.screeningAnswers.expected_ctc_raw || 900000)).catch(() => {});

      const noticeInput = await page.$('input[name*="notice" i], input[placeholder*="notice" i]');
      if (noticeInput) await noticeInput.fill(String(this.screeningAnswers.notice_period_days || 60)).catch(() => {});
    } catch (e) {
      // Non-blocking
    }
  }

  async _fillScreeningQuestions(page) {
    try {
      const noticeInput = await page.$('input[placeholder*="Notice" i], input[name*="notice" i]');
      if (noticeInput) {
        await noticeInput.fill(String(this.screeningAnswers.notice_period_days || 60)).catch(() => {});
      }

      const ctcInput = await page.$('input[placeholder*="CTC" i], input[placeholder*="Salary" i], input[name*="expected" i]');
      if (ctcInput) {
        await ctcInput.fill(String(this.screeningAnswers.expected_ctc_lpa || 9.0)).catch(() => {});
      }
    } catch (e) {
      // Non-blocking
    }
  }
}

module.exports = AutoApply;
