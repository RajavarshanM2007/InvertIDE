import { h, difficultyBadge } from '../dom.js';
import { api } from '../api.js';

export async function progressView() {
  const p = await api('/progress');
  const tile = (value, label) => h('div', { class: 'tile' }, h('strong', {}, value ?? '—'), h('span', {}, label));
  const signed = n => (n == null ? '—' : `${n > 0 ? '+' : ''}${n}`);

  if (p.summary.attempts === 0) {
    return h('section', { class: 'page' }, h('div', { class: 'wrap' },
      h('div', { class: 'pagehead' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Progress'), h('h1', {}, 'No attempts yet.'))),
      h('div', { class: 'empty' }, h('p', {}, 'Your scores, topic accuracy and Cross-Examine history will appear here.'), h('a', { class: 'btn primary', href: '#/library' }, 'Start your first investigation →'))));
  }

  return h('section', { class: 'page' }, h('div', { class: 'wrap' },
    h('div', { class: 'pagehead' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Progress'), h('h1', {}, 'Your investigation record.'),
      h('p', {}, 'Best score per snippet drives your averages. Every attempt is listed below.'))),
    h('div', { class: 'tiles' },
      tile(p.summary.attempts, 'Total attempts'),
      tile(p.summary.snippetsAttempted, 'Snippets attempted'),
      tile(p.summary.averageBestScore, 'Average best score'),
      tile(p.summary.strongReconstructions, 'Strong (80+) reconstructions')),
    h('div', { class: 'two' },
      h('div', { class: 'panel' }, h('h2', {}, 'Topic accuracy'), h('p', { class: 'sub' }, 'Average of your best score on each snippet in a topic.'),
        h('div', { class: 'bars' }, p.topics.map(t => h('div', { class: 'barrow' },
          h('span', {}, t.topic), h('div', { class: 'b', role: 'img', 'aria-label': `${t.topic}: ${t.averageScore} out of 100` }, h('i', { style: { width: `${t.averageScore}%` } })), h('strong', {}, t.averageScore))))),
      h('div', { class: 'panel' }, h('h2', {}, 'Cross-Examine'), h('p', { class: 'sub' }, 'How executed counterexamples changed your hypotheses.'),
        h('div', { class: 'tiles', style: { gridTemplateColumns: '1fr 1fr', margin: 0 } },
          tile(p.crossExamine.sessions, 'Sessions run'),
          tile(p.crossExamine.counterexamples, 'Counterexamples faced'),
          tile(p.crossExamine.corroborations, 'Predictions confirmed'),
          tile(signed(p.crossExamine.averageRevisionGain), 'Avg. score gain after revising')))),
    h('div', { class: 'panel', style: { marginTop: '16px' } }, h('h2', {}, 'You vs the AI Detective'), h('p', { class: 'sub' }, 'Investigations you watched, and how your best score compared with the Detective\'s.'),
      h('div', { class: 'tiles', style: { gridTemplateColumns: 'repeat(3,1fr)', margin: 0 } },
        tile(p.detective.runs, 'Investigations watched'),
        tile(p.detective.averageAiScore, 'Detective average score'),
        tile(p.detective.youBeatTheDetective, 'Times you matched or beat it'))),
    h('div', { class: 'panel', style: { marginTop: '16px' } }, h('h2', {}, 'Attempt history'),
      h('div', { class: 'tablewrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, ['When (UTC)', 'Snippet', 'Topic', 'Mode', 'Round', 'Your guess', 'Score'].map(c => h('th', { scope: 'col' }, c)))),
        h('tbody', {}, p.recent.map(a => h('tr', {},
          h('td', {}, a.createdAt.slice(0, 16)),
          h('td', {}, h('a', { class: 'textlink', href: `#/solve/${a.snippetId}?mode=practice` }, a.title), ' ', difficultyBadge(a.difficulty)),
          h('td', {}, a.topic),
          h('td', {}, a.mode, a.afterReveal ? h('span', { class: 'badge', style: { marginLeft: '6px' }, title: 'Submitted after the answer was revealed; not counted in averages' }, 'after reveal') : ''),
          h('td', {}, a.round),
          h('td', { class: 'clip', title: a.guess }, a.guess),
          h('td', {}, h('strong', {}, a.score), a.penalty ? h('span', { style: { color: 'var(--dim)' } }, ` (−${a.penalty})`) : '')))))))));
}
