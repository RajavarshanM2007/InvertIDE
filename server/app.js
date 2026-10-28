// InvertIDE HTTP application: REST API + static student/admin interface.
import express from 'express';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateGuess, validateGuess, band } from './evaluator.js';
import { crossExamine, judgeProbe } from './crossExamine.js';
import { runDetective } from './detective.js';
import { runSnippet } from './sandbox.js';
import { insertSnippet } from './db.js';
import { createAuth, rateLimit } from './auth.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const IDENT_RE = /^[A-Za-z_$][\w$]*$/;
const LANGUAGES = ['JavaScript', 'Python', 'Java', 'C++'];
const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function rowToSnippet(r) {
  return {
    id: r.id, title: r.title, language: r.language, topic: r.topic, difficulty: r.difficulty,
    code: r.code, execJs: r.exec_js, entryFn: r.entry_fn, params: JSON.parse(r.params_json),
    referenceQuestion: r.reference_question, keywords: JSON.parse(r.keywords_json),
    probes: JSON.parse(r.probes_json), active: !!r.active, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// The only snippet fields a student may see before the round is revealed.
function publicSnippet(s) {
  return { id: s.id, title: s.title, language: s.language, topic: s.topic, difficulty: s.difficulty, code: s.code, params: s.params };
}

function parseSqlTime(t) {
  return Date.parse(t.replace(' ', 'T') + 'Z');
}

export function validateSnippetPayload(b) {
  const errors = [];
  const str = (k, max) => {
    if (typeof b[k] !== 'string' || !b[k].trim()) errors.push(`${k} is required.`);
    else if (b[k].length > max) errors.push(`${k} must be at most ${max} characters.`);
  };
  str('title', 80); str('topic', 40); str('code', 5000); str('execJs', 5000); str('referenceQuestion', 600); str('entryFn', 40);
  if (!LANGUAGES.includes(b.language)) errors.push(`language must be one of ${LANGUAGES.join(', ')}.`);
  if (!DIFFICULTIES.includes(b.difficulty)) errors.push(`difficulty must be one of ${DIFFICULTIES.join(', ')}.`);
  if (typeof b.entryFn === 'string' && !IDENT_RE.test(b.entryFn)) errors.push('entryFn must be a valid JavaScript identifier.');
  if (!Array.isArray(b.params) || b.params.length === 0 || b.params.length > 4
      || !b.params.every(p => p && typeof p.name === 'string' && p.name && typeof p.type === 'string')) {
    errors.push('params must list 1-4 parameters with a name and a type.');
  }
  if (!Array.isArray(b.keywords) || b.keywords.length === 0
      || !b.keywords.every(k => k && typeof k.concept === 'string' && k.concept.trim()
        && Array.isArray(k.terms) && k.terms.length > 0 && k.terms.every(t => typeof t === 'string' && t.trim())
        && Number.isInteger(k.weight ?? 1) && (k.weight ?? 1) >= 1 && (k.weight ?? 1) <= 5)) {
    errors.push('keywords must be a list of concepts, each with at least one term and a weight from 1 to 5.');
  }
  if (!Array.isArray(b.probes) || b.probes.length === 0 || b.probes.length > 8 || !b.probes.every(Array.isArray)) {
    errors.push('probes must be a list of 1-8 argument arrays.');
  }
  if (errors.length) return { errors };
  // The execution twin must actually run on every probe.
  const probeResults = b.probes.map(args => {
    if (args.length !== b.params.length) return { args, ok: false, error: `Expected ${b.params.length} argument(s).` };
    return { args, ...runSnippet(b.execJs, b.entryFn, args) };
  });
  const failing = probeResults.filter(r => !r.ok);
  if (failing.length) errors.push(`Execution twin failed on ${failing.length} probe(s): ${failing[0].error}`);
  return { errors, probeResults };
}

export function createApp({ db, jwtSecret, aiProvider = null, aiWarning = null, challengeTimeLimitSec = 300, examPenalty = 10, now = () => Date.now() }) {
  const app = express();
  const auth = createAuth(jwtSecret);
  const loginLimiter = rateLimit({ windowMs: 60_000, max: 10, message: 'Too many sign-in attempts. Please wait a minute.' });
  const examLimiter = rateLimit({ windowMs: 60_000, max: 6, message: 'Cross-Examine is limited to 6 runs per minute.' });
  const probeLimiter = rateLimit({ windowMs: 60_000, max: 30, message: 'Too many probe runs. Please wait a minute.' });
  const detectiveLimiter = rateLimit({ windowMs: 60_000, max: 3, message: 'The AI Detective can be started 3 times per minute.' });

  const getSnippet = (id, { includeInactive = false } = {}) => {
    const row = db.prepare('SELECT * FROM snippets WHERE id = ?').get(Number(id));
    if (!row || (!row.active && !includeInactive)) throw new HttpError(404, 'Snippet not found.');
    return rowToSnippet(row);
  };
  const getOwnAttempt = (id, userId) => {
    const a = db.prepare('SELECT * FROM attempts WHERE id = ? AND user_id = ?').get(Number(id), userId);
    if (!a) throw new HttpError(404, 'Attempt not found.');
    return a;
  };

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
    });
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  // ---------------------------------------------------------------- meta
  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.get('/api/meta', (req, res) => {
    const rows = db.prepare('SELECT DISTINCT language, topic FROM snippets WHERE active = 1').all();
    const mode = aiProvider ? aiProvider.name : 'offline';
    res.json({
      languages: [...new Set(rows.map(r => r.language))].sort(),
      topics: [...new Set(rows.map(r => r.topic))].sort(),
      difficulties: DIFFICULTIES,
      ai: { mode, model: aiProvider?.model ?? null, warning: aiWarning },
      challengeTimeLimitSec, examPenalty,
    });
  });

  // ---------------------------------------------------------------- auth
  app.post('/api/auth/register', loginLimiter, (req, res) => {
    const { name, email, password } = req.body ?? {};
    const errors = {};
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 60) errors.name = 'Name must be 2-60 characters.';
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) errors.email = 'Enter a valid email address.';
    if (typeof password !== 'string' || password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      errors.password = 'Password must be at least 8 characters and include a letter and a digit.';
    }
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Please correct the highlighted fields.', fields: errors });
    const normEmail = email.trim().toLowerCase();
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(normEmail)) {
      return res.status(409).json({ error: 'An account with this email already exists.', fields: { email: 'Already registered.' } });
    }
    const info = db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,'student')")
      .run(name.trim(), normEmail, bcrypt.hashSync(password, 10));
    const user = { id: Number(info.lastInsertRowid), name: name.trim(), email: normEmail, role: 'student' };
    res.status(201).json({ token: auth.sign(user), user });
  });

  app.post('/api/auth/login', loginLimiter, (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }
    const user = { id: row.id, name: row.name, email: row.email, role: row.role };
    res.json({ token: auth.sign(user), user });
  });

  app.get('/api/auth/me', auth.requireUser, (req, res) => {
    const row = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(req.user.id);
    if (!row) return res.status(401).json({ error: 'Account no longer exists.' });
    res.json({ user: row });
  });

  // ------------------------------------------------------------ snippets
  app.get('/api/snippets', auth.requireUser, (req, res) => {
    const { language, topic, difficulty } = req.query;
    const where = ['active = 1'];
    const args = [];
    if (language) { where.push('language = ?'); args.push(String(language)); }
    if (topic) { where.push('topic = ?'); args.push(String(topic)); }
    if (difficulty) { where.push('difficulty = ?'); args.push(String(difficulty)); }
    const rows = db.prepare(`SELECT * FROM snippets WHERE ${where.join(' AND ')} ORDER BY id`).all(...args);
    const best = new Map(db.prepare('SELECT snippet_id, MAX(score) AS best FROM attempts WHERE user_id = ? GROUP BY snippet_id')
      .all(req.user.id).map(r => [r.snippet_id, r.best]));
    res.json({
      snippets: rows.map(r => {
        const { code, params, ...rest } = publicSnippet(rowToSnippet(r));
        return { ...rest, lines: code.split('\n').length, bestScore: best.get(r.id) ?? null };
      }),
    });
  });

  app.get('/api/snippets/:id', auth.requireUser, (req, res) => {
    res.json({ snippet: publicSnippet(getSnippet(req.params.id)) });
  });

  // Predict-then-run: the student states the output they expect, then the
  // real snippet is executed and the two are compared.
  app.post('/api/snippets/:id/probe', auth.requireUser, probeLimiter, (req, res) => {
    const snippet = getSnippet(req.params.id);
    const { argsJson, predictedJson } = req.body ?? {};
    if (typeof predictedJson !== 'string' || !predictedJson.trim()) {
      return res.status(400).json({ error: 'Write your prediction before running the code.' });
    }
    const judged = judgeProbe(snippet, argsJson, predictedJson.trim());
    if (judged.error) return res.status(400).json({ error: judged.error });
    res.json({ probe: judged });
  });

  // ------------------------------------------------------------ challenge
  app.post('/api/challenges/start', auth.requireUser, (req, res) => {
    const snippet = getSnippet(req.body?.snippetId);
    const info = db.prepare('INSERT INTO challenge_tickets (user_id, snippet_id) VALUES (?, ?)').run(req.user.id, snippet.id);
    const t = db.prepare('SELECT * FROM challenge_tickets WHERE id = ?').get(Number(info.lastInsertRowid));
    res.status(201).json({ ticketId: t.id, startedAt: t.started_at, timeLimitSec: challengeTimeLimitSec, serverNow: new Date(now()).toISOString() });
  });

  // ------------------------------------------------------------ attempts
  app.post('/api/attempts', auth.requireUser, (req, res) => {
    const { snippetId, guess, mode = 'practice', ticketId } = req.body ?? {};
    if (!['practice', 'challenge'].includes(mode)) throw new HttpError(400, 'Mode must be practice or challenge.');
    const snippet = getSnippet(snippetId);
    const invalid = validateGuess(guess);
    if (invalid) throw new HttpError(400, invalid);

    let ticket = null;
    let penalty = 0;
    let elapsed = null;
    if (mode === 'challenge') {
      ticket = db.prepare('SELECT * FROM challenge_tickets WHERE id = ? AND user_id = ?').get(Number(ticketId), req.user.id);
      if (!ticket || ticket.snippet_id !== snippet.id) throw new HttpError(400, 'Start the challenge before submitting.');
      if (ticket.closed) throw new HttpError(409, 'This challenge round is closed.');
      elapsed = Math.floor((now() - parseSqlTime(ticket.started_at)) / 1000);
      if (elapsed > challengeTimeLimitSec) {
        db.prepare('UPDATE challenge_tickets SET closed = 1 WHERE id = ?').run(ticket.id);
        throw new HttpError(409, 'Time is up - this challenge round has closed.');
      }
      penalty = Math.min(30, ticket.exam_count * examPenalty);
    }

    const result = evaluateGuess(guess, snippet.keywords);
    const score = Math.max(0, result.score - penalty);
    const prev = mode === 'challenge'
      ? db.prepare('SELECT score, round FROM attempts WHERE ticket_id = ? ORDER BY id DESC LIMIT 1').get(ticket.id)
      : db.prepare("SELECT score, round FROM attempts WHERE user_id = ? AND snippet_id = ? AND mode = 'practice' ORDER BY id DESC LIMIT 1").get(req.user.id, snippet.id);
    const round = (prev?.round ?? 0) + 1;
    // Practice attempts made after the answer was revealed are kept for the
    // student's own practice but excluded from progress statistics (defect D-03).
    const afterReveal = mode === 'practice' && !!db.prepare(
      "SELECT 1 FROM attempts WHERE user_id = ? AND snippet_id = ? AND mode = 'practice' AND revealed = 1 LIMIT 1").get(req.user.id, snippet.id);
    const info = db.prepare(`INSERT INTO attempts (user_id, snippet_id, ticket_id, mode, guess, round, raw_score, penalty, score, matched_json, missed_json, elapsed_sec, revealed, after_reveal)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.user.id, snippet.id, ticket?.id ?? null, mode, guess.trim(), round,
      result.score, penalty, score, JSON.stringify(result.matched), JSON.stringify(result.missed), elapsed, afterReveal ? 1 : 0, afterReveal ? 1 : 0);
    res.status(201).json({
      attempt: {
        id: Number(info.lastInsertRowid), snippetId: snippet.id, mode, round,
        rawScore: result.score, penalty, score, band: band(score), feedback: result.feedback,
        matched: result.matched, missedCount: result.missed.length,
        previousScore: prev?.score ?? null, elapsedSec: elapsed, afterReveal,
      },
    });
  });

  app.post('/api/attempts/:id/cross-examine', auth.requireUser, examLimiter, async (req, res) => {
    const attempt = getOwnAttempt(req.params.id, req.user.id);
    if (attempt.revealed) throw new HttpError(409, 'The answer for this round has already been revealed.');
    if (attempt.ticket_id) {
      const t = db.prepare('SELECT * FROM challenge_tickets WHERE id = ?').get(attempt.ticket_id);
      if (t.closed) throw new HttpError(409, 'This challenge round is closed.');
    }
    const snippet = getSnippet(attempt.snippet_id);
    const missed = new Set(JSON.parse(attempt.missed_json).map(m => m.concept));
    const missedTerms = snippet.keywords.filter(k => missed.has(k.concept) && (k.weight ?? 1) >= 3).flatMap(k => k.terms);
    const result = await crossExamine({ snippet, guess: attempt.guess, missedTerms, provider: aiProvider });
    if (attempt.ticket_id) db.prepare('UPDATE challenge_tickets SET exam_count = exam_count + 1 WHERE id = ?').run(attempt.ticket_id);
    const info = db.prepare(`INSERT INTO examinations (attempt_id, user_id, snippet_id, provider, model, restated, gap_hint, probes_json, falsified, corroborated, total)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(attempt.id, req.user.id, snippet.id, result.provider, result.model ?? null,
      result.restated ?? null, result.gapHint ?? null, JSON.stringify(result.probes), result.falsified, result.corroborated, result.total);
    res.json({
      examination: { id: Number(info.lastInsertRowid), attemptId: attempt.id, ...result },
      penaltyApplied: attempt.ticket_id ? examPenalty : 0,
    });
  });

  // AI Detective: streams the agent's investigation as NDJSON events.
  // Unlocked only after the student's own attempt (practice) or after the
  // challenge round has ended, so it cannot be used to skip the exercise.
  app.post('/api/attempts/:id/detective', auth.requireUser, detectiveLimiter, async (req, res) => {
    const attempt = getOwnAttempt(req.params.id, req.user.id);
    if (attempt.ticket_id) {
      const t = db.prepare('SELECT * FROM challenge_tickets WHERE id = ?').get(attempt.ticket_id);
      const expired = now() - parseSqlTime(t.started_at) > challengeTimeLimitSec * 1000;
      if (!t.closed && !expired) throw new HttpError(409, 'In challenge mode the AI Detective unlocks when the round has ended.');
    }
    const snippet = getSnippet(attempt.snippet_id);
    const best = db.prepare('SELECT MAX(score) AS best FROM attempts WHERE user_id = ? AND snippet_id = ? AND after_reveal = 0').get(req.user.id, snippet.id).best;

    let open = true;
    req.on('close', () => { open = false; });
    res.status(200).set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const emit = event => { if (open) res.write(`${JSON.stringify(event)}\n`); };
    const result = await runDetective({ snippet, provider: aiProvider, emit, studentBest: best ?? null });
    db.prepare(`INSERT INTO detective_runs (attempt_id, user_id, snippet_id, provider, model, experiments_json, statement, ai_score, student_best)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(attempt.id, req.user.id, snippet.id, result.provider, result.model ?? null,
      JSON.stringify(result.experiments), result.statement ?? null, result.score ?? null, best ?? null);
    emit({ type: 'done' });
    res.end();
  });

  app.post('/api/attempts/:id/reveal', auth.requireUser, (req, res) => {
    const attempt = getOwnAttempt(req.params.id, req.user.id);
    const snippet = getSnippet(attempt.snippet_id, { includeInactive: true });
    if (attempt.ticket_id) {
      db.prepare('UPDATE challenge_tickets SET closed = 1 WHERE id = ?').run(attempt.ticket_id);
      db.prepare('UPDATE attempts SET revealed = 1 WHERE ticket_id = ?').run(attempt.ticket_id);
    } else {
      db.prepare("UPDATE attempts SET revealed = 1 WHERE user_id = ? AND snippet_id = ? AND mode = 'practice'").run(req.user.id, snippet.id);
    }
    const matched = new Set(JSON.parse(attempt.matched_json).map(m => m.concept));
    res.json({
      referenceQuestion: snippet.referenceQuestion,
      concepts: snippet.keywords.map(k => ({ concept: k.concept, weight: k.weight ?? 1, matched: matched.has(k.concept) })),
    });
  });

  // ------------------------------------------------------------ progress
  app.get('/api/progress', auth.requireUser, (req, res) => {
    const attempts = db.prepare(`SELECT a.id, a.snippet_id, a.mode, a.round, a.score, a.raw_score, a.penalty, a.guess, a.created_at, a.after_reveal,
        s.title, s.topic, s.language, s.difficulty
      FROM attempts a JOIN snippets s ON s.id = a.snippet_id WHERE a.user_id = ? ORDER BY a.id DESC`).all(req.user.id);
    const exams = db.prepare('SELECT attempt_id, snippet_id, provider, falsified, corroborated, total FROM examinations WHERE user_id = ? ORDER BY id').all(req.user.id);

    const bestBySnippet = new Map();
    for (const a of attempts) {
      if (a.after_reveal) continue;
      const b = bestBySnippet.get(a.snippet_id);
      if (!b || a.score > b.score) bestBySnippet.set(a.snippet_id, a);
    }
    const topics = new Map();
    for (const a of bestBySnippet.values()) {
      const t = topics.get(a.topic) ?? { topic: a.topic, snippets: 0, total: 0 };
      t.snippets++; t.total += a.score; topics.set(a.topic, t);
    }
    // Revision gain: score of the next guess on the same snippet after a
    // Cross-Examine session, minus the score of the examined guess.
    const byId = new Map(attempts.map(a => [a.id, a]));
    const gains = [];
    for (const e of exams) {
      const examined = byId.get(e.attempt_id);
      if (!examined) continue;
      const next = attempts.filter(a => a.snippet_id === examined.snippet_id && a.id > examined.id).at(-1);
      if (next) gains.push(next.score - examined.score);
    }
    const avg = xs => (xs.length ? Math.round(xs.reduce((p, q) => p + q, 0) / xs.length) : null);
    res.json({
      summary: {
        attempts: attempts.length,
        snippetsAttempted: bestBySnippet.size,
        averageBestScore: avg([...bestBySnippet.values()].map(a => a.score)),
        strongReconstructions: [...bestBySnippet.values()].filter(a => a.score >= 80).length,
      },
      topics: [...topics.values()].map(t => ({ topic: t.topic, snippets: t.snippets, averageScore: Math.round(t.total / t.snippets) }))
        .sort((p, q) => q.averageScore - p.averageScore),
      crossExamine: {
        sessions: exams.length,
        counterexamples: exams.reduce((n, e) => n + e.falsified, 0),
        corroborations: exams.reduce((n, e) => n + e.corroborated, 0),
        averageRevisionGain: avg(gains),
      },
      detective: (() => {
        const runs = db.prepare('SELECT ai_score, student_best FROM detective_runs WHERE user_id = ? AND ai_score IS NOT NULL').all(req.user.id);
        return {
          runs: db.prepare('SELECT COUNT(*) AS n FROM detective_runs WHERE user_id = ?').get(req.user.id).n,
          averageAiScore: avg(runs.map(r => r.ai_score)),
          youBeatTheDetective: runs.filter(r => r.student_best != null && r.student_best >= r.ai_score).length,
        };
      })(),
      recent: attempts.slice(0, 25).map(a => ({
        id: a.id, snippetId: a.snippet_id, title: a.title, topic: a.topic, language: a.language, difficulty: a.difficulty,
        mode: a.mode, round: a.round, score: a.score, penalty: a.penalty, guess: a.guess, createdAt: a.created_at, afterReveal: !!a.after_reveal,
      })),
    });
  });

  app.get('/api/leaderboard', auth.requireUser, (req, res) => {
    const rows = db.prepare(`SELECT u.id, u.name, SUM(best) AS points, COUNT(*) AS solved
      FROM (SELECT user_id, snippet_id, MAX(score) AS best FROM attempts WHERE mode = 'challenge' GROUP BY user_id, snippet_id) b
      JOIN users u ON u.id = b.user_id GROUP BY u.id ORDER BY points DESC, solved DESC, u.id ASC LIMIT 20`).all();
    res.json({ leaderboard: rows.map((r, i) => ({ rank: i + 1, userId: r.id, name: r.name, points: r.points, snippets: r.solved, you: r.id === req.user.id })) });
  });

  // ---------------------------------------------------------------- admin
  app.get('/api/admin/snippets', auth.requireAdmin, (req, res) => {
    res.json({ snippets: db.prepare('SELECT * FROM snippets ORDER BY id').all().map(rowToSnippet) });
  });

  app.post('/api/admin/snippets/validate', auth.requireAdmin, (req, res) => {
    const { errors, probeResults } = validateSnippetPayload(req.body ?? {});
    res.status(errors.length ? 400 : 200).json({ ok: errors.length === 0, errors, probeResults: probeResults ?? [] });
  });

  app.post('/api/admin/snippets', auth.requireAdmin, (req, res) => {
    const { errors } = validateSnippetPayload(req.body ?? {});
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    const id = insertSnippet(db, req.body, req.user.id);
    res.status(201).json({ snippet: getSnippet(id, { includeInactive: true }) });
  });

  app.put('/api/admin/snippets/:id', auth.requireAdmin, (req, res) => {
    const existing = getSnippet(req.params.id, { includeInactive: true });
    const { errors } = validateSnippetPayload(req.body ?? {});
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    const b = req.body;
    db.prepare(`UPDATE snippets SET title=?, language=?, topic=?, difficulty=?, code=?, exec_js=?, entry_fn=?, params_json=?,
      reference_question=?, keywords_json=?, probes_json=?, active=?, updated_at=datetime('now') WHERE id=?`).run(
      b.title, b.language, b.topic, b.difficulty, b.code, b.execJs, b.entryFn, JSON.stringify(b.params),
      b.referenceQuestion, JSON.stringify(b.keywords), JSON.stringify(b.probes), b.active === false ? 0 : 1, existing.id);
    res.json({ snippet: getSnippet(existing.id, { includeInactive: true }) });
  });

  app.delete('/api/admin/snippets/:id', auth.requireAdmin, (req, res) => {
    const existing = getSnippet(req.params.id, { includeInactive: true });
    db.prepare('DELETE FROM snippets WHERE id = ?').run(existing.id);
    res.json({ deleted: existing.id });
  });

  app.get('/api/admin/attempts', auth.requireAdmin, (req, res) => {
    const rows = db.prepare(`SELECT a.id, a.mode, a.round, a.score, a.guess, a.created_at, u.name AS user, s.title, s.id AS snippet_id
      FROM attempts a JOIN users u ON u.id = a.user_id JOIN snippets s ON s.id = a.snippet_id ORDER BY a.id DESC LIMIT 100`).all();
    res.json({ attempts: rows });
  });

  // ----------------------------------------------------------- static + errors
  app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
    const status = err.status && err.status < 500 ? err.status : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Unexpected server error.' : err.message });
  });

  return app;
}

