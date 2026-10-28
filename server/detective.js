// AI Detective: an autonomous agent that reverse-engineers a snippet live.
//
// The agent sees the code but NOT the hidden reference question. It runs its
// own experiments through a `run_code` tool (executed by sandbox.js, never by
// the AI), explains the purpose of every experiment, and finally submits a
// hypothesis. That hypothesis is graded by the same keyword evaluator as the
// student's guesses, so the student can compare their reasoning with the
// agent's. Every step is streamed to the browser as it happens.
import { parseArgs, runSnippet } from './sandbox.js';
import { evaluateGuess } from './evaluator.js';

export const MAX_EXPERIMENTS = 6;

// Wraps the sandbox so providers can only run validated JSON arguments.
function makeRunner(snippet, emit, state) {
  return async (argsJson, purpose) => {
    if (state.experiments.length >= MAX_EXPERIMENTS) {
      return { ok: false, error: `Experiment budget of ${MAX_EXPERIMENTS} used up. Submit your hypothesis now.`, budgetExhausted: true };
    }
    const parsed = parseArgs(argsJson, snippet.params.length);
    if (parsed.error) {
      const step = { n: state.experiments.length + 1, purpose: String(purpose || ''), argsJson: String(argsJson).slice(0, 200), ok: false, error: parsed.error };
      state.experiments.push(step);
      emit({ type: 'experiment', ...step });
      return { ok: false, error: parsed.error };
    }
    const run = runSnippet(snippet.execJs, snippet.entryFn, parsed.args);
    const step = {
      n: state.experiments.length + 1, purpose: String(purpose || '').slice(0, 300), argsJson: JSON.stringify(parsed.args),
      ok: run.ok, output: run.ok ? run.output : null, error: run.ok ? null : run.error,
    };
    state.experiments.push(step);
    emit({ type: 'experiment', ...step });
    return run.ok ? { ok: true, output: run.output } : { ok: false, error: run.error };
  };
}

// Offline: no AI, so no reasoning or hypothesis - only the instructor probes,
// clearly labelled as an experiment log.
async function offlineLog(snippet, runCode) {
  for (const args of snippet.probes.slice(0, MAX_EXPERIMENTS)) await runCode(JSON.stringify(args), 'Instructor probe (no AI reasoning in offline mode)');
  return null;
}

export async function runDetective({ snippet, provider, emit = () => {}, studentBest = null }) {
  const state = { experiments: [] };
  const runCode = makeRunner(snippet, emit, state);
  emit({ type: 'start', provider: provider ? provider.name : 'offline', model: provider?.model ?? null, budget: MAX_EXPERIMENTS });

  let verdict = null;
  let notice = null;
  let fellBack = false;
  if (!provider) {
    await offlineLog(snippet, runCode);
    notice = 'No AI provider is configured, so only the instructor experiment log is shown. Set AI_PROVIDER=groq and GROQ_API_KEY in .env to enable the Groq AI Detective.';
  } else {
    try {
      verdict = await provider.investigate({
        language: snippet.language, code: snippet.code, execJs: snippet.execJs, params: snippet.params,
        maxExperiments: MAX_EXPERIMENTS, runCode,
        think: text => emit({ type: 'thought', text: String(text).slice(0, 400) }),
      });
    } catch (err) {
      // Same graceful degradation as Cross-Examine: show the instructor log.
      notice = `AI Detective unavailable (${err.message.replace(/\.+$/, '')}). Showing the instructor experiment log instead.`;
      fellBack = true;
      emit({ type: 'fallback', reason: err.message });
      if (state.experiments.length === 0) await offlineLog(snippet, runCode);
    }
  }

  const finalProvider = provider && !fellBack ? provider.name : 'offline';
  let result = { provider: finalProvider, model: finalProvider === 'offline' ? null : provider.model ?? null, experiments: state.experiments, notice };
  if (verdict && typeof verdict.statement === 'string' && verdict.statement.trim()) {
    const statement = verdict.statement.trim().slice(0, 1000);
    let grade;
    try { grade = evaluateGuess(statement, snippet.keywords); } catch { grade = { score: 0, band: 'weak', matched: [], missed: snippet.keywords.map(k => ({ concept: k.concept })) }; }
    result = {
      ...result, statement, reasoning: String(verdict.reasoning || '').slice(0, 800),
      confidence: Number.isFinite(verdict.confidence) ? Math.max(0, Math.min(100, Math.round(verdict.confidence))) : null,
      score: grade.score, band: grade.band, matchedCount: grade.matched.length, conceptCount: snippet.keywords.length,
      studentBest,
    };
  } else if (provider && !notice) {
    result.notice = 'The AI Detective did not submit a hypothesis.';
  }
  emit({ type: 'verdict', ...result });
  return result;
}
