// Tiny DOM helpers. All user-provided text is inserted with textContent,
// never innerHTML, so snippet code, guesses and AI text cannot inject markup.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (val == null) continue;
        if (prop.startsWith('--')) el.style.setProperty(prop, String(val)); else el.style[prop] = val;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }

// Providers whose results come from a live AI model, as reported by the server
// ('offline' and the 'fixture' test double are not live).
export const LIVE_AI_PROVIDERS = ['claude', 'groq'];
export const isLiveAi = provider => LIVE_AI_PROVIDERS.includes(provider);

export function toast(message, kind = 'ok') {
  const box = document.getElementById('toast');
  const item = h('div', { class: kind }, message);
  box.append(item);
  setTimeout(() => item.remove(), 4200);
}

// Puts a button into a loading state while an async action runs.
export async function busy(button, label, fn) {
  const original = [...button.childNodes];
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  clear(button).append(h('span', { class: 'spin', 'aria-hidden': 'true' }), label);
  try { return await fn(); }
  finally { button.disabled = false; button.removeAttribute('aria-busy'); clear(button).append(...original); }
}

export function field({ id, label, input, hint }) {
  input.id = id;
  if (hint) input.setAttribute('aria-describedby', `${id}-hint`);
  return h('div', { class: 'field' },
    h('label', { for: id }, label), input,
    hint && h('span', { class: 'hint', id: `${id}-hint` }, hint),
    h('span', { class: 'err', id: `${id}-err`, role: 'alert' }));
}

export function setFieldError(id, message) {
  const err = document.getElementById(`${id}-err`);
  if (!err) return;
  err.textContent = message || '';
  err.parentElement.classList.toggle('invalid', !!message);
  document.getElementById(id)?.setAttribute('aria-invalid', message ? 'true' : 'false');
}

export function difficultyBadge(d) {
  return h('span', { class: `badge ${String(d).toLowerCase()}` }, d);
}

export function show(value) {
  return value === undefined ? 'undefined' : JSON.stringify(value);
}
