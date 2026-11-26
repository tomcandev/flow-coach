// Deterministic word-by-word marking for Write From Dictation style answers.
// One point per reference word typed correctly, in order (longest common subsequence).
// Extra words are shown but do not cost points. Every lost point is put in one category,
// so "which weakness costs the most points" is a count, not a guess.

export type MistakeCategory = 'ending' | 'spelling' | 'small' | 'missed';

export const CATEGORY_LABEL: Record<MistakeCategory, string> = {
  ending: 'Word endings (-s, -ed, -ing)',
  spelling: 'Spelling',
  small: 'Small words (articles, prepositions)',
  missed: 'Missed words (listening memory)',
};

export const CATEGORY_SHORT: Record<MistakeCategory, string> = {
  ending: 'Endings',
  spelling: 'Spelling',
  small: 'Small words',
  missed: 'Missed words',
};

export const SMALL_WORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'for', 'by', 'with', 'from', 'and', 'or',
  'but', 'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had', 'its', 'their', 'that',
  'this', 'who', 'over', 'into', 'than', 'as',
]);

export interface Token {
  ref?: string; // expected word (display form)
  typed?: string; // what the learner typed (display form)
  status: 'correct' | 'wrong' | 'missing' | 'extra';
  category?: MistakeCategory;
}

export interface MarkResult {
  tokens: Token[];
  score: number;
  total: number;
  accuracy: number; // 0..1
  lost: Record<MistakeCategory, number>;
  mistakes: { expected: string; typed: string | null; category: MistakeCategory }[];
}

export function words(text: string): string[] {
  return text
    .replace(/[’']/g, "'")
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, ''))
    .filter(Boolean);
}

export const norm = (w: string) => w.toLowerCase();

// British and American spellings both count as correct.
const VARIANTS: [RegExp, string][] = [
  [/ise(s|d)?$/, 'ize$1'],
  [/ising$/, 'izing'],
  [/isation(s)?$/, 'ization$1'],
  [/our(s)?$/, 'or$1'],
  [/tre(s)?$/, 'ter$1'],
  [/ence$/, 'ense'],
];
export function canonical(w: string): string {
  let c = norm(w);
  if (c === 'practise' || c === 'practised' || c === 'practises') c = c.replace('practis', 'practic');
  for (const [re, rep] of VARIANTS) {
    if (re.test(c) && c.length > 5) {
      c = c.replace(re, rep);
      break;
    }
  }
  return c;
}

export function stem(w: string): string {
  const c = canonical(w);
  for (const suf of ['ing', 'ies', 'ied', 'es', 'ed', 's', 'd']) {
    if (c.length > suf.length + 2 && c.endsWith(suf)) return c.slice(0, -suf.length).replace(/e$/, '');
  }
  return c.replace(/e$/, '');
}

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

const SUFFIXES = ['s', 'es', 'ed', 'd', 'ing', 'ies', 'ied', "'s"];
/** True when two words differ only by an inflection ending, e.g. extend/extends, hour/hours, study/studied. */
export function isInflection(a: string, b: string): boolean {
  if (a === b) return false;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (l.startsWith(s) && SUFFIXES.includes(l.slice(s.length))) return true;
  if (s.endsWith('e') && l.startsWith(s.slice(0, -1)) && ['ing', 'ed'].includes(l.slice(s.length - 1))) return true;
  if (s.endsWith('y') && l.startsWith(s.slice(0, -1)) && ['ies', 'ied'].includes(l.slice(s.length - 1))) return true;
  return stem(a) === stem(b);
}

function classify(expected: string, typed: string | null): MistakeCategory {
  const e = canonical(expected);
  if (SMALL_WORDS.has(e)) return 'small';
  if (typed) {
    const t = canonical(typed);
    if (isInflection(e, t)) return 'ending';
    if (levenshtein(e, t) <= Math.max(2, Math.floor(e.length * 0.34))) return 'spelling';
  }
  return 'missed';
}

export function mark(reference: string, answer: string): MarkResult {
  const ref = words(reference);
  const ans = words(answer);
  const R = ref.map(canonical);
  const A = ans.map(canonical);
  // LCS table
  const L: number[][] = Array.from({ length: R.length + 1 }, () => new Array(A.length + 1).fill(0));
  for (let i = R.length - 1; i >= 0; i--)
    for (let j = A.length - 1; j >= 0; j--)
      L[i][j] = R[i] === A[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);

  // Walk the table, collecting gaps between matched words.
  const tokens: Token[] = [];
  let i = 0;
  let j = 0;
  let gapRef: string[] = [];
  let gapAns: string[] = [];
  const flush = () => {
    // Pair words inside a gap position by position, then classify.
    const usedAns = new Set<number>();
    const pairs: (number | null)[] = gapRef.map(() => null);
    // Prefer pairing with the most similar typed word in the same gap.
    gapRef.forEach((r, ri) => {
      let best = -1;
      let bestScore = Infinity;
      gapAns.forEach((a, ai) => {
        if (usedAns.has(ai)) return;
        const d = stem(r) === stem(a) ? 0 : levenshtein(canonical(r), canonical(a));
        if (d < bestScore) {
          bestScore = d;
          best = ai;
        }
      });
      if (best >= 0 && bestScore <= Math.max(2, Math.floor(r.length * 0.5))) {
        usedAns.add(best);
        pairs[ri] = best;
      }
    });
    gapRef.forEach((r, ri) => {
      const p = pairs[ri];
      const typed = p === null ? null : gapAns[p];
      const category = classify(r, typed);
      tokens.push({ ref: r, typed: typed ?? undefined, status: typed ? 'wrong' : 'missing', category });
    });
    gapAns.forEach((a, ai) => {
      if (!usedAns.has(ai)) tokens.push({ typed: a, status: 'extra' });
    });
    gapRef = [];
    gapAns = [];
  };
  while (i < R.length || j < A.length) {
    if (i < R.length && j < A.length && R[i] === A[j]) {
      flush();
      tokens.push({ ref: ref[i], typed: ans[j], status: 'correct' });
      i++;
      j++;
    } else if (j < A.length && (i >= R.length || L[i][j + 1] >= L[i + 1][j])) {
      gapAns.push(ans[j++]);
    } else {
      gapRef.push(ref[i++]);
    }
  }
  flush();

  const lost: Record<MistakeCategory, number> = { ending: 0, spelling: 0, small: 0, missed: 0 };
  const mistakes: MarkResult['mistakes'] = [];
  for (const t of tokens) {
    if (t.category && t.ref) {
      lost[t.category]++;
      mistakes.push({ expected: t.ref, typed: t.typed ?? null, category: t.category });
    }
  }
  const score = tokens.filter((t) => t.status === 'correct').length;
  return { tokens, score, total: ref.length, accuracy: ref.length ? score / ref.length : 0, lost, mistakes };
}

// Which categories a sentence can train, from its own words.
export function itemSkills(text: string): MistakeCategory[] {
  const w = words(text).map(norm);
  const skills: MistakeCategory[] = [];
  if (w.some((x) => x.length > 4 && /(s|ed|ing)$/.test(x) && !/(ss|ous|is)$/.test(x))) skills.push('ending');
  if (w.some((x) => x.length >= 9)) skills.push('spelling');
  if (w.filter((x) => SMALL_WORDS.has(x)).length >= 3) skills.push('small');
  if (w.length >= 11) skills.push('missed');
  return skills;
}
