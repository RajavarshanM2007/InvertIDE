// Investigate screen: read the snippet, submit a hypothesis, cross-examine it
// against the real code, revise, and finally reveal the original question.
import { h, clear, busy, toast, difficultyBadge, show, isLiveAi } from '../dom.js';
import { api } from '../api.js';
import { getMeta } from '../app.js';
import { codeBlock } from '../highlight.js';
import { detectivePanel } from './detective.js';

const EXT = { JavaScript: 'js', Python: 'py', Java: 'java', 'C++': 'cpp' };
const MAX_CHARS = 1000;
const MIN_WORDS = 4;
const VERDICT_LABEL = {
  falsified: 'Counterexample', corroborated: 'Confirmed', undetermined: 'Too vague', error: 'Runtime error', 'awaiting-prediction': 'Your turn',
};

const words = text => (text.trim().match(/[A-Za-z0-9]+/g) || []).length;
const parseSqlTime = t => Date.parse(t.replace(' ', 'T') + 'Z');

// Built from the examination the server returned, not from configuration: a
// provider that fell back reports provider 'offline' / mode 'predict-then-run'.
function providerBadge(exam) {
  if (isLiveAi(exam.provider) && exam.mode === 'ai-probes') return h('span', { class: 'badge ai' }, `AI · ${exam.model || exam.provider}`);
  if (exam.provider === 'fixture') return h('span', { class: 'badge warn', title: 'Canned responses used for testing - not a live AI model' }, 'TEST DOUBLE · not live AI');
  return h('span', { class: 'badge off' }, 'Offline · predict-then-run');
}

function argsLabel(params, argsJson) {
  const args = JSON.parse(argsJson);
  return params.map((p, i) => `${p.name} = ${show(args[i])}`).join(', ');
}

export async function solveView({ params, query, onLeave }) {
  const id = Number(params[0]);
  const mode = query.get('mode') === 'challenge' ? 'challenge' : 'practice';
  const [meta, { snippet }] = await Promise.all([getMeta(), api(`/snippets/${id}`)]);

  const state = { ticket: null, attempts: [], last: null, revealed: false, timeUp: false, timer: null };
  onLeave(() => clearInterval(state.timer));
  const detective = detectivePanel({
    snippet, meta, mode,
    getAttempt: () => state.last,
    isUnlocked: () => !!state.last && (mode === 'practice' || state.revealed || state.timeUp),
  });

  // ---------------------------------------------------------------- code
  // In challenge mode the code stays hidden until the timer is started.
  const codeSlot = h('div', {}, mode === 'challenge'
    ? h('div', { class: 'code', style: { color: 'var(--dim)', whiteSpace: 'normal' } }, 'The code appears when you start the timer.')
    : codeBlock(snippet.code, snippet.language));
  const codePanel = h('div', { class: 'codepanel' },
    h('div', { class: 'bar' }, h('span', { class: 'lights', 'aria-hidden': 'true' }, '● ● ●'),
      h('span', {}, `${snippet.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${EXT[snippet.language] || 'txt'}`),
      h('span', { style: { color: 'var(--lime)' } }, snippet.language)),
    codeSlot,
    h('div', { class: 'foot' }, h('span', {}, `${snippet.topic} · ${snippet.difficulty}`),
      h('span', {}, `inputs: ${snippet.params.map(p => `${p.name}: ${p.type}`).join(', ')}`)));

  // ---------------------------------------------------------- hypothesis
  const textarea = h('textarea', {
    id: 'guess', maxlength: String(MAX_CHARS), rows: '5', 'aria-describedby': 'guess-hint guess-count',
    placeholder: 'e.g. "Given a list of numbers and a target, return …"',
  });
  const counter = h('span', { id: 'guess-count', 'aria-live': 'polite' });
  const submitBtn = h('button', { class: 'btn primary', type: 'submit', disabled: true }, 'Evaluate my hypothesis →');
  const formAlert = h('div', { role: 'alert' });
  const updateCounter = () => {
    const w = words(textarea.value);
    counter.textContent = `${w} word${w === 1 ? '' : 's'} · ${textarea.value.length}/${MAX_CHARS}`;
    submitBtn.disabled = w < MIN_WORDS || state.revealed || state.timeUp || (mode === 'challenge' && !state.ticket);
  };
  textarea.addEventListener('input', updateCounter);
  textarea.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !submitBtn.disabled) form.requestSubmit(); });

  const form = h('form', { class: 'panel', novalidate: true, 'aria-labelledby': 'guess-label' },
    h('div', { class: 'field', style: { marginBottom: '10px' } },
      h('label', { id: 'guess-label', for: 'guess' }, 'What problem does this code solve?'),
      textarea,
      h('div', { class: 'counter' }, h('span', { id: 'guess-hint' }, `Write it as a problem statement. Minimum ${MIN_WORDS} words · Ctrl+Enter to submit`), counter)),
    formAlert,
    h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } }, submitBtn));

  // ------------------------------------------------------------- outputs
  const resultArea = h('div', { 'aria-live': 'polite' });
  const xeArea = h('div');
  const historyArea = h('div');
  const answerArea = h('div');

  const xeButton = h('button', { class: 'btn lime', type: 'button', disabled: true }, 'Cross-examine my hypothesis');
  const revealBtn = h('button', { class: 'btn danger small', type: 'button', disabled: true }, 'Reveal original question');
  const xeIntro = h('div', { class: 'xe' },
    h('h3', {}, 'Cross-Examine', isLiveAi(meta.ai.mode) ? h('span', { class: 'badge ai' }, `AI · ${meta.ai.model || meta.ai.mode}`)
      : meta.ai.mode === 'fixture' ? h('span', { class: 'badge warn' }, 'TEST DOUBLE · not live AI') : h('span', { class: 'badge off' }, 'Offline mode')),
    h('p', { class: 'sub', style: { color: 'var(--muted)', margin: '4px 0 12px', fontSize: '14px' } },
      meta.ai.mode === 'offline'
        ? 'No AI provider is configured. You will get test inputs chosen by the instructor: predict each output from your hypothesis, then run the real code.'
        : 'AI reads your hypothesis, picks inputs where it is most likely to be wrong and predicts what your hypothesis implies. The real code is then executed - every mismatch is a verified counterexample.'),
    mode === 'challenge' ? h('p', { style: { fontSize: '13px', color: 'var(--amber)', margin: '0 0 12px' } }, `Challenge mode: each cross-examination deducts ${meta.examPenalty} points from later submissions (max 30).`) : null,
    h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } }, xeButton,
      h('span', { id: 'xe-hint', style: { fontSize: '13px', color: 'var(--dim)' } }, 'Submit a hypothesis first.')));

  // ----------------------------------------------------- predict-then-run
  const labInputs = snippet.params.map(p => h('input', { class: 'input mono', id: `lab-${p.name}`, placeholder: p.type, 'aria-label': `${p.name} (${p.type}) as JSON` }));
  const labPrediction = h('input', { class: 'input mono', id: 'lab-pred', placeholder: 'expected output as JSON', 'aria-label': 'Your predicted output as JSON' });
  const labRun = h('button', { class: 'btn small', type: 'button' }, 'Predict & run');
  const labResults = h('div', { class: 'probes', 'aria-live': 'polite' });
  labRun.onclick = async () => {
    const argsJson = `[${labInputs.map(i => i.value.trim() || 'null').join(',')}]`;
    if (labInputs.some(i => !i.value.trim())) return toast('Fill in every input value (as JSON).', 'bad');
    if (!labPrediction.value.trim()) return toast('Write your prediction before running the code.', 'bad');
    try {
      const { probe } = await busy(labRun, 'Running…', () => api(`/snippets/${id}/probe`, { method: 'POST', body: { argsJson, predictedJson: labPrediction.value.trim() } }));
      labResults.prepend(probeCard({ ...probe, id: labResults.children.length + 1 }, 'Your probe'));
    } catch (err) { toast(err.message, 'bad'); }
  };
  const lab = h('details', { class: 'panel lab' },
    h('summary', {}, 'Predict-then-run lab — test your own inputs'),
    h('p', { class: 'sub' }, 'Enter inputs as JSON (e.g. [1,2,3] or "abc"), commit to a prediction, then run the real code.'),
    h('div', { class: 'formgrid', style: { gridTemplateColumns: `repeat(${snippet.params.length + 1}, minmax(0,1fr))` } },
      snippet.params.map((p, i) => h('div', { class: 'field' }, h('label', { for: `lab-${p.name}` }, p.name), labInputs[i])),
      h('div', { class: 'field' }, h('label', { for: 'lab-pred' }, 'Prediction'), labPrediction)),
    labRun, labResults);

  // ---------------------------------------------------------------- probe UI
  function probeCard(p, label = `Probe ${p.id}`) {
    const actual = p.verdict === 'awaiting-prediction' ? h('dd', {}, 'hidden until you predict')
      : p.actualError ? h('dd', { style: { color: 'var(--amber)' } }, p.actualError) : h('dd', {}, show(p.actual));
    const predicted = p.verdict === 'awaiting-prediction' ? null : h('dd', {}, p.determined ? show(p.predicted) : 'cannot tell from your wording');
    const card = h('div', { class: `probe ${p.verdict}` },
      h('div', { class: 'probehead' }, h('strong', { style: { fontSize: '13px' } }, label), h('span', { class: `verdict ${p.verdict}` }, VERDICT_LABEL[p.verdict])),
      h('dl', { class: 'grid', style: { margin: 0 } },
        h('div', {}, h('dt', {}, 'Input'), h('dd', {}, argsLabel(snippet.params, p.argsJson))),
        h('div', {}, h('dt', {}, 'Your hypothesis predicts'), predicted ?? h('dd', {}, '—')),
        h('div', {}, h('dt', {}, 'Code actually returns'), actual)),
      p.rationale ? h('p', { class: 'why' }, p.rationale) : null);
    if (p.verdict === 'awaiting-prediction') {
      const input = h('input', { class: 'input', placeholder: 'your predicted output (JSON)', 'aria-label': `Prediction for ${label}` });
      const run = h('button', { class: 'btn small', type: 'button' }, 'Run');
      run.onclick = async () => {
        if (!input.value.trim()) return toast('Write a prediction first.', 'bad');
        try {
          const { probe } = await busy(run, 'Running…', () => api(`/snippets/${id}/probe`, { method: 'POST', body: { argsJson: p.argsJson, predictedJson: input.value.trim() } }));
          card.replaceWith(probeCard({ ...probe, id: p.id, rationale: 'Instructor-chosen test input.' }, label));
        } catch (err) { toast(err.message, 'bad'); }
      };
      card.append(h('div', { class: 'predict' }, input, run));
    }
    return card;
  }

  function renderExamination(exam) {
    const undetermined = exam.probes.filter(p => p.verdict === 'undetermined').length;
    const box = h('div', { class: 'xe', id: 'xe-result', tabindex: '-1' },
      h('h3', {}, 'Evidence board', providerBadge(exam)),
      exam.notice ? h('div', { class: 'alert warn' }, exam.notice) : null);
    if (exam.mode === 'ai-probes') {
      const pct = n => `${(n / exam.total) * 100}%`;
      box.append(
        h('p', { style: { margin: '6px 0', color: 'var(--muted)' } }, 'Your hypothesis, as read: ', h('em', { style: { color: 'var(--text)' } }, exam.restated)),
        h('div', { class: 'meter', role: 'img', 'aria-label': `${exam.falsified} counterexamples, ${exam.corroborated} confirmed, ${undetermined} undetermined out of ${exam.total} probes` },
          h('i', { class: 'f', style: { width: pct(exam.falsified) } }), h('i', { class: 'c', style: { width: pct(exam.corroborated) } }), h('i', { class: 'u', style: { width: pct(exam.total - exam.falsified - exam.corroborated) } })),
        h('p', { style: { margin: '0 0 6px', fontWeight: 700 } },
          exam.falsified
            ? `${exam.falsified} counterexample${exam.falsified === 1 ? '' : 's'} found — on ${exam.falsified === 1 ? 'this input' : 'these inputs'} the real code disagrees with your hypothesis.`
            : `No counterexamples — the code agreed with your hypothesis on ${exam.corroborated} of ${exam.total} probes.`,
          undetermined ? ` ${undetermined} probe${undetermined === 1 ? ' was' : 's were'} too vague to predict — make your statement more precise.` : ''),
        h('div', { class: 'probes' }, exam.probes.map(p => probeCard(p))),
        exam.gapHint ? h('div', { class: 'gaphint' }, h('strong', {}, 'Think about it: '), exam.gapHint) : null,
        h('p', { style: { fontSize: '13px', color: 'var(--dim)', margin: '12px 0 0' } }, 'Outputs under "Code actually returns" come from executing the snippet on the server, not from the AI.'),
      );
    } else {
      box.append(
        h('p', { class: 'sub', style: { color: 'var(--muted)', fontSize: '14px' } }, 'Predict each output from your own hypothesis, then press Run to execute the real code.'),
        h('div', { class: 'probes' }, exam.probes.map(p => probeCard(p))));
    }
    box.append(h('p', { style: { margin: '14px 0 0', fontSize: '14px' } }, 'Use the evidence to revise your statement above and submit again.'));
    return box;
  }

  xeButton.onclick = async () => {
    if (!state.last) return;
    try {
      const { examination, penaltyApplied } = await busy(xeButton, 'Designing probes and running the code…', () => api(`/attempts/${state.last.id}/cross-examine`, { method: 'POST' }));
      clear(xeArea).append(renderExamination(examination));
      if (penaltyApplied) toast(`Challenge penalty: −${penaltyApplied} on later submissions.`, 'bad');
      document.getElementById('xe-result')?.focus();
      textarea.value = state.last.guess;
      updateCounter();
    } catch (err) { toast(err.message, 'bad'); }
  };

  // --------------------------------------------------------------- results
  function renderResult(a) {
    const delta = a.previousScore == null ? null : a.score - a.previousScore;
    return h('div', { class: 'result' },
      h('div', { class: 'score' },
        h('div', { class: `ring ${a.band}`, style: { '--p': a.score }, role: 'img', 'aria-label': `Score ${a.score} out of 100` }, h('span', {}, a.score)),
        h('div', {},
          h('div', { class: 'eyebrow' }, `Round ${a.round} · ${a.band}`),
          h('p', { style: { margin: '6px 0 0' } }, a.feedback),
          h('p', { style: { margin: '4px 0 0', fontSize: '13px', color: 'var(--muted)' } },
            delta == null ? '' : h('span', { class: `delta ${delta >= 0 ? 'up' : 'down'}` }, `${delta >= 0 ? '▲ +' : '▼ '}${delta} vs previous round. `),
            a.penalty ? `Keyword score ${a.rawScore} − ${a.penalty} challenge penalty.` : ''))),
      a.afterReveal ? h('div', { class: 'alert warn', style: { margin: '12px 0 0' } }, 'You have already revealed this snippet\'s answer, so this attempt is saved for practice but does not count towards your progress.') : null,
      h('div', { class: 'chips', 'aria-label': 'Key ideas found' },
        a.matched.map(m => h('span', { class: 'chip', title: `matched "${m.term}"` }, `✓ ${m.concept}`)),
        a.missedCount ? h('span', { class: 'chip miss' }, `${a.missedCount} key idea${a.missedCount === 1 ? '' : 's'} still missing`) : null));
  }

  function renderHistory() {
    if (state.attempts.length < 2) return clear(historyArea);
    clear(historyArea).append(h('div', { class: 'panel' }, h('h3', {}, 'Rounds this session'),
      h('ul', { class: 'history' }, state.attempts.map(a => h('li', {}, h('span', { class: 'g', title: a.guess }, `R${a.round} · ${a.guess}`), h('strong', {}, a.score))))));
  }

  form.onsubmit = async e => {
    e.preventDefault();
    formAlert.className = ''; formAlert.textContent = '';
    if (words(textarea.value) < MIN_WORDS) return;
    try {
      const { attempt } = await busy(submitBtn, 'Evaluating…', () => api('/attempts', {
        method: 'POST', body: { snippetId: id, guess: textarea.value, mode, ticketId: state.ticket?.ticketId },
      }));
      attempt.guess = textarea.value.trim();
      state.last = attempt;
      state.attempts.push(attempt);
      clear(resultArea).append(renderResult(attempt));
      renderHistory();
      xeButton.disabled = false;
      detective.refresh();
      revealBtn.disabled = false;
      document.getElementById('xe-hint').textContent = 'Tests your latest submission.';
    } catch (err) {
      formAlert.className = 'alert'; formAlert.textContent = err.message;
      if (err.status === 409) endRound('closed');
    }
  };

  // ---------------------------------------------------------------- reveal
  function endRound(reason) {
    state.revealed = reason === 'revealed';
    state.timeUp = reason !== 'revealed';
    clearInterval(state.timer);
    textarea.disabled = true; xeButton.disabled = true; labRun.disabled = true;
    detective.refresh();
    updateCounter();
  }

  revealBtn.onclick = async () => {
    const warning = mode === 'challenge' ? 'Reveal the original question? This ends the challenge round; you cannot submit again.' : 'Reveal the original question? You can still look at the code afterwards.';
    if (!window.confirm(warning)) return;
    try {
      const res = await busy(revealBtn, 'Revealing…', () => api(`/attempts/${state.last.id}/reveal`, { method: 'POST' }));
      endRound('revealed');
      revealBtn.disabled = true;
      clear(answerArea).append(h('div', { class: 'answer', tabindex: '-1', id: 'answer' },
        h('div', { class: 'eyebrow' }, 'Original question'),
        h('q', {}, res.referenceQuestion),
        h('div', { class: 'chips' }, res.concepts.map(c => h('span', { class: c.matched ? 'chip' : 'chip miss' }, `${c.matched ? '✓' : '✗'} ${c.concept}`))),
        h('div', { style: { marginTop: '14px', display: 'flex', gap: '10px', flexWrap: 'wrap' } },
          h('a', { class: 'btn primary', href: '#/library' }, 'Next snippet →'), h('a', { class: 'btn', href: '#/progress' }, 'View progress'))));
      document.getElementById('answer')?.focus();
    } catch (err) { toast(err.message, 'bad'); }
  };

  // ------------------------------------------------------------- challenge
  const timerBox = h('div');
  if (mode === 'challenge') {
    const startBtn = h('button', { class: 'btn lime', type: 'button' }, 'Start the timer');
    const gate = h('div', { class: 'panel' },
      h('h3', {}, 'Timed challenge'),
      h('p', { class: 'sub' }, `You will have ${Math.round(meta.challengeTimeLimitSec / 60)} minutes. Your best score on this snippet counts towards the leaderboard. Cross-examining costs ${meta.examPenalty} points per use.`),
      startBtn);
    timerBox.append(gate);
    startBtn.onclick = async () => {
      try {
        const t = await busy(startBtn, 'Starting…', () => api('/challenges/start', { method: 'POST', body: { snippetId: id } }));
        state.ticket = t;
        clear(codeSlot).append(codeBlock(snippet.code, snippet.language));
        const deadline = Date.now() + t.timeLimitSec * 1000 - (Date.parse(t.serverNow) - parseSqlTime(t.startedAt));
        const clock = h('strong', { 'aria-live': 'off' });
        const fill = h('i');
        const bar = h('div', { class: 'timer', role: 'timer', 'aria-label': 'Time remaining' }, h('span', { class: 'eyebrow' }, 'Time left'), h('div', { class: 'track' }, fill), clock);
        clear(timerBox).append(bar);
        const tick = () => {
          const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
          clock.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
          fill.style.width = `${(left / t.timeLimitSec) * 100}%`;
          bar.classList.toggle('low', left <= 30);
          if (left === 0 && !state.timeUp) { endRound('time'); toast('Time is up for this challenge.', 'bad'); }
        };
        tick();
        state.timer = setInterval(tick, 1000);
        updateCounter();
        textarea.focus();
      } catch (err) { toast(err.message, 'bad'); }
    };
  }

  updateCounter();
  return h('section', { class: 'page' }, h('div', { class: 'wrap' },
    h('div', { class: 'pagehead', style: { marginBottom: '18px' } },
      h('div', {},
        h('a', { class: 'textlink', href: '#/library' }, '← Library'),
        h('h1', {}, snippet.title),
        h('div', { style: { display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' } },
          h('span', { class: 'badge' }, snippet.language), difficultyBadge(snippet.difficulty), h('span', { class: 'badge' }, snippet.topic),
          h('span', { class: mode === 'challenge' ? 'badge warn' : 'badge ai' }, mode === 'challenge' ? 'Challenge mode' : 'Practice mode'))),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Mode' },
        h('button', { type: 'button', 'aria-pressed': String(mode === 'practice'), onclick: () => { location.hash = `#/solve/${id}?mode=practice`; } }, 'Practice'),
        h('button', { type: 'button', 'aria-pressed': String(mode === 'challenge'), onclick: () => { location.hash = `#/solve/${id}?mode=challenge`; } }, 'Challenge'))),
    h('div', { class: 'solve' },
      codePanel,
      h('div', { class: 'stack' }, timerBox, form, resultArea, xeIntro, xeArea, detective.el, lab, historyArea,
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
          h('span', { style: { fontSize: '13px', color: 'var(--dim)' } }, 'Done investigating? Revealing shows the original question and the key ideas.'), revealBtn),
        answerArea))));
}
