import { h, clear, difficultyBadge, isLiveAi } from '../dom.js';
import { api } from '../api.js';
import { getMeta, navigate } from '../app.js';

export async function libraryView({ query }) {
  const [meta, { snippets }] = await Promise.all([
    getMeta(),
    api(`/snippets?${new URLSearchParams([...query].filter(([k, v]) => ['language', 'topic', 'difficulty'].includes(k) && v))}`),
  ]);

  const select = (id, label, plural, options) => {
    const el = h('select', { id, name: id },
      h('option', { value: '' }, `All ${plural}`),
      options.map(o => h('option', { value: o, selected: query.get(id) === o }, o)));
    el.onchange = () => {
      const q = new URLSearchParams(query);
      if (el.value) q.set(id, el.value); else q.delete(id);
      navigate(`#/library${q.toString() ? `?${q}` : ''}`);
    };
    return h('div', { class: 'field' }, h('label', { for: id }, label), el);
  };

  const filtered = ['language', 'topic', 'difficulty'].some(k => query.get(k));
  const grid = h('div', { class: 'grid3' });
  if (snippets.length === 0) {
    clear(grid).append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } },
      h('p', {}, 'No snippets match these filters.'),
      h('a', { class: 'btn', href: '#/library' }, 'Clear filters')));
  }
  for (const s of snippets) {
    grid.append(h('article', { class: 'scard', 'aria-labelledby': `s${s.id}-t` },
      h('div', { class: 'meta' }, h('span', { class: 'badge' }, s.language), difficultyBadge(s.difficulty)),
      h('h3', { id: `s${s.id}-t` }, s.title),
      h('div', { style: { color: 'var(--muted)', fontSize: '14px' } }, `${s.topic} · ${s.lines} lines`),
      h('div', { class: 'row' },
        h('span', {}, s.bestScore == null ? 'Not attempted yet' : `Your best: ${s.bestScore}/100`)),
      h('div', { class: 'actions' },
        h('a', { class: 'btn small primary', href: `#/solve/${s.id}?mode=practice`, 'aria-label': `Practice ${s.title}` }, 'Practice'),
        h('a', { class: 'btn small', href: `#/solve/${s.id}?mode=challenge`, 'aria-label': `Challenge ${s.title}` }, 'Challenge ⏱'))));
  }

  const aiBadge = isLiveAi(meta.ai.mode)
    ? h('span', { class: 'badge ai' }, `Cross-Examine · AI (${meta.ai.model || meta.ai.mode})`)
    : meta.ai.mode === 'fixture'
      ? h('span', { class: 'badge warn' }, 'Cross-Examine · TEST DOUBLE')
      : h('span', { class: 'badge off' }, 'Cross-Examine · offline mode');

  return h('section', { class: 'page' }, h('div', { class: 'wrap' },
    h('div', { class: 'pagehead' },
      h('div', {}, h('div', { class: 'eyebrow' }, 'Snippet library'), h('h1', {}, 'Choose your next investigation.'),
        h('p', {}, 'Each snippet hides its original problem statement. Practice freely, or start a timed challenge for the leaderboard.')),
      aiBadge),
    h('div', { class: 'toolbar', role: 'search', 'aria-label': 'Filter snippets' },
      select('language', 'Language', 'languages', meta.languages),
      select('topic', 'Topic', 'topics', meta.topics),
      select('difficulty', 'Difficulty', 'levels', meta.difficulties),
      filtered && h('a', { class: 'btn small', href: '#/library' }, 'Clear filters'),
      h('span', { style: { color: 'var(--muted)', fontSize: '13px', marginLeft: 'auto' }, 'aria-live': 'polite' }, `${snippets.length} snippet${snippets.length === 1 ? '' : 's'}`)),
    grid));
}
