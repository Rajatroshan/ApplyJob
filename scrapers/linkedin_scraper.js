const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

class LinkedinScraper {
  constructor(config = {}) {
    this.cdpUrl = config.cdp_url || 'http://localhost:9222';
    this.userDataDir = config.user_data_dir || 'C:\\ChromeProfile';
    this.headless = config.headless !== undefined ? config.headless : false;
    this.slowMo = config.slowMo || 0;
  }

  async getBrowserContext() {
    // Strategy 1: Check active CDP Chrome
    try {
      console.log(`[LinkedIn Scraper] Checking for existing Chrome CDP session at ${this.cdpUrl}...`);
      const browser = await chromium.connectOverCDP(this.cdpUrl, { timeout: 3000 });
      const contexts = browser.contexts();
      const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
      console.log(`[LinkedIn Scraper] Connected successfully to active Chrome session via CDP!`);
      return { browser, context, isCdp: true };
    } catch (e) {
      // Strategy 2: Persistent profile
    }

    console.log(`[LinkedIn Scraper] Launching Chrome with profile at ${this.userDataDir}...`);
    if (!fs.existsSync(this.userDataDir)) {
      fs.mkdirSync(this.userDataDir, { recursive: true });
    }

    const systemChrome = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ].find(p => fs.existsSync(p));

    const launchOpts = {
      headless: this.headless,
      slowMo: this.slowMo,
      viewport: null,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      args: ['--disable-blink-features=AutomationControlled', '--start-maximized']
    };

    if (systemChrome) {
      launchOpts.executablePath = systemChrome;
    }

    const context = await chromium.launchPersistentContext(this.userDataDir, launchOpts);
    return { browser: null, context, isCdp: false };
  }

  /**
   * Search and scrape matching Easy Apply jobs from LinkedIn
   * @param {Object} options - Search constraints
   * @returns {Promise<Array>} - List of matching job objects
   */
  async searchJobs(options = {}) {
    const keywords = encodeURIComponent(options.keywords || 'Backend Developer');
    const location = encodeURIComponent(options.location || 'India');
    const targetTech = (options.tech_stack || ['Java', 'Spring Boot']).map(t => t.toLowerCase().trim());
    const limit = options.limit || 10;

    // f_AL=true filters for Easy Apply jobs specifically
    const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${keywords}&location=${location}&f_AL=true&origin=JOB_SEARCH_PAGE_JOB_FILTER`;
    console.log(`[LinkedIn Scraper] Navigating to: ${searchUrl}`);

    const { browser, context, isCdp } = await this.getBrowserContext();
    const page = await context.newPage();
    const jobs = [];

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(3500);

      // Check if logged in
      const currentUrl = page.url();
      if (currentUrl.includes('/login') || currentUrl.includes('/authwall')) {
        console.warn('\n⚠️ [LinkedIn] You are not logged in to LinkedIn in this browser profile!');
        console.warn('👉 Please run "login_to_linkedin.bat" once to log in, then re-run the agent.\n');
      }

      // Locate job list container and items
      const cardSelector = '.jobs-search-results__list-item, div.job-card-container, li.scaffold-layout__list-item';
      await page.waitForSelector(cardSelector, { timeout: 10000 }).catch(() => {});

      let scrollAttempts = 0;
      while (jobs.length < limit && scrollAttempts < 8) {
        scrollAttempts++;
        const jobCards = await page.$$(cardSelector);
        console.log(`[LinkedIn Scraper] Found ${jobCards.length} job cards on current view (pass ${scrollAttempts}).`);

        if (jobCards.length === 0) break;

        for (let i = 0; i < jobCards.length && jobs.length < limit; i++) {
          const card = jobCards[i];

          try {
            await card.scrollIntoViewIfNeeded().catch(() => {});

            if (!this.headless) {
              await card.evaluate(node => {
                node.style.outline = '3px solid #f59e0b';
                node.style.transition = 'all 0.3s ease';
              }).catch(() => {});
              await page.waitForTimeout(300);
            }

            // Extract preview details
            const title = await card.$eval(
              '.job-card-list__title, .artdeco-entity-lockup__title a, strong',
              e => e.innerText.trim()
            ).catch(() => '');

            const company = await card.$eval(
              '.job-card-container__primary-description, .artdeco-entity-lockup__subtitle',
              e => e.innerText.trim()
            ).catch(() => 'Company');

            const cardLocation = await card.$eval(
              '.job-card-container__metadata-item, .artdeco-entity-lockup__caption',
              e => e.innerText.trim()
            ).catch(() => 'India');

            // Extract canonical job view URL
            let jobUrl = await card.$eval('a[href*="/jobs/view/"]', a => a.href).catch(() => '');
            let jobId = '';
            let rawJobId = '';
            if (jobUrl) {
              const m = jobUrl.match(/\/jobs\/view\/(\d+)/);
              if (m) {
                rawJobId = m[1];
                jobId = `li_${rawJobId}`;
                jobUrl = `https://www.linkedin.com/jobs/search/?currentJobId=${rawJobId}&f_AL=true`;
              }
            }

            // Check duplicate
            if (jobs.some(j => (jobId && j.job_id === jobId) || (j.company.toLowerCase() === company.toLowerCase() && j.title.toLowerCase() === title.toLowerCase()))) {
              continue;
            }

            // Click card to load full JD in the right preview pane
            await card.click().catch(() => {});
            await page.waitForTimeout(1200);

            if (!jobId) {
              const currentJobId = await page.evaluate(() => {
                const m = window.location.href.match(/currentJobId=(\d+)/);
                return m ? m[1] : null;
              });
              if (currentJobId) {
                jobId = `li_${currentJobId}`;
                jobUrl = `https://www.linkedin.com/jobs/search/?currentJobId=${currentJobId}&f_AL=true`;
              } else {
                jobId = `li_${Date.now()}_${i}`;
                jobUrl = page.url();
              }
            }

            // Extract full JD text from the right panel
            const jdText = await page.$eval(
              '#job-details, .jobs-description__content, .jobs-box__html-content',
              e => e.innerText.trim()
            ).catch(() => '');

            const allText = `${title} ${company} ${jdText}`.toLowerCase();

            // Apply Tech Stack Constraint Filter
            const matchesTech = targetTech.some(tech => allText.includes(tech));
            if (!matchesTech) {
              if (!this.headless) {
                await card.evaluate(node => {
                  node.style.outline = '1px solid #cbd5e1';
                  node.style.opacity = '0.5';
                }).catch(() => {});
              }
              console.log(`[LinkedIn Scraper] Skipping "${title}" at ${company} - Does not match tech constraints.`);
              continue;
            }

            if (!this.headless) {
              await card.evaluate(node => {
                node.style.outline = '4px solid #10b981';
                node.style.backgroundColor = '#ecfdf5';
              }).catch(() => {});
            }

            jobs.push({
              job_id: jobId,
              title,
              company,
              location: cardLocation,
              experience_req: options.yoe ? `${options.yoe}+ Years` : 'Mid-Level',
              skills: targetTech,
              jd_text: jdText.slice(0, 3000) || `${title} at ${company}. Requirements: ${targetTech.join(', ')}`,
              apply_url: jobUrl,
              source: 'linkedin'
            });

            console.log(`[LinkedIn Scraper] ✓ Matched Job [${jobs.length}/${limit}]: ${title} at ${company}`);
          } catch (cardErr) {
            // Continue to next card
          }
        }

        // Scroll the list down to trigger lazy loading of more job cards
        await page.evaluate(() => {
          const list = document.querySelector('.jobs-search-results-list, .scaffold-layout__list-detail-inner');
          if (list) list.scrollTop += 800;
        });
        await page.waitForTimeout(1500);
      }

      return jobs;
    } catch (err) {
      console.error(`[LinkedIn Scraper] Error during scraping: ${err.message}`);
      return jobs;
    } finally {
      await page.close();
      if (isCdp && browser) {
        browser.disconnect();
      } else if (context) {
        await context.close();
      }
    }
  }
}

module.exports = LinkedinScraper;

