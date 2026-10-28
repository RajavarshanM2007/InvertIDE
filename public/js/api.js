// REST client. The JWT is kept in localStorage and sent as a Bearer token.
const TOKEN_KEY = 'invertide.token';
const USER_KEY = 'invertide.user';

export const session = {
  get token() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  get user() { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } },
  save(token, user) { try { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch { /* storage unavailable */ } },
  clear() { try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch { /* storage unavailable */ } },
};

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Request failed (${status}).`);
    this.status = status;
    this.fields = body?.fields || null;
  }
}

// POSTs and reads a newline-delimited JSON stream, calling onEvent for each
// event as it arrives (used by the AI Detective).
export async function apiStream(path, onEvent) {
  const headers = { Accept: 'application/x-ndjson' };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  let res;
  try {
    res = await fetch(`/api${path}`, { method: 'POST', headers });
  } catch {
    throw new ApiError(0, { error: 'Cannot reach the InvertIDE server. Check your connection and try again.' });
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && session.token) {
      session.clear();
      window.dispatchEvent(new CustomEvent('invertide:signed-out', { detail: data.error }));
    }
    throw new ApiError(res.status, data);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, { error: 'Cannot reach the InvertIDE server. Check your connection and try again.' });
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && session.token) {
    session.clear();
    window.dispatchEvent(new CustomEvent('invertide:signed-out', { detail: data.error }));
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
