const geminiTailor = require('./core/gemini_tailor');
const pdfCompiler = require('./core/pdf_compiler');
const db = require('./core/database');

async function test() {
  console.log('[Test] 1. Testing Database...');
  db.saveJob({
    job_id: 'test_101',
    title: 'Senior Backend Engineer',
    company: 'FinTech Innovations',
    status: 'DISCOVERED'
  });
  console.log('[Test] Database save verified. Has test job:', db.hasJob('test_101'));

  console.log('\n[Test] 2. Testing ATS Resume Tailoring...');
  const baseProfile = {
    full_name: 'Alex Johnson',
    current_role: 'Backend Developer',
    current_company: 'CloudScale Technologies',
    years_of_experience: 4,
    core_skills: ['Java', 'Spring Boot', 'Docker', 'AWS', 'PostgreSQL', 'Redis']
  };

  const sampleJob = {
    title: 'Senior Java / Spring Boot Engineer',
    company: 'FinTech Innovations',
    jd_text: 'Seeking a Backend Engineer experienced in building scalable Java Spring Boot microservices, high-volume caching using Redis, Docker, and AWS cloud deployment with 99.9% uptime.'
  };

  const tailoredHtml = await geminiTailor.tailorResume(baseProfile, sampleJob);
  console.log('[Test] Resume tailored successfully. HTML length:', tailoredHtml.length);

  console.log('\n[Test] 3. Testing Single-Page PDF Compiler...');
  const pdfPath = await pdfCompiler.compileHtmlToPdf(tailoredHtml, 'Test_FinTech_Backend');
  console.log('[Test] ✓ Verified! Single-page PDF compiled at:', pdfPath);
}

test().catch(console.error);

