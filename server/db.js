// Persistent storage for InvertIDE.
// Uses Node's built-in SQLite driver (node:sqlite) so the project runs with no
// external database server. The schema mirrors the ER diagram from Assessment 2
// (User, CodeSnippet + ReferenceQuestion, Attempt, Evaluation) plus the tables
// added for challenge tickets and Cross-Examine sessions.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { SEED_SNIPPETS } from './seedSnippets.js';

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'student' CHECK (role IN ('student','admin')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- A snippet and its hidden reference question are stored together; the
-- reference_question / keywords_json / exec_js / probes_json columns are never
-- sent to students before the round is revealed.
CREATE TABLE IF NOT EXISTS snippets (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  title              TEXT    NOT NULL,
  language           TEXT    NOT NULL,
  topic              TEXT    NOT NULL,
  difficulty         TEXT    NOT NULL CHECK (difficulty IN ('Easy','Medium','Hard')),
  code               TEXT    NOT NULL,
  exec_js            TEXT    NOT NULL,
  entry_fn           TEXT    NOT NULL,
  params_json        TEXT    NOT NULL,
  reference_question TEXT    NOT NULL,
  keywords_json      TEXT    NOT NULL,
  probes_json        TEXT    NOT NULL,
  active             INTEGER NOT NULL DEFAULT 1,
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS challenge_tickets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snippet_id  INTEGER NOT NULL REFERENCES snippets(id) ON DELETE CASCADE,
  started_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  closed      INTEGER NOT NULL DEFAULT 0,
  exam_count  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS attempts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snippet_id    INTEGER NOT NULL REFERENCES snippets(id) ON DELETE CASCADE,
  ticket_id     INTEGER REFERENCES challenge_tickets(id) ON DELETE SET NULL,
  mode          TEXT    NOT NULL CHECK (mode IN ('practice','challenge')),
  guess         TEXT    NOT NULL,
  round         INTEGER NOT NULL DEFAULT 1,
  raw_score     INTEGER NOT NULL,
  penalty       INTEGER NOT NULL DEFAULT 0,
  score         INTEGER NOT NULL,
  matched_json  TEXT    NOT NULL,
  missed_json   TEXT    NOT NULL,
  elapsed_sec   INTEGER,
  revealed      INTEGER NOT NULL DEFAULT 0,
  after_reveal  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS examinations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id  INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snippet_id  INTEGER NOT NULL REFERENCES snippets(id) ON DELETE CASCADE,
  provider    TEXT    NOT NULL,
  model       TEXT,
  restated    TEXT,
  gap_hint    TEXT,
  probes_json TEXT    NOT NULL,
  falsified   INTEGER NOT NULL DEFAULT 0,
  corroborated INTEGER NOT NULL DEFAULT 0,
  total       INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One AI Detective investigation (agent experiments + final hypothesis).
CREATE TABLE IF NOT EXISTS detective_runs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id       INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snippet_id       INTEGER NOT NULL REFERENCES snippets(id) ON DELETE CASCADE,
  provider         TEXT    NOT NULL,
  model            TEXT,
  experiments_json TEXT    NOT NULL,
  statement        TEXT,
  ai_score         INTEGER,
  student_best     INTEGER,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_attempts_snippet ON attempts(snippet_id);
CREATE INDEX IF NOT EXISTS idx_exams_attempt ON examinations(attempt_id);
`;

export function openDatabase(file = ':memory:') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  // Migration for databases created before the after_reveal column existed.
  const columns = db.prepare('PRAGMA table_info(attempts)').all().map(c => c.name);
  if (!columns.includes('after_reveal')) db.exec('ALTER TABLE attempts ADD COLUMN after_reveal INTEGER NOT NULL DEFAULT 0');
  return db;
}

export function insertSnippet(db, s, createdBy = null) {
  const info = db.prepare(`INSERT INTO snippets
    (title, language, topic, difficulty, code, exec_js, entry_fn, params_json,
     reference_question, keywords_json, probes_json, active, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    s.title, s.language, s.topic, s.difficulty, s.code, s.execJs, s.entryFn,
    JSON.stringify(s.params), s.referenceQuestion, JSON.stringify(s.keywords),
    JSON.stringify(s.probes), s.active === false ? 0 : 1, createdBy);
  return Number(info.lastInsertRowid);
}

// Seeds the snippet repository and the administrator account when the
// database is empty. Admin credentials come from the environment.
export function seedDatabase(db, { adminEmail, adminPassword, log = () => {} } = {}) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM snippets').get();
  if (n === 0) {
    for (const s of SEED_SNIPPETS) insertSnippet(db, s);
    log(`Seeded ${SEED_SNIPPETS.length} snippet-question pairs.`);
  }
  if (adminEmail && adminPassword) {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail.toLowerCase());
    if (!existing) {
      db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?, 'admin')")
        .run('Administrator', adminEmail.toLowerCase(), bcrypt.hashSync(adminPassword, 10));
      log(`Created administrator account ${adminEmail}.`);
    }
  }
}
