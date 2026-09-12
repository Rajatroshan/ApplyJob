const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

class NaukriScraper {
  constructor(config = {}) {
    this.cdpUrl = config.cdp_url || 'http://localhost:9222';
    this.userDataDir = config.user_data_dir || path.join(__dirname, '..', '.chrome_session');
    this.headless = config.headless !== undefined ? config.headless : false;
    this.slowMo = config.slowMo || 0;
  }

  async getBrowserContext() {
    // Strategy 1: Try connecting to an already running Chrome with remote debugging
    try {
      console.log(`[Scraper] Checking for existing Chrome CDP session at ${this.cdpUrl}...`);
      const browser = await chromium.connectOverCDP(this.cdpUrl, { timeout: 3000 });
      const contexts = browser.contexts();
      const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
      console.log(`[Scraper] Connected successfully to active Chrome session via CDP!`);
      return { browser, context, isCdp: true };
    } catch (e) {
      console.log(`[Scraper] No active CDP Chrome detected (${e.message}).`);
    }

    // Strategy 2: Launch Playwright with a persistent profile on disk
    console.log(`[Scraper] Launching visible Chrome browser window on your screen...`);
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
      viewport: null, // Allow window to use full native screen size
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
   * Search and scrape matching jobs from Naukri
   * @param {Object} options - Search constraints
   * @returns {Promise<Array>} - List of matching job objects
   */
  async searchJobs(options = {}) {
    const keywords = (options.keywords || 'Java Developer').replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '-').toLowerCase();
    const location = (options.location || '').replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '-').toLowerCase();
    const yoe = options.yoe !== undefined ? options.yoe : (options.yoe_min !== undefined ? options.yoe_min : 1);
    const targetTech = (options.tech_stack || ['Java', 'Spring Boot']).map(t => t.toLowerCase().trim());
    const limit = options.limit || 5;

    let searchUrl = `https://www.naukri.com/${keywords}-jobs?experience=${yoe}`;
    if (location && location !== 'all' && location !== 'india') {
      searchUrl = `https://www.naukri.com/${keywords}-jobs-in-${location}?experience=${yoe}`;
    }
    console.log(`[Scraper] Navigating to: ${searchUrl}`);

    const { browser, context, isCdp } = await this.getBrowserContext();
    const page = await context.newPage();

    const jobs = [];

    try {
      let pageNo = 1;
      const maxPages = 5;

      while (jobs.length < limit && pageNo <= maxPages) {
      let pageUrl = searchUrl;
      if (pageNo > 1) {
        pageUrl = searchUrl.includes('?') ? `${searchUrl}&pageNo=${pageNo}` : `${searchUrl}?pageNo=${pageNo}`;
      }
      console.log(`[Scraper] Scraping page ${pageNo}: ${pageUrl}`);

      try {
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(3000);

        // Scroll to trigger lazy loading of job cards
        await page.evaluate(() => window.scrollBy(0, 800));
        await page.waitForTimeout(1500);

        // Extract job cards
        const jobElements = await page.$$('.srp-jobtuple-wrapper, .jobTuple, article.jobTuple');
        console.log(`[Scraper] Found ${jobElements.length} job cards on page ${pageNo}.`);

        if (jobElements.length === 0) {
          console.log(`[Scraper] No more cards found. Stopping pagination.`);
          break;
        }

        for (let i = 0; i < jobElements.length && jobs.length < limit; i++) {
          const el = jobElements[i];

          try {
            await el.scrollIntoViewIfNeeded().catch(() => {});
            if (!this.headless) {
              await el.evaluate(node => {
                node.style.outline = '3px solid #f59e0b';
                node.style.transition = 'all 0.3s ease';
              }).catch(() => {});
              await page.waitForTimeout(300);
            }

            const title = await el.$eval('.title, a.title', e => e.innerText.trim()).catch(() => '');
            const company = await el.$eval('.comp-name, a.subTitle', e => e.innerText.trim()).catch(() => 'Company');
            const expText = await el.$eval('.expwdth, .experience', e => e.innerText.trim()).catch(() => '');
            const location = await el.$eval('.locWdth, .location', e => e.innerText.trim()).catch(() => 'India');
            const jdSnippet = await el.$eval('.job-desc, .job-description', e => e.innerText.trim()).catch(() => '');
            const jobUrl = await el.$eval('.title, a.title', e => e.href).catch(() => '');

            // Extract tags/skills
            const tags = await el.$$eval('.tags-gt li, .dot-gt li, .tag-li', elements => 
              elements.map(e => e.innerText.trim())
            ).catch(() => []);

            const allText = `${title} ${jdSnippet} ${tags.join(' ')}`.toLowerCase();

            // Apply Tech Stack Constraint Filter
            const matchesTech = targetTech.some(tech => allText.includes(tech));
            if (!matchesTech) {
              if (!this.headless) {
                await el.evaluate(node => {
                  node.style.outline = '1px solid #cbd5e1';
                  node.style.opacity = '0.5';
                }).catch(() => {});
              }
              console.log(`[Scraper] Skipping "${title}" at ${company} - Does not match tech constraints.`);
              continue;
            }

            if (!this.headless) {
              await el.evaluate(node => {
                node.style.outline = '4px solid #10b981';
                node.style.backgroundColor = '#ecfdf5';
              }).catch(() => {});
            }

            const jobId = jobUrl ? jobUrl.split('-').pop() : `naukri_${Date.now()}_${i}`;

            // Avoid adding duplicate postings from the same company in the same batch
            const isDuplicate = jobs.some(
              j => j.job_id === jobId || 
              (j.company.toLowerCase() === company.toLowerCase() && j.title.toLowerCase() === title.toLowerCase())
            );

            if (isDuplicate) {
              console.log(`[Scraper] Skipping duplicate posting from "${company}".`);
              continue;
            }

            jobs.push({
              job_id: jobId,
              title,
              company,
              experience_req: expText,
              location,
              skills: tags,
              jd_text: jdSnippet || `${title} at ${company}. Required skills: ${tags.join(', ')}`,
              apply_url: jobUrl,
              source: 'naukri'
            });

            console.log(`[Scraper] ✓ Matched Job [${jobs.length}/${limit}]: ${title} at ${company} (${expText})`);
          } catch (cardErr) {
            // Ignore individual parsing failure
          }
        }
      } catch (pageErr) {
        console.warn(`[Scraper] Error scraping page ${pageNo}: ${pageErr.message}`);
        break;
      }

      pageNo++;
    }

    return jobs;
    } catch (err) {
      console.error(`[Scraper] Error during scraping: ${err.message}`);
      return jobs;
    } finally {
      await page.close();
      if (isCdp && browser) {
        // Disconnect CDP session without killing the user's browser
        browser.disconnect();
      } else if (context) {
        await context.close();
      }
    }
  }
}

module.exports = NaukriScraper;

