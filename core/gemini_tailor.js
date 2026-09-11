require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

class GeminiTailor {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    if (this.apiKey && this.apiKey !== 'YOUR_GEMINI_API_KEY_HERE') {
      this.ai = new GoogleGenAI({ apiKey: this.apiKey });
    } else {
      this.ai = null;
    }
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiKey !== 'YOUR_GEMINI_API_KEY_HERE');
  }

  /**
   * Tailor resume content for a specific Job Description
   * @param {Object} baseProfile - Candidate profile details from settings.json
   * @param {Object} job - Scraped job details (title, company, jd_text, skills)
   * @returns {Promise<string>} - Complete tailored HTML resume string
   */
  async tailorResume(baseProfile, job) {
    const templatePath = path.join(__dirname, '..', 'templates', 'base_resume.html');
    let template = fs.readFileSync(templatePath, 'utf8');

    let tailoredData = null;

    if (this.isConfigured()) {
      let attempts = 0;
      while (attempts < 3 && !tailoredData) {
        attempts++;
        try {
          console.log(`[Gemini Tailor] Calling Gemini 3.6 Flash for ${job.company} - ${job.title} (attempt ${attempts})...`);
          tailoredData = await this._callGemini(baseProfile, job);
        } catch (err) {
          console.warn(`[Gemini Tailor] Gemini attempt ${attempts} failed (${err.message}).`);
          if (attempts < 3) {
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      }
    }

    if (!tailoredData) {
      tailoredData = this._fallbackTailoring(baseProfile, job);
    }

    // Replace template tokens
    let html = template
      .replace(/{{OBJECTIVE}}/g, tailoredData.objective)
      .replace(/{{SKILLS_LANGUAGES}}/g, tailoredData.skills_languages)
      .replace(/{{SKILLS_BACKEND}}/g, tailoredData.skills_backend)
      .replace(/{{SKILLS_DATABASES}}/g, tailoredData.skills_databases)
      .replace(/{{SKILLS_DEVOPS}}/g, tailoredData.skills_devops)
      .replace(/{{SKILLS_ARCHITECTURE}}/g, tailoredData.skills_architecture)
      .replace(/{{EXP_TECH_MAHINDRA}}/g, tailoredData.exp_tech_mahindra)
      .replace(/{{EXP_EMEDIHUB}}/g, tailoredData.exp_emedihub)
      .replace(/{{PROJECTS_LIST}}/g, tailoredData.projects_list);

    return html;
  }

  async _callGemini(baseProfile, job) {
    const prompt = `
You are an expert Technical Recruiter & ATS Optimization Specialist.
Tailor Rajat Kumar Sahu's resume bullet points and skills to achieve a 95%+ ATS match for this job description.

JOB DETAILS:
Company: ${job.company}
Role: ${job.title}
Job Description:
${job.jd_text ? job.jd_text.slice(0, 2500) : job.title}

AUTHENTIC RESUME FACTUAL GROUND TRUTH (DO NOT FABRICATE OR HALLUCINATE):
Candidate: Rajat Kumar Sahu
Current Role: Associate Software Engineer at Tech Mahindra (Mar 2026 - Present)
Previous Role: Backend Developer at eMediHub Platform, AscendSoft Pte Ltd (May 2025 - Mar 2026)
Core Stack: Java, Spring Boot, Microservices, Docker, CI/CD, AWS, MySQL, PostgreSQL, REST APIs.

RULES:
1. STRICT TRUTH: Do NOT add new degrees, companies, or fake dates. Only rephrase authentic achievements using action verbs and matching technical keywords.
2. ATS TAILORING: Rephrase experience bullet points to emphasize competencies matching the JD (e.g. distributed caching, high availability, containerization, microservice performance).
3. SINGLE PAGE: Keep bullet points punchy and concise.
4. Output MUST be valid JSON only.

JSON SCHEMA:
{
  "objective": "A punchy 3-line objective emphasizing Java/Spring Boot/DevOps aligned with ${job.title} at ${job.company}.",
  "skills_languages": "Java, Python, C, SQL",
  "skills_backend": "Spring Boot (Microservices, Spring Security, JPA), Node.js, Express.js",
  "skills_databases": "MySQL, PostgreSQL, MongoDB, DynamoDB, Redis",
  "skills_devops": "Docker, Docker Compose, CI/CD (GitHub Actions), AWS (EC2, RDS, S3), Linux, PM2, Nginx",
  "skills_architecture": "REST APIs, System Design, Swagger (OpenAPI), WebSocket, Microservices",
  "exp_tech_mahindra": "HTML <li> items (5 bullets) tailored for Tech Mahindra experience highlighting matching keywords",
  "exp_emedihub": "HTML <li> items (5 bullets) tailored for eMediHub experience highlighting matching keywords",
  "projects_list": "HTML <li> items (3 bullets) for Dress-Craft, Shrujan 3.0, and AVYAKT 3.0 highlighting matching tech"
}
`;

    const response = await this.ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

    return JSON.parse(response.text.trim());
  }

  _fallbackTailoring(baseProfile, job) {
    const jdLower = (job.jd_text || '').toLowerCase();

    const techMahindraBullets = [
      `<li>Designed and implemented a module-based backend architecture in Spring Boot, containerizing the application with <strong>Docker</strong> to ensure consistent deployments across environments and drastically improve maintainability.</li>`,
      `<li>Engineered MVC-compliant Controller-Service-DAO layers, increasing code modularity and reducing maintenance effort by 30%.</li>`,
      `<li>Architected optimized MySQL database schemas with Hibernate/JPA (ORM), and developed RESTful APIs achieving 95% functional test coverage.</li>`,
      `<li>Implemented centralized API-level exception handling and input validation, resolving data integrity issues and reducing runtime errors by 35%.</li>`,
      `<li>Managed Agile sprint workflows utilizing <strong>JIRA</strong> and <strong>GitHub Issues</strong>, executing task decomposition and streamlining code integration by raising <strong>Pull Requests (PRs)</strong> to ensure 100% on-time delivery.</li>`
    ];

    const emedihubBullets = [
      `<li>Architected robust backend services for the Virtual Doctor Consultation (VDC) workflows and Patient Dashboard using Node.js and Spring Boot, reducing data retrieval latency by 30%.</li>`,
      `<li>Developed a structured architectural flow for medical consultation booking, engineering the backend payment initiation and gateway verification pipelines to ensure zero-fault transactions.</li>`,
      `<li>Orchestrated containerized environments using Docker Compose and managed server-side process monitoring via PM2, achieving 99.9% uptime across AWS and DigitalOcean deployments.</li>`,
      `<li>Integrated Agora real-time engagement SDK on the server-side to manage secure video consultation rooms and rejoin flows, delivering highly reliable sessions with 99.5% uptime.</li>`,
      `<li>Authored comprehensive Low-Level Design (LLD) documentation for database schemas and API contracts, accelerating cross-functional handoffs by 20%.</li>`
    ];

    const projectsBullets = [
      `<li><strong><a href="https://github.com/Rajatroshan/Dresscraft">Dress-Craft (E-commerce Core):</a></strong> Engineered a robust Spring Boot backend architecture capable of supporting 5,000+ active sessions, focusing on secure REST APIs, authentication, and structured data persistence.</li>`,
      `<li><strong>Shrujan 3.0 (Fest Platform):</strong> Built a Spring Boot backend managing 3,000+ concurrent registrations; configured automated AWS EC2 deployments and reverse proxies with Nginx, reducing manual server administration by 90%.</li>`,
      `<li><strong><a href="https://github.com/invins2003/Avyakt3.0">AVYAKT 3.0 (Event API):</a></strong> Developed the backend infrastructure and endpoints to support an Android application, seamlessly handling the data load for 1,200+ users onboarded within 3 days.</li>`
    ];

    return {
      objective: `Results-driven Backend Developer specializing in the Java/Spring Boot ecosystem with robust DevOps expertise. Proven track record of architecting scalable microservices, developing secure RESTful APIs, and orchestrating containerized deployments using Docker and CI/CD pipelines. Adept at driving server-side performance and establishing resilient infrastructure on AWS for high-availability production environments.`,
      skills_languages: 'Java, Python, C, SQL',
      skills_backend: 'Spring Boot (Microservices, Spring Security, JPA), Node.js, Express.js',
      skills_databases: 'MySQL, PostgreSQL, MongoDB, DynamoDB, Redis',
      skills_devops: 'Docker, Docker Compose, CI/CD (GitHub Actions), AWS (EC2, RDS, S3), Linux, PM2, Nginx',
      skills_architecture: 'REST APIs, System Design, Swagger (OpenAPI), WebSocket, Payment Gateways, Microservices',
      exp_tech_mahindra: techMahindraBullets.join('\n'),
      exp_emedihub: emedihubBullets.join('\n'),
      projects_list: projectsBullets.join('\n')
    };
  }
}

module.exports = new GeminiTailor();
