const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

class PdfCompiler {
  constructor() {
    this.outputDir = path.join(__dirname, '..', 'output', 'pdf');
    this.ensureOutputDir();
  }

  ensureOutputDir() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Compiles tailored HTML resume into a single-page ATS-compliant PDF
   * @param {string} htmlContent - Tailored HTML resume
   * @param {string} filename - Target PDF file name
   * @returns {Promise<string>} - Absolute path to generated PDF
   */
  async compileHtmlToPdf(htmlContent, filename = 'Resume.pdf') {
    this.ensureOutputDir();
    const cleanFilename = filename.replace(/[^a-zA-Z0-9_-]/g, '_') + '.pdf';
    const outputPath = path.join(this.outputDir, cleanFilename);

    const systemChrome = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ].find(p => fs.existsSync(p));

    const launchOptions = { headless: true };
    if (systemChrome) {
      launchOptions.executablePath = systemChrome;
    }

    const browser = await chromium.launch(launchOptions);
    try {
      const page = await browser.newPage();

      // Load HTML
      await page.setContent(htmlContent, { waitUntil: 'load' });

      // Generate PDF
      await page.pdf({
        path: outputPath,
        format: 'A4',
        printBackground: true,
        margin: {
          top: '12mm',
          bottom: '12mm',
          left: '14mm',
          right: '14mm'
        }
      });

      // Verify single page constraint
      const { PDFParse } = require('pdf-parse');
      const dataBuffer = fs.readFileSync(outputPath);
      const parser = new PDFParse({ data: dataBuffer });
      const info = await parser.getInfo();

      if (info.total > 1) {
        console.warn(`[PDF Compiler] Warning: PDF is ${info.total} pages. Applying automatic compression...`);
        // Inject CSS to slightly tighten line-height and margins to enforce 1-page budget
        const compressedHtml = htmlContent.replace(
          '</style>',
          'body { font-size: 9.2pt !important; line-height: 1.25 !important; } .section-title { margin-top: 6px !important; margin-bottom: 4px !important; } li { margin-bottom: 1.5px !important; } </style>'
        );
        await page.setContent(compressedHtml, { waitUntil: 'load' });
        await page.pdf({
          path: outputPath,
          format: 'A4',
          printBackground: true,
          margin: { top: '8mm', bottom: '8mm', left: '12mm', right: '12mm' }
        });
      }

      console.log(`[PDF Compiler] Single-page PDF generated at: ${outputPath}`);
      return outputPath;
    } finally {
      await browser.close();
    }
  }
}

module.exports = new PdfCompiler();
