# InvertIDE

**A reverse-engineering based coding platform for building code comprehension skills.**
BCSE301P Software Engineering project: Kapish P (24BDE0039), Rajavarshan M (24BYB0083).

Students are shown working code without its problem statement and must write the question it answers. A keyword/rule evaluator scores the guess. Two AI features build on it.

**Cross-Examine** tests the guess as a *hypothesis*:

1. Groq cloud AI designs probe inputs and predicts what a program solving the **student's stated problem** would return.
2. The server **executes the real snippet** on those inputs.
3. Each mismatch is shown as an execution-verified counterexample.

The AI never decides what the code does.

**AI Detective** is an autonomous agent that reverse-engineers the same snippet live, as a worked example:
- It never sees the hidden question.
- It runs its own experiments through a `run_code` tool, which the server sandbox executes, and explains the purpose of each one.
- It then submits a hypothesis, graded by the same evaluator, so the student sees a "You vs AI Detective" comparison.
- Steps stream to the browser as they happen (NDJSON).
- It unlocks only after the student's own attempt (practice) or after the challenge round ends.

## Requirements

- **Node.js 22.13 or newer.** Tested on Node 24.19. The built-in `node:sqlite` module is used, so no database server is needed.
- **Google Chrome**, only for the end-to-end UI tests.
- **A Groq API key**, for live cloud AI mode. No Ollama or local model is required. Without a key, the application runs in clearly labelled offline mode.

## Quick start (Windows)

This package includes a development `.env` file with local defaults. **Only paste your Groq API key** after `GROQ_API_KEY=` when Notepad opens, save, and close it. Then the `Start InvertIDE.bat` launcher installs the dependencies if needed, syntax-checks the AI files, and starts the app at `http://localhost:3000`. Keep the terminal window open while using the app.

The default local admin account is `admin@invertide.local` / `ChangeMe-Admin1`. Change this password before using the app beyond local development. The bundled `.env` is configured for local development only and contains a blank `GROQ_API_KEY` field until you add yours.

Manual start is also supported:

```powershell
npm ci
node --check server/ai/groqProvider.js
node --check server/crossExamine.js
npm start
```

On first start, the SQLite database (`DB_FILE`, default `./data/invertide.db`) is created automatically. It is seeded with 10 snippet–question pairs in JavaScript, Python, Java and C++, plus the administrator account from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Run `npm run reset-db` to delete the database so it is re-seeded on the next start.

## Configuring the AI provider (Cross-Examine and AI Detective)

| `AI_PROVIDER` | Behaviour |
|---|---|
| `groq` (recommended) | Live Groq cloud AI. Set `GROQ_API_KEY`; `GROQ_MODEL` defaults to `qwen/qwen3.8-27b`. No local model or Ollama is used. |
| `claude` (optional) | Live Claude API via `@anthropic-ai/sdk`, using `ANTHROPIC_API_KEY` and optional `AI_MODEL`. |
| `offline` (default without an API key) | No AI. Cross-Examine shows instructor-authored probe inputs; AI Detective shows the instructor experiment log. |
| `fixture` | **Test double** that replays canned responses from `tests/fixtures/cross-examine.json` and scripted investigations from `tests/fixtures/detective.json`, with real sandbox outputs. Used only for automated tests and UI demos; the interface labels it "TEST DOUBLE · not live AI". `AI_FIXTURE_STEP_DELAY_MS` (default 700) paces the scripted Detective. |

The API key is read only by the server. It is never sent to the browser and must not be committed. `.env` is in `.gitignore`.

To verify your Groq key, run `npm run live-ai-check`. It runs two live Cross-Examine sessions and one AI Detective investigation, and saves the results to `test-results/live-ai-check.json`. This makes real API calls and consumes your Groq quota.

## Tests

```bash
npm test            # unit and API integration tests, including mocked Groq provider tests (node:test)
npm run test:e2e    # 23 browser scenarios with Puppeteer + Chrome; screenshots in test-results/
```

Set `CHROME_PATH` if Chrome is not at `C:/Program Files/Google/Chrome/Application/chrome.exe`.

## Architecture

```
Browser (vanilla JS SPA, public/)  --HTTPS/JSON + JWT-->  Express API (server/app.js)
                                                              |-- auth.js           JWT, rate limiting
                                                              |-- evaluator.js      keyword/rule evaluator
                                                              |-- crossExamine.js   probes, verdicts, leak guard
                                                              |-- detective.js      AI Detective agent run (streamed)
                                                              |     |-- sandbox.js        executes snippet twin (node:vm)
                                                              |     '-- ai/groqProvider.js     Groq API (server-side only)
                                                              '-- db.js             SQLite: users, snippets, attempts,
                                                                                    challenge_tickets, examinations
```

### Main endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login` | Create an account / sign in (returns a JWT) |
| GET | `/api/snippets?language=&topic=&difficulty=` | Filtered snippet list (never includes reference data) |
| GET | `/api/snippets/:id` | Code and parameter signature only |
| POST | `/api/challenges/start` | Start a timed challenge ticket |
| POST | `/api/attempts` | Submit a guess; returns score, band, matched concepts and missed count |
| POST | `/api/attempts/:id/cross-examine` | Run Cross-Examine on an attempt |
| POST | `/api/attempts/:id/detective` | Stream an AI Detective investigation (NDJSON) |
| POST | `/api/snippets/:id/probe` | Predict-then-run on a student-chosen input |
| POST | `/api/attempts/:id/reveal` | Reveal the reference question and concept checklist |
| GET | `/api/progress`, `/api/leaderboard` | Progress statistics and challenge ranking |
| GET/POST/PUT/DELETE | `/api/admin/snippets[/:id]` | Admin snippet management (admin role only) |
| POST | `/api/admin/snippets/validate` | Run the execution twin on its probes before saving |
| GET | `/api/admin/attempts` | Recent submissions |

## Deviations from the original design documents

- **SQLite instead of PostgreSQL.** The schema follows the ER diagram. SQLite was chosen so the project runs on any machine without installing a database server. The SQL is standard, so porting to PostgreSQL mainly means changing the driver in `server/db.js`.
- **Vanilla JavaScript instead of React/Vite.** The supplied front-end redesign was plain HTML/CSS/JS, so it was extended directly with ES modules. There is no build step.

## Known limitations

- The keyword evaluator does not understand negation (defect D-01) or equivalent restatements of a constraint (D-02). See the Assessment 8 report.
- `node:vm` is not a hard security boundary. Only administrator-authored execution twins are executed; probe inputs are JSON data only.
- For non-JavaScript snippets, Cross-Examine runs a JavaScript "execution twin". The administrator is responsible for keeping it equivalent to the displayed code.
- In challenge mode, the code is hidden in the browser until the timer starts, but the API still returns it on request. The code is not secret; the reference question is, and it is never sent before reveal.
- Rate limits are kept in memory and reset when the server restarts.
