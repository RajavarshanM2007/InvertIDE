// Particle field and scroll-reveal from the original landing page.
export function startParticles(c) {
  const x = c.getContext('2d');
  let w, h, d = 1, p = [], mouse = { x: -999, y: -999 };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function size() {
    d = Math.min(devicePixelRatio || 1, 2); w = c.clientWidth; h = c.clientHeight; c.width = w * d; c.height = h * d; x.setTransform(d, 0, 0, d, 0, 0);
    p = Array.from({ length: Math.min(110, Math.floor(w * h / 8000)) }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * .3, vy: (Math.random() - .5) * .3, r: .5 + Math.random() * 1.4, a: .2 + Math.random() * .5 }));
  }
  function draw() {
    if (!c.isConnected) return;
    x.clearRect(0, 0, w, h);
    p.forEach((a, i) => {
      if (!reduced) { a.x += a.vx; a.y += a.vy; if (a.x < 0 || a.x > w) a.vx *= -1; if (a.y < 0 || a.y > h) a.vy *= -1; const dx = a.x - mouse.x, dy = a.y - mouse.y, dist = Math.hypot(dx, dy); if (dist < 100 && dist > 0) { a.x += dx / dist * .4; a.y += dy / dist * .4; } }
      x.beginPath(); x.arc(a.x, a.y, a.r, 0, Math.PI * 2); x.fillStyle = `rgba(235,255,242,${a.a})`; x.fill();
      for (let j = i + 1; j < p.length; j++) { const b = p[j], dist = Math.hypot(a.x - b.x, a.y - b.y); if (dist < 90) { x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.strokeStyle = `rgba(141,240,191,${(1 - dist / 90) * .12})`; x.stroke(); } }
    });
    if (!reduced) requestAnimationFrame(draw);
  }
  c.addEventListener('pointermove', e => { const r = c.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; });
  c.addEventListener('pointerleave', () => { mouse = { x: -999, y: -999 }; });
  const onResize = () => { if (!c.isConnected) { removeEventListener('resize', onResize); return; } size(); if (reduced) draw(); };
  size(); draw(); addEventListener('resize', onResize);
}

export function startReveal(root) {
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('show'); io.unobserve(e.target); } }), { threshold: .12 });
  root.querySelectorAll('.reveal').forEach(e => io.observe(e));
}
