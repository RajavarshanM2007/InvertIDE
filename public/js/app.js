// InvertIDE single-page application: hash router, navigation and shell.
import { h, clear, toast } from './dom.js';
import { api, session } from './api.js';
import { landingView } from './views/landing.js';
import { loginView, registerView } from './views/auth.js';
import { libraryView } from './views/library.js';
import { solveView } from './views/solve.js';
import { progressView } from './views/progress.js';
import { leaderboardView } from './views/leaderboard.js';
import { adminView } from './views/admin.js';

const ROUTES = [
  { path: /^\/?$/, view: landingView, title: 'Reverse Engineering Lab' },
  { path: /^\/login$/, view: loginView, title: 'Sign in', guestOnly: true },
  { path: /^\/register$/, view: registerView, title: 'Create account', guestOnly: true },
  { path: /^\/library$/, view: libraryView, title: 'Snippet library', auth: true, nav: 'library' },
  { path: /^\/solve\/(\d+)$/, view: solveView, title: 'Investigate', auth: true, nav: 'library' },
  { path: /^\/progress$/, view: progressView, title: 'My progress', auth: true, nav: 'progress' },
  { path: /^\/leaderboard$/, view: leaderboardView, title: 'Leaderboard', auth: true, nav: 'leaderboard' },
  { path: /^\/admin$/, view: adminView, title: 'Admin panel', auth: true, admin: true, nav: 'admin' },
];

let metaPromise = null;
export function getMeta() {
  metaPromise ??= api('/meta').catch(err => { metaPromise = null; throw err; });
  return metaPromise;
}

export function navigate(hash) { location.hash = hash; }

let cleanups = [];

function renderNav(active) {
  const user = session.user;
  const links = clear(document.getElementById('navlinks'));
  const actions = clear(document.getElementById('navactions'));
  const link = (href, label, key) => h('a', { href, 'aria-current': key === active ? 'page' : null }, label);
  if (user) {
    links.append(link('#/library', 'Library', 'library'), link('#/progress', 'Progress', 'progress'), link('#/leaderboard', 'Leaderboard', 'leaderboard'));
    if (user.role === 'admin') links.append(link('#/admin', 'Admin', 'admin'));
    actions.append(
      h('span', { class: 'who' }, `${user.name}${user.role === 'admin' ? ' · admin' : ''}`),
      h('button', { class: 'btn small', type: 'button', onclick: () => { session.clear(); toast('Signed out.'); navigate('#/'); } }, 'Sign out'));
  } else {
    links.append(h('a', { href: '#/' }, 'Home'), h('a', { href: '#/#workflow' }, 'How it works'), h('a', { href: '#/#references' }, 'References'));
    actions.append(h('a', { class: 'btn ghost', href: '#/login' }, 'Sign in'), h('a', { class: 'btn primary', href: '#/register' }, 'Get started ↗'));
  }
  const menu = h('button', { class: 'menu', type: 'button', 'aria-label': 'Toggle navigation', 'aria-expanded': 'false', 'aria-controls': 'navlinks' }, '☰');
  menu.onclick = () => { const open = links.classList.toggle('open'); menu.setAttribute('aria-expanded', String(open)); };
  links.onclick = e => { if (e.target.tagName === 'A') links.classList.remove('open'); };
  actions.append(menu);
}

async function router() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart = ''] = raw.split('?');
  // In-page anchors on the landing page (e.g. #/#workflow or #workflow).
  const anchor = pathPart.startsWith('/#') ? pathPart.slice(2) : (!pathPart.startsWith('/') ? pathPart : null);
  const path = anchor !== null ? '/' : pathPart;
  const route = ROUTES.find(r => r.path.test(path));
  const user = session.user;

  if (!route) return navigate('#/');
  if (route.auth && !user) return navigate(`#/login?next=${encodeURIComponent(raw)}`);
  if (route.admin && user?.role !== 'admin') { toast('Administrator access required.', 'bad'); return navigate('#/library'); }
  if (route.guestOnly && user) return navigate('#/library');

  cleanups.forEach(fn => fn()); cleanups = [];
  renderNav(route.nav);
  document.title = `InvertIDE — ${route.title}`;
  const app = clear(document.getElementById('app'));
  app.append(h('p', { class: 'wrap loading' }, 'Loading…'));
  const ctx = {
    params: path.match(route.path).slice(1),
    query: new URLSearchParams(queryPart),
    onLeave: fn => cleanups.push(fn),
  };
  try {
    const node = await route.view(ctx);
    clear(app).append(node);
  } catch (err) {
    clear(app).append(h('section', { class: 'page' }, h('div', { class: 'wrap' },
      h('div', { class: 'alert', role: 'alert' }, err.message || 'Something went wrong.'),
      h('a', { class: 'btn', href: '#/library' }, '← Back to library'))));
  }
  if (anchor) document.getElementById(anchor)?.scrollIntoView();
  else window.scrollTo(0, 0);
  if (route.path.source !== /^\/?$/.source) app.focus({ preventScroll: true });
}

window.addEventListener('invertide:signed-out', e => {
  toast(e.detail || 'Your session has expired. Please sign in again.', 'bad');
  navigate('#/login');
});
window.addEventListener('hashchange', router);
router();
