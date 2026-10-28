// Integration tests - REST API over a real HTTP listener and an in-memory
// SQLite database. Cross-Examine uses the fixture test double.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDatabase, seedDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { createFixtureProvider } from '../server/ai/index.js';
import { SEED_SNIPPETS } from '../server/seedSnippets.js';

const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/cross-examine.json', import.meta.url), 'utf8'));
const ADMIN = { email: 'admin@test.local', password: 'Admin-pass1' };

function startServer(options = {}) {
  const db = openDatabase(':memory:');
  seedDatabase(db, { adminEmail: ADMIN.email, adminPassword: ADMIN.password });
  const clock = { offsetMs: 0 };
  const app = createApp({ db, jwtSecret: 'test-secret', now: () => Date.now() + clock.offsetMs, ...options });
  return new Promise(resolve => {
    const server = app.listen(0, () => {
      const base = `http://127.0.0.1:${server.address().port}/api`;
      const call = async (path, { method = 'GET', body, token, raw } = {}) => {
        const headers = {};
        if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(base + path, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
        return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
      };
      resolve({ server, db, call, clock });
    });
  });
}

let ctx;
let student;
let other;
let admin;
const register = async (name, email) => (await ctx.call('/auth/register', { method: 'POST', body: { name, email, password: 'secret123' } })).body.token;

before(async () => {
  ctx = await startServer({ aiProvider: createFixtureProvider(fixtures), challengeTimeLimitSec: 300 });
  student = await register('Asha Student', 'asha@test.local');
  other = await register('Ravi Student', 'ravi@test.local');
  admin = (await ctx.call('/auth/login', { method: 'POST', body: ADMIN })).body.token;
});
after(() => ctx.server.close());

describe('Authentication', () => {
  test('IT-AU-01 registration returns a token and a student role', async () => {
    const r = await ctx.call('/auth/register', { method: 'POST', body: { name: 'New User', email: 'NEW@Test.local', password: 'abcdef12' } });
    assert.equal(r.status, 201);
    assert.ok(r.body.token);
    assert.equal(r.body.user.role, 'student');
    assert.equal(r.body.user.email, 'new@test.local');
  });

  test('IT-AU-02 duplicate email is rejected', async () => {
    const r = await ctx.call('/auth/register', { method: 'POST', body: { name: 'Again', email: 'asha@test.local', password: 'secret123' } });
    assert.equal(r.status, 409);
  });

  test('IT-AU-03 invalid registration fields are reported per field', async () => {
    const r = await ctx.call('/auth/register', { method: 'POST', body: { name: 'A', email: 'not-an-email', password: 'short' } });
    assert.equal(r.status, 400);
    assert.deepEqual(Object.keys(r.body.fields).sort(), ['email', 'name', 'password']);
  });

  test('IT-AU-04 wrong password gives a generic 401', async () => {
    const r = await ctx.call('/auth/login', { method: 'POST', body: { email: 'asha@test.local', password: 'wrongpass1' } });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, 'Incorrect email or password.');
  });

  test('IT-AU-05 protected endpoints require a valid token', async () => {
    assert.equal((await ctx.call('/snippets')).status, 401);
    assert.equal((await ctx.call('/snippets', { token: 'forged.token.value' })).status, 401);
    assert.equal((await ctx.call('/auth/me', { token: student })).body.user.name, 'Asha Student');
  });
});

describe('Snippet retrieval', () => {
  test('IT-SN-01 the snippet list never exposes hidden reference data', async () => {
    const r = await ctx.call('/snippets', { token: student });
    assert.equal(r.status, 200);
    assert.equal(r.body.snippets.length, SEED_SNIPPETS.length);
    const text = JSON.stringify(r.body);
    for (const s of SEED_SNIPPETS) assert.ok(!text.includes(s.referenceQuestion));
    for (const key of ['referenceQuestion', 'keywords', 'execJs', 'probes', 'code']) assert.ok(!(key in r.body.snippets[0]), key);
  });

  test('IT-SN-02 snippet detail returns code but not the reference question', async () => {
    const r = await ctx.call('/snippets/3', { token: student });
    assert.equal(r.status, 200);
    assert.ok(r.body.snippet.code.includes('while (lo < hi)'));
    assert.deepEqual(Object.keys(r.body.snippet).sort(), ['code', 'difficulty', 'id', 'language', 'params', 'title', 'topic']);
  });

  test('IT-SN-03 filters by language, topic and difficulty', async () => {
    const py = await ctx.call('/snippets?language=Python', { token: student });
    assert.ok(py.body.snippets.length > 0 && py.body.snippets.every(s => s.language === 'Python'));
    const combo = await ctx.call('/snippets?language=JavaScript&difficulty=Hard', { token: student });
    assert.deepEqual(combo.body.snippets.map(s => s.title), ['Mystery #07', 'Mystery #10']);
    const none = await ctx.call('/snippets?topic=Nope', { token: student });
    assert.equal(none.body.snippets.length, 0);
  });

  test('IT-SN-04 unknown snippet returns 404', async () => {
    assert.equal((await ctx.call('/snippets/999', { token: student })).status, 404);
  });
});

describe('Guess submission and evaluation', () => {
  let attemptId;

  test('IT-AT-01 a valid guess is evaluated, scored and stored', async () => {
    const r = await ctx.call('/attempts', { method: 'POST', token: student, body: { snippetId: 3, guess: 'binary search that returns the index of x in the array, or -1 if missing', mode: 'practice' } });
    assert.equal(r.status, 201);
    assert.equal(r.body.attempt.round, 1);
    assert.equal(r.body.attempt.score, 10);
    assert.equal(r.body.attempt.band, 'weak');
    assert.equal(r.body.attempt.missedCount, 4);
    assert.ok(!('missed' in r.body.attempt), 'missed concept names stay hidden until reveal');
    attemptId = r.body.attempt.id;
  });

  test('IT-AT-02 a revised guess increments the round and reports the previous score', async () => {
    const r = await ctx.call('/attempts', { method: 'POST', token: student, body: { snippetId: 3, guess: 'Given a sorted array and x, return the first position where x could be inserted so the array stays sorted', mode: 'practice' } });
    assert.equal(r.body.attempt.round, 2);
    assert.equal(r.body.attempt.previousScore, 10);
    assert.equal(r.body.attempt.score, 80);
  });

  test('IT-AT-03 too-short, missing and oversized guesses are rejected', async () => {
    for (const guess of ['two words', '', 'x '.repeat(600), undefined]) {
      const r = await ctx.call('/attempts', { method: 'POST', token: student, body: { snippetId: 3, guess } });
      assert.equal(r.status, 400, JSON.stringify(guess)?.slice(0, 20));
    }
  });

  test('IT-AT-04 unknown snippet and invalid mode are rejected', async () => {
    assert.equal((await ctx.call('/attempts', { method: 'POST', token: student, body: { snippetId: 999, guess: 'a b c d e' } })).status, 404);
    assert.equal((await ctx.call('/attempts', { method: 'POST', token: student, body: { snippetId: 3, guess: 'a b c d e', mode: 'ranked' } })).status, 400);
  });

  test('IT-AT-05 malformed JSON bodies get a 400, not a crash', async () => {
    const r = await ctx.call('/attempts', { method: 'POST', token: student, raw: '{"snippetId": 3,' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /not valid JSON/);
  });

  test('IT-AT-06 another student cannot reveal or cross-examine my attempt', async () => {
    assert.equal((await ctx.call(`/attempts/${attemptId}/reveal`, { method: 'POST', token: other })).status, 404);
    assert.equal((await ctx.call(`/attempts/${attemptId}/cross-examine`, { method: 'POST', token: other })).status, 404);
  });

  test('IT-AT-07 attempts appear in progress with topic accuracy', async () => {
    const p = (await ctx.call('/progress', { token: student })).body;
    assert.equal(p.summary.attempts, 2);
    assert.equal(p.summary.averageBestScore, 80);
    assert.deepEqual(p.topics, [{ topic: 'Searching', snippets: 1, averageScore: 80 }]);
  });

  test('IT-AT-08 reveal returns the reference question and concept checklist, then locks Cross-Examine', async () => {
    const r = await ctx.call(`/attempts/${attemptId}/reveal`, { method: 'POST', token: student });
    assert.equal(r.status, 200);
    assert.equal(r.body.referenceQuestion, SEED_SNIPPETS[2].referenceQuestion);
    assert.equal(r.body.concepts.filter(c => c.matched).length, 1);
    assert.equal((await ctx.call(`/attempts/${attemptId}/cross-examine`, { method: 'POST', token: student })).status, 409);
  });

  test('IT-AT-09 [regression D-03] copying the revealed answer does not inflate progress', async () => {
    const r = await ctx.call('/attempts', { method: 'POST', token: student, body: { snippetId: 3, guess: SEED_SNIPPETS[2].referenceQuestion } });
    assert.equal(r.status, 201);
    assert.equal(r.body.attempt.afterReveal, true);
    const p = (await ctx.call('/progress', { token: student })).body;
    assert.equal(p.summary.averageBestScore, 80, 'best score must stay at the pre-reveal 80');
    assert.equal(p.recent[0].afterReveal, true);
  });
});

describe('Cross-Examine API', () => {
  test('IT-XE-01 cross-examination returns executed probes and is persisted', async () => {
    const a = (await ctx.call('/attempts', { method: 'POST', token: other, body: { snippetId: 8, guess: 'returns the most frequent element in the list' } })).body.attempt;
    const r = await ctx.call(`/attempts/${a.id}/cross-examine`, { method: 'POST', token: other });
    assert.equal(r.status, 200);
    const ex = r.body.examination;
    assert.equal(ex.provider, 'fixture');
    assert.deepEqual(ex.probes.map(p => [p.verdict, p.actual]), [['corroborated', 3], ['falsified', 5], ['undetermined', 3], ['corroborated', 2]]);
    const stored = ctx.db.prepare('SELECT * FROM examinations WHERE id = ?').get(ex.id);
    assert.equal(stored.falsified, 1);
    const p = (await ctx.call('/progress', { token: other })).body;
    assert.equal(p.crossExamine.sessions, 1);
    assert.equal(p.crossExamine.counterexamples, 1);
  });

  test('IT-XE-02 revision gain is measured after a cross-examination', async () => {
    await ctx.call('/attempts', { method: 'POST', token: other, body: { snippetId: 8, guess: 'Given an array where one element appears more than half of the time, return that majority element' } });
    const p = (await ctx.call('/progress', { token: other })).body;
    assert.equal(p.crossExamine.averageRevisionGain, 100 - 25);
  });

  test('IT-XE-03 predict-then-run requires a prediction and returns a verdict', async () => {
    assert.equal((await ctx.call('/snippets/3/probe', { method: 'POST', token: student, body: { argsJson: '[[1,3],2]' } })).status, 400);
    const r = await ctx.call('/snippets/3/probe', { method: 'POST', token: student, body: { argsJson: '[[1,3],2]', predictedJson: '1' } });
    assert.equal(r.body.probe.verdict, 'corroborated');
    const bad = await ctx.call('/snippets/3/probe', { method: 'POST', token: student, body: { argsJson: '[1]', predictedJson: '1' } });
    assert.equal(bad.status, 400);
  });

  test('IT-XE-04 offline mode returns instructor probes awaiting student predictions', async () => {
    const off = await startServer({ aiProvider: null });
    const token = (await off.call('/auth/register', { method: 'POST', body: { name: 'Off Line', email: 'off@test.local', password: 'secret123' } })).body.token;
    const meta = (await off.call('/meta')).body;
    assert.equal(meta.ai.mode, 'offline');
    const a = (await off.call('/attempts', { method: 'POST', token, body: { snippetId: 1, guess: 'find two numbers that add to target' } })).body.attempt;
    const r = (await off.call(`/attempts/${a.id}/cross-examine`, { method: 'POST', token })).body.examination;
    assert.equal(r.mode, 'predict-then-run');
    assert.ok(r.probes.every(p => p.verdict === 'awaiting-prediction'));
    off.server.close();
  });

  test('IT-XE-05 Cross-Examine is rate limited per user', async () => {
    const a = (await ctx.call('/attempts', { method: 'POST', token: student, body: { snippetId: 1, guess: 'find two numbers that add to target' } })).body.attempt;
    const statuses = [];
    for (let i = 0; i < 7; i++) statuses.push((await ctx.call(`/attempts/${a.id}/cross-examine`, { method: 'POST', token: student })).status);
    assert.equal(statuses[0], 200);
    assert.equal(statuses.at(-1), 429);
  });
});

describe('Challenge mode and leaderboard', () => {
  test('IT-CH-01 challenge submissions require a started ticket', async () => {
    const r = await ctx.call('/attempts', { method: 'POST', token: other, body: { snippetId: 9, guess: 'computes the gcd of two numbers', mode: 'challenge' } });
    assert.equal(r.status, 400);
  });

  test('IT-CH-02 cross-examining in a challenge deducts points from later submissions', async () => {
    const t = (await ctx.call('/challenges/start', { method: 'POST', token: other, body: { snippetId: 3 } })).body;
    assert.equal(t.timeLimitSec, 300);
    const first = (await ctx.call('/attempts', { method: 'POST', token: other, body: { snippetId: 3, guess: 'binary search for x returning its index', mode: 'challenge', ticketId: t.ticketId } })).body.attempt;
    assert.equal(first.penalty, 0);
    const ex = await ctx.call(`/attempts/${first.id}/cross-examine`, { method: 'POST', token: other });
    assert.equal(ex.body.penaltyApplied, 10);
    const second = (await ctx.call('/attempts', { method: 'POST', token: other, body: { snippetId: 3, guess: 'Given a sorted array return the leftmost insertion index for x', mode: 'challenge', ticketId: t.ticketId } })).body.attempt;
    // 80, not 100: the evaluator does not see that "leftmost insertion index" implies the
    // "greater than or equal" boundary (recorded as defect D-02 in the test report).
    assert.equal(second.rawScore, 80);
    assert.equal(second.penalty, 10);
    assert.equal(second.score, 70);
  });

  test('IT-CH-03 submissions after the time limit are rejected and the round closes', async () => {
    const t = (await ctx.call('/challenges/start', { method: 'POST', token: student, body: { snippetId: 9 } })).body;
    ctx.clock.offsetMs = 301_000;
    const late = await ctx.call('/attempts', { method: 'POST', token: student, body: { snippetId: 9, guess: 'computes the gcd of two numbers', mode: 'challenge', ticketId: t.ticketId } });
    ctx.clock.offsetMs = 0;
    assert.equal(late.status, 409);
    const again = await ctx.call('/attempts', { method: 'POST', token: student, body: { snippetId: 9, guess: 'computes the gcd of two numbers', mode: 'challenge', ticketId: t.ticketId } });
    assert.equal(again.status, 409);
  });

  test('IT-CH-04 a ticket cannot be used for a different snippet or by another user', async () => {
    const t = (await ctx.call('/challenges/start', { method: 'POST', token: student, body: { snippetId: 9 } })).body;
    assert.equal((await ctx.call('/attempts', { method: 'POST', token: student, body: { snippetId: 1, guess: 'two numbers adding to target', mode: 'challenge', ticketId: t.ticketId } })).status, 400);
    assert.equal((await ctx.call('/attempts', { method: 'POST', token: other, body: { snippetId: 9, guess: 'gcd of two numbers here', mode: 'challenge', ticketId: t.ticketId } })).status, 400);
  });

  test('IT-CH-05 the leaderboard sums best challenge scores and ignores practice', async () => {
    const t = (await ctx.call('/challenges/start', { method: 'POST', token: student, body: { snippetId: 9 } })).body;
    await ctx.call('/attempts', { method: 'POST', token: student, body: { snippetId: 9, guess: 'Compute the greatest common divisor of two integers', mode: 'challenge', ticketId: t.ticketId } });
    const lb = (await ctx.call('/leaderboard', { token: student })).body.leaderboard;
    assert.deepEqual(lb.map(r => [r.name, r.points, r.snippets]), [['Asha Student', 100, 1], ['Ravi Student', 70, 1]]);
    assert.equal(lb[0].you, true);
  });
});

describe('Administration', () => {
  const newSnippet = {
    title: 'Mystery #11', language: 'JavaScript', topic: 'Strings', difficulty: 'Easy', entryFn: 'solve',
    code: 'function solve(s) { return s.split("").reverse().join("") === s; }',
    execJs: 'function solve(s) { return s.split("").reverse().join("") === s; }',
    params: [{ name: 's', type: 'string' }], referenceQuestion: 'Determine whether a string is a palindrome.',
    keywords: [{ concept: 'palindrome', terms: ['palindrome', 'reads the same'], weight: 3 }], probes: [['abba'], ['abc']],
  };
  let createdId;

  test('IT-AD-01 students cannot use admin endpoints', async () => {
    assert.equal((await ctx.call('/admin/snippets', { token: student })).status, 403);
    assert.equal((await ctx.call('/admin/snippets', { method: 'POST', token: student, body: newSnippet })).status, 403);
    assert.equal((await ctx.call('/admin/attempts')).status, 401);
  });

  test('IT-AD-02 admin can create a snippet that students then see', async () => {
    const r = await ctx.call('/admin/snippets', { method: 'POST', token: admin, body: newSnippet });
    assert.equal(r.status, 201);
    createdId = r.body.snippet.id;
    const list = (await ctx.call('/snippets', { token: student })).body.snippets;
    assert.ok(list.some(s => s.id === createdId));
  });

  test('IT-AD-03 an execution twin that fails on a probe is rejected', async () => {
    const r = await ctx.call('/admin/snippets/validate', { method: 'POST', token: admin, body: { ...newSnippet, execJs: 'function solve(s) { return s.nope.x; }' } });
    assert.equal(r.status, 400);
    assert.match(r.body.errors[0], /Execution twin failed on 2 probe/);
    const missing = await ctx.call('/admin/snippets', { method: 'POST', token: admin, body: { ...newSnippet, difficulty: 'Impossible', keywords: [] } });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.errors.length, 2);
  });

  test('IT-AD-04 admin can update and hide a snippet', async () => {
    const r = await ctx.call(`/admin/snippets/${createdId}`, { method: 'PUT', token: admin, body: { ...newSnippet, title: 'Mystery #11b', active: false } });
    assert.equal(r.body.snippet.title, 'Mystery #11b');
    assert.equal((await ctx.call(`/snippets/${createdId}`, { token: student })).status, 404);
  });

  test('IT-AD-05 admin can delete a snippet and view submissions', async () => {
    assert.equal((await ctx.call(`/admin/snippets/${createdId}`, { method: 'DELETE', token: admin })).status, 200);
    assert.equal((await ctx.call(`/admin/snippets/${createdId}`, { method: 'DELETE', token: admin })).status, 404);
    const subs = (await ctx.call('/admin/attempts', { token: admin })).body.attempts;
    assert.ok(subs.length > 0 && 'guess' in subs[0] && 'user' in subs[0]);
  });
});

describe('Security headers and errors', () => {
  test('IT-SEC-01 responses carry security headers', async () => {
    const r = await ctx.call('/meta');
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-powered-by'), null);
  });

  test('IT-SEC-02 unknown API routes return JSON 404', async () => {
    const r = await ctx.call('/does-not-exist');
    assert.equal(r.status, 404);
    assert.equal(r.body.error, 'Unknown API endpoint.');
  });
});

describe('AI Detective API', () => {
  const scripts = JSON.parse(fs.readFileSync(new URL('./fixtures/detective.json', import.meta.url), 'utf8'));
  let det;
  let token;
  let base;
  const stream = async (path, tok) => {
    const res = await fetch(base + path, { method: 'POST', headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
    const text = await res.text();
    return { status: res.status, type: res.headers.get('content-type'), events: res.ok ? text.trim().split('\n').map(l => JSON.parse(l)) : JSON.parse(text) };
  };
  before(async () => {
    det = await startServer({ aiProvider: createFixtureProvider(fixtures, scripts, { stepDelayMs: 0 }), challengeTimeLimitSec: 300 });
    base = `http://127.0.0.1:${det.server.address().port}/api`;
    token = (await det.call('/auth/register', { method: 'POST', body: { name: 'Det Student', email: 'det@test.local', password: 'secret123' } })).body.token;
  });
  after(() => det.server.close());

  test('IT-DT-01 a practice attempt streams the investigation as NDJSON and stores the run', async () => {
    const a = (await det.call('/attempts', { method: 'POST', token, body: { snippetId: 3, guess: 'binary search returning the index of x or -1' } })).body.attempt;
    const r = await stream(`/attempts/${a.id}/detective`, token);
    assert.equal(r.status, 200);
    assert.match(r.type, /application\/x-ndjson/);
    assert.equal(r.events[0].type, 'start');
    assert.deepEqual(r.events.filter(e => e.type === 'experiment').map(e => e.output), [2, 2, 1, 2, 0]);
    const verdict = r.events.find(e => e.type === 'verdict');
    assert.equal(verdict.score, 100);
    assert.equal(verdict.studentBest, a.score);
    assert.equal(r.events.at(-1).type, 'done');
    const row = det.db.prepare('SELECT * FROM detective_runs WHERE attempt_id = ?').get(a.id);
    assert.equal(row.ai_score, 100);
    const p = (await det.call('/progress', { token })).body;
    assert.deepEqual(p.detective, { runs: 1, averageAiScore: 100, youBeatTheDetective: 0 });
  });

  test('IT-DT-02 in challenge mode the Detective unlocks only after the round ends', async () => {
    const t = (await det.call('/challenges/start', { method: 'POST', token, body: { snippetId: 8 } })).body;
    const a = (await det.call('/attempts', { method: 'POST', token, body: { snippetId: 8, guess: 'returns the most frequent element', mode: 'challenge', ticketId: t.ticketId } })).body.attempt;
    const locked = await stream(`/attempts/${a.id}/detective`, token);
    assert.equal(locked.status, 409);
    await det.call(`/attempts/${a.id}/reveal`, { method: 'POST', token });
    const open = await stream(`/attempts/${a.id}/detective`, token);
    assert.equal(open.status, 200);
    assert.deepEqual(open.events.filter(e => e.type === 'experiment').map(e => e.output), [3, 2, 5, 3]);
  });

  test('IT-DT-03 the Detective requires sign-in and the attempt owner', async () => {
    const other = (await det.call('/auth/register', { method: 'POST', body: { name: 'Other Student', email: 'other-det@test.local', password: 'secret123' } })).body.token;
    assert.equal((await stream('/attempts/1/detective')).status, 401);
    assert.equal((await stream('/attempts/1/detective', other)).status, 404);
  });

  test('IT-DT-04 the Detective is rate limited to 3 runs per minute per user', async () => {
    const fresh = (await det.call('/auth/register', { method: 'POST', body: { name: 'Rate Student', email: 'rate-det@test.local', password: 'secret123' } })).body.token;
    const a = (await det.call('/attempts', { method: 'POST', token: fresh, body: { snippetId: 3, guess: 'binary search for x in an array' } })).body.attempt;
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await stream(`/attempts/${a.id}/detective`, fresh)).status);
    assert.deepEqual(statuses, [200, 200, 200, 429]);
  });
});
