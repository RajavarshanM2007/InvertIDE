// Runs Cross-Examine and AI Detective against the configured live provider.
// For Groq, .env only needs GROQ_API_KEY plus the settings shipped with this project.
// Saves results to test-results/live-ai-check.json. This makes real API calls.
import fs from 'node:fs';
import path from 'node:path';
import { providerFromEnv } from '../server/ai/index.js';
import { crossExamine } from '../server/crossExamine.js';
import { runDetective } from '../server/detective.js';
import { SEED_SNIPPETS } from '../server/seedSnippets.js';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
const { provider, warning } = providerFromEnv(process.env);
if (!provider || provider.name !== 'groq') {
  console.error(warning || 'Groq is not configured. Set AI_PROVIDER=groq and GROQ_API_KEY in .env.');
  process.exit(2);
}

const cases = [
  { snippet: SEED_SNIPPETS[2], guess: 'binary search that returns the index of x in the array, or -1 if x is not present', missedTerms: ['insert', 'insertion', 'placed', 'lower bound'] },
  { snippet: SEED_SNIPPETS[7], guess: 'returns the most frequent element in the list', missedTerms: ['majority', 'more than half', 'over half', 'n/2', 'n / 2', 'half'] },
];

const results = [];
for (const c of cases) {
  const started = Date.now();
  const result = await crossExamine({
    snippet: c.snippet,
    guess: c.guess,
    missedTerms: c.missedTerms,
    provider,
  });
  results.push({ feature: 'Cross-Examine', snippet: c.snippet.title, ms: Date.now() - started, result });
  console.log(`\nCross-Examine: ${c.snippet.title}`);
  console.log(`provider=${result.provider} model=${result.model ?? '-'} mode=${result.mode} falsified=${result.falsified} corroborated=${result.corroborated} total=${result.total}`);
  if (result.notice) console.log(`notice: ${result.notice}`);
  for (const probe of result.probes) {
    console.log(`  ${String(probe.verdict).padEnd(20)} args=${probe.argsJson} predicted=${JSON.stringify(probe.predicted)} actual=${JSON.stringify(probe.actual)}`);
  }
}

const started = Date.now();
const detective = await runDetective({
  snippet: SEED_SNIPPETS[2],
  provider,
  emit: event => {
    if (event.type === 'thought') console.log(`  note: ${event.text.slice(0, 120)}`);
    if (event.type === 'experiment') {
      console.log(`  experiment ${event.n}: ${event.purpose} | args=${event.argsJson} -> ${event.ok ? JSON.stringify(event.output) : event.error}`);
    }
  },
});
results.push({ feature: 'AI Detective', snippet: SEED_SNIPPETS[2].title, ms: Date.now() - started, result: detective });
console.log(`\nAI Detective: ${detective.statement ?? detective.notice}`);

fs.mkdirSync('test-results', { recursive: true });
fs.writeFileSync(path.join('test-results', 'live-ai-check.json'), JSON.stringify({ runAt: new Date().toISOString(), results }, null, 2));
console.log('\nSaved test-results/live-ai-check.json');

const failures = results.filter(item => item.result.notice || item.result.provider !== 'groq' || (item.result.mode && item.result.mode !== 'ai-probes'));
if (failures.length) {
  console.error(`\nLIVE AI CHECK FAILED: ${failures.length} of ${results.length} runs did not complete in live Groq mode.`);
  process.exit(1);
}
console.log('\nLIVE AI CHECK PASSED: all three runs used the live Groq provider.');
