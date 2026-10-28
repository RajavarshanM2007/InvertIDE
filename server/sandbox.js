// Executes a snippet's JavaScript execution twin on JSON arguments to obtain
// the ground-truth output used by Cross-Examine.
//
// Only administrator-authored code is executed here. Probe arguments (from the
// AI provider or the student) are pure JSON data, parsed inside the isolated
// context, so they can never inject code. node:vm is not a hard security
// boundary, which is why untrusted code is never passed to it.
import vm from 'node:vm';

export const EXEC_TIMEOUT_MS = 250;
export const MAX_ARGS_CHARS = 2000;
export const MAX_OUTPUT_CHARS = 2000;

export function parseArgs(argsJson, arity) {
  if (typeof argsJson !== 'string' || argsJson.length > MAX_ARGS_CHARS) {
    return { error: `Arguments must be a JSON array of at most ${MAX_ARGS_CHARS} characters.` };
  }
  let args;
  try { args = JSON.parse(argsJson); } catch { return { error: 'Arguments are not valid JSON.' }; }
  if (!Array.isArray(args)) return { error: 'Arguments must be a JSON array, e.g. [[1,2,3], 4].' };
  if (arity != null && args.length !== arity) return { error: `Expected ${arity} argument(s), received ${args.length}.` };
  return { args };
}

export function runSnippet(execJs, entryFn, args) {
  if (!/^[A-Za-z_$][\w$]*$/.test(entryFn)) return { ok: false, error: 'Invalid entry function name.' };
  const context = vm.createContext({ __args: JSON.stringify(args) }, {
    codeGeneration: { strings: false, wasm: false },
  });
  const source = `${execJs}\n;(() => { const r = ${entryFn}(...JSON.parse(__args)); return r === undefined ? 'null' : JSON.stringify(r); })()`;
  try {
    const out = vm.runInContext(source, context, { timeout: EXEC_TIMEOUT_MS });
    if (typeof out !== 'string') return { ok: false, error: 'Snippet produced no serialisable output.' };
    if (out.length > MAX_OUTPUT_CHARS) return { ok: false, error: 'Output too large to display.' };
    return { ok: true, output: JSON.parse(out) };
  } catch (err) {
    const timedOut = err && err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT';
    return { ok: false, error: timedOut ? `Execution exceeded ${EXEC_TIMEOUT_MS} ms.` : `Runtime error: ${err && err.message}` };
  }
}

// Order-independent key serialisation so {a:1,b:2} equals {b:2,a:1}.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function sameOutput(a, b) {
  return canonical(a) === canonical(b);
}
