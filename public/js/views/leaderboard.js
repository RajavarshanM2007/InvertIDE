import { h } from '../dom.js';
import { api } from '../api.js';

export async function leaderboardView() {
  const { leaderboard } = await api('/leaderboard');
  const body = leaderboard.length === 0
    ? h('div', { class: 'empty' }, h('p', {}, 'No challenge scores yet. Be the first on the board.'), h('a', { class: 'btn primary', href: '#/library' }, 'Start a challenge →'))
    : h('div', { class: 'tablewrap' }, h('table', { class: 'table' },
      h('caption', { class: 'sr-only' }, 'Challenge leaderboard'),
      h('thead', {}, h('tr', {}, ['Rank', 'Student', 'Snippets', 'Points'].map(c => h('th', { scope: 'col' }, c)))),
      h('tbody', {}, leaderboard.map(r => h('tr', { class: r.you ? 'you' : null },
        h('td', {}, h('strong', { style: { fontFamily: 'var(--mono)', color: r.rank <= 3 ? 'var(--lime)' : null } }, `#${r.rank}`)),
        h('td', {}, r.name, r.you ? h('span', { class: 'badge', style: { marginLeft: '8px' } }, 'You') : ''),
        h('td', {}, r.snippets),
        h('td', {}, h('strong', {}, r.points)))))));
  return h('section', { class: 'page' }, h('div', { class: 'wrap' },
    h('div', { class: 'pagehead' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Challenge mode'), h('h1', {}, 'Leaderboard'),
      h('p', {}, 'Points are the sum of each student\'s best challenge score per snippet. Practice attempts do not count.'))),
    h('div', { class: 'panel' }, body)));
}
