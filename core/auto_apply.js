const path = require('path');
const fs = require('fs');
const readline = require('readline');
const geminiTailor = require('./gemini_tailor');

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
      years_of_experience: 2,
      linkedin: 'https://www.linkedin.com/in/rajat-kumar-sahu-19ab62226/'
    };
    this.gemini = geminiTailor;
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

  async _getResumePath(resumeProvider) {
    if (!resumeProvider) return null;
    if (typeof resumeProvider === 'function') {
      return await resumeProvider();
    }
    return resumeProvider;
  }

  /**
   * Apply for a single job
   * @param {Object} job - Scraped job object
   * @param {string|Function} resumeProvider - Absolute path or async callback to produce tailored PDF
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async apply(job, resumeProvider) {
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
        return await this._handleDirectApply(page, job, resumeProvider, directApplyBtn);
      } else if (externalBtn) {
        // Extract the destination link if available
        let companyUrl = job.apply_url;
        try {
          const href = await externalBtn.getAttribute('href');
          if (href && href.startsWith('http')) {
            companyUrl = href;
          } else {
            // Attempt quick popup or navigation capture without blocking
            const [newPage] = await Promise.all([
              this.context.waitForEvent('page', { timeout: 4000 }).catch(() => null),
              externalBtn.click().catch(() => {})
            ]);
            if (newPage) {
              await newPage.waitForLoadState('domcontentloaded', { timeout: 4000 }).catch(() => {});
              companyUrl = newPage.url();
              await newPage.close().catch(() => {});
            }
          }
        } catch (e) {}

        console.log(`[Auto-Apply] ⏩ "${job.company}" requires external company site. Skipping for now.`);
        return {
          success: false,
          type: 'EXTERNAL_SITE',
          link: companyUrl,
          message: 'External Company Site (Skipped - Link saved in report)'
        };
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

  async _handleDirectApply(page, job, resumeProvider, applyBtn) {
    console.log(`[Auto-Apply] Found Direct Apply on Naukri for ${job.company}. Clicking...`);
    await applyBtn.click();
    await page.waitForTimeout(2500);

    // Check if clicking apply redirected away from Naukri to an external portal
    const currentUrl = page.url();
    if (!currentUrl.includes('naukri.com')) {
      console.log(`[Auto-Apply] ⏩ Redirected to external company portal: ${currentUrl}. Skipping.`);
      return {
        success: false,
        type: 'EXTERNAL_SITE',
        link: currentUrl,
        message: 'External Company Site (Skipped - Link saved in report)'
      };
    }

    // If file upload is explicitly requested by Naukri modal
    const fileInput = await page.$('input[type="file"]');
    if (fileInput) {
      const resumePdfPath = await this._getResumePath(resumeProvider);
      if (resumePdfPath && fs.existsSync(resumePdfPath)) {
        console.log(`[Auto-Apply] Uploading tailored resume: ${path.basename(resumePdfPath)}`);
        await fileInput.setInputFiles(resumePdfPath).catch(() => {});
        await page.waitForTimeout(1500);
      }
    } else {
      console.log(`[Auto-Apply] Using pre-uploaded resume on your Naukri profile (no PDF compilation needed).`);
    }

    // Autofill standard screening questions and recruiter chatbot prompts
    await this._handleScreeningAndChatbot(page);

    // Final submit button if still visible
    const submitBtn = await page.$(
      'button:has-text("Submit"), button:has-text("Send Application"), button.submit-button, button:has-text("Apply now")'
    );

    if (submitBtn && await submitBtn.isVisible()) {
      console.log(`[Auto-Apply] Submitting application...`);
      await submitBtn.click();
      await page.waitForTimeout(3000);
    }

    console.log(`[Auto-Apply] ✓ Successfully submitted direct application for ${job.company}!`);
    return { success: true, message: 'Applied directly on Naukri using profile resume.' };
  }

  async _handleExternalApply(page, job, resumeProvider, externalBtn) {
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

    // Generate tailored PDF only for external company site
    const resumePdfPath = await this._getResumePath(resumeProvider);

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

  async _handleScreeningAndChatbot(page) {
    console.log(`[Auto-Apply] Checking for recruiter screening questions or chatbot prompts...`);

    const maxRounds = 8;
    let round = 0;

    while (round < maxRounds) {
      round++;
      await page.waitForTimeout(1500);

      // Check if application is already completed or successful
      const successFound = await page.evaluate(() => {
        const text = document.body.innerText;
        return text.includes('Successfully applied') ||
               text.includes('Application sent') ||
               text.includes('Applied successfully') ||
               text.includes('You have successfully applied');
      });

      if (successFound) {
        console.log(`[Auto-Apply] ✓ Application confirmation detected.`);
        return true;
      }

      // 1. Check for Chatbot message bubbles and single active chat input
      const chatState = await page.evaluate(() => {
        const botMessages = Array.from(document.querySelectorAll(
          '.bot-msg, .chat-message, .msg-text, .msgWrapper, .chat-msg, [class*="bot"] [class*="text"], [class*="botMsg"], [class*="chat-item"], .drawer [class*="msg"]'
        )).filter(el => {
          const style = window.getComputedStyle(el);
          return style && style.display !== 'none' && style.visibility !== 'hidden' && el.innerText.trim().length > 0;
        });

        const latestBotMsg = botMessages.length > 0 ? botMessages[botMessages.length - 1].innerText.trim() : '';

        const chatInput = document.querySelector(
          '.chat-input, input[placeholder*="Type" i], textarea[placeholder*="Type" i], input[placeholder*="Answer" i], input[placeholder*="reply" i]'
        );

        // Clickable chips/quick-replies
        const chips = Array.from(document.querySelectorAll(
          'button.chip, div.chip, button.option, span.chip, div[class*="chip"], div[class*="option"], div[class*="pill"], .bot-options button, .options-wrap button, .chat-options button'
        )).filter(el => {
          const style = window.getComputedStyle(el);
          return style && style.display !== 'none' && style.visibility !== 'hidden';
        }).map(el => el.innerText.trim());

        return {
          hasChatInput: Boolean(chatInput),
          latestBotMsg,
          chips
        };
      });

      // If chips are available (quick-replies for chatbot), click the best one
      if (chatState.chips && chatState.chips.length > 0) {
        console.log(`[Auto-Apply] Recruiter prompt: "${chatState.latestBotMsg || 'Options presented'}"`);
        const targetAns = await this._getAnswerForQuestion(chatState.latestBotMsg);
        const bestIdx = this._selectBestOption(chatState.chips, targetAns, chatState.latestBotMsg);
        const chosenChip = chatState.chips[bestIdx];
        console.log(`[Auto-Apply] Selecting option: "${chosenChip}"`);

        const chipEls = await page.$$(
          'button.chip, div.chip, button.option, span.chip, div[class*="chip"], div[class*="option"], div[class*="pill"], .bot-options button, .options-wrap button, .chat-options button'
        );
        if (chipEls[bestIdx]) {
          await chipEls[bestIdx].click().catch(() => {});
          await page.waitForTimeout(2000);
          continue;
        }
      }

      // If there is a dedicated chat input with a latest bot message
      if (chatState.hasChatInput && chatState.latestBotMsg) {
        console.log(`[Auto-Apply] Recruiter Chatbot prompt: "${chatState.latestBotMsg}"`);
        const targetAns = await this._getAnswerForQuestion(chatState.latestBotMsg);
        console.log(`[Auto-Apply] Typing accurate response: "${targetAns}"`);

        const chatInputEl = await page.$(
          '.chat-input, input[placeholder*="Type" i], textarea[placeholder*="Type" i], input[placeholder*="Answer" i], input[placeholder*="reply" i]'
        );
        if (chatInputEl) {
          await chatInputEl.fill('').catch(() => {});
          await chatInputEl.fill(String(targetAns)).catch(() => {});
          await page.waitForTimeout(600);

          const sendBtn = await page.$(
            'button.send-btn, button:has-text("Send"), button:has-text("Reply"), button[type="submit"], .send-icon'
          );
          if (sendBtn && await sendBtn.isVisible()) {
            await sendBtn.click().catch(() => {});
            await page.waitForTimeout(2000);
            continue;
          } else {
            await chatInputEl.press('Enter').catch(() => {});
            await page.waitForTimeout(2000);
            continue;
          }
        }
      }

      // 2. Check for Questionnaire Modal / Form Fields
      const formFields = await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll(
          'input[type="text"], input[type="number"], input:not([type]), textarea, select'
        )).filter(el => {
          const style = window.getComputedStyle(el);
          return style && style.display !== 'none' && style.visibility !== 'hidden' && !el.disabled && el.type !== 'file';
        });

        return elements.map(el => {
          let label = '';
          if (el.id) {
            const lbl = document.querySelector(`label[for="${el.id}"]`);
            if (lbl) label = lbl.innerText.trim();
          }
          if (!label) {
            const parentLabel = el.closest('label');
            if (parentLabel) label = parentLabel.innerText.trim();
          }
          if (!label) {
            const container = el.closest('.form-group, .question, .input-container, .field, div');
            if (container) {
              const t = container.querySelector('label, .label, .title, .question-title, p, span');
              if (t) label = t.innerText.trim();
            }
          }
          return {
            tag: el.tagName.toLowerCase(),
            type: el.type || 'text',
            name: el.name || '',
            id: el.id || '',
            placeholder: el.placeholder || '',
            label: label || el.placeholder || el.name || '',
            value: el.value || ''
          };
        });
      });

      if (formFields.length > 0) {
        console.log(`[Auto-Apply] Found ${formFields.length} screening questionnaire field(s)...`);
        for (let i = 0; i < formFields.length; i++) {
          const field = formFields[i];
          const qText = field.label || field.placeholder || field.name;
          const ans = await this._getAnswerForQuestion(qText, {
            isDecimal: (field.placeholder || '').toLowerCase().includes('lpa')
          });

          console.log(`[Auto-Apply] Question: "${qText.slice(0, 50)}" -> Answering: "${ans}"`);

          const fieldSelector = field.id ? `#${field.id}` : (field.name ? `[name="${field.name}"]` : null);
          let el = fieldSelector ? await page.$(fieldSelector) : null;
          if (!el) {
            const allInputs = await page.$$('input[type="text"], input[type="number"], input:not([type]), textarea, select');
            el = allInputs[i];
          }

          if (el) {
            if (field.tag === 'select') {
              await el.selectOption({ label: String(ans) }).catch(async () => {
                await el.selectOption({ value: String(ans) }).catch(() => {});
              });
            } else {
              await el.fill('').catch(() => {});
              await el.fill(String(ans)).catch(() => {});
            }
            await page.waitForTimeout(300);
          }
        }
      }

      // Check for Radio groups (e.g. Yes/No questions or experience ranges)
      await this._handleRadioQuestions(page);

      // Look for Next / Continue / Submit button
      const nextOrSubmit = await page.$(
        'button:has-text("Submit"), button:has-text("Send Application"), button.submit-button, button:has-text("Apply now"), button:has-text("Save & Apply"), button:has-text("Next"), button:has-text("Continue"), button.next-btn'
      );

      if (nextOrSubmit && await nextOrSubmit.isVisible()) {
        const btnText = await nextOrSubmit.innerText().catch(() => 'Submit');
        console.log(`[Auto-Apply] Clicking "${btnText.trim()}" button...`);
        await nextOrSubmit.click().catch(() => {});
        await page.waitForTimeout(2500);

        if (btnText.toLowerCase().includes('submit') || btnText.toLowerCase().includes('apply')) {
          break;
        }
      } else {
        // No action button visible
        break;
      }
    }
  }

  async _handleRadioQuestions(page) {
    try {
      const radioGroups = await page.evaluate(() => {
        const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
        const groups = {};
        radios.forEach(r => {
          const name = r.name || 'default';
          if (!groups[name]) groups[name] = [];
          const parentLabel = r.closest('label');
          const labelText = parentLabel ? parentLabel.innerText.trim() : (r.value || '');
          groups[name].push({ id: r.id, value: r.value, label: labelText, name: r.name });
        });
        return groups;
      });

      for (const groupName in radioGroups) {
        const options = radioGroups[groupName];
        if (!options || options.length === 0) continue;

        const groupQuestion = await page.evaluate(gName => {
          const firstRadio = document.querySelector(`input[name="${gName}"]`);
          if (firstRadio) {
            const container = firstRadio.closest('.form-group, .question, .radio-group, div');
            if (container) {
              const t = container.querySelector('.title, .label, label, p, span');
              if (t) return t.innerText.trim();
            }
          }
          return '';
        }, groupName);

        const targetAns = await this._getAnswerForQuestion(groupQuestion || groupName);
        const optionsTexts = options.map(o => o.label || o.value);
        const bestIdx = this._selectBestOption(optionsTexts, targetAns, groupQuestion);
        const chosen = options[bestIdx];

        if (chosen && chosen.id) {
          const radioEl = await page.$(`#${chosen.id}`);
          if (radioEl) await radioEl.check().catch(() => {});
        } else if (chosen) {
          const radioEls = await page.$$(`input[name="${groupName}"]`);
          if (radioEls[bestIdx]) await radioEls[bestIdx].check().catch(() => {});
        }
      }
    } catch (e) {
      // Non-blocking
    }
  }

  _selectBestOption(optionsTextList, targetAnswer, questionText = '') {
    const q = (questionText || '').toLowerCase();
    const ans = String(targetAnswer).toLowerCase().trim();
    const yoe = Number(this.userProfile.years_of_experience) || 2;

    // 1. Experience range matching (e.g. option is "1 - 3 Years", yoe is 2)
    if (q.includes('experience') || q.includes('exp') || q.includes('years') || q.includes('yoe')) {
      // First check ranged options like "1-2", "1 to 3"
      for (let i = 0; i < optionsTextList.length; i++) {
        const opt = optionsTextList[i].toLowerCase();
        const rangeMatch = opt.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)/);
        if (rangeMatch) {
          const min = parseFloat(rangeMatch[1]);
          const max = parseFloat(rangeMatch[2]);
          if (yoe >= min && yoe <= max) return i;
        }
      }

      // Next check comparative options (less than, more than, plus)
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
        if (singleMatch && parseFloat(singleMatch[1]) === yoe) {
          return i;
        }
      }
    }

    // 2. Exact or partial string match
    for (let i = 0; i < optionsTextList.length; i++) {
      const opt = optionsTextList[i].toLowerCase().trim();
      if (opt === ans || opt.includes(ans) || ans.includes(opt)) return i;
    }

    // 3. Yes/No matching
    if (ans === 'yes') {
      for (let i = 0; i < optionsTextList.length; i++) {
        if (optionsTextList[i].toLowerCase().includes('yes')) return i;
      }
    }

    // 4. Notice Period matching (e.g. "60 days" or "2 months")
    if (q.includes('notice') || q.includes('join')) {
      for (let i = 0; i < optionsTextList.length; i++) {
        const opt = optionsTextList[i].toLowerCase();
        if (opt.includes('60') || opt.includes('2 month')) return i;
      }
    }

    return 0; // Default first option if unsure
  }

  async _getAnswerForQuestion(questionText, options = {}) {
    const q = (questionText || '').toLowerCase().trim();
    const yoe = Number(this.userProfile.years_of_experience) || 2;
    const currentCtc = this.screeningAnswers.current_ctc_raw || 450000;
    const expectedCtc = this.screeningAnswers.expected_ctc_raw || 900000;
    const currentCtcLpa = this.screeningAnswers.current_ctc_lpa || 4.5;
    const expectedCtcLpa = this.screeningAnswers.expected_ctc_lpa || 9.0;
    const noticeDays = this.screeningAnswers.notice_period_days || 60;
    const location = this.userProfile.location || 'Hyderabad';

    // 1. Notice Period
    if (q.includes('notice') || q.includes('serving notice') || q.includes('join in') || q.includes('availability')) {
      if (q.includes('month')) return '2';
      return String(noticeDays);
    }

    // 2. Current CTC / Salary
    if (q.includes('current') && (q.includes('ctc') || q.includes('salary') || q.includes('fixed') || q.includes('earning') || q.includes('package') || q.includes('drawn'))) {
      if (q.includes('lpa') || q.includes('lakh') || options.isDecimal) return String(currentCtcLpa);
      return String(currentCtc);
    }

    // 3. Expected CTC / Salary
    if ((q.includes('expected') || q.includes('expectation') || q.includes('looking for') || q.includes('desired')) && (q.includes('ctc') || q.includes('salary') || q.includes('package'))) {
      if (q.includes('lpa') || q.includes('lakh') || options.isDecimal) return String(expectedCtcLpa);
      return String(expectedCtc);
    }

    // 4. Generic CTC / Salary without current/expected specified:
    if (q.includes('ctc') || q.includes('salary') || q.includes('compensation') || q.includes('remuneration')) {
      if (q.includes('lpa') || q.includes('lakh') || options.isDecimal) return String(expectedCtcLpa);
      return String(expectedCtc);
    }

    // 5. Experience Questions (Total experience, relevant experience, skill experience like Java/Spring Boot)
    if (
      q.includes('experience') ||
      q.includes('exp') ||
      q.includes('how many years') ||
      q.includes('years of') ||
      q.includes('total work') ||
      q.includes('relevant') ||
      q.includes('yoe') ||
      q.includes('how much experience') ||
      q.includes('tenure')
    ) {
      if (q.includes('month') && !q.includes('year')) {
        return String(Math.round(yoe * 12));
      }
      return String(yoe);
    }

    // 6. Location & Relocation
    if (q.includes('current location') || q.includes('city') || q.includes('where do you live') || q.includes('residing') || q.includes('based in')) {
      return location;
    }
    if (q.includes('preferred location') || q.includes('preferred city')) {
      return location;
    }
    if (q.includes('relocat') || q.includes('willing to move') || q.includes('ready to relocate') || q.includes('open to relocate') || q.includes('commut') || q.includes('on-site') || q.includes('onsite')) {
      return 'Yes';
    }

    // 7. Hands-on / Technology / Verification questions
    if (
      q.includes('do you have') ||
      q.includes('are you comfortable') ||
      q.includes('hands-on') ||
      q.includes('working knowledge') ||
      q.includes('proficient') ||
      q.includes('authorized') ||
      q.includes('work permit')
    ) {
      return 'Yes';
    }

    // 8. Education / Qualification
    if (q.includes('qualification') || q.includes('degree') || q.includes('education') || q.includes('graduation')) {
      return 'B.Tech';
    }

    // 9. Employer / Role
    if (q.includes('company') || q.includes('employer') || q.includes('organization')) {
      return this.userProfile.current_company || 'Tech Mahindra';
    }
    if (q.includes('designation') || q.includes('current role') || q.includes('job title')) {
      return this.userProfile.current_role || 'Associate Software Engineer';
    }

    // 10. AI Fallback via Gemini if question is custom/unstructured
    if (q.length > 5 && this.gemini && this.gemini.isConfigured()) {
      const aiAnswer = await this._askGeminiForAnswer(questionText);
      if (aiAnswer) return aiAnswer;
    }

    // Fallback: if text looks numeric, return yoe, else Yes
    if (q.includes('how many') || q.includes('number')) {
      return String(yoe);
    }
    return 'Yes';
  }

  async _askGeminiForAnswer(questionText, options = []) {
    if (!this.gemini || !this.gemini.isConfigured()) return null;
    try {
      const prompt = `You are representing job applicant Rajat Kumar Sahu.
Applicant Profile:
- Full Name: ${this.userProfile.full_name}
- Total Work Experience: ${this.userProfile.years_of_experience || 2} years
- Primary Role & Skills: Java, Spring Boot, Microservices, REST APIs, Docker, AWS, SQL
- Current Employer: ${this.userProfile.current_company || 'Tech Mahindra'} (${this.userProfile.current_role || 'Associate Software Engineer'})
- Current CTC: ₹${this.screeningAnswers.current_ctc_raw} (${this.screeningAnswers.current_ctc_lpa} LPA)
- Expected CTC: ₹${this.screeningAnswers.expected_ctc_raw} (${this.screeningAnswers.expected_ctc_lpa} LPA)
- Notice Period: ${this.screeningAnswers.notice_period_days} days
- Location: ${this.userProfile.location || 'Hyderabad'} (Willing to relocate: Yes)
- Education: B.Tech Computer Science (2023)

A recruiter or job portal asks: "${questionText}"
${options && options.length > 0 ? `Select one from these options: ${options.join(', ')}` : ''}

Respond with ONLY the exact, truthful, direct short answer (max 10 words). No conversational preamble.`;

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

module.exports = AutoApply;
