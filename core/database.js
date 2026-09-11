const fs = require('fs');
const path = require('path');

class Database {
  constructor(dbPath = null) {
    this.dbPath = dbPath || path.join(__dirname, '..', 'data', 'jobs.json');
    this.ensureDbExists();
  }

  ensureDbExists() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.dbPath)) {
      fs.writeFileSync(this.dbPath, JSON.stringify({ jobs: {}, stats: { total_applied: 0, total_skipped: 0 } }, null, 2));
    }
  }

  _read() {
    try {
      const data = fs.readFileSync(this.dbPath, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      return { jobs: {}, stats: { total_applied: 0, total_skipped: 0 } };
    }
  }

  _write(data) {
    const tempPath = `${this.dbPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, this.dbPath);
  }

  hasJob(jobId) {
    const db = this._read();
    return Boolean(db.jobs[jobId]);
  }

  isAlreadyApplied(jobId) {
    const db = this._read();
    return db.jobs[jobId] && db.jobs[jobId].status === 'APPLIED';
  }

  saveJob(job) {
    const db = this._read();
    const existing = db.jobs[job.job_id] || {};
    db.jobs[job.job_id] = {
      ...existing,
      ...job,
      updated_at: new Date().toISOString()
    };
    if (!existing.created_at) {
      db.jobs[job.job_id].created_at = new Date().toISOString();
    }
    this._write(db);
    return db.jobs[job.job_id];
  }

  markApplied(jobId, resumePath) {
    const db = this._read();
    if (db.jobs[jobId]) {
      db.jobs[jobId].status = 'APPLIED';
      db.jobs[jobId].tailored_resume_path = resumePath;
      db.jobs[jobId].applied_at = new Date().toISOString();
      db.stats.total_applied = (db.stats.total_applied || 0) + 1;
      this._write(db);
    }
  }

  markSkipped(jobId, reason) {
    const db = this._read();
    if (db.jobs[jobId]) {
      db.jobs[jobId].status = 'SKIPPED';
      db.jobs[jobId].skip_reason = reason;
      db.stats.total_skipped = (db.stats.total_skipped || 0) + 1;
      this._write(db);
    }
  }

  getJob(jobId) {
    const db = this._read();
    return db.jobs[jobId] || null;
  }

  getAllJobs() {
    const db = this._read();
    return Object.values(db.jobs);
  }

  getStats() {
    const db = this._read();
    const jobs = Object.values(db.jobs);
    return {
      total_discovered: jobs.length,
      applied: jobs.filter(j => j.status === 'APPLIED').length,
      tailored: jobs.filter(j => j.status === 'TAILORED').length,
      skipped: jobs.filter(j => j.status === 'SKIPPED').length,
      failed: jobs.filter(j => j.status === 'FAILED').length
    };
  }
}

module.exports = new Database();

