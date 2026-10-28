// Initial snippet-question repository.
// `code` is what the student sees (in the snippet's own language).
// `execJs` is the JavaScript "execution twin" that Cross-Examine runs to obtain
// ground-truth outputs; for JavaScript snippets it is identical to `code`.
// `keywords` drive the baseline keyword/rule evaluator: each concept matches if
// any of its terms (or their simple stems) appears in the guess.
// `probes` are admin-authored inputs used when no AI provider is configured.

export const SEED_SNIPPETS = [
  {
    title: 'Mystery #01',
    language: 'JavaScript', topic: 'Arrays & Hashing', difficulty: 'Easy',
    code: `function solve(nums, target) {
  const seen = new Map();
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i];
    if (seen.has(need)) return [seen.get(need), i];
    seen.set(nums[i], i);
  }
  return [];
}`,
    entryFn: 'solve',
    params: [{ name: 'nums', type: 'number[]' }, { name: 'target', type: 'number' }],
    referenceQuestion: 'Given an array of integers and a target value, return the indices of the two numbers that add up to the target, or an empty array if no such pair exists.',
    keywords: [
      { concept: 'array of integers', terms: ['array', 'list', 'integers', 'numbers'], weight: 1 },
      { concept: 'target value', terms: ['target', 'given sum', 'goal'], weight: 2 },
      { concept: 'pair of elements', terms: ['two numbers', 'pair', 'two elements', 'two values', 'two integers'], weight: 2 },
      { concept: 'sum to target', terms: ['add up', 'sum', 'adds to', 'total'], weight: 2 },
      { concept: 'return indices', terms: ['indices', 'index', 'positions', 'position'], weight: 2 },
      { concept: 'no-pair case', terms: ['empty', 'no such', 'not found', 'no pair', 'none'], weight: 1 },
    ],
    probes: [[[2, 7, 11, 15], 9], [[3, 3], 6], [[1, 2, 3], 7], [[5, 1, 5], 10]],
  },
  {
    title: 'Mystery #02',
    language: 'Python', topic: 'Strings', difficulty: 'Easy',
    code: `def solve(s):
    counts = {}
    for ch in s:
        counts[ch] = counts.get(ch, 0) + 1
    for i, ch in enumerate(s):
        if counts[ch] == 1:
            return i
    return -1`,
    execJs: `function solve(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) || 0) + 1);
  for (let i = 0; i < s.length; i++) if (counts.get(s[i]) === 1) return i;
  return -1;
}`,
    entryFn: 'solve',
    params: [{ name: 's', type: 'string' }],
    referenceQuestion: 'Given a string, return the index of the first character that does not repeat anywhere in the string, or -1 if every character repeats.',
    keywords: [
      { concept: 'input string', terms: ['string', 'text', 'word'], weight: 1 },
      { concept: 'first occurrence', terms: ['first', 'earliest', 'leftmost'], weight: 2 },
      { concept: 'non-repeating character', terms: ['non repeating', 'does not repeat', 'unique', 'appears once', 'only once', 'not repeated', 'no repeat'], weight: 3 },
      { concept: 'return index', terms: ['index', 'position'], weight: 2 },
      { concept: 'none-found case', terms: ['-1', 'minus one', 'negative one', 'not found', 'none'], weight: 1 },
    ],
    probes: [['leetcode'], ['aabb'], ['abcabd'], ['']],
  },
  {
    title: 'Mystery #03',
    language: 'JavaScript', topic: 'Searching', difficulty: 'Medium',
    code: `function solve(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}`,
    entryFn: 'solve',
    params: [{ name: 'arr', type: 'number[] (sorted)' }, { name: 'x', type: 'number' }],
    referenceQuestion: 'Given a sorted array and a value, return the leftmost index at which the value could be inserted while keeping the array sorted, i.e. the index of the first element that is greater than or equal to the value.',
    keywords: [
      { concept: 'sorted array', terms: ['sorted', 'ascending', 'ordered'], weight: 2 },
      { concept: 'insertion position', terms: ['insert', 'insertion', 'placed', 'lower bound'], weight: 3 },
      { concept: 'leftmost / first', terms: ['leftmost', 'first', 'lowest', 'earliest'], weight: 2 },
      { concept: 'greater-or-equal boundary', terms: ['greater than or equal', 'not less than', 'at least', '>='], weight: 2 },
      { concept: 'return index', terms: ['index', 'position'], weight: 1 },
    ],
    probes: [[[1, 3, 5, 7], 5], [[1, 3, 5, 7], 4], [[1, 2, 2, 2, 3], 2], [[1, 3], 10], [[], 1]],
  },
  {
    title: 'Mystery #04',
    language: 'Java', topic: 'Stacks', difficulty: 'Medium',
    code: `boolean solve(String s) {
    Deque<Character> st = new ArrayDeque<>();
    for (char c : s.toCharArray()) {
        if (c == '(') st.push(')');
        else if (c == '[') st.push(']');
        else if (c == '{') st.push('}');
        else if (st.isEmpty() || st.pop() != c) return false;
    }
    return st.isEmpty();
}`,
    execJs: `function solve(s) {
  const st = [];
  for (const c of s) {
    if (c === '(') st.push(')');
    else if (c === '[') st.push(']');
    else if (c === '{') st.push('}');
    else if (st.length === 0 || st.pop() !== c) return false;
  }
  return st.length === 0;
}`,
    entryFn: 'solve',
    params: [{ name: 's', type: 'string' }],
    referenceQuestion: 'Given a string containing only the bracket characters ( ) [ ] { }, determine whether it is valid: every opening bracket must be closed by the same type of bracket in the correct order.',
    keywords: [
      { concept: 'brackets', terms: ['bracket', 'parenthes', 'braces', 'parens'], weight: 2 },
      { concept: 'valid / balanced', terms: ['valid', 'balanced', 'matched', 'well formed', 'properly closed'], weight: 3 },
      { concept: 'same type', terms: ['same type', 'matching type', 'corresponding', 'same kind'], weight: 2 },
      { concept: 'correct order / nesting', terms: ['order', 'nested', 'nesting', 'sequence'], weight: 2 },
      { concept: 'boolean result', terms: ['true', 'false', 'boolean', 'whether'], weight: 1 },
    ],
    probes: [['()[]{}'], ['([)]'], ['{[]}'], ['(('], ['']],
  },
  {
    title: 'Mystery #05',
    language: 'C++', topic: 'Dynamic Programming', difficulty: 'Medium',
    code: `int solve(vector<int>& a) {
    int best = a[0], cur = a[0];
    for (size_t i = 1; i < a.size(); ++i) {
        cur = max(a[i], cur + a[i]);
        best = max(best, cur);
    }
    return best;
}`,
    execJs: `function solve(a) {
  let best = a[0], cur = a[0];
  for (let i = 1; i < a.length; i++) {
    cur = Math.max(a[i], cur + a[i]);
    best = Math.max(best, cur);
  }
  return best;
}`,
    entryFn: 'solve',
    params: [{ name: 'a', type: 'number[] (non-empty)' }],
    referenceQuestion: 'Given a non-empty integer array that may contain negative numbers, find the largest sum of any contiguous subarray.',
    keywords: [
      { concept: 'integer array', terms: ['array', 'list', 'integers', 'numbers'], weight: 1 },
      { concept: 'maximum', terms: ['maximum', 'largest', 'max', 'greatest', 'biggest', 'highest'], weight: 2 },
      { concept: 'sum', terms: ['sum', 'total'], weight: 2 },
      { concept: 'contiguous subarray', terms: ['contiguous', 'subarray', 'consecutive', 'continuous', 'sub array'], weight: 3 },
      { concept: 'negative values', terms: ['negative'], weight: 1 },
    ],
    probes: [[[-2, 1, -3, 4, -1, 2, 1, -5, 4]], [[-3, -1, -2]], [[5]], [[1, 2, 3]]],
  },
  {
    title: 'Mystery #06',
    language: 'Python', topic: 'Bit Manipulation', difficulty: 'Easy',
    code: `def solve(n):
    return n > 0 and (n & (n - 1)) == 0`,
    execJs: `function solve(n) {
  return n > 0 && (n & (n - 1)) === 0;
}`,
    entryFn: 'solve',
    params: [{ name: 'n', type: 'integer' }],
    referenceQuestion: 'Determine whether a given integer is a power of two.',
    keywords: [
      { concept: 'integer input', terms: ['integer', 'number'], weight: 1 },
      { concept: 'power of two', terms: ['power of two', 'power of 2', '2^k', 'powers of two', 'powers of 2'], weight: 4 },
      { concept: 'boolean result', terms: ['whether', 'true', 'false', 'check', 'determine'], weight: 1 },
    ],
    probes: [[16], [0], [6], [1], [-8]],
  },
  {
    title: 'Mystery #07',
    language: 'JavaScript', topic: 'Sliding Window', difficulty: 'Hard',
    code: `function solve(s) {
  const last = new Map();
  let start = 0, best = 0;
  for (let i = 0; i < s.length; i++) {
    if (last.has(s[i]) && last.get(s[i]) >= start) start = last.get(s[i]) + 1;
    last.set(s[i], i);
    best = Math.max(best, i - start + 1);
  }
  return best;
}`,
    entryFn: 'solve',
    params: [{ name: 's', type: 'string' }],
    referenceQuestion: 'Given a string, find the length of the longest substring that contains no repeating characters.',
    keywords: [
      { concept: 'input string', terms: ['string', 'text'], weight: 1 },
      { concept: 'length', terms: ['length', 'size', 'how long', 'number of characters'], weight: 2 },
      { concept: 'longest', terms: ['longest', 'maximum', 'max', 'largest'], weight: 2 },
      { concept: 'substring', terms: ['substring', 'contiguous', 'window', 'sub string'], weight: 2 },
      { concept: 'no repeating characters', terms: ['without repeating', 'no repeating', 'distinct', 'unique', 'no duplicate', 'non repeating', 'without duplicate'], weight: 3 },
    ],
    probes: [['abcabcbb'], ['bbbbb'], ['pwwkew'], [''], ['abba']],
  },
  {
    title: 'Mystery #08',
    language: 'Python', topic: 'Arrays & Hashing', difficulty: 'Medium',
    code: `def solve(nums):
    cand, count = None, 0
    for x in nums:
        if count == 0:
            cand = x
        count += 1 if x == cand else -1
    return cand`,
    execJs: `function solve(nums) {
  let cand = null, count = 0;
  for (const x of nums) {
    if (count === 0) cand = x;
    count += x === cand ? 1 : -1;
  }
  return cand;
}`,
    entryFn: 'solve',
    params: [{ name: 'nums', type: 'number[]' }],
    referenceQuestion: 'Given an array in which one element is guaranteed to appear more than half of the time, return that majority element.',
    keywords: [
      { concept: 'array input', terms: ['array', 'list', 'numbers'], weight: 1 },
      { concept: 'majority element', terms: ['majority'], weight: 3 },
      { concept: 'more than half', terms: ['more than half', 'over half', 'n/2', 'n / 2', 'half'], weight: 3 },
      { concept: 'appears / frequency', terms: ['appear', 'occur', 'frequent', 'frequency', 'times'], weight: 1 },
    ],
    probes: [[[3, 2, 3]], [[2, 2, 1, 1, 1, 2, 2]], [[1, 2, 3]], [[7]]],
  },
  {
    title: 'Mystery #09',
    language: 'Java', topic: 'Math', difficulty: 'Easy',
    code: `int solve(int a, int b) {
    while (b != 0) {
        int t = a % b;
        a = b;
        b = t;
    }
    return a;
}`,
    execJs: `function solve(a, b) {
  while (b !== 0) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}`,
    entryFn: 'solve',
    params: [{ name: 'a', type: 'non-negative int' }, { name: 'b', type: 'non-negative int' }],
    referenceQuestion: 'Compute the greatest common divisor of two non-negative integers.',
    keywords: [
      { concept: 'greatest common divisor', terms: ['greatest common divisor', 'gcd', 'highest common factor', 'hcf', 'greatest common factor'], weight: 4 },
      { concept: 'two integers', terms: ['two integers', 'two numbers', 'pair of numbers', 'two non negative'], weight: 1 },
    ],
    probes: [[48, 18], [7, 13], [0, 5], [21, 0]],
  },
  {
    title: 'Mystery #10',
    language: 'JavaScript', topic: 'Intervals', difficulty: 'Hard',
    code: `function solve(iv) {
  iv = [...iv].sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const [s, e] of iv) {
    if (out.length && s <= out[out.length - 1][1]) {
      out[out.length - 1][1] = Math.max(out[out.length - 1][1], e);
    } else out.push([s, e]);
  }
  return out;
}`,
    entryFn: 'solve',
    params: [{ name: 'iv', type: '[start, end][]' }],
    referenceQuestion: 'Given a list of intervals, merge all overlapping intervals and return the resulting non-overlapping intervals sorted by their start.',
    keywords: [
      { concept: 'intervals', terms: ['interval', 'ranges', 'range', 'segments'], weight: 2 },
      { concept: 'merge', terms: ['merge', 'combine', 'union', 'join'], weight: 3 },
      { concept: 'overlapping', terms: ['overlap', 'intersect', 'touching'], weight: 3 },
      { concept: 'sorted by start', terms: ['sorted', 'sort', 'start', 'order'], weight: 1 },
    ],
    probes: [[[[1, 3], [2, 6], [8, 10], [15, 18]]], [[[1, 4], [4, 5]]], [[[5, 6], [1, 2]]], [[]]],
  },
].map(s => ({ ...s, execJs: s.execJs ?? s.code }));
