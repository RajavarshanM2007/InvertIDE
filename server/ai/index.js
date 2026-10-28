// Chooses the AI provider for Cross-Examine and AI Detective.
//   AI_PROVIDER=groq    -> Groq-hosted cloud model (no local model/Ollama)
//   AI_PROVIDER=claude  -> Claude API (optional compatibility)
//   AI_PROVIDER=fixture -> deterministic test double
//   otherwise          -> offline predict-then-run mode
import fs from 'node:fs';
import { createClaudeProvider, DEFAULT_MODEL } from './claudeProvider.js';
import { createGroqProvider, DEFAULT_GROQ_MODEL } from './groqProvider.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createFixtureProvider(fixtures, detectiveScripts = [], { stepDelayMs = 0 } = {}) {
  return {
    name: 'fixture',
    model: 'test-double',

    async generate({ code }) {
      const entry = fixtures.find(f => code.includes(f.match));
      if (!entry) throw new Error('no fixture for this snippet');
      return { ...entry.response, provider: 'fixture', model: 'test-double' };
    },

    async investigate({ code, runCode, think }) {
      const script = detectiveScripts.find(f => code.includes(f.match));
      if (!script) throw new Error('no scripted investigation for this snippet in the test double');

      for (const step of script.steps) {
        await sleep(stepDelayMs);
        if (step.thought) think(step.thought);
        if (step.args_json) await runCode(step.args_json, step.purpose);
      }

      await sleep(stepDelayMs);
      return { ...script.final, provider: 'fixture', model: 'test-double' };
    },
  };
}

export function providerFromEnv(env = process.env) {
  const choice = (
    env.AI_PROVIDER ||
    (env.GROQ_API_KEY ? 'groq' : env.ANTHROPIC_API_KEY ? 'claude' : 'offline')
  ).toLowerCase();

  if (choice === 'groq') {
    if (!env.GROQ_API_KEY) {
      return {
        provider: null,
        warning: 'AI_PROVIDER=groq but GROQ_API_KEY is not set; running offline.',
      };
    }

    return {
      provider: createGroqProvider({
        apiKey: env.GROQ_API_KEY,
        model: env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
        timeoutMs: Number(env.GROQ_TIMEOUT_MS || 30000),
        // Free/on-demand tier limit for qwen/qwen3.8-27b; raise it after upgrading.
        outputTokensPerMinute: Number(env.GROQ_OUTPUT_TOKENS_PER_MINUTE ?? 1000),
        log: message => console.log(message),
      }),
    };
  }

  if (choice === 'claude') {
    if (!env.ANTHROPIC_API_KEY) {
      return {
        provider: null,
        warning: 'AI_PROVIDER=claude but ANTHROPIC_API_KEY is not set; running offline.',
      };
    }

    return {
      provider: createClaudeProvider({
        apiKey: env.ANTHROPIC_API_KEY,
        model: env.AI_MODEL || DEFAULT_MODEL,
      }),
    };
  }

  if (choice === 'fixture') {
    const file = env.AI_FIXTURE_FILE ||
      new URL('../../tests/fixtures/cross-examine.json', import.meta.url);
    const detFile = env.AI_DETECTIVE_FIXTURE_FILE ||
      new URL('../../tests/fixtures/detective.json', import.meta.url);
    const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));

    return {
      provider: createFixtureProvider(
        read(file),
        read(detFile),
        { stepDelayMs: Number(env.AI_FIXTURE_STEP_DELAY_MS ?? 700) },
      ),
      warning: 'AI features are using the TEST-DOUBLE fixture provider, not a live AI model.',
    };
  }

  return { provider: null };
}
