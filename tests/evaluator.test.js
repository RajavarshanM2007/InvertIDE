// Unit tests - Keyword & Rule Evaluator (Assessment 8 module under test).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGuess, validateGuess, band, tokenize, containsTerm, MAX_GUESS_CHARS } from '../server/evaluator.js';
import { SEED_SNIPPETS } from '../server/seedSnippets.js';

const twoSum = SEED_SNIPPETS[0];
const lowerBound = SEED_SNIPPETS[2];
const intervals = SEED_SNIPPETS[9];

describe('Keyword evaluator', () => {
  test('UT-EV-01 each stored reference question scores 100 against its own keywords', () => {
    for (const s of SEED_SNIPPETS) {
      assert.equal(evaluateGuess(s.referenceQuestion, s.keywords).score, 100, s.title);
    }
  });

  test('UT-EV-02 a differently worded but correct guess scores in the strong band', () => {
    const r = evaluateGuess('Find the positions of a pair of numbers in a list whose sum equals the given target; return empty when none exists', twoSum.keywords);
    assert.ok(r.score >= 80, `score was ${r.score}`);
    assert.equal(r.band, 'strong');
  });

  test('UT-EV-03 an unrelated guess scores in the weak band', () => {
    const r = evaluateGuess('This code prints every character of a string in reverse order', twoSum.keywords);
    assert.ok(r.score < 50, `score was ${r.score}`);
    assert.equal(r.band, 'weak');
  });

  test('UT-EV-04 a partially correct guess scores in the partial band and lists matched concepts', () => {
    const r = evaluateGuess('Given a sorted array, return the index of the first element', lowerBound.keywords);
    assert.equal(r.band, 'partial');
    assert.deepEqual(r.matched.map(m => m.concept).sort(), ['leftmost / first', 'return index', 'sorted array']);
  });

  test('UT-EV-05 matching tolerates plural and -ing suffixes', () => {
    const r = evaluateGuess('Combine overlapping intervals and output them ordered', intervals.keywords);
    assert.equal(r.score, 100);
  });

  test('UT-EV-06 matching ignores case and punctuation', () => {
    const a = evaluateGuess('GIVEN A SORTED ARRAY, RETURN THE LEFTMOST INSERTION INDEX!!!', lowerBound.keywords);
    const b = evaluateGuess('given a sorted array return the leftmost insertion index', lowerBound.keywords);
    assert.equal(a.score, b.score);
  });

  test('UT-EV-07 "-1" in a guess is recognised as the not-found marker', () => {
    assert.ok(containsTerm(tokenize('return -1 if none'), '-1'));
    assert.ok(!containsTerm(tokenize('return 10 if none'), '-1'));
  });

  test('UT-EV-08 matched and missed concepts partition the reference concepts', () => {
    const r = evaluateGuess('return the index of the two numbers', twoSum.keywords);
    assert.equal(r.matched.length + r.missed.length, twoSum.keywords.length);
  });

  test('UT-EV-09 score bands use the documented boundaries', () => {
    assert.equal(band(100), 'strong'); assert.equal(band(80), 'strong'); assert.equal(band(79), 'partial');
    assert.equal(band(50), 'partial'); assert.equal(band(49), 'weak'); assert.equal(band(0), 'weak');
  });

  test('UT-EV-10 invalid guesses are rejected with a helpful message', () => {
    assert.match(validateGuess(''), /describe the problem/);
    assert.match(validateGuess('   '), /describe the problem/);
    assert.match(validateGuess('two sum'), /at least 4 words/);
    assert.match(validateGuess('x'.repeat(MAX_GUESS_CHARS + 1)), /at most 1000/);
    assert.match(validateGuess(42), /must be text/);
    assert.equal(validateGuess('find two numbers adding to target'), null);
    assert.throws(() => evaluateGuess('too short', twoSum.keywords), { status: 400 });
  });

  test('UT-EV-11 a short term does not match a much longer unrelated word', () => {
    assert.ok(!containsTerm(tokenize('summarise the document'), 'sum'));
    assert.ok(containsTerm(tokenize('the sums of pairs'), 'sum'));
  });

  test('UT-EV-12 [KNOWN DEFECT D-01] negated terms still count as matches', { todo: 'Negation handling is not implemented in the keyword evaluator' }, () => {
    const r = evaluateGuess('The array is not sorted and nothing is inserted', lowerBound.keywords);
    assert.equal(r.matched.find(m => m.concept === 'sorted array'), undefined);
  });

  test('UT-EV-13 [KNOWN DEFECT D-02] an equivalent restatement of a constraint is under-scored', { todo: 'Keyword matching cannot infer that "leftmost insertion index" implies the >= boundary' }, () => {
    const r = evaluateGuess('Given a sorted array return the leftmost insertion index for x', lowerBound.keywords);
    assert.equal(r.score, 100);
  });
});
