// Minimal syntax highlighter that builds DOM nodes (no innerHTML).
import { h } from './dom.js';

const KEYWORDS = new Set(('function const let var return if else for while of in new class def and or not None True False '
  + 'boolean int char void size_t vector auto public private static String true false null this break continue import from '
  + 'elif enumerate lambda Map Set Deque ArrayDeque').split(' '));
const TOKEN = /(\/\/.*|#.*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$]*)/g;

export function highlightLine(line, language) {
  const out = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    const t = m[0];
    if (m.index < last) continue;
    if (m.index > last) out.push(line.slice(last, m.index));
    let cls = null;
    if (t.startsWith('//') || (t.startsWith('#') && language === 'Python')) cls = 'comment';
    else if (t.startsWith('#')) { out.push(line.slice(m.index)); last = line.length; break; }
    else if (/^["'`]/.test(t)) cls = 'str';
    else if (/^\d/.test(t)) cls = 'lit';
    else if (KEYWORDS.has(t)) cls = 'kw';
    else if (line[m.index + t.length] === '(') cls = 'fn';
    out.push(cls ? h('span', { class: cls }, t) : t);
    last = m.index + t.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

export function codeBlock(code, language) {
  const lines = code.split('\n');
  return h('div', { class: 'code', role: 'region', 'aria-label': `${language} code snippet`, tabindex: '0' },
    lines.map((line, i) => [
      h('span', { class: 'ln', 'aria-hidden': 'true' }, String(i + 1).padStart(2, '0')),
      ...highlightLine(line, language),
      i < lines.length - 1 ? '\n' : '',
    ]));
}
