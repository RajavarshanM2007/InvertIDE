// AI Detective panel: streams an autonomous agent's investigation of the
// snippet (thoughts, experiments on the real code, final hypothesis) and
// compares its graded hypothesis with the student's best score.
import { h, clear, busy, toast, show, isLiveAi } from '../dom.js';
import { apiStream } from '../api.js';

function providerBadge(provider, model) {
  if (isLiveAi(provider)) return h('span', { class: 'badge ai' }, `AI agent · ${model || provider}`);
  if (provider === 'fixture') return h('span', { class: 'badge warn', title: 'Scripted investigation used for testing - outputs still come from the real code' }, 'TEST DOUBLE · not live AI');
  return h('span', { class: 'badge off' }, 'Offline · experiment log only');
}

export function detectivePanel({ snippet, meta, mode, getAttempt, isUnlocked }) {
  const callText = argsJson => {
    try {
      const args = JSON.parse(argsJson);
      return `solve(${snippet.params.map((p, i) => `${p.name} = ${show(args[i])}`).join(', ')})`;
    } catch { return argsJson; }
  };
  const startBtn = h('button', { class: 'btn det-btn', type: 'button', disabled: true }, '▶ Start the investigation');
  const lockNote = h('span', { class: 'det-lock' });
  const board = h('div', { class: 'det-board', 'aria-live': 'polite' });
  const panel = h('section', { class: 'det', 'aria-labelledby': 'det-title' },
    h('div', { class: 'det-head' },
      h('h3', { id: 'det-title' }, h('span', { class: 'det-icon', 'aria-hidden': 'true' }, '◎'), 'AI Detective'),
      isLiveAi(meta.ai.mode) ? h('span', { class: 'badge ai' }, `AI agent · ${meta.ai.model || meta.ai.mode}`)
        : meta.ai.mode === 'fixture' ? h('span', { class: 'badge warn' }, 'TEST DOUBLE · not live AI') : h('span', { class: 'badge off' }, 'Offline mode')),
    h('p', { class: 'det-intro' },
      'Watch an AI agent crack this snippet from scratch. It ', h('strong', {}, 'cannot see the hidden question'),
      ' — it runs its own experiments on the real code, explains each one, then states its hypothesis and is graded exactly like you.'),
    h('div', { class: 'det-actions' }, startBtn, lockNote),
    board);

  function refresh() {
    const unlocked = isUnlocked();
    startBtn.disabled = !unlocked;
    lockNote.textContent = unlocked ? `Budget: up to ${6} experiments.`
      : mode === 'challenge' ? 'Unlocks when the challenge round ends.' : 'Unlocks after your first submission — try it yourself first.';
  }

  function render(ev, ui) {
    if (ev.type === 'start') {
      ui.badge = providerBadge(ev.provider, ev.model);
      ui.provider = ev.provider;
      clear(board).append(
        h('div', { class: 'det-status' }, ui.badge, ui.status),
        h('div', { class: 'det-budget', role: 'progressbar', 'aria-label': 'Experiments used', 'aria-valuemin': '0', 'aria-valuemax': String(ev.budget), 'aria-valuenow': '0' }, ui.budgetFill),
        ui.timeline);
      ui.budget = ev.budget;
    } else if (ev.type === 'fallback') {
      const offline = providerBadge('offline');
      offline.title = `AI unavailable: ${ev.reason}`;
      ui.badge.replaceWith(offline);
      ui.badge = offline;
      ui.provider = 'offline';
      ui.status.textContent = 'AI unavailable · instructor log';
    } else if (ev.type === 'thought') {
      ui.timeline.append(h('li', { class: 'det-step thought' }, h('span', { class: 'det-tag' }, 'NOTE'), h('p', {}, ev.text)));
    } else if (ev.type === 'experiment') {
      ui.count = ev.n;
      ui.budgetFill.style.width = `${(ev.n / ui.budget) * 100}%`;
      ui.budgetFill.parentElement.setAttribute('aria-valuenow', String(ev.n));
      ui.timeline.append(h('li', { class: `det-step exp${ev.ok ? '' : ' err'}` },
        h('span', { class: 'det-tag' }, `EXPERIMENT ${ev.n}/${ui.budget}`),
        h('p', { class: 'det-purpose' }, ev.purpose || '(no purpose given)'),
        h('code', { class: 'det-call' }, callText(ev.argsJson), h('span', { class: 'det-arrow' }, ' → '),
          h('strong', {}, ev.ok ? show(ev.output) : ev.error))));
    } else if (ev.type === 'verdict') {
      // The verdict reports the provider that actually produced the result.
      if (ui.badge && ev.provider !== ui.provider) {
        const finalBadge = providerBadge(ev.provider, ev.model);
        ui.badge.replaceWith(finalBadge);
        ui.badge = finalBadge;
        ui.provider = ev.provider;
      }
      ui.status.textContent = ev.statement ? 'Case closed' : ev.provider === 'offline' ? 'Experiment log' : 'Stopped';
      ui.status.classList.remove('live');
      if (ev.notice) board.append(h('div', { class: 'alert warn' }, ev.notice));
      if (ev.statement) {
        const you = ev.studentBest;
        const cmp = you == null ? 'Submit a guess to compare scores.'
          : you > ev.score ? 'You beat the AI Detective. Compare its experiments with your reasoning.'
            : you === ev.score ? 'A tie with the AI Detective.'
              : `The Detective found ${ev.score - you} more points of key ideas. Which experiment would have changed your mind?`;
        board.append(h('div', { class: 'det-verdict', tabindex: '-1', id: 'det-verdict' },
          h('div', { class: 'eyebrow' }, `Case closed after ${ev.experiments.length} experiment${ev.experiments.length === 1 ? '' : 's'}`),
          h('blockquote', {}, ev.statement),
          ev.reasoning ? h('p', { class: 'det-reason' }, h('strong', {}, 'Decisive evidence: '), ev.reasoning) : null,
          h('div', { class: 'det-score' },
            h('div', {}, h('span', {}, 'AI Detective'), h('div', { class: 'det-bar' }, h('i', { class: 'ai', style: { width: `${ev.score}%` } })), h('strong', {}, `${ev.score}`)),
            h('div', {}, h('span', {}, 'You (best)'), h('div', { class: 'det-bar' }, h('i', { class: 'you', style: { width: `${you ?? 0}%` } })), h('strong', {}, you == null ? '—' : `${you}`))),
          h('p', { class: 'det-cmp' }, cmp,
            ev.confidence != null ? ` Self-reported confidence: ${ev.confidence}%.` : ''),
          h('p', { class: 'det-foot' }, 'Every output above came from executing the snippet on the server. The Detective never saw the hidden question; its statement was graded by the same keyword evaluator as yours.')));
        document.getElementById('det-verdict')?.focus();
      }
    }
  }

  startBtn.onclick = async () => {
    const attempt = getAttempt();
    if (!attempt) return;
    const ui = {
      status: h('span', { class: 'det-live live' }, 'Investigating…'),
      budgetFill: h('i'),
      timeline: h('ol', { class: 'det-timeline' }),
      budget: 6, count: 0,
    };
    clear(board);
    try {
      await busy(startBtn, 'Detective at work…', () => apiStream(`/attempts/${attempt.id}/detective`, ev => render(ev, ui)));
    } catch (err) { toast(err.message, 'bad'); }
    refresh();
  };

  refresh();
  return { el: panel, refresh };
}
