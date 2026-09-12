const path = require('path');
const fs = require('fs');
const geminiTailor = require('./gemini_tailor');

class LinkedinAutoApply {
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
      phone: '7608820376',
      years_of_experience: 2,
      linkedin: 'https://www.linkedin.com/in/rajat-kumar-sahu-19ab62226/'
    };
    this.gemini = geminiTailor;
  }

  async _getResumePath(resumeProvider) {
    if (!resumeProvider) return null;
    if (typeof resumeProvider === 'function') {
      try {
        return await resumeProvider();
      } catch (err) {
        console.warn(`[LinkedIn Apply] Could not generate tailored resume: ${err.message}`);
        return null;
      }
    }
    return resumeProvider;
  }

  /**
   * Automatically submit LinkedIn Easy Apply application
   * @param {Object} job - Scraped LinkedIn job object
   * @param {string|Function} resumeProvider - Absolute path or async callback to produce tailored PDF
   * @returns {Promise<{success: boolean, message: string, type?: string, link?: string}>}
   */
  async apply(job, resumeProvider) {
    const page = await this.context.newPage();
    console.log(`[LinkedIn Apply] Navigating to job page: ${job.apply_url}`);

    try {
      await page.goto(job.apply_url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(3500);

      // 1. Check if already applied
      const alreadyApplied = await page.$(
        'button:has-text("Applied"), span.artdeco-inline-feedback--success, .jobs-s-apply__applied-date'
      );
      if (alreadyApplied) {
        console.log(`[LinkedIn Apply] Already applied to ${job.company} on LinkedIn previously.`);
        return { success: true, message: 'Already applied previously on LinkedIn.' };
      }

      // 2. Locate Easy Apply button with resilience (strictly exclude search filter pills)
      const easyApplySelectors = [
        '#jobs-apply-button-id',
        '.jobs-search__job-details button.jobs-apply-button',
        '.jobs-details__main-content button.jobs-apply-button',
        '.jobs-apply-button--top-card button',
        'button.jobs-apply-button:not([id*="searchFilter"]):not([id*="SearchFilter"])',
        'button[data-job-id]:has-text("Easy Apply")',
        '[data-view-name="job-details-easy-apply-button"]'
      ];

      let easyApplyBtn = null;
      for (const sel of easyApplySelectors) {
        const btn = await page.$(sel);
        if (btn && await btn.isVisible().catch(() => false)) {
          const btnId = (await btn.getAttribute('id')) || '';
          if (!btnId.toLowerCase().includes('filter')) {
            easyApplyBtn = btn;
            break;
          }
        }
      }

      // Fallback: search visible buttons having text "Easy Apply" excluding filter pills
      if (!easyApplyBtn) {
        const btns = await page.$$('button');
        for (const btn of btns) {
          const id = ((await btn.getAttribute('id')) || '').toLowerCase();
          if (id.includes('filter')) continue;
          const aria = ((await btn.getAttribute('aria-label')) || '').toLowerCase();
          const txt = (await btn.innerText().catch(() => '')).toLowerCase();
          if ((txt.includes('easy apply') || aria.includes('easy apply')) && await btn.isVisible().catch(() => false)) {
            easyApplyBtn = btn;
            break;
          }
        }
      }

      // Check for external company site Apply button
      if (!easyApplyBtn) {
        const externalApplyBtn = await page.$(
          '.jobs-search__job-details button.jobs-apply-button:has-text("Apply"), .jobs-details__main-content button.jobs-apply-button:has-text("Apply"), a.jobs-apply-button:has-text("Apply"), button.jobs-apply-button:has-text("Apply")'
        );
        if (externalApplyBtn) {
          let companyUrl = job.apply_url;
          try {
            const href = await externalApplyBtn.getAttribute('href');
            if (href && href.startsWith('http')) {
              companyUrl = href;
            }
          } catch (e) {}

          console.log(`[LinkedIn Apply] ⏩ "${job.company}" requires external company site. Skipping for now.`);
          return {
            success: false,
            type: 'EXTERNAL_SITE',
            link: companyUrl,
            message: 'External Company Site (Skipped - Link saved in report)'
          };
        }

        return {
          success: false,
          message: 'Easy Apply button not found on job page.'
        };
      }

      console.log(`[LinkedIn Apply] Found Easy Apply for ${job.company}. Clicking...`);
      await easyApplyBtn.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(400);

      // Trigger click with evaluate fallback
      await easyApplyBtn.click({ force: true }).catch(async () => {
        await page.evaluate(el => el.click(), easyApplyBtn).catch(() => {});
      });

      // 3. Wait for Easy Apply modal dialog to appear
      const modalSelector = '.jobs-easy-apply-modal, div.artdeco-modal[role="dialog"], div[role="dialog"], .jobs-easy-apply-content';
      const modal = await page.waitForSelector(modalSelector, { state: 'visible', timeout: 8000 }).catch(() => null);

      if (!modal) {
        return { success: false, message: 'Easy Apply modal dialog did not open.' };
      }

      // 4. Process multi-step application flow
      return await this._handleEasyApplyModal(page, job, resumeProvider);
    } catch (err) {
      console.error(`[LinkedIn Apply] Error applying to ${job.company}: ${err.message}`);
      return { success: false, message: err.message };
    } finally {
      await page.close().catch(() => {});
    }
  }

  async _handleEasyApplyModal(page, job, resumeProvider) {
    let step = 0;
    const maxSteps = 10;

    while (step < maxSteps) {
      step++;
      console.log(`[LinkedIn Apply] Processing Easy Apply Step ${step}...`);
      await page.waitForTimeout(1500);

      // Check if modal has closed or application already succeeded
      const modalVisible = await page.$('.jobs-easy-apply-modal, div[role="dialog"], div.artdeco-modal');
      if (!modalVisible) {
        console.log(`[LinkedIn Apply] Modal closed. Application completed.`);
        return { success: true, message: 'Easy Apply application completed successfully.' };
      }

      // 1. Handle Contact Info (phone, country code, email)
      await this._handleContactInfo(page);

      // 2. Handle Resume Selection / Upload (ensure top resume or tailored resume is selected)
      await this._handleResumeStep(page, resumeProvider);

      // 3. Handle Screening Questions (Experience, CTC, Notice, Sponsorship, Commute, textareas, etc.)
      await this._handleScreeningQuestions(page);

      // 4. Check for "Submit application" button (Final Step)
      const submitBtn = await page.$(
        'footer button:has-text("Submit application"), button[aria-label*="Submit application"], button:has-text("Submit application"), footer button.artdeco-button--primary:has-text("Submit")'
      );

      if (submitBtn && await submitBtn.isVisible().catch(() => false)) {
        console.log(`[LinkedIn Apply] Found "Submit application" button. Finalizing...`);

        // Uncheck "Follow company"
        const followCheckbox = await page.$(
          'input[id*="follow-company"], input[type="checkbox"]#follow-company-checkbox'
        );
        if (followCheckbox && await followCheckbox.isChecked().catch(() => false)) {
          await followCheckbox.uncheck().catch(() => {});
        }

        await submitBtn.scrollIntoViewIfNeeded().catch(() => {});
        await submitBtn.click({ force: true }).catch(async () => {
          await page.evaluate(el => el.click(), submitBtn).catch(() => {});
        });
        await page.waitForTimeout(3500);

        // Close confirmation dialog if displayed
        const doneBtn = await page.$(
          'button[aria-label="Dismiss"], button:has-text("Done"), button.artdeco-modal__dismiss'
        );
        if (doneBtn && await doneBtn.isVisible().catch(() => false)) {
          await doneBtn.click().catch(() => {});
          await page.waitForTimeout(1000);
        }

        console.log(`[LinkedIn Apply] ✓ Successfully submitted Easy Apply application for ${job.company}!`);
        return { success: true, message: 'Easy Apply application submitted successfully on LinkedIn.' };
      }

      // 5. Look for forward button: "Next" or "Review"
      const primaryBtn = await page.$(
        'footer button.artdeco-button--primary, button[data-easy-apply-next-button], button:has-text("Review"), button[aria-label*="Review"], button:has-text("Next"), button[aria-label*="Next"]'
      );

      if (primaryBtn && await primaryBtn.isVisible().catch(() => false)) {
        const btnText = await primaryBtn.innerText().catch(() => 'Next');
        console.log(`[LinkedIn Apply] Clicking forward button: "${btnText.trim()}"...`);
        await primaryBtn.click();
        await page.waitForTimeout(2000);

        // Check for any inline validation notice
        const hasError = await page.$('.artdeco-inline-feedback--error, p.artdeco-inline-feedback__message');
        if (hasError) {
          const errorMsg = await hasError.innerText().catch(() => 'Required field missing');
          console.warn(`[LinkedIn Apply] ⚠️ Validation notice: "${errorMsg.trim()}". Answering remaining questions...`);
          await this._handleScreeningQuestions(page);
          await primaryBtn.click().catch(() => {});
          await page.waitForTimeout(1500);
        }
      } else {
        console.log(`[LinkedIn Apply] No forward button found on step ${step}.`);
        break;
      }
    }

    // Dismiss modal safely if not completed
    const dismissBtn = await page.$('button[aria-label="Dismiss"]');
    if (dismissBtn && await dismissBtn.isVisible().catch(() => false)) {
      await dismissBtn.click().catch(() => {});
      await page.waitForTimeout(1000);
      const discardBtn = await page.$('button:has-text("Discard")');
      if (discardBtn && await discardBtn.isVisible().catch(() => false)) await discardBtn.click().catch(() => {});
    }

    return {
      success: false,
      message: 'Could not complete all Easy Apply steps automatically (required custom inputs).'
    };
  }

  async _handleContactInfo(page) {
    try {
      // 1. Phone number input
      const phoneInput = await page.$(
        'input[id*="phoneNumber-nationalNumber"], input[type="tel"], input[id*="phone"]'
      );
      if (phoneInput && await phoneInput.isVisible()) {
        const val = await phoneInput.inputValue();
        if (!val || val.trim().length < 5) {
          const rawPhone = (this.userProfile.phone || '7608820376').replace(/[^0-9]/g, '');
          console.log(`[LinkedIn Apply] Filling mobile phone number: ${rawPhone}`);
          await phoneInput.fill(rawPhone);
        }
      }

      // 2. Phone country code dropdown
      const countryCodeSelect = await page.$(
        'select[id*="country-code"], select[id*="phoneNumber-country-code"]'
      );
      if (countryCodeSelect && await countryCodeSelect.isVisible()) {
        const selectedVal = await countryCodeSelect.inputValue();
        if (!selectedVal || selectedVal.includes('Choose') || selectedVal.includes('Select')) {
          await countryCodeSelect.selectOption({ label: 'India (+91)' }).catch(async () => {
            await countryCodeSelect.selectOption({ index: 1 }).catch(() => {});
          });
        }
      }

      // 3. Email select dropdown
      const emailSelect = await page.$('select[id*="email"]');
      if (emailSelect && await emailSelect.isVisible()) {
        const currentEmail = await emailSelect.inputValue();
        if (!currentEmail && this.userProfile.email) {
          await emailSelect.selectOption({ label: this.userProfile.email }).catch(() => {});
        }
      }
    } catch (e) {
      // Non-blocking
    }
  }

  async _handleResumeStep(page, resumeProvider) {
    try {
      const fileInput = await page.$('input[type="file"]');
      const resumeRadioButtons = await page.$$(
        '.jobs-document-upload__file-selection-container input[type="radio"], input[type="radio"][id*="resume"], input[type="radio"][name*="resume"]'
      );

      if (!fileInput && resumeRadioButtons.length === 0) {
        return; // Not on resume step
      }

      console.log(`[LinkedIn Apply] Resume selection / upload step detected.`);

      // Check if tailored resume is provided to upload
      const tailoredPdf = await this._getResumePath(resumeProvider);

      if (tailoredPdf && fs.existsSync(tailoredPdf) && fileInput) {
        console.log(`[LinkedIn Apply] Uploading tailored single-page resume: ${path.basename(tailoredPdf)}`);
        await fileInput.setInputFiles(tailoredPdf);
        await page.waitForTimeout(2500);
      } else if (resumeRadioButtons.length > 0) {
        // Select the top resume from the list (Screenshot 4: e.g. ResumeRajat (1).pdf)
        const isFirstChecked = await resumeRadioButtons[0].isChecked().catch(() => false);
        if (!isFirstChecked) {
          console.log(`[LinkedIn Apply] Selecting top resume from existing profile resumes.`);
          await resumeRadioButtons[0].check().catch(async () => {
            const topCard = await page.$('.jobs-document-upload__file-selection-container li, .jobs-document-upload__file-selection-container div[role="radio"]');
            if (topCard) await topCard.click().catch(() => {});
          });
          await page.waitForTimeout(1000);
        } else {
          console.log(`[LinkedIn Apply] Top profile resume is already active.`);
        }
      }
    } catch (e) {
      // Non-blocking
    }
  }

  async _handleScreeningQuestions(page) {
    try {
      // 1. Numeric and Text input fields
      const textInputs = await page.$$(
        'div[role="dialog"] input[type="text"]:not([disabled]), div[role="dialog"] input[type="number"]:not([disabled]), .jobs-easy-apply-modal input[type="text"]:not([disabled]), .jobs-easy-apply-modal input[type="number"]:not([disabled])'
      );

      for (const input of textInputs) {
        if (!await input.isVisible()) continue;

        const currentVal = await input.inputValue();
        if (currentVal && currentVal.trim().length > 0) continue; // Already answered

        // Extract associated label text
        const labelText = await input.evaluate(el => {
          if (el.id) {
            const lbl = document.querySelector(`label[for="${el.id}"]`);
            if (lbl) return lbl.innerText.trim();
          }
          const parentLabel = el.closest('label');
          if (parentLabel) return parentLabel.innerText.trim();
          const container = el.closest('.fb-form-element, .jobs-easy-apply-form-section__grouping, div');
          if (container) {
            const t = container.querySelector('label, .fb-form-element-label, .artdeco-text-input--label, span, p');
            if (t) return t.innerText.trim();
          }
          return el.placeholder || el.getAttribute('aria-label') || el.name || '';
        });

        const ans = await this._getAnswerForQuestion(labelText);
        console.log(`[LinkedIn Apply] Question: "${labelText.slice(0, 50)}" -> Answering: "${ans}"`);
        await input.fill(String(ans));
        await page.waitForTimeout(200);
      }

      // 2. Radio button groups (Yes/No questions or options)
      const fieldsets = await page.$$(
        'div[role="dialog"] fieldset, div[role="dialog"] .fb-radio-buttons, .jobs-easy-apply-modal fieldset'
      );
      for (const fieldset of fieldsets) {
        if (!await fieldset.isVisible()) continue;

        const isAnyChecked = await fieldset.$('input[type="radio"]:checked');
        if (isAnyChecked) continue;

        const legendText = await fieldset.$eval('legend, .fb-form-element-label', el => el.innerText.trim()).catch(() => '');
        if (!legendText) continue;

        const radioOptions = await fieldset.$$('input[type="radio"]');
        if (radioOptions.length === 0) continue;

        const targetAns = await this._getAnswerForQuestion(legendText);
        const optionLabels = await fieldset.$$eval('label', labels => labels.map(l => l.innerText.trim())).catch(() => []);
        const bestIdx = this._selectBestOption(optionLabels, targetAns, legendText);

        console.log(`[LinkedIn Apply] Radio Question: "${legendText.slice(0, 50)}" -> Selecting: "${optionLabels[bestIdx] || targetAns}"`);
        if (radioOptions[bestIdx]) {
          await radioOptions[bestIdx].check().catch(async () => {
            const labels = await fieldset.$$('label');
            if (labels[bestIdx]) await labels[bestIdx].click().catch(() => {});
          });
          await page.waitForTimeout(200);
        }
      }

      // 3. Dropdown selects
      const selects = await page.$$(
        'div[role="dialog"] select:not([disabled]), .jobs-easy-apply-modal select:not([disabled])'
      );
      for (const select of selects) {
        if (!await select.isVisible()) continue;

        const currentVal = await select.inputValue();
        if (currentVal && !currentVal.includes('Select') && !currentVal.includes('Choose')) continue;

        const labelText = await select.evaluate(el => {
          if (el.id) {
            const lbl = document.querySelector(`label[for="${el.id}"]`);
            if (lbl) return lbl.innerText.trim();
          }
          const parent = el.closest('.fb-form-element, div');
          if (parent) {
            const l = parent.querySelector('label, .fb-form-element-label, span');
            if (l) return l.innerText.trim();
          }
          return '';
        });

        const targetAns = await this._getAnswerForQuestion(labelText);
        const optionsTexts = await select.$$eval('option', opts => opts.map(o => o.innerText.trim())).catch(() => []);
        const bestIdx = this._selectBestOption(optionsTexts, targetAns, labelText);

        console.log(`[LinkedIn Apply] Dropdown Question: "${labelText.slice(0, 50)}" -> Selecting: "${optionsTexts[bestIdx] || targetAns}"`);
        if (optionsTexts[bestIdx]) {
          await select.selectOption({ label: optionsTexts[bestIdx] }).catch(async () => {
            await select.selectOption({ index: bestIdx }).catch(() => {});
          });
          await page.waitForTimeout(200);
        }
      }

      // 4. Textarea inputs
      const textareas = await page.$$(
        'div[role="dialog"] textarea:not([disabled]), .jobs-easy-apply-modal textarea:not([disabled])'
      );
      for (const ta of textareas) {
        if (!await ta.isVisible()) continue;
        const currentVal = await ta.inputValue();
        if (currentVal && currentVal.trim().length > 0) continue;

        const labelText = await ta.evaluate(el => {
          if (el.id) {
            const lbl = document.querySelector(`label[for="${el.id}"]`);
            if (lbl) return lbl.innerText.trim();
          }
          const parentLabel = el.closest('label');
          if (parentLabel) return parentLabel.innerText.trim();
          const container = el.closest('.fb-form-element, div');
          if (container) {
            const t = container.querySelector('label, .fb-form-element-label, span');
            if (t) return t.innerText.trim();
          }
          return el.placeholder || el.getAttribute('aria-label') || '';
        });

        const ans = await this._getAnswerForQuestion(labelText);
        console.log(`[LinkedIn Apply] Textarea Question: "${labelText.slice(0, 50)}" -> Answering: "${ans}"`);
        await ta.fill(String(ans));
        await page.waitForTimeout(200);
      }
    } catch (e) {
      // Non-blocking
    }
  }

  _selectBestOption(optionsTextList, targetAnswer, questionText = '') {
    const q = (questionText || '').toLowerCase();
    const ans = String(targetAnswer).toLowerCase().trim();
    const yoe = Number(this.userProfile.years_of_experience) || 2;

    // 1. Experience range matching
    if (q.includes('experience') || q.includes('exp') || q.includes('years') || q.includes('yoe')) {
      for (let i = 0; i < optionsTextList.length; i++) {
        const opt = optionsTextList[i].toLowerCase();
        const rangeMatch = opt.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)/);
        if (rangeMatch) {
          const min = parseFloat(rangeMatch[1]);
          const max = parseFloat(rangeMatch[2]);
          if (yoe >= min && yoe <= max) return i;
        }
      }
      for (let i = 0; i < optionsTextList.length; i++) {
        const opt = optionsTextList[i].toLowerCase();
        if (opt.includes('less') || opt.includes('<') || opt.includes('under') || opt.includes('below')) {
          const numMatch = opt.match(/(\d+(?:\.\d+)?)/);
          if (numMatch && yoe < parseFloat(numMatch[1])) return i;
          continue;
        }
        if (opt.includes('+') || opt.includes('more') || opt.includes('>') || opt.includes('above')) {
          const numMatch = opt.match(/(\d+(?:\.\d+)?)/);
          if (numMatch && yoe >= parseFloat(numMatch[1])) return i;
          continue;
        }
        const singleMatch = opt.match(/(\d+(?:\.\d+)?)/);
        if (singleMatch && parseFloat(singleMatch[1]) === yoe) return i;
      }
    }

    // 2. Exact or partial match
    for (let i = 0; i < optionsTextList.length; i++) {
      const opt = optionsTextList[i].toLowerCase().trim();
      if (opt === ans || opt.includes(ans) || ans.includes(opt)) return i;
    }

    // 3. Yes/No matching
    if (ans === 'yes') {
      for (let i = 0; i < optionsTextList.length; i++) {
        if (optionsTextList[i].toLowerCase().includes('yes')) return i;
      }
    } else if (ans === 'no') {
      for (let i = 0; i < optionsTextList.length; i++) {
        if (optionsTextList[i].toLowerCase().includes('no')) return i;
      }
    }

    // 4. Notice Period matching
    if (q.includes('notice') || q.includes('join')) {
      for (let i = 0; i < optionsTextList.length; i++) {
        const opt = optionsTextList[i].toLowerCase();
        if (opt.includes('60') || opt.includes('2 month')) return i;
      }
    }

    return 0; // Default first option
  }

  async _getAnswerForQuestion(questionText) {
    const q = (questionText || '').toLowerCase().trim();
    const yoe = Number(this.userProfile.years_of_experience) || 2;
    const currentCtc = this.screeningAnswers.current_ctc_raw || 450000;
    const expectedCtc = this.screeningAnswers.expected_ctc_raw || 900000;
    const currentCtcLpa = this.screeningAnswers.current_ctc_lpa || 4.5;
    const expectedCtcLpa = this.screeningAnswers.expected_ctc_lpa || 9.0;
    const noticeDays = this.screeningAnswers.notice_period_days || 60;
    const location = this.userProfile.location || 'Hyderabad';

    // 1. Sponsorship / Visa Questions (Crucial on LinkedIn!)
    // e.g. "Will you now or in the future require sponsorship for an employment visa status?"
    if (q.includes('sponsor') || q.includes('visa') || q.includes('work authorization required')) {
      return 'No';
    }

    // 2. Legal authorization
    // e.g. "Are you legally authorized to work in India?"
    if (q.includes('authorized') || q.includes('legal') || q.includes('permit') || q.includes('legally')) {
      return 'Yes';
    }

    // 3. Commute / On-site comfort / Relocation
    // e.g. "Are you comfortable commuting to this job's location?", "Are you willing to work on-site?"
    if (q.includes('commut') || q.includes('commu') || q.includes('on-site') || q.includes('onsite') || q.includes('relocat') || q.includes('hybrid') || q.includes('travel')) {
      return 'Yes';
    }

    // 4. Notice Period
    if (q.includes('notice') || q.includes('serving notice') || q.includes('join in') || q.includes('availability')) {
      if (q.includes('month')) return '2';
      return String(noticeDays);
    }

    // 5. Current CTC / Salary
    if (q.includes('current') && (q.includes('ctc') || q.includes('salary') || q.includes('compensation') || q.includes('package'))) {
      if (q.includes('lpa') || q.includes('lakh')) return String(currentCtcLpa);
      return String(currentCtc);
    }

    // 6. Expected CTC / Salary
    if ((q.includes('expected') || q.includes('expectation') || q.includes('desired')) && (q.includes('ctc') || q.includes('salary') || q.includes('package'))) {
      if (q.includes('lpa') || q.includes('lakh')) return String(expectedCtcLpa);
      return String(expectedCtc);
    }

    // 7. Generic CTC
    if (q.includes('ctc') || q.includes('salary') || q.includes('compensation')) {
      if (q.includes('lpa') || q.includes('lakh')) return String(expectedCtcLpa);
      return String(expectedCtc);
    }

    // 8. Experience Questions (Java, Spring Boot, Total YoE)
    if (
      q.includes('experience') ||
      q.includes('exp') ||
      q.includes('how many years') ||
      q.includes('years of') ||
      q.includes('total work') ||
      q.includes('relevant') ||
      q.includes('yoe')
    ) {
      if (q.includes('month') && !q.includes('year')) {
        return String(Math.round(yoe * 12));
      }
      return String(yoe);
    }

    // 9. Location (e.g. "What is your current city/location?", "Where are you currently based?")
    if (
      q.includes('current location') ||
      q.includes('where are you') ||
      q.includes('residing') ||
      q.includes('your location') ||
      q.includes('what city') ||
      (q.includes('city') && !q.includes('comfortable') && !q.includes('willing'))
    ) {
      return location;
    }

    // 10. General confirmation (e.g. "Do you have experience in Java?")
    if (q.startsWith('do you') || q.startsWith('are you') || q.startsWith('have you') || q.includes('comfortable')) {
      return 'Yes';
    }

    // 11. AI Fallback via Gemini for custom questions
    if (q.length > 5 && this.gemini && this.gemini.isConfigured()) {
      const aiAns = await this._askGeminiForAnswer(questionText);
      if (aiAns) return aiAns;
    }

    if (q.includes('how many') || q.includes('number')) return String(yoe);
    return 'Yes';
  }

  async _askGeminiForAnswer(questionText) {
    if (!this.gemini || !this.gemini.isConfigured()) return null;
    try {
      const prompt = `You are representing job applicant Rajat Kumar Sahu.
Applicant Profile:
- Full Name: ${this.userProfile.full_name}
- Total Work Experience: ${this.userProfile.years_of_experience || 2} years
- Primary Role & Skills: Java, Spring Boot, Microservices, REST APIs, Docker, AWS, SQL
- Current Employer: Tech Mahindra (Associate Software Engineer)
- Current CTC: 4.5 LPA (₹4,50,000)
- Expected CTC: 9 LPA (₹9,00,000)
- Notice Period: 60 Days
- Location: Hyderabad (Willing to relocate: Yes)
- Sponsorship required: No
- Legally authorized to work: Yes

The LinkedIn job application asks: "${questionText}"
Provide ONLY the short, direct, accurate answer as the candidate (max 5 words). No explanations.`;

      const response = await this.gemini.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
      });
      const text = response.text ? response.text.trim() : null;
      return text ? text.replace(/^["']|["']$/g, '') : null;
    } catch (e) {
      return null;
    }
  }
}

module.exports = LinkedinAutoApply;
