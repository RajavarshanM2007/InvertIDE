// End-to-end UI tests with Puppeteer (headless Chrome).
// Starts two real servers (fixture test-double AI and offline mode) on fresh
// databases, drives the interface like a user, asserts the outcome of each
// scenario and saves screenshots plus a JSON result file to test-results/.
//
// Usage: npm run test:e2e   (CHROME_PATH overrides the browser location)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'test-results');
const SHOTS = path.join(OUT, 'screenshots');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ADMIN = { email: 'admin@invertide.local', password: 'ChangeMe-Admin1' };
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.startsWith('e2e-')) fs.rmSync(path.join(OUT, f), { force: true });

function startServer(port, aiProvider) {
  const dbFile = path.join(OUT, `e2e-${port}.db`);
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DB_FILE: dbFile, JWT_SECRET: 'e2e-secret', AI_PROVIDER: aiProvider, ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, ANTHROPIC_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let log = '';
    child.stdout.on('data', d => { log += d; if (log.includes('running at')) resolve({ child, base: `http://localhost:${port}` }); });
    child.stderr.on('data', d => { log += d; });
    child.on('exit', code => reject(new Error(`server exited (${code}): ${log}`)));
  });
}

const results = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function scenario(id, title, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ id, title, status: 'passed', ms: Date.now() - started });
    console.log(`  ✔ ${id} ${title}`);
  } catch (err) {
    results.push({ id, title, status: 'failed', ms: Date.now() - started, error: err.message });
    console.log(`  ✖ ${id} ${title}\n      ${err.message}`);
  }
}
function expect(cond, message) { if (!cond) throw new Error(message); }

const fixture = await startServer(3200, 'fixture');
const offline = await startServer(3201, 'offline');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: 1366, height: 900 } });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
page.on('dialog', d => d.accept());
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);

const go = async (base, hash, selector) => {
  if (!page.url().startsWith(base)) await page.goto(`${base}/${hash}`);
  else await page.evaluate(hh => { location.hash = hh; }, hash);
  if (selector) await page.waitForSelector(selector, { timeout: 8000 });
  await sleep(250);
};
const text = sel => page.$eval(sel, el => el.textContent.trim());
const typeInto = async (sel, value) => { await page.click(sel, { clickCount: 3 }); await page.$eval(sel, el => { el.value = ''; }); await page.type(sel, value); };
async function shot(name, { full = false, element } = {}) {
  await page.addStyleTag({ content: 'header,.codepanel{position:static!important}.toast{display:none!important}' }).catch(() => {});
  const file = path.join(SHOTS, `${name}.png`);
  if (element) await (await page.$(element)).screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: full });
  await page.evaluate(() => document.querySelectorAll('style').forEach(s => { if (s.textContent.includes('.toast{display:none')) s.remove(); }));
}
const toastText = () => page.$eval('#toast', el => el.textContent);

console.log('InvertIDE end-to-end UI tests');
const F = fixture.base;

await scenario('E2E-01', 'Landing page loads and the call-to-action opens registration', async () => {
  await page.goto(`${F}/#/`);
  await page.waitForSelector('.hero h1');
  expect((await text('.hero h1')).includes('Read the signal'), 'hero heading missing');
  await sleep(400);
  await shot('01-landing');
  await page.click('.hero a[data-cta]');
  await page.waitForSelector('#reg-name');
});

await scenario('E2E-02', 'Registration form blocks invalid input with field-level messages', async () => {
  await page.type('#reg-name', 'Meera Student');
  await page.type('#reg-email', 'meera-at-example');
  await page.type('#reg-password', 'secret12');
  await page.type('#reg-confirm', 'secret13');
  await page.click('form button[type=submit]');
  await sleep(200);
  expect((await text('#reg-email-err')) === 'Enter a valid email address.', 'email error not shown');
  expect((await text('#reg-confirm-err')) === 'Passwords do not match.', 'confirm error not shown');
  expect(page.url().includes('#/register'), 'should stay on register page');
  await shot('02-register-validation');
});

await scenario('E2E-03', 'Valid registration signs the student in and opens the library', async () => {
  await typeInto('#reg-email', 'meera@example.com');
  await typeInto('#reg-confirm', 'secret12');
  await page.click('form button[type=submit]');
  await page.waitForSelector('.scard');
  expect(page.url().endsWith('#/library'), `unexpected url ${page.url()}`);
  expect((await page.$$('.scard')).length === 10, 'expected 10 snippet cards');
  await sleep(300);
  await shot('03-library');
});

await scenario('E2E-04', 'Language filter shows only matching snippets', async () => {
  await page.select('#language', 'Python');
  await page.waitForFunction(() => location.hash.includes('language=Python'));
  await page.waitForSelector('.scard');
  await sleep(300);
  const langs = await page.$$eval('.scard .meta .badge:first-child', els => els.map(e => e.textContent));
  expect(langs.length === 3 && langs.every(l => l === 'Python'), `got ${langs}`);
  await shot('04-library-filtered');
});

await scenario('E2E-05', 'Submit is disabled for short guesses; a valid guess returns a score and feedback', async () => {
  await go(F, '#/solve/3?mode=practice', '#guess');
  await shot('05-solve-initial');
  await page.type('#guess', 'binary search');
  expect(await page.$eval('form button[type=submit]', b => b.disabled), 'submit should be disabled under 4 words');
  await page.type('#guess', ' that returns the index of x in the array, or -1 if x is not present');
  expect(!(await page.$eval('form button[type=submit]', b => b.disabled)), 'submit should be enabled');
  await page.click('form button[type=submit]');
  await page.waitForSelector('.result .ring span');
  expect((await text('.result .ring span')) === '10', 'expected score 10');
  expect((await text('.result .chip.miss')).includes('4 key ideas'), 'missing-ideas chip not shown');
  await shot('06-solve-first-result', { full: true });
  await shot('06b-result-card', { element: '.result' });
  await shot('06c-hypothesis-form', { element: 'form.panel' });
});

await scenario('E2E-06', 'Cross-Examine shows executed counterexamples on the evidence board', async () => {
  await page.click('.xe .btn.lime');
  await page.waitForSelector('#xe-result');
  const verdicts = await page.$$eval('#xe-result .probe', ps => ps.map(p => p.className.replace('probe ', '')));
  expect(JSON.stringify(verdicts) === JSON.stringify(['corroborated', 'falsified', 'undetermined', 'falsified', 'falsified']), `verdicts ${verdicts}`);
  expect((await text('#xe-result .badge')).includes('TEST DOUBLE'), 'test-double label missing');
  expect((await text('#xe-result .gaphint')).startsWith('Think about it'), 'hint missing');
  await shot('07-cross-examine-board', { element: '#xe-result' });
});

await scenario('E2E-07', 'A revised hypothesis is re-scored and the improvement is shown', async () => {
  await typeInto('#guess', 'Given a sorted array and a value x, return the first position where x could be inserted so the array stays sorted');
  await page.click('form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('.result .ring span')?.textContent === '80');
  expect((await text('.result .delta')).includes('+70'), 'delta not shown');
  expect((await page.$$('.history li')).length === 2, 'round history missing');
  await shot('08-revised-result', { full: true });
  await shot('08b-revised-card', { element: '.result' });
  await shot('08c-round-history', { element: '.history' });
  await shot('08d-code-panel', { element: '.codepanel' });
});

await scenario('E2E-08', 'Predict-then-run lab executes a student-chosen input', async () => {
  await page.click('details.lab summary');
  await page.type('#lab-arr', '[1,3,5,7]');
  await page.type('#lab-x', '6');
  await page.type('#lab-pred', '3');
  await page.click('details.lab .btn');
  await page.waitForSelector('details.lab .probe .verdict');
  expect((await text('details.lab .probe .verdict')) === 'Confirmed', 'lab verdict should be Confirmed');
  await shot('09-predict-then-run-lab', { element: 'details.lab' });
});

await scenario('E2E-21', 'AI Detective streams a live investigation and is graded against the student', async () => {
  expect(!(await page.$eval('.det-btn', b => b.disabled)), 'detective should be unlocked after a submission');
  await page.click('.det-btn');
  await page.waitForFunction(() => document.querySelectorAll('.det-step.exp').length >= 2, { timeout: 15000 });
  expect(!(await page.$('.det-verdict')), 'verdict must not be shown before the investigation finishes (streaming)');
  await shot('21-detective-live', { element: '.det' });
  await page.waitForSelector('.det-verdict', { timeout: 20000 });
  const outputs = await page.$$eval('.det-step.exp .det-call strong', els => els.map(e => e.textContent));
  expect(JSON.stringify(outputs) === JSON.stringify(['2', '2', '1', '2', '0']), `outputs ${outputs}`);
  const scores = await page.$$eval('.det-score strong', els => els.map(e => e.textContent));
  expect(scores[0] === '100' && scores[1] === '80', `scores ${scores}`);
  await shot('22-detective-verdict', { element: '.det' });
  await shot('22b-detective-case-closed', { element: '.det-verdict' });
});

await scenario('E2E-09', 'Reveal shows the original question and locks the round', async () => {
  await page.click('.btn.danger');
  await page.waitForSelector('#answer q');
  expect((await text('#answer q')).startsWith('Given a sorted array and a value'), 'reference question not shown');
  expect(await page.$eval('#guess', t => t.disabled), 'textarea should be disabled');
  await shot('10-reveal', { element: '#answer' });
});

await scenario('E2E-10', 'Challenge mode hides the code until the timer starts and accepts a timed answer', async () => {
  await go(F, '#/solve/9?mode=challenge', '.btn.lime');
  expect((await text('.codepanel .code')).includes('appears when you start'), 'code should be hidden');
  await shot('11-challenge-gate');
  await page.click('.stack .panel .btn.lime');
  await page.waitForSelector('.timer strong');
  await sleep(1200);
  expect(/^0[45]:\d\d$/.test(await text('.timer strong')), 'timer not running');
  await page.type('#guess', 'Compute the greatest common divisor of two integers');
  await page.click('form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('.result .ring span')?.textContent === '100');
  await shot('12-challenge-running', { full: true });
  await shot('12b-challenge-timer', { element: '.stack' });
});

await scenario('E2E-22', 'In challenge mode the AI Detective stays locked while the round is running', async () => {
  expect(await page.$eval('.det-btn', b => b.disabled), 'detective must be locked during a challenge');
  expect((await text('.det-lock')).includes('round ends'), 'lock reason not shown');
});

await scenario('E2E-24', 'If the AI fails mid-request, the Detective falls back to the instructor log and says why', async () => {
  // Mystery #01 has no scripted investigation, so the test-double provider throws - like an API error.
  await go(F, '#/solve/1?mode=practice', '#guess');
  await page.type('#guess', 'find two numbers in the array that add up to the target');
  await page.click('form button[type=submit]');
  await page.waitForSelector('.result');
  await page.click('.det-btn');
  await page.waitForSelector('.det .alert.warn', { timeout: 15000 });
  expect((await text('.det .alert.warn')).includes('Showing the instructor experiment log'), 'fallback notice missing');
  expect((await page.$$('.det-step.exp')).length === 4, 'expected the instructor log');
  expect((await text('.det-status .badge')).includes('Offline'), 'badge should switch to offline');
  expect((await text('.det-live')) === 'Experiment log', 'status should not claim the case is closed');
  await shot('24-detective-ai-failure', { element: '.det' });
});

await scenario('E2E-11', 'Leaderboard lists the challenge score and highlights the current student', async () => {
  await go(F, '#/leaderboard', 'table');
  const row = await page.$eval('tr.you', tr => tr.textContent);
  expect(row.includes('Meera Student') && row.includes('100'), `row: ${row}`);
  await shot('13-leaderboard');
});

await scenario('E2E-12', 'Progress page summarises attempts, topics and Cross-Examine statistics', async () => {
  await go(F, '#/progress', '.tiles');
  const tiles = await page.$$eval('.tile strong', ts => ts.map(t => t.textContent));
  // 2 practice rounds on #03, 1 challenge on #09, 1 practice on #01 (E2E-24)
  expect(tiles[0] === '4', `attempts tile ${tiles[0]}`);
  expect(tiles[4] === '1' && tiles[5] === '3', `cross-examine tiles ${tiles.slice(4)}`);
  await shot('14-progress', { full: true });
});

await scenario('E2E-13', 'A student cannot open the admin panel', async () => {
  await go(F, '#/admin');
  await page.waitForFunction(() => location.hash === '#/library');
  expect((await toastText()).includes('Administrator access required'), 'no access-denied message');
});

await scenario('E2E-14', 'An invalid or expired session returns the user to sign-in', async () => {
  await page.evaluate(() => localStorage.setItem('invertide.token', 'expired.token.value'));
  await go(F, '#/progress');
  await page.waitForFunction(() => location.hash.startsWith('#/login'));
  expect((await toastText()).includes('session has expired'), 'no session message');
});

await scenario('E2E-15', 'Network failure shows a clear error instead of failing silently', async () => {
  await page.type('#login-email', 'meera@example.com');
  await page.type('#login-password', 'secret12');
  await page.setOfflineMode(true);
  await page.click('form button[type=submit]');
  await page.waitForSelector('.alert');
  expect((await text('.alert')).includes('Cannot reach the InvertIDE server'), 'no network error');
  await shot('15-network-error');
  await page.setOfflineMode(false);
});

await scenario('E2E-16', 'Admin signs in and sees the snippet repository with reference questions', async () => {
  await go(F, '#/login', '#login-email');
  await typeInto('#login-email', ADMIN.email);
  await typeInto('#login-password', ADMIN.password);
  await page.click('form button[type=submit]');
  await page.waitForSelector('.table tbody tr');
  expect(page.url().endsWith('#/admin'), 'admin should land on admin panel');
  expect((await page.$$('.table tbody tr')).length === 10, 'expected 10 rows');
  await shot('16-admin-list');
});

await scenario('E2E-17', 'Admin creates a snippet after validating its execution twin', async () => {
  await page.click('.pagehead ~ div .btn.primary, [role=tabpanel] .btn.primary');
  await page.waitForSelector('#ed-title');
  await page.type('#ed-title', 'Mystery #11');
  await page.type('#ed-topic', 'Strings');
  await page.$eval('#ed-code', el => { el.value = 'function solve(s) {\n  return s === s.split("").reverse().join("");\n}'; });
  await page.$eval('#ed-exec', el => { el.value = 'function solve(s) {\n  return s === s.split("").reverse().join("");\n}'; });
  await page.$eval('#ed-ref', el => { el.value = 'Determine whether a string reads the same forwards and backwards (is a palindrome).'; });
  await page.$eval('#ed-params', el => { el.value = '[{"name":"s","type":"string"}]'; });
  await page.$eval('#ed-keywords', el => { el.value = '[{"concept":"palindrome","terms":["palindrome","reads the same"],"weight":3},{"concept":"string","terms":["string","word"],"weight":1}]'; });
  await page.$eval('#ed-probes', el => { el.value = '[["racecar"],["abc"],[""]]'; });
  await page.click('form .btn.small');
  await page.waitForSelector('.alert.info');
  await shot('17-admin-editor', { full: true });
  await page.click('form button[type=submit]');
  await page.waitForFunction(() => document.querySelectorAll('.table tbody tr').length === 11);
});

await scenario('E2E-18', 'Admin can review student submissions', async () => {
  await page.click('[role=tab][data-key=attempts]');
  await page.waitForSelector('.table tbody tr');
  const rows = await page.$$eval('.table tbody tr', rs => rs.map(r => r.textContent));
  expect(rows.some(r => r.includes('Meera Student')), 'student submission missing');
  await shot('18-admin-submissions');
});

await scenario('E2E-19', 'Responsive layout: the investigate screen fits a 390px phone without horizontal scrolling', async () => {
  await page.evaluate(() => { localStorage.clear(); });
  await go(F, '#/login', '#login-email');
  await page.type('#login-email', 'meera@example.com');
  await page.type('#login-password', 'secret12');
  await page.click('form button[type=submit]');
  await page.waitForSelector('.scard');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await go(F, '#/solve/8?mode=practice', '#guess');
  await page.type('#guess', 'returns the most frequent element in the list');
  await page.click('form button[type=submit]');
  await page.waitForSelector('.result');
  await page.click('.xe .btn.lime');
  await page.waitForSelector('#xe-result');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow <= 0, `horizontal overflow ${overflow}px`);
  await shot('19-mobile-solve', { element: '#xe-result' });
  await page.setViewport({ width: 1366, height: 900 });
});

const O = offline.base;
await scenario('E2E-20', 'Offline mode: no AI configured, the student predicts outputs for instructor probes', async () => {
  await page.goto(`${O}/#/register`);
  await page.waitForSelector('#reg-name');
  await page.type('#reg-name', 'Offline Student');
  await page.type('#reg-email', 'offline@example.com');
  await page.type('#reg-password', 'secret12');
  await page.type('#reg-confirm', 'secret12');
  await page.click('form button[type=submit]');
  await page.waitForSelector('.scard');
  await go(O, '#/solve/1?mode=practice', '#guess');
  await page.type('#guess', 'find two numbers in the array that add up to the target');
  await page.click('form button[type=submit]');
  await page.waitForSelector('.result');
  await page.click('.xe .btn.lime');
  await page.waitForSelector('#xe-result .predict input');
  expect((await text('#xe-result .badge')).includes('Offline'), 'offline label missing');
  await page.type('#xe-result .probe:nth-child(1) .predict input', '[0,1]');
  await page.click('#xe-result .probe:nth-child(1) .predict button');
  await page.waitForSelector('#xe-result .probe.corroborated');
  await page.type('#xe-result .probe:nth-child(2) .predict input', '[]');
  await page.click('#xe-result .probe:nth-child(2) .predict button');
  await page.waitForSelector('#xe-result .probe.falsified');
  await shot('20-offline-predict-then-run', { element: '#xe-result' });
});

await scenario('E2E-23', 'Offline mode: the Detective shows the instructor experiment log and says why', async () => {
  await page.click('.det-btn');
  await page.waitForSelector('.det .alert.warn', { timeout: 15000 });
  expect((await page.$$('.det-step.exp')).length === 4, 'expected 4 instructor experiments');
  expect((await text('.det .alert.warn')).includes('No AI provider'), 'offline notice missing');
  await shot('23-detective-offline', { element: '.det' });
});

await browser.close();
fixture.child.kill();
offline.child.kill();

const summary = {
  runAt: new Date().toISOString(),
  browser: CHROME,
  passed: results.filter(r => r.status === 'passed').length,
  failed: results.filter(r => r.status === 'failed').length,
  pageErrors,
  results,
};
fs.writeFileSync(path.join(OUT, 'e2e-results.json'), JSON.stringify(summary, null, 2));
console.log(`\n${summary.passed} passed, ${summary.failed} failed, ${pageErrors.length} uncaught page errors`);
process.exit(summary.failed || pageErrors.length ? 1 : 0);
