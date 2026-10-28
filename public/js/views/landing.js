import { session } from '../api.js';
import { startParticles, startReveal } from '../particles.js';

export function landingView() {
  const frag = document.getElementById('tpl-landing').content.cloneNode(true);
  const root = document.createElement('div');
  root.append(frag);
  if (session.user) {
    root.querySelectorAll('[data-cta]').forEach(a => { a.href = '#/library'; a.textContent = 'Open the library →'; });
  }
  setTimeout(() => {
    const canvas = root.querySelector('#particles');
    if (canvas?.isConnected) startParticles(canvas);
    startReveal(root);
  }, 0);
  return root;
}
