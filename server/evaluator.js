// Baseline keyword/rule-based evaluator (the "Keyword & Rule Evaluator"
// component from the Assessment 7 component diagram).
// A guess is tokenised and each reference concept is matched if any of its
// terms appears in the guess. Matching is tolerant of simple suffixes, so
// "intervals" matches "interval" and "overlapping" matches "overlap".

export const MIN_GUESS_WORDS = 4;
export const MAX_GUESS_CHARS = 1000;

export function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/>=/g, ' gte ')
    .replace(/(^|[^a-z0-9])-1(?![0-9])/g, '$1 minusone ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenize(text) {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

// A guess token matches a term token when equal, or when it extends the term
// by a short suffix (plural, -ing, -ed, -ion ...).
function tokenMatches(guessTok, termTok) {
  if (guessTok === termTok) return true;
  return termTok.length >= 3 && guessTok.startsWith(termTok) && guessTok.length - termTok.length <= 4;
}

export function containsTerm(guessTokens, term) {
  const termTokens = tokenize(term);
  if (termTokens.length === 0) return false;
  outer: for (let i = 0; i + termTokens.length <= guessTokens.length; i++) {
    for (let j = 0; j < termTokens.length; j++) {
      if (!tokenMatches(guessTokens[i + j], termTokens[j])) continue outer;
    }
    return true;
  }
  return false;
}

export function validateGuess(guess) {
  if (typeof guess !== 'string') return 'Guess must be text.';
  const trimmed = guess.trim();
  if (!trimmed) return 'Please describe the problem you think this code solves.';
  if (trimmed.length > MAX_GUESS_CHARS) return `Guess must be at most ${MAX_GUESS_CHARS} characters.`;
  if (tokenize(trimmed).length < MIN_GUESS_WORDS) return `Write at least ${MIN_GUESS_WORDS} words so the guess can be evaluated.`;
  return null;
}

export function band(score) {
  if (score >= 80) return 'strong';
  if (score >= 50) return 'partial';
  return 'weak';
}

const FEEDBACK = {
  strong: 'Strong reconstruction - your statement covers most of the key ideas in the original problem.',
  partial: 'Partially correct - you identified some of the core ideas, but important constraints are still missing.',
  weak: 'Not there yet - the guess misses most of the key ideas. Trace the code on a small input and try again.',
};

// keywords: [{ concept, terms: [...], weight }]
export function evaluateGuess(guess, keywords) {
  const error = validateGuess(guess);
  if (error) throw Object.assign(new Error(error), { status: 400 });
  const tokens = tokenize(guess);
  const matched = [];
  const missed = [];
  let total = 0;
  let got = 0;
  for (const k of keywords) {
    const weight = k.weight ?? 1;
    total += weight;
    const hit = k.terms.find(t => containsTerm(tokens, t));
    if (hit) { got += weight; matched.push({ concept: k.concept, term: hit }); }
    else missed.push({ concept: k.concept });
  }
  const score = total === 0 ? 0 : Math.round((got / total) * 100);
  const b = band(score);
  return { score, band: b, matched, missed, feedback: FEEDBACK[b] };
}
