// JWT session handling and request guards.
import jwt from 'jsonwebtoken';

export function createAuth(secret, { expiresIn = '2h' } = {}) {
  function sign(user) {
    return jwt.sign({ sub: user.id, role: user.role, name: user.name }, secret, { expiresIn });
  }

  function requireUser(req, res, next) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Please sign in to continue.' });
    try {
      const payload = jwt.verify(token, secret);
      req.user = { id: Number(payload.sub), role: payload.role, name: payload.name };
      next();
    } catch {
      res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    }
  }

  function requireAdmin(req, res, next) {
    requireUser(req, res, () => {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Administrator access required.' });
      next();
    });
  }

  return { sign, requireUser, requireAdmin };
}

// Fixed-window in-memory rate limiter, keyed per user (or IP when anonymous).
export function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.user ? `u${req.user.id}` : `ip${req.ip}`;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }
    if (++entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.start + windowMs - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}
