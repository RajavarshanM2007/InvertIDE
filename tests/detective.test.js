// Unit tests - AI Detective agent. AI behaviour is supplied by test doubles
// (scripted provider or a fake Anthropic SDK client); no live AI is called.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runDetective, MAX_EXPERIMENTS } from '../server/detective.js';
import { createFixtureProvider } from '../server/ai/index.js';
import { createClaudeProvider } from '../server/ai/claudeProvider.js';
import { SEED_SNIPPETS } from '../server/seedSnippets.js';

const scripts = JSON.parse(fs.readFileSync(new URL('./fixtures/detective.json', import.meta.url), 'utf8'));
const lowerBound = SEED_SNIPPETS[2];
const majority = SEED_SNIPPETS[7];
const scripted = createFixtureProvider([], scripts, { stepDelayMs: 0 });
const collect = () => { const events = []; return { events, emit: e => events.push(e) }; };

describe('AI Detective engine', () => {
  test('UT-DT-01 scripted investigation: outputs come from the sandbox and the hypothesis is graded', async () => {
    const { events, emit } = collect();
    const r = await runDetective({ snippet: lowerBound, provider: scripted, emit, studentBest: 10 });
    assert.deepEqual(r.experiments.map(e => e.output), [2, 2, 1, 2, 0]);
    assert.equal(r.score, 100);
    assert.equal(r.studentBest, 10);
    assert.equal(r.confidence, 92);
    assert.deepEqual(events.map(e => e.type), ['start', 'thought', 'experiment', 'experiment', 'thought', 'experiment', 'experiment', 'experiment', 'verdict']);
  });

  test('UT-DT-02 the Boyer-Moore investigation exposes the counterexample [1,1,1,2,3,4,5] -> 5', async () => {
    const r = await runDetective({ snippet: majority, provider: scripted });
    assert.deepEqual(r.experiments.map(e => e.output), [3, 2, 5, 3]);
    assert.equal(r.score, 100);
  });

  test('UT-DT-03 the experiment budget is enforced', async () => {
    let refused = null;
    const greedy = { name: 'stub', model: 'stub', async investigate({ runCode }) {
      for (let i = 0; i < 9; i++) { const r = await runCode(`[[1,2,3],${i}]`, `probe ${i}`); if (r.budgetExhausted) refused = i; }
      return { statement: 'returns an index in a sorted array', reasoning: 'r', confidence: 50 };
    } };
    const r = await runDetective({ snippet: lowerBound, provider: greedy });
    assert.equal(r.experiments.length, MAX_EXPERIMENTS);
    assert.equal(refused, MAX_EXPERIMENTS + 2);
  });

  test('UT-DT-04 malformed arguments are recorded as failed experiments and never executed', async () => {
    const bad = { name: 'stub', model: 'stub', async investigate({ runCode }) {
      await runCode('[1,', 'broken JSON'); await runCode('[[1,2]]', 'wrong arity');
      return { statement: 'some statement about arrays', reasoning: '', confidence: 10 };
    } };
    const r = await runDetective({ snippet: lowerBound, provider: bad });
    assert.deepEqual(r.experiments.map(e => e.ok), [false, false]);
    assert.match(r.experiments[1].error, /Expected 2 argument/);
  });

  test('UT-DT-05 a failing provider falls back to the instructor log with a notice', async () => {
    const failing = { name: 'claude', model: 'm', async investigate() { throw new Error('API error 400: Your credit balance is too low'); } };
    const { events, emit } = collect();
    const r = await runDetective({ snippet: lowerBound, provider: failing, emit });
    assert.match(r.notice, /unavailable \(API error 400: Your credit balance is too low\)\. Showing the instructor experiment log/);
    assert.equal(r.provider, 'offline');
    assert.equal(r.statement, undefined);
    assert.equal(r.experiments.length, lowerBound.probes.length);
    assert.ok(events.some(e => e.type === 'fallback'));
    assert.equal(events.at(-1).type, 'verdict');
  });

  test('UT-DT-06 offline mode shows the instructor experiment log without a hypothesis', async () => {
    const r = await runDetective({ snippet: lowerBound, provider: null });
    assert.equal(r.provider, 'offline');
    assert.equal(r.experiments.length, lowerBound.probes.length);
    assert.equal(r.statement, undefined);
    assert.match(r.notice, /No AI provider/);
  });

  test('UT-DT-07 the agent is never given the hidden reference question', async () => {
    let received;
    const spy = { name: 'stub', model: 'stub', async investigate(input) { received = input; return { statement: 'x y z w', reasoning: '', confidence: 1 }; } };
    await runDetective({ snippet: lowerBound, provider: spy });
    assert.ok(!('reference' in received) && !('referenceQuestion' in received) && !('keywords' in received));
    assert.ok(!JSON.stringify({ ...received, runCode: 0, think: 0 }).includes(lowerBound.referenceQuestion));
  });
});

describe('AI Detective agent loop (fake Claude SDK client)', () => {
  const toolUse = (id, name, input) => ({ type: 'tool_use', id, name, input });
  function fakeClient(responses) {
    const requests = [];
    return { requests, beta: { messages: { create: async req => { requests.push(structuredClone(req)); return responses.shift(); } } } };
  }

  test('UT-DT-08 runs tools through the sandbox, feeds results back and returns the submitted hypothesis', async () => {
    const client = fakeClient([
      { stop_reason: 'tool_use', model: 'claude-opus-5-5', content: [{ type: 'thinking', thinking: 'Looks like binary search.' }, toolUse('t1', 'run_code', { args_json: '[[1,3,5,7],4]', purpose: 'absent value' })] },
      { stop_reason: 'tool_use', model: 'claude-opus-5-5', content: [toolUse('t2', 'run_code', { args_json: '[[],1]', purpose: 'empty array' })] },
      { stop_reason: 'tool_use', model: 'claude-opus-5-5', content: [toolUse('t3', 'submit_hypothesis', { statement: 'Return the leftmost insertion index of x in a sorted array', reasoning: '4 -> 2', confidence: 80 })] },
    ]);
    const provider = createClaudeProvider({ client });
    const { events, emit } = collect();
    const r = await runDetective({ snippet: lowerBound, provider, emit });
    assert.deepEqual(r.experiments.map(e => e.output), [2, 0]);
    assert.equal(r.statement, 'Return the leftmost insertion index of x in a sorted array');
    assert.equal(r.confidence, 80);
    assert.ok(events.some(e => e.type === 'thought' && e.text === 'Looks like binary search.'));
    const req = client.requests[0];
    assert.equal(req.model, 'claude-opus-5-5');
    assert.deepEqual(req.tools.map(t => [t.name, t.strict]), [['run_code', true], ['submit_hypothesis', true]]);
    assert.deepEqual(req.thinking, { type: 'adaptive', display: 'summarized' });
    assert.equal(req.fallbacks, 'default');
    assert.ok(!JSON.stringify(req).includes(lowerBound.referenceQuestion), 'reference must not be sent');
    const second = client.requests[1].messages;
    assert.equal(second.at(-2).role, 'assistant');
    assert.deepEqual(second.at(-1).content[0], { type: 'tool_result', tool_use_id: 't1', is_error: false, content: 'Output: 2' });
  });

  test('UT-DT-09 a model that stops without submitting is nudged once, then reported', async () => {
    const client = fakeClient([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'I think I know.' }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] },
    ]);
    const r = await runDetective({ snippet: lowerBound, provider: createClaudeProvider({ client }) });
    assert.match(r.notice, /without submitting/);
    assert.equal(client.requests[1].messages.at(-1).content, 'Please finish by calling submit_hypothesis.');
  });

  test('UT-DT-10 runtime errors are returned to the model as error tool results', async () => {
    const client = fakeClient([
      { stop_reason: 'tool_use', content: [toolUse('t1', 'run_code', { args_json: '[null, 1]', purpose: 'null input' })] },
      { stop_reason: 'refusal', content: [] },
    ]);
    const r = await runDetective({ snippet: lowerBound, provider: createClaudeProvider({ client }) });
    const result = client.requests[1].messages.at(-1).content[0];
    assert.equal(result.is_error, true);
    assert.match(result.content, /^Error: Runtime error/);
    assert.match(r.notice, /declined/);
  });
});
