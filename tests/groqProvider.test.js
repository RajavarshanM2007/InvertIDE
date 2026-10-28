// Groq provider tests use mocked HTTP responses only; no live API key is needed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createGroqProvider, coerceArgsJson, rateLimitWaitMs } from '../server/ai/groqProvider.js';
import { crossExamine } from '../server/crossExamine.js';
import { SEED_SNIPPETS } from '../server/seedSnippets.js';

function okJson(content, extra = {}) {
  return new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content } }],
    ...extra,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function apiError(status, message, extraError = {}) {
  return new Response(JSON.stringify({
    error: { message, ...extraError },
  }), { status, headers: { 'content-type': 'application/json' } });
}

const action = (overrides = {}) => JSON.stringify({
  action: 'submit_hypothesis',
  args_json: '',
  purpose: '',
  statement: 'Return the index of a matching value or a not-found marker.',
  reasoning: 'Experiments show matching and non-matching cases.',
  confidence: 82,
  ...overrides,
});

const probeResponse = (args = '[[1,3,5],4]', prediction = '2') => JSON.stringify({
  restated_hypothesis: 'Find a target in a sorted array.',
  gap_hint: 'Check empty inputs and duplicate values.',
  probes: [
    { args_json: args, predicted_json: prediction, rationale: 'Check a boundary case.' },
    { args_json: '[[1,3,5],3]', predicted_json: '1', rationale: 'Check a matching value.' },
    { args_json: '[[],3]', predicted_json: '0', rationale: 'Check an empty array.' },
  ],
});

function scriptedFetch(responses, requests = []) {
  return async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const next = responses.shift();
    if (typeof next === 'function') return next();
    return next;
  };
}

describe('Groq provider (mocked API)', () => {
  test('AI Detective runs an experiment, feeds the observation back, then submits a hypothesis', async () => {
    const requests = [];
    const fetchImpl = scriptedFetch([
      okJson(action({
        action: 'run_code',
        args_json: '[2,3]',
        purpose: 'Check whether the function adds two numbers.',
        statement: '',
        reasoning: '',
        confidence: 0,
      })),
      okJson(action()),
    ], requests);

    const provider = createGroqProvider({ apiKey: 'test-key', fetchImpl });
    const result = await provider.investigate({
      language: 'JavaScript',
      code: 'function solve(a, b) { return a + b; }',
      execJs: 'function solve(a, b) { return a + b; }',
      params: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }],
      maxExperiments: 2,
      runCode: async (args, purpose) => ({ ok: true, output: 5, args, purpose }),
    });

    assert.equal(result.provider, 'groq');
    assert.equal(result.confidence, 82);
    assert.match(result.statement, /index/);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].response_format, undefined, 'does not force Groq JSON decoding');
    assert.equal(requests[0].reasoning_format, 'hidden');
    assert.equal(requests[0].reasoning_effort, 'none');
    assert.equal(requests[0].messages.every(message => message.role !== 'system'), true);
    assert.equal(requests[0].messages.some(message => message.role === 'system'), false,
      'Qwen system instructions are folded into the user request');
    assert.ok(requests[1].messages.some(message => message.content.includes('"output":5')),
      'the real sandbox observation is included in the next model request');
    assert.ok(requests.every(request => request.max_completion_tokens <= 480));
  });

  test('AI Detective repairs a malformed first response once', async () => {
    const requests = [];
    const provider = createGroqProvider({
      apiKey: 'test-key',
      fetchImpl: scriptedFetch([
        okJson('not valid json at all'),
        okJson(`\n\`\`\`json\n${action()}\n\`\`\``),
      ], requests),
    });

    const result = await provider.investigate({
      language: 'JavaScript',
      code: 'function solve(x) { return x; }',
      execJs: 'function solve(x) { return x; }',
      params: [{ name: 'x', type: 'number' }],
      maxExperiments: 1,
      runCode: async () => ({ ok: true, output: 1 }),
    });

    assert.equal(result.provider, 'groq');
    assert.equal(requests.length, 2);
    assert.ok(requests[1].max_completion_tokens <= 480);
  });

  test('Evidence Board repairs a malformed first JSON response', async () => {
    const requests = [];
    const provider = createGroqProvider({
      apiKey: 'test-key',
      fetchImpl: scriptedFetch([
        okJson('this is not JSON'),
        okJson(probeResponse()),
      ], requests),
    });
    const result = await crossExamine({
      snippet: SEED_SNIPPETS[2],
      guess: 'returns an index or a not-found marker',
      missedTerms: [],
      provider,
    });
    assert.equal(requests.length, 2);
    assert.equal(result.mode, 'ai-probes');
    assert.ok(result.total > 0);
  });

  test('Evidence Board falls back with a diagnostic if repaired probes are still invalid', async () => {
    const bad = JSON.stringify({
      restated_hypothesis: 'A hypothesis.',
      gap_hint: 'A hint.',
      probes: [{ args_json: '[bad', predicted_json: '2', rationale: 'bad input' }],
    });
    const requests = [];
    const provider = createGroqProvider({
      apiKey: 'test-key',
      fetchImpl: scriptedFetch([okJson(bad), okJson(bad)], requests),
    });
    const result = await crossExamine({
      snippet: SEED_SNIPPETS[2],
      guess: 'returns an index or a not-found marker',
      missedTerms: [],
      provider,
    });
    assert.equal(requests.length, 2);
    assert.equal(result.provider, 'offline');
    assert.match(result.notice, /no usable probes.*repair attempt/i);
  });

  test('Evidence Board uses a repair request when its first probe has invalid arguments', async () => {
    const requests = [];
    const fetchImpl = scriptedFetch([
      okJson(JSON.stringify({
        restated_hypothesis: 'Find a target in a sorted array.',
        gap_hint: 'Check boundary cases.',
        probes: Array.from({ length: 3 }, (_, i) => ({ args_json: '[1,', predicted_json: String(i), rationale: 'Invalid test probe.' })),
      })),
      okJson(probeResponse()),
    ], requests);
    const provider = createGroqProvider({ apiKey: 'test-key', fetchImpl });
    const snippet = SEED_SNIPPETS[2];
    const result = await crossExamine({
      snippet,
      guess: 'returns an index or a not-found marker',
      missedTerms: [],
      provider,
    });

    assert.equal(requests.length, 2, 'invalid first probe set is retried once');
    assert.equal(result.mode, 'ai-probes');
    assert.equal(result.provider, 'groq');
    assert.ok(result.total > 0);
    assert.ok(requests[1].messages.some(message => message.content.includes('probe_validation_feedback')),
      'validator feedback is sent during repair');
  });

  test('HTTP 400 keeps useful provider diagnostics and is not retried as malformed JSON', async () => {
    const requests = [];
    const provider = createGroqProvider({
      apiKey: 'test-key',
      fetchImpl: scriptedFetch([
        apiError(400, 'Invalid request option', { failed_generation: 'provider detail' }),
      ], requests),
    });

    await assert.rejects(
      provider.investigate({ language: 'JavaScript', code: '', execJs: '', params: [], maxExperiments: 0, runCode: async () => ({ ok: true, output: null }) }),
      /Groq API error \(HTTP 400\): Invalid request option.*failed_generation: provider detail/
    );
    assert.equal(requests.length, 1);
  });

  const rateLimited = (retryAfter, message = 'Output tokens per minute exceeded') => () => new Response(
    JSON.stringify({ error: { message } }),
    { status: 429, headers: { 'content-type': 'application/json', ...(retryAfter ? { 'retry-after': retryAfter } : {}), 'x-ratelimit-reset-tokens': '15s' } },
  );

  test('HTTP 429 waits for retry-after and retries instead of failing', async () => {
    const requests = [];
    const waits = [];
    const thoughts = [];
    const provider = createGroqProvider({
      apiKey: 'test-key',
      sleep: async ms => { waits.push(ms); },
      fetchImpl: scriptedFetch([rateLimited('6'), okJson(action())], requests),
    });
    const result = await provider.investigate({
      language: 'JavaScript', code: '', execJs: '', params: [], maxExperiments: 0,
      runCode: async () => ({ ok: true, output: null }), think: t => thoughts.push(t),
    });
    assert.equal(result.provider, 'groq');
    assert.equal(requests.length, 2);
    assert.deepEqual(waits, [6250]);
    assert.ok(thoughts.some(t => /Waiting 7s for the Groq rate limit/.test(t)), 'the wait is shown in the Detective timeline');
  });

  test('HTTP 429 uses "try again in" from the message when there is no retry-after header', async () => {
    const waits = [];
    const provider = createGroqProvider({
      apiKey: 'test-key',
      sleep: async ms => { waits.push(ms); },
      fetchImpl: scriptedFetch([rateLimited(null, 'Rate limit reached ... Please try again in 5.04s. Need more tokens?'), okJson(action())]),
    });
    await provider.investigate({ language: 'JavaScript', code: '', execJs: '', params: [], maxExperiments: 0, runCode: async () => ({ ok: true, output: null }) });
    assert.deepEqual(waits, [5290]);
  });

  test('HTTP 429 with a long wait (daily quota) reports rate-limit details without retrying', async () => {
    const requests = [];
    const provider = createGroqProvider({
      apiKey: 'test-key',
      sleep: async () => { throw new Error('must not sleep'); },
      fetchImpl: scriptedFetch([rateLimited('1400')], requests),
    });
    await assert.rejects(
      provider.investigate({ language: 'JavaScript', code: '', execJs: '', params: [], maxExperiments: 0, runCode: async () => ({ ok: true, output: null }) }),
      /Groq HTTP 429.*retry-after=1400s.*token reset=15s/
    );
    assert.equal(requests.length, 1);
  });

  test('HTTP 429 retries are bounded', async () => {
    const requests = [];
    const provider = createGroqProvider({
      apiKey: 'test-key',
      rateLimitRetries: 2,
      sleep: async () => {},
      fetchImpl: scriptedFetch([rateLimited('1'), rateLimited('1'), rateLimited('1')], requests),
    });
    await assert.rejects(
      provider.investigate({ language: 'JavaScript', code: '', execJs: '', params: [], maxExperiments: 0, runCode: async () => ({ ok: true, output: null }) }),
      /Groq HTTP 429/
    );
    assert.equal(requests.length, 3);
  });

  test('output-token budget paces requests before Groq would reject them', async () => {
    let clock = 0;
    const waits = [];
    const withUsage = (content, tokens) => okJson(content, { usage: { completion_tokens: tokens } });
    const provider = createGroqProvider({
      apiKey: 'test-key',
      outputTokensPerMinute: 1000,
      now: () => clock,
      sleep: async ms => { waits.push(ms); clock += ms; },
      fetchImpl: scriptedFetch([withUsage(probeResponse(), 900), withUsage(action(), 60)]),
    });
    await crossExamine({ snippet: SEED_SNIPPETS[2], guess: 'returns an index or a not-found marker', missedTerms: [], provider });
    assert.deepEqual(waits, [], 'first request fits the budget');
    // 900 used + 180 requested > 1000: waits for the first request to leave the window.
    await provider.investigate({ language: 'JavaScript', code: '', execJs: '', params: [], maxExperiments: 0, runCode: async () => ({ ok: true, output: null }) });
    assert.equal(waits.length, 1);
    assert.ok(waits[0] >= 60000 && waits[0] <= 60100);
  });

  test('Evidence Board accepts bare single-argument values and wraps them', async () => {
    const snippet = SEED_SNIPPETS.find(s => s.params.length === 1 && s.params[0].type === 'string');
    const requests = [];
    const provider = createGroqProvider({
      apiKey: 'test-key',
      fetchImpl: scriptedFetch([okJson(JSON.stringify({
        restated_hypothesis: 'Something about a string.',
        gap_hint: 'Try repeated characters.',
        probes: [
          { args_json: '"leetcode"', predicted_json: '0', rationale: 'bare JSON string' },
          { args_json: 'aabb', predicted_json: '-1', rationale: 'raw unquoted string' },
          { args_json: { [snippet.params[0].name]: 'abc' }, predicted_json: '0', rationale: 'object keyed by name' },
        ],
      }))], requests),
    });
    const result = await crossExamine({ snippet, guess: 'returns an index of some character in the string', missedTerms: [], provider });
    assert.equal(requests.length, 1, 'no repair request was needed');
    assert.equal(result.mode, 'ai-probes');
    assert.deepEqual(result.probes.map(p => p.argsJson), ['["leetcode"]', '["aabb"]', '["abc"]']);
  });

  test('coerceArgsJson fixes near-miss argument shapes and leaves others for the validator', () => {
    const p = (...types) => types.map((type, i) => ({ name: `p${i}`, type }));
    assert.equal(coerceArgsJson('"leetcode"', p('string')), '["leetcode"]');
    assert.equal(coerceArgsJson('["leetcode"]', p('string')), '["leetcode"]');
    assert.equal(coerceArgsJson('5', p('integer')), '[5]');
    assert.equal(coerceArgsJson('[1,2,3]', p('number[]')), '[[1,2,3]]');
    assert.equal(coerceArgsJson('[[1,2,3]]', p('number[]')), '[[1,2,3]]');
    assert.equal(coerceArgsJson('[]', p('number[]')), '[[]]');
    assert.equal(coerceArgsJson('[[1,3],[2,6]]', p('[start, end][]')), '[[[1,3],[2,6]]]');
    assert.equal(coerceArgsJson('[[[1,3]]]', p('[start, end][]')), '[[[1,3]]]');
    assert.equal(coerceArgsJson('{"p0":[1,2],"p1":3}', p('number[]', 'number')), '[[1,2],3]');
    assert.equal(coerceArgsJson('[[1,2],3]', p('number[]', 'number')), '[[1,2],3]');
    assert.equal(coerceArgsJson('[bad', p('number[]', 'number')), '[bad', 'invalid JSON is left for the validator');
    assert.equal(coerceArgsJson('[bad', p('number[]')), '[bad');
  });

  test('rateLimitWaitMs reads retry-after or the message hint', () => {
    assert.equal(rateLimitWaitMs('6'), 6000);
    assert.equal(rateLimitWaitMs(null, 'Please try again in 5.04s.'), 5040);
    assert.equal(rateLimitWaitMs(null, 'Please try again in 1m2.5s.'), 62500);
    assert.equal(rateLimitWaitMs(null, 'Please try again in 350ms.'), 350);
    assert.equal(rateLimitWaitMs(null, 'no hint'), null);
  });

  test('authentication failures and timeouts are reported without malformed-response retries', async () => {
    const authProvider = createGroqProvider({
      apiKey: 'bad-key',
      fetchImpl: scriptedFetch([apiError(401, 'invalid API key')]),
    });
    await assert.rejects(
      authProvider.investigate({ language: 'JavaScript', code: '', execJs: '', params: [], maxExperiments: 0, runCode: async () => ({ ok: true, output: null }) }),
      /rejected the API key.*invalid API key/
    );

    const timeoutProvider = createGroqProvider({
      apiKey: 'test-key',
      fetchImpl: async () => { const error = new Error('request timed out'); error.name = 'TimeoutError'; throw error; },
    });
    await assert.rejects(
      timeoutProvider.investigate({ language: 'JavaScript', code: '', execJs: '', params: [], maxExperiments: 0, runCode: async () => ({ ok: true, output: null }) }),
      /request timed out/
    );
  });
});
