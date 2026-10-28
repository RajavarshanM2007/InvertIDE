// Cross-Examine: the AI counterexample engine.
//
// 1. An AI provider reads the snippet and the student's hypothesis and designs
//    probe inputs, predicting what a program that solves the STUDENT'S stated
//    problem would return for each one.
// 2. The server executes the real snippet on every probe (sandbox.js) - the AI
//    is never trusted to say what the code does.
// 3. Each probe gets a verdict: corroborated (prediction == actual output),
//    falsified (a counterexample), undetermined (hypothesis too vague) or error.
// 4. A leak guard removes AI text that would reveal the hidden reference.
//
// Without a configured provider the engine runs in offline "predict-then-run"
// mode: administrator-authored probes are shown and the student predicts.
import { parseArgs, runSnippet, sameOutput } from './sandbox.js';
import { tokenize, containsTerm } from './evaluator.js';

export const MAX_PROBES = 5;
export const UNDETERMINED = 'UNDETERMINED';

const STOPWORDS = new Set(('a an the of to in on and or is are be that which it its for with by as at from '
  + 'this these those given return returns find whether if each any every all into than then so').split(' '));

function contentTokens(text) {
  return tokenize(text).filter(t => !STOPWORDS.has(t));
}

function ngrams(tokens, n) {
  const out = new Set();
  for (let i = 0; i + n <= tokens.length; i++) out.add(tokens.slice(i, i + n).join(' '));
  return out;
}

// Removes every sentence that reproduces 3+ consecutive content words of the
// hidden reference question, or names a high-weight concept the student has
// not found yet - unless the student already wrote those words themselves.
export function redactLeaks(text, { reference, missedTerms = [], guess = '' }) {
  if (!text) return { text: '', redacted: 0 };
  const refGrams = ngrams(contentTokens(reference), 3);
  const guessGrams = ngrams(contentTokens(guess), 3);
  const guessTokens = tokenize(guess);
  const banned = missedTerms.filter(t => !containsTerm(guessTokens, t));
  let redacted = 0;
  const sentences = String(text).split(/(?<=[.!?])\s+/);
  const kept = sentences.map(sentence => {
    const grams = ngrams(contentTokens(sentence), 3);
    const sentenceTokens = tokenize(sentence);
    const echoesReference = [...grams].some(g => refGrams.has(g) && !guessGrams.has(g));
    const namesMissedConcept = banned.some(t => containsTerm(sentenceTokens, t));
    if (echoesReference || namesMissedConcept) { redacted++; return '[hint withheld: too close to the hidden answer]'; }
    return sentence;
  });
  return { text: kept.join(' '), redacted };
}

// ---------------------------------------------------------------------------
// Provider-independent pipeline
// ---------------------------------------------------------------------------

export function offlineProbes(snippet) {
  return snippet.probes.slice(0, MAX_PROBES).map((args, i) => ({
    id: i + 1, argsJson: JSON.stringify(args), predicted: null, verdict: 'awaiting-prediction',
  }));
}

export function judgeProbe(snippet, argsJson, predictedJson) {
  const parsed = parseArgs(argsJson, snippet.params.length);
  if (parsed.error) return { error: parsed.error };
  const run = runSnippet(snippet.execJs, snippet.entryFn, parsed.args);
  let predicted = null;
  let determined = predictedJson != null && predictedJson !== UNDETERMINED;
  if (determined) {
    try { predicted = JSON.parse(predictedJson); }
    catch { return { error: 'Prediction must be valid JSON, e.g. 2, true, "abc" or [0, 1].' }; }
  }
  let verdict;
  if (!run.ok) verdict = 'error';
  else if (!determined) verdict = 'undetermined';
  else verdict = sameOutput(predicted, run.output) ? 'corroborated' : 'falsified';
  return {
    argsJson: JSON.stringify(parsed.args),
    predicted, determined,
    actual: run.ok ? run.output : null,
    actualError: run.ok ? null : run.error,
    verdict,
  };
}

function summarize(probes) {
  return {
    falsified: probes.filter(p => p.verdict === 'falsified').length,
    corroborated: probes.filter(p => p.verdict === 'corroborated').length,
    total: probes.length,
  };
}

export async function crossExamine({ snippet, guess, missedTerms = [], provider }) {
  if (!provider) {
    return {
      provider: 'offline', mode: 'predict-then-run', notice: null,
      probes: offlineProbes(snippet), ...summarize([]),
    };
  }

  const providerInput = {
    language: snippet.language,
    code: snippet.code,
    execJs: snippet.execJs,
    entryFn: snippet.entryFn,
    params: snippet.params,
    hypothesis: guess,
    reference: snippet.referenceQuestion,
  };

  let ai;
  try {
    ai = await provider.generate(providerInput);
  } catch (err) {
    return {
      provider: 'offline', mode: 'predict-then-run',
      notice: `AI provider unavailable (${err.message}). Switched to offline predict-then-run mode.`,
      probes: offlineProbes(snippet), ...summarize([]),
    };
  }

  const guard = { reference: snippet.referenceQuestion, missedTerms, guess };

  function evaluateProbes(candidate) {
    const seen = new Set();
    const probes = [];
    const rejected = [];
    let redactions = 0;
    const candidates = Array.isArray(candidate?.probes) ? candidate.probes : [];

    if (candidates.length === 0) rejected.push('No probes were returned.');

    for (const p of candidates.slice(0, MAX_PROBES * 2)) {
      if (probes.length >= MAX_PROBES) break;
      const argsJson = p?.args_json ?? p?.argsJson ?? p?.args;
      const predictedJson = p?.predicted_json ?? p?.predictedJson ?? p?.predicted;
      if (argsJson == null || predictedJson == null) {
        rejected.push('Probe is missing args_json or predicted_json.');
        continue;
      }
      const argsText = typeof argsJson === 'string' ? argsJson : JSON.stringify(argsJson);
      const predictionText = typeof predictedJson === 'string' ? predictedJson : JSON.stringify(predictedJson);
      const judged = judgeProbe(snippet, argsText, predictionText);
      if (judged.error) {
        rejected.push(judged.error);
        continue;
      }
      if (seen.has(judged.argsJson)) {
        rejected.push('Duplicate probe input was returned.');
        continue;
      }
      seen.add(judged.argsJson);
      const rationale = redactLeaks(p?.rationale ?? p?.reason ?? '', guard);
      redactions += rationale.redacted;
      probes.push({ id: probes.length + 1, ...judged, rationale: rationale.text });
    }

    return { probes, rejected, redactions };
  }

  let evaluated = evaluateProbes(ai);

  // If the provider's probes are all invalid, ask it once to repair them with
  // the concrete validator errors. Never loop or retry API quota/auth errors here.
  if (evaluated.probes.length === 0) {
    try {
      ai = await provider.generate({
        ...providerInput,
        validationFeedback: evaluated.rejected.slice(0, 5),
      });
      evaluated = evaluateProbes(ai);
    } catch (err) {
      evaluated.rejected.push(`Probe repair failed: ${err.message}`);
    }
  }

  const probes = evaluated.probes;
  let redactions = evaluated.redactions;

  if (probes.length === 0) {
    const reason = evaluated.rejected[0] || 'No usable probes were returned.';
    return {
      provider: 'offline', mode: 'predict-then-run',
      notice: `The AI response contained no usable probes after one repair attempt (${reason}). Switched to offline predict-then-run mode.`,
      probes: offlineProbes(snippet), ...summarize([]),
    };
  }

  const restated = redactLeaks(
    ai.restated_hypothesis ?? ai.restatedHypothesis ?? ai.hypothesis ?? ai.restatement ?? '',
    guard,
  );
  const gapHint = redactLeaks(
    ai.gap_hint ?? ai.gapHint ?? ai.gap ?? ai.missing_case ?? '',
    guard,
  );
  redactions += restated.redacted + gapHint.redacted;

  return {
    provider: ai.provider || provider.name || 'groq',
    model: ai.model || provider.model,
    mode: 'ai-probes', notice: null,
    restated: restated.text, gapHint: gapHint.text, redactions,
    probes, ...summarize(probes),
  };
}
