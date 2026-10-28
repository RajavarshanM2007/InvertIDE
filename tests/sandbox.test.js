// Unit tests - execution sandbox used to obtain ground-truth outputs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runSnippet, parseArgs, canonical, sameOutput, MAX_ARGS_CHARS } from '../server/sandbox.js';
import { SEED_SNIPPETS } from '../server/seedSnippets.js';

describe('Execution sandbox', () => {
  test('UT-SB-01 executes the execution twin and returns its output', () => {
    const s = SEED_SNIPPETS[0];
    assert.deepEqual(runSnippet(s.execJs, s.entryFn, [[2, 7, 11, 15], 9]), { ok: true, output: [0, 1] });
  });

  test('UT-SB-02 every seed snippet runs on all of its instructor probes', () => {
    for (const s of SEED_SNIPPETS) {
      for (const args of s.probes) assert.equal(runSnippet(s.execJs, s.entryFn, args).ok, true, `${s.title} ${JSON.stringify(args)}`);
    }
  });

  test('UT-SB-03 an infinite loop is stopped by the timeout', () => {
    const r = runSnippet('function f(){ while(true){} }', 'f', []);
    assert.equal(r.ok, false);
    assert.match(r.error, /exceeded/);
  });

  test('UT-SB-04 runtime errors are reported instead of crashing the server', () => {
    const r = runSnippet('function f(a){ return a.b.c; }', 'f', [null]);
    assert.equal(r.ok, false);
    assert.match(r.error, /Runtime error/);
  });

  test('UT-SB-05 the sandbox has no access to Node.js globals', () => {
    assert.match(runSnippet('function f(){ return process.env; }', 'f', []).error, /process is not defined/);
    assert.match(runSnippet('function f(){ return require("fs"); }', 'f', []).error, /require is not defined/);
  });

  test('UT-SB-06 code generation from strings (eval) is disabled', () => {
    assert.equal(runSnippet('function f(){ return eval("1+1"); }', 'f', []).ok, false);
  });

  test('UT-SB-07 argument JSON is validated', () => {
    assert.match(parseArgs('[1,', 1).error, /not valid JSON/);
    assert.match(parseArgs('{"a":1}', 1).error, /JSON array/);
    assert.match(parseArgs('[1,2]', 1).error, /Expected 1 argument/);
    assert.match(parseArgs(`[${'1,'.repeat(MAX_ARGS_CHARS)}1]`, 1).error, /at most/);
    assert.deepEqual(parseArgs('[[1,2],3]', 2), { args: [[1, 2], 3] });
  });

  test('UT-SB-08 arguments cannot inject code', () => {
    const s = SEED_SNIPPETS[1];
    const r = runSnippet(s.execJs, s.entryFn, ['"); process.exit(1); ("']);
    assert.equal(r.ok, true);
  });

  test('UT-SB-09 output comparison is structural and key-order independent', () => {
    assert.equal(canonical({ b: 1, a: [1, { d: 2, c: 3 }] }), canonical({ a: [1, { c: 3, d: 2 }], b: 1 }));
    assert.ok(sameOutput([0, 1], [0, 1]));
    assert.ok(!sameOutput([0, 1], [1, 0]));
    assert.ok(!sameOutput(1, '1'));
    assert.ok(sameOutput(null, undefined));
  });
});
