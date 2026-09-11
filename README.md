# 🚀 Autonomous Job Application & ATS Resume Tailoring Agent

An open-source, local-first, **100% zero-cost** autonomous agent that automates the job search and application workflow:
1. **Discovers** jobs on portals (like Naukri.com) using Playwright.
2. **Filters** positions strictly based on your runtime constraints (Tech Stack & Years of Experience).
3. **Tailors** your authentic LaTeX / HTML resume using **Google Gemini 3.6 Flash** (Free Tier) to optimize ATS keyword matching with zero hallucinations.
4. **Compiles** pixel-perfect, guaranteed single-page PDFs locally.
5. **Submits** applications automatically or runs in safe `--mode dry-run`.

---

## 🌟 Key Features

- **100% Zero Cost:** Uses Google AI Studio free tier, local Chrome automation via Playwright, and local PDF compilation. Zero paid proxy or API subscriptions required.
- **Stealth Browser Automation:** Reuses your real Chrome profile via persistent context or Chrome DevTools Protocol (CDP) to bypass Cloudflare, Akamai, and anti-bot checks.
- **Zero-Hallucination Guardrails:** Strictly preserves your authentic employment dates, companies, and degrees—only enhances and aligns accomplishment bullet points with target job descriptions.
- **Single-Page Budget Validator:** Enforces strict 1-page constraints on generated PDFs with automated whitespace and margin tuning.
- **Audit Database:** Tracks the entire application lifecycle (`DISCOVERED`, `TAILORED`, `APPLIED`) in a local embedded database to prevent duplicate applications.

---

## 🛠️ Project Structure

```plaintext
├── config/
│   └── settings.json          # Candidate details, search filters & screening answers
├── core/
│   ├── auto_apply.js          # Modal interaction and application submitter
│   ├── database.js            # Embedded local job tracker & deduplication
│   ├── gemini_tailor.js       # Gemini 3.6 Flash ATS tailoring engine
│   └── pdf_compiler.js        # Local Chromium single-page PDF generator
├── scrapers/
│   └── naukri_scraper.js      # Playwright stealth scraper with visual animations
├── templates/
│   ├── base_resume.html       # ATS-optimized single-page HTML resume
│   └── base_resume.tex        # Clean single-page LaTeX template
├── output/
│   └── pdf/                   # Generated role-specific PDFs
├── .env.example               # Configuration template
├── login_to_naukri.bat        # 1-click script for one-time Naukri login
├── watch_agent.bat            # 1-click script to run agent in visible desktop mode
├── run_agent.js               # CLI runner
└── package.json               # Node.js dependencies
```

---

## 🚀 Quick Start

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- Google Chrome installed

### 2. Installation
```bash
git clone https://github.com/Rajatroshan/ApplyJob.git
cd ApplyJob
npm install
```

### 3. Configure API Key
Create a `.env` file (copied from `.env.example`) and add your free Gemini API key from [Google AI Studio](https://aistudio.google.com/):
```ini
GEMINI_API_KEY=your_free_gemini_api_key
```

### 4. Configure Your Profile
Edit `config/settings.json` with your real candidate details, notice period, and CTC preferences.

---

## 🖥️ Usage

### A. Run in Safe Dry-Run Mode (Visible Desktop Window)
Scrapes jobs and compiles tailored resumes into `output/pdf/` without submitting:
```bash
node run_agent.js --keywords "Backend Developer" --tech "Spring Boot, Docker, AWS" --yoe 2 --limit 3 --mode dry-run --headed
```
*(Or simply double-click `watch_agent.bat`)*

### B. One-Time Login (Enables 1-Click Apply)
Double-click `login_to_naukri.bat` to log in once to your Naukri account so the agent can apply under your verified credentials.

### C. Live Auto-Apply Mode
Automatically submit applications on Naukri:
```bash
node run_agent.js --keywords "Backend Developer" --tech "Spring Boot, Docker, AWS" --yoe 2 --limit 2 --mode auto-apply --headed
```

---

## 📜 License
MIT License
