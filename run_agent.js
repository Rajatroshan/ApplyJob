#!/usr/bin/env node

require('dotenv').config();
const { program } = require('commander');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const pdf = require('pdf-parse');

const db = require('./core/database');
const geminiTailor = require('./core/gemini_tailor');
const pdfCompiler = require('./core/pdf_compiler');
const NaukriScraper = require('./scrapers/naukri_scraper');
const LinkedinScraper = require('./scrapers/linkedin_scraper');
const AutoApply = require('./core/auto_apply');
const LinkedinAutoApply = require('./core/linkedin_auto_apply');

// Load default settings
const settingsPath = path.join(__dirname, 'config', 'settings.json');
let settings = {};
if (fs.existsSync(settingsPath)) {
  settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}

program
  .name('naukri-agent')
  .description('Autonomous Zero-Cost Job Application & Resume Tailoring Agent')
  .version('1.0.0')
  .option('-p, --platform <platform>', 'Job platform: naukri or linkedin', 'naukri')
  .option('-i, --interactive', 'Interactively ask role, yoe, location, and CTC at start', false)
  .option('-r, --resume <path>', 'Path to your standard resume file (.pdf, .html, .tex)')
  .option('-k, --keywords <string>', 'Job search keywords', settings.job_filters?.keywords || 'Java Developer')
  .option('-c, --location <city>', 'Location preference', 'Hyderabad')
  .option('-t, --tech <string>', 'Target tech stack constraints (comma-separated)', (settings.user_profile?.core_skills || ['Java', 'Spring Boot']).join(', '))
  .option('-y, --yoe <number>', 'Years of Experience (YoE)', 1)
  .option('--current-ctc <number>', 'Current CTC in INR', settings.screening_answers?.current_ctc_raw || 450000)
  .option('--expected-ctc <number>', 'Expected CTC in INR', settings.screening_answers?.expected_ctc_raw || 900000)
  .option('--notice <days>', 'Notice period in days', settings.screening_answers?.notice_period_days || 60)
  .option('-l, --limit <number>', 'Maximum matching jobs to process', 3)
  .option('-m, --mode <mode>', 'Execution mode: dry-run (generate PDFs only) or auto-apply (submit live)', 'dry-run')
  .option('--headed', 'Launch a visible browser window on your desktop screen to watch it live', false)
  .option('--slow <ms>', 'Milliseconds delay between actions so you can watch comfortably', 600)
  .parse(process.argv);

const options = program.opts();

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans.trim());
  }));
}

async function extractResumeContent(resumePath) {
  if (!resumePath || !fs.existsSync(resumePath)) {
    return null;
  }
  const ext = path.extname(resumePath).toLowerCase();
  console.log(`[Agent] Ingesting standard resume from: ${resumePath}`);

  if (ext === '.pdf') {
    const { PDFParse } = require('pdf-parse');
    const dataBuffer = fs.readFileSync(resumePath);
    const parser = new PDFParse({ data: dataBuffer });
    const textResult = await parser.getText();
    return { type: 'pdf', raw_text: textResult.text };
  } else if (ext === '.html' || ext === '.htm') {
    return { type: 'html', raw_text: fs.readFileSync(resumePath, 'utf8') };
  } else if (ext === '.tex') {
    return { type: 'tex', raw_text: fs.readFileSync(resumePath, 'utf8') };
  }
  return null;
}

async function main() {
  console.log('\n======================================================');
  console.log('🚀 AUTONOMOUS JOB APPLICATION & RESUME TAILORING AGENT');
  console.log('======================================================\n');

  if (options.interactive) {
    console.log('📋 Runtime Search & Application Constraints (Press [Enter] to keep default):');
    const roleAns = await askQuestion(`1. Target Job Role [${options.keywords}]: `);
    if (roleAns) options.keywords = roleAns;

    const yoeAns = await askQuestion(`2. Experience in Years [${options.yoe}]: `);
    if (yoeAns) options.yoe = Number(yoeAns);

    const locAns = await askQuestion(`3. Preferred Location [${options.location}]: `);
    if (locAns) options.location = locAns;

    const curCtc = await askQuestion(`4. Current CTC [₹${options.currentCtc}]: `);
    if (curCtc) options.currentCtc = Number(curCtc.replace(/[^0-9]/g, ''));

    const expCtc = await askQuestion(`5. Expected CTC [₹${options.expectedCtc}]: `);
    if (expCtc) options.expectedCtc = Number(expCtc.replace(/[^0-9]/g, ''));

    const noticeAns = await askQuestion(`6. Notice Period in Days [${options.notice}]: `);
    if (noticeAns) options.notice = Number(noticeAns);
    console.log('');
  }

  // Update screening answers with active runtime values
  settings.screening_answers = {
    ...settings.screening_answers,
    current_ctc_raw: Number(options.currentCtc),
    current_ctc_lpa: Number(options.currentCtc) / 100000,
    expected_ctc_raw: Number(options.expectedCtc),
    expected_ctc_lpa: Number(options.expectedCtc) / 100000,
    notice_period_days: Number(options.notice)
  };

  let resumePath = options.resume;
  if (!resumePath) {
    const defaultTemplate = path.join(__dirname, 'templates', 'base_resume.html');
    if (fs.existsSync(defaultTemplate)) {
      resumePath = defaultTemplate;
      console.log('ℹ Using configured standard resume template: templates/base_resume.html');
    }
  }

  // Parse Resume if provided
  const parsedResume = await extractResumeContent(resumePath);
  const userProfile = {
    ...settings.user_profile,
    core_skills: options.tech.split(',').map(s => s.trim()),
    years_of_experience: Number(options.yoe)
  };

  if (parsedResume && parsedResume.raw_text) {
    console.log(`[Agent] Extracted ${parsedResume.raw_text.length} characters of profile context from resume.`);
    userProfile.raw_resume_context = parsedResume.raw_text;
  }

  const techStackList = options.tech.split(',').map(s => s.trim());

  const isLinkedIn = (options.platform || 'naukri').toLowerCase() === 'linkedin';

  console.log('\n--- Active Runtime Constraints ---');
  console.log(`• Target Platform:  ${isLinkedIn ? 'LINKEDIN (Easy Apply)' : 'NAUKRI.COM'}`);
  console.log(`• Job Role:         ${options.keywords}`);
  console.log(`• Location:         ${options.location}`);
  console.log(`• Experience Req:   ${options.yoe} Years`);
  console.log(`• Target Tech:      ${techStackList.join(', ')}`);
  console.log(`• Current CTC:      ₹${options.currentCtc.toLocaleString ? options.currentCtc.toLocaleString('en-IN') : options.currentCtc}`);
  console.log(`• Expected CTC:     ₹${options.expectedCtc.toLocaleString ? options.expectedCtc.toLocaleString('en-IN') : options.expectedCtc}`);
  console.log(`• Notice Period:    ${options.notice} Days`);
  console.log(`• Max Jobs:         ${options.limit}`);
  console.log(`• Execution Mode:   ${options.mode.toUpperCase()}`);
  console.log(`• Browser Mode:     ${options.headed ? 'VISIBLE (Desktop Window)' : 'HEADLESS (Background)'}`);
  console.log(`• Gemini API:       ${geminiTailor.isConfigured() ? 'CONFIGURED (Gemini 3.6 Flash)' : 'FALLBACK MODE (Local ATS Token Matcher)'}`);
  console.log('----------------------------------\n');

  // Step 1: Initialize Scraper
  const browserConfig = {
    ...settings.browser_config,
    headless: !options.headed,
    slowMo: Number(options.slow) || (options.headed ? 600 : 0)
  };
  const scraper = isLinkedIn
    ? new LinkedinScraper(browserConfig)
    : new NaukriScraper(browserConfig);

  console.log(`[Agent] Stage 1: Initiating stealth job discovery on ${isLinkedIn ? 'LinkedIn' : 'Naukri'}...`);

  const matchingJobs = await scraper.searchJobs({
    keywords: options.keywords,
    location: options.location,
    yoe: options.yoe,
    tech_stack: techStackList,
    limit: Number(options.limit)
  });

  if (matchingJobs.length === 0) {
    console.log('[Agent] No new matching jobs found matching your criteria. Try loosening tech filters.');
    process.exit(0);
  }

  console.log(`\n[Agent] Successfully retrieved ${matchingJobs.length} matching jobs.\n`);

  // Step 2: Tailor Resumes & Compile PDFs
  const processedJobs = [];

  for (let i = 0; i < matchingJobs.length; i++) {
    const job = matchingJobs[i];
    console.log(`\n--- Processing [${i + 1}/${matchingJobs.length}]: ${job.company} - ${job.title} ---`);

    // Check database to prevent duplicate applications
    if (db.isAlreadyApplied(job.job_id)) {
      console.log(`[Agent] Already applied to ${job.company} previously. Skipping.`);
      continue;
    }

    db.saveJob({ ...job, status: 'DISCOVERED' });

    // Step 2a: Gemini Resume Tailoring
    console.log(`[Agent] Stage 2: Tailoring resume bullet points for ATS match...`);
    const tailoredHtml = await geminiTailor.tailorResume(userProfile, job);

    // Step 2b: Local Single-Page PDF Compilation
    console.log(`[Agent] Stage 3: Compiling single-page PDF...`);
    const pdfFilename = `${job.company}_${job.title}`;
    const pdfPath = await pdfCompiler.compileHtmlToPdf(tailoredHtml, pdfFilename);

    db.saveJob({ ...job, status: 'TAILORED', tailored_resume_path: pdfPath });

    // Step 2c: Application Submission
    if (options.mode === 'auto-apply') {
      console.log(`[Agent] Stage 4: Submitting application on portal...`);
      const { browser, context, isCdp } = await scraper.getBrowserContext();
      const autoApplier = isLinkedIn
        ? new LinkedinAutoApply(context, settings)
        : new AutoApply(context, settings);
      const result = await autoApplier.apply(job, pdfPath);

      if (result.success) {
        db.markApplied(job.job_id, pdfPath);
        processedJobs.push({ ...job, status: 'APPLIED', pdf: pdfPath });
      } else {
        db.saveJob({ ...job, status: 'FLAGGED_FOR_MANUAL', reason: result.message });
        processedJobs.push({ ...job, status: 'MANUAL_REQUIRED', pdf: pdfPath, reason: result.message });
      }

      if (isCdp && browser) browser.disconnect();
      else if (context) await context.close();
    } else {
      console.log(`[Agent] [DRY RUN] Generated tailored single-page PDF at: ${pdfPath}`);
      processedJobs.push({ ...job, status: 'READY_TO_APPLY', pdf: pdfPath });
    }
  }

  // Summary Report
  console.log('\n======================================================');
  console.log('📊 EXECUTION SUMMARY REPORT');
  console.log('======================================================');
  processedJobs.forEach((j, idx) => {
    console.log(`[${idx + 1}] ${j.company.padEnd(20)} | ${j.title.padEnd(25)} | Status: ${j.status}`);
    console.log(`    📄 Resume: ${j.pdf}`);
    if (j.reason) console.log(`    ℹ Note:   ${j.reason}`);
  });
  console.log('======================================================\n');
}

main().catch(err => {
  console.error('\n[Agent Error]:', err);
  process.exit(1);
});
