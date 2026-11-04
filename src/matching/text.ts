// Tokenization and shared-n-gram snippet extraction for the matching engine.

export interface Token {
  /** Lowercased token text. */
  norm: string;
  /** Char offset of the token start in the source text. */
  start: number;
  /** Char offset just past the token end in the source text. */
  end: number;
}

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(WORD_RE)) {
    tokens.push({
      norm: m[0].toLowerCase(),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return tokens;
}

export const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "i",
  "in",
  "into",
  "is",
  "it",
  "its",
  "may",
  "might",
  "must",
  "of",
  "on",
  "or",
  "our",
  "s",
  "shall",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "to",
  "was",
  "we",
  "were",
  "what",
  "when",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

/** Tokens with stopwords removed, for BM25 scoring. */
export function contentTokens(text: string): string[] {
  return tokenize(text)
    .map((t) => t.norm)
    .filter((t) => !STOPWORDS.has(t));
}

export interface SnippetMatch {
  /** Verbatim text from the source document. */
  text: string;
  /** Number of shared words in the matched span (>= minWords). */
  wordCount: number;
}

function gramKey(tokens: Token[], from: number, n: number): string {
  let key = tokens[from].norm;
  for (let i = 1; i < n; i++) key += " " + tokens[from + i].norm;
  return key;
}

/**
 * Find the longest run of >= minWords words shared verbatim between the
 * query and a document, and return a window of the document text around it.
 * Returns null when the query shares no span of minWords words with the doc.
 */
export function findSharedSnippet(
  queryText: string,
  docText: string,
  minWords = 6,
  windowWords = 24,
): SnippetMatch | null {
  const q = tokenize(queryText);
  const d = tokenize(docText);
  if (q.length < minWords || d.length < minWords) return null;

  // Index the document's n-grams (first occurrence of each).
  const grams = new Map<string, number>();
  for (let i = 0; i + minWords <= d.length; i++) {
    const key = gramKey(d, i, minWords);
    if (!grams.has(key)) grams.set(key, i);
  }

  let best: { dStart: number; len: number } | null = null;
  for (let i = 0; i + minWords <= q.length; i++) {
    const dStart = grams.get(gramKey(q, i, minWords));
    if (dStart === undefined) continue;
    let fwd = minWords;
    while (
      i + fwd < q.length &&
      dStart + fwd < d.length &&
      q[i + fwd].norm === d[dStart + fwd].norm
    ) {
      fwd++;
    }
    let back = 0;
    while (
      i - back - 1 >= 0 &&
      dStart - back - 1 >= 0 &&
      q[i - back - 1].norm === d[dStart - back - 1].norm
    ) {
      back++;
    }
    if (!best || fwd + back > best.len) {
      best = { dStart: dStart - back, len: fwd + back };
    }
  }
  if (!best) return null;

  // Context window around the matched span, capped at windowWords words.
  let from = Math.max(0, best.dStart - 3);
  let to = Math.min(d.length, best.dStart + best.len + 3);
  if (to - from > windowWords) {
    const surplus = to - from - windowWords;
    from += Math.ceil(surplus / 2);
    to -= Math.floor(surplus / 2);
  }
  return {
    text: docText.slice(d[from].start, d[to - 1].end),
    wordCount: best.len,
  };
}
