// Admin panel: manage snippet-question pairs and review submissions.
import { h, clear, busy, toast, field, difficultyBadge, show } from '../dom.js';
import { api } from '../api.js';

const LANGUAGES = ['JavaScript', 'Python', 'Java', 'C++'];
const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];

const BLANK = {
  title: '', language: 'JavaScript', topic: '', difficulty: 'Easy', entryFn: 'solve', code: '', execJs: '', referenceQuestion: '',
  params: [{ name: 'nums', type: 'number[]' }],
  keywords: [{ concept: 'example concept', terms: ['example'], weight: 2 }],
  probes: [[[1, 2, 3]]], active: true,
};

export async function adminView() {
  const root = h('div');
  const tabsBar = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Admin sections' });
  const body = h('div', { role: 'tabpanel' });
  const tabs = [['snippets', 'Snippet-question pairs', renderSnippets], ['attempts', 'Submissions', renderAttempts]];
  const select = async key => {
    for (const b of tabsBar.children) b.setAttribute('aria-selected', String(b.dataset.key === key));
    clear(body).append(h('p', { class: 'loading' }, 'Loading…'));
    try { clear(body).append(await tabs.find(t => t[0] === key)[2]()); }
    catch (err) { clear(body).append(h('div', { class: 'alert' }, err.message)); }
  };
  for (const [key, label] of tabs) tabsBar.append(h('button', { role: 'tab', type: 'button', dataset: { key }, onclick: () => select(key) }, label));

  async function renderSnippets() {
    const { snippets } = await api('/admin/snippets');
    return h('div', {},
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', gap: '10px', flexWrap: 'wrap' } },
        h('p', { style: { margin: 0, color: 'var(--muted)' } }, `${snippets.length} pairs in the repository. Reference questions are only visible here.`),
        h('button', { class: 'btn primary small', type: 'button', onclick: () => openEditor(null) }, '+ New snippet')),
      h('div', { class: 'tablewrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, ['#', 'Title', 'Language', 'Topic', 'Level', 'Reference question', 'Status', ''].map(c => h('th', { scope: 'col' }, c)))),
        h('tbody', {}, snippets.map(s => h('tr', {},
          h('td', {}, s.id), h('td', {}, s.title), h('td', {}, s.language), h('td', {}, s.topic), h('td', {}, difficultyBadge(s.difficulty)),
          h('td', { class: 'clip', title: s.referenceQuestion }, s.referenceQuestion),
          h('td', {}, s.active ? 'Active' : 'Hidden'),
          h('td', { style: { whiteSpace: 'nowrap' } },
            h('button', { class: 'btn small', type: 'button', onclick: () => openEditor(s), 'aria-label': `Edit ${s.title}` }, 'Edit'), ' ',
            h('button', {
              class: 'btn small danger', type: 'button', 'aria-label': `Delete ${s.title}`,
              onclick: async e => {
                if (!window.confirm(`Delete "${s.title}"? Its attempts will also be removed. This cannot be undone.`)) return;
                try { await busy(e.currentTarget, 'Deleting…', () => api(`/admin/snippets/${s.id}`, { method: 'DELETE' })); toast('Snippet deleted.'); select('snippets'); }
                catch (err) { toast(err.message, 'bad'); }
              },
            }, 'Delete'))))))));
  }

  async function renderAttempts() {
    const { attempts } = await api('/admin/attempts');
    if (attempts.length === 0) return h('div', { class: 'empty' }, 'No submissions yet.');
    return h('div', { class: 'tablewrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ['When (UTC)', 'Student', 'Snippet', 'Mode', 'Round', 'Guess', 'Score'].map(c => h('th', { scope: 'col' }, c)))),
      h('tbody', {}, attempts.map(a => h('tr', {},
        h('td', {}, a.created_at.slice(0, 16)), h('td', {}, a.user), h('td', {}, a.title), h('td', {}, a.mode), h('td', {}, a.round),
        h('td', { class: 'clip', title: a.guess }, a.guess), h('td', {}, h('strong', {}, a.score)))))));
  }

  function openEditor(existing) {
    const s = existing ?? BLANK;
    const text = (id, value, attrs = {}) => h('input', { id, value: value ?? '', ...attrs });
    const area = (id, value, rows = 6, mono = true) => { const t = h('textarea', { id, rows: String(rows), class: mono ? 'mono' : null }); t.value = value ?? ''; return t; };
    const sel = (id, options, value) => h('select', { id }, options.map(o => h('option', { value: o, selected: o === value }, o)));
    const els = {
      title: text('ed-title', s.title, { maxlength: '80' }), language: sel('ed-language', LANGUAGES, s.language), topic: text('ed-topic', s.topic, { maxlength: '40' }),
      difficulty: sel('ed-difficulty', DIFFICULTIES, s.difficulty), entryFn: text('ed-entry', s.entryFn, { class: 'mono' }),
      params: area('ed-params', JSON.stringify(s.params), 2), code: area('ed-code', s.code, 9), execJs: area('ed-exec', s.execJs, 9),
      referenceQuestion: area('ed-ref', s.referenceQuestion, 3, false), keywords: area('ed-keywords', JSON.stringify(s.keywords, null, 1), 8),
      probes: area('ed-probes', JSON.stringify(s.probes), 3), active: h('input', { type: 'checkbox', id: 'ed-active', checked: s.active !== false }),
    };
    const alertBox = h('div', { role: 'alert' });
    const output = h('div', { 'aria-live': 'polite' });

    const collect = () => {
      const payload = { title: els.title.value.trim(), language: els.language.value, topic: els.topic.value.trim(), difficulty: els.difficulty.value,
        entryFn: els.entryFn.value.trim(), code: els.code.value, execJs: els.execJs.value, referenceQuestion: els.referenceQuestion.value.trim(), active: els.active.checked };
      for (const k of ['params', 'keywords', 'probes']) {
        try { payload[k] = JSON.parse(els[k].value); } catch { throw new Error(`${k} is not valid JSON.`); }
      }
      return payload;
    };
    const showErrors = (errors, probeResults = []) => {
      alertBox.className = errors.length ? 'alert' : 'alert info';
      clear(alertBox).append(errors.length ? h('ul', { style: { margin: 0, paddingLeft: '18px' } }, errors.map(e => h('li', {}, e))) : 'Execution twin ran on every probe.');
      clear(output).append(probeResults.length ? h('div', { class: 'probes' }, probeResults.map(r => h('div', { class: `probe ${r.ok ? 'corroborated' : 'falsified'}` },
        h('code', {}, `${s.entryFn || 'fn'}(${r.args.map(show).join(', ')}) → ${r.ok ? show(r.output) : r.error}`)))) : '');
    };

    const validateBtn = h('button', { class: 'btn small', type: 'button' }, 'Validate execution twin');
    validateBtn.onclick = async () => {
      let payload; try { payload = collect(); } catch (err) { return showErrors([err.message]); }
      try {
        const r = await busy(validateBtn, 'Running…', () => api('/admin/snippets/validate', { method: 'POST', body: payload }));
        showErrors(r.errors, r.probeResults);
      } catch (err) { showErrors([err.message]); }
    };
    const saveBtn = h('button', { class: 'btn primary', type: 'submit' }, existing ? 'Save changes' : 'Create snippet');
    const form = h('form', { class: 'panel', novalidate: true },
      h('h2', {}, existing ? `Edit ${existing.title}` : 'New snippet-question pair'),
      h('p', { class: 'sub' }, 'The execution twin is the JavaScript version Cross-Examine runs. Probes are the instructor test inputs used in offline mode.'),
      alertBox,
      h('div', { class: 'formgrid' },
        h('div', { class: 'span2' }, field({ id: 'ed-title', label: 'Title', input: els.title })),
        field({ id: 'ed-language', label: 'Language', input: els.language }),
        field({ id: 'ed-difficulty', label: 'Difficulty', input: els.difficulty }),
        h('div', { class: 'span2' }, field({ id: 'ed-topic', label: 'Topic', input: els.topic })),
        field({ id: 'ed-entry', label: 'Entry function', input: els.entryFn }),
        h('div', { class: 'field', style: { justifyContent: 'end' } }, h('label', { for: 'ed-active' }, h('span', {}, 'Visible to students ')), els.active),
        h('div', { class: 'span4' }, field({ id: 'ed-ref', label: 'Reference question (hidden from students)', input: els.referenceQuestion })),
        h('div', { class: 'span2' }, field({ id: 'ed-code', label: 'Displayed code', input: els.code })),
        h('div', { class: 'span2' }, field({ id: 'ed-exec', label: 'JavaScript execution twin', input: els.execJs })),
        h('div', { class: 'span2' }, field({ id: 'ed-params', label: 'Parameters (JSON)', input: els.params, hint: '[{"name":"nums","type":"number[]"}]' })),
        h('div', { class: 'span2' }, field({ id: 'ed-probes', label: 'Probe inputs (JSON)', input: els.probes, hint: 'One argument array per probe, e.g. [[[1,2,3], 4]]' })),
        h('div', { class: 'span4' }, field({ id: 'ed-keywords', label: 'Keyword concepts (JSON)', input: els.keywords, hint: '[{"concept":"...","terms":["..."],"weight":1-5}]' }))),
      h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } }, saveBtn, validateBtn,
        h('button', { class: 'btn small', type: 'button', onclick: () => select('snippets') }, 'Cancel')),
      output);
    form.onsubmit = async e => {
      e.preventDefault();
      let payload; try { payload = collect(); } catch (err) { return showErrors([err.message]); }
      try {
        await busy(saveBtn, 'Saving…', () => api(existing ? `/admin/snippets/${existing.id}` : '/admin/snippets', { method: existing ? 'PUT' : 'POST', body: payload }));
        toast(existing ? 'Snippet updated.' : 'Snippet created.');
        select('snippets');
      } catch (err) { showErrors(err.fields ? Object.values(err.fields) : [err.message]); }
    };
    clear(body).append(form);
    els.title.focus();
  }

  root.append(h('section', { class: 'page' }, h('div', { class: 'wrap' },
    h('div', { class: 'pagehead' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Administrator'), h('h1', {}, 'Admin panel'),
      h('p', {}, 'Add, edit and remove snippet-question pairs, and review student submissions.'))),
    tabsBar, body)));
  select('snippets');
  return root;
}
