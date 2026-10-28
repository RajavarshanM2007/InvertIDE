import { h, field, setFieldError, busy, toast } from '../dom.js';
import { api, session } from '../api.js';
import { navigate } from '../app.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function shell(title, intro, form, side) {
  return h('section', { class: 'page' }, h('div', { class: 'wrap authgrid' },
    h('div', { class: 'authcard' },
      h('div', { class: 'eyebrow' }, 'Student workspace'),
      h('h1', { style: { fontSize: '44px', margin: '10px 0 6px' } }, title),
      h('p', { style: { color: 'var(--muted)', marginTop: 0 } }, intro),
      form),
    side));
}

function sidePanel() {
  return h('aside', { class: 'panel authside', 'aria-label': 'What you can do' },
    h('h2', {}, 'Inside your account'),
    h('ul', {},
      h('li', {}, 'Practice mode — unlimited, untimed rounds on any snippet.'),
      h('li', {}, 'Challenge mode — timed rounds that count towards the leaderboard.'),
      h('li', {}, 'Cross-Examine — test your hypothesis against the real code.'),
      h('li', {}, 'Progress — topic accuracy and every attempt you have made.')));
}

function afterAuth({ token, user }, query) {
  session.save(token, user);
  toast(`Welcome, ${user.name}.`);
  const next = query.get('next');
  navigate(next && next.startsWith('/') && !next.startsWith('//') ? `#${next}` : (user.role === 'admin' ? '#/admin' : '#/library'));
}

export function loginView({ query }) {
  const email = h('input', { type: 'email', autocomplete: 'email', required: true });
  const password = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const alertBox = h('div', { role: 'alert' });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Sign in →');
  const form = h('form', { novalidate: true, 'aria-label': 'Sign in' },
    alertBox,
    field({ id: 'login-email', label: 'Email', input: email }),
    field({ id: 'login-password', label: 'Password', input: password }),
    h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' } }, submit,
      h('span', { style: { color: 'var(--muted)', fontSize: '14px' } }, 'New here? ', h('a', { class: 'textlink', href: `#/register${query.toString() ? `?${query}` : ''}` }, 'Create an account'))));
  form.onsubmit = async e => {
    e.preventDefault();
    alertBox.className = ''; alertBox.textContent = '';
    setFieldError('login-email', EMAIL_RE.test(email.value.trim()) ? '' : 'Enter a valid email address.');
    setFieldError('login-password', password.value ? '' : 'Enter your password.');
    if (!EMAIL_RE.test(email.value.trim()) || !password.value) return;
    try {
      const res = await busy(submit, 'Signing in…', () => api('/auth/login', { method: 'POST', body: { email: email.value.trim(), password: password.value } }));
      afterAuth(res, query);
    } catch (err) {
      alertBox.className = 'alert'; alertBox.textContent = err.message;
      password.value = ''; password.focus();
    }
  };
  return shell('Welcome back.', 'Sign in to continue your investigations.', form, sidePanel());
}

export function registerView({ query }) {
  const name = h('input', { type: 'text', autocomplete: 'name', maxlength: '60', required: true });
  const email = h('input', { type: 'email', autocomplete: 'email', required: true });
  const password = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const confirm = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const alertBox = h('div', { role: 'alert' });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Create account →');

  const checks = {
    'reg-name': () => (name.value.trim().length >= 2 ? '' : 'Enter your name (at least 2 characters).'),
    'reg-email': () => (EMAIL_RE.test(email.value.trim()) ? '' : 'Enter a valid email address.'),
    'reg-password': () => (password.value.length >= 8 && /[A-Za-z]/.test(password.value) && /\d/.test(password.value) ? '' : 'Use at least 8 characters with a letter and a digit.'),
    'reg-confirm': () => (confirm.value && confirm.value === password.value ? '' : 'Passwords do not match.'),
  };
  // Validate each field when the user leaves it (error prevention).
  const inputs = { 'reg-name': name, 'reg-email': email, 'reg-password': password, 'reg-confirm': confirm };
  for (const [id, check] of Object.entries(checks)) {
    inputs[id].addEventListener('blur', e => { if (e.target.value) setFieldError(id, check()); });
  }

  const form = h('form', { novalidate: true, 'aria-label': 'Create account' },
    alertBox,
    field({ id: 'reg-name', label: 'Full name', input: name }),
    field({ id: 'reg-email', label: 'Email', input: email }),
    field({ id: 'reg-password', label: 'Password', input: password, hint: 'At least 8 characters, including a letter and a digit.' }),
    field({ id: 'reg-confirm', label: 'Confirm password', input: confirm }),
    h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' } }, submit,
      h('span', { style: { color: 'var(--muted)', fontSize: '14px' } }, 'Already registered? ', h('a', { class: 'textlink', href: '#/login' }, 'Sign in'))));
  form.onsubmit = async e => {
    e.preventDefault();
    alertBox.className = ''; alertBox.textContent = '';
    let firstBad = null;
    for (const [id, check] of Object.entries(checks)) {
      const msg = check();
      setFieldError(id, msg);
      if (msg && !firstBad) firstBad = id;
    }
    if (firstBad) { document.getElementById(firstBad).focus(); return; }
    try {
      const res = await busy(submit, 'Creating account…', () => api('/auth/register', { method: 'POST', body: { name: name.value.trim(), email: email.value.trim(), password: password.value } }));
      afterAuth(res, query);
    } catch (err) {
      alertBox.className = 'alert'; alertBox.textContent = err.message;
      if (err.fields) for (const [k, v] of Object.entries(err.fields)) setFieldError(`reg-${k}`, v);
    }
  };
  return shell('Create your account.', 'Free for students. Your attempts and progress are saved to this account.', form, sidePanel());
}
