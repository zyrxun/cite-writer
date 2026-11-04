// BM25-style lexical matching engine over three channels:
// item metadata (title/abstract/creators/year), user annotations, PDF fulltext.
// Pure logic — no Zotero imports — so it is fully unit-testable headlessly.

import { contentTokens, findSharedSnippet } from "./text";

export type ChannelName = "metadata" | "annotations" | "fulltext";

export interface TextSegment {
  text: string;
  /** Page label (from annotations) when known. */
  page?: string;
}

export interface SearchableItem {
  itemID: number;
  /** Zotero item key, the stable identity used by the citation registry. */
  key: string;
  libraryID: number;
  title: string;
  creators: string;
  year: string;
  abstract: string;
  annotationSegments: TextSegment[];
  fulltextSegments: TextSegment[];
}

export interface MatchSnippet {
  text: string;
  channel: ChannelName;
  page?: string;
  /** Shared word count of the verbatim evidence span. */
  wordCount: number;
}

export interface MatchCandidate {
  item: SearchableItem;
  /** Combined weighted BM25 score across channels. */
  score: number;
  snippet: MatchSnippet;
}

export interface EngineWeights {
  metadata: number;
  annotations: number;
  fulltext: number;
}

export const DEFAULT_WEIGHTS: EngineWeights = {
  metadata: 1.5,
  annotations: 2,
  fulltext: 1,
};

export interface RankOptions {
  /** Max candidates returned (default 5). */
  maxCandidates?: number;
  /** Minimum combined score to keep a candidate (default 0). */
  minScore?: number;
  weights?: Partial<EngineWeights>;
}

// Minimal number of shared words required as verbatim snippet evidence.
export const SNIPPET_MIN_WORDS = 6;
// How many top-scored items get snippet verification per query.
const TOP_FOR_SNIPPET = 12;

const K1 = 1.2;
const B = 0.75;

const CHANNEL_NAMES: ChannelName[] = ["annotations", "fulltext", "metadata"];
// Tie-break boost when several channels yield snippets: user highlights are
// the strongest evidence, then fulltext, then metadata.
const CHANNEL_SNIPPET_BOOST: Record<ChannelName, number> = {
  annotations: 1000,
  fulltext: 500,
  metadata: 0,
};

interface ChannelIndex {
  postings: Map<string, Array<[docIdx: number, tf: number]>>;
  lengths: number[];
  avgLength: number;
}

export function metadataText(item: SearchableItem): string {
  return [item.title, item.abstract, item.creators, item.year]
    .filter(Boolean)
    .join("\n");
}

export function channelText(
  item: SearchableItem,
  channel: ChannelName,
): string {
  switch (channel) {
    case "metadata":
      return metadataText(item);
    case "annotations":
      return item.annotationSegments.map((s) => s.text).join("\n");
    case "fulltext":
      return item.fulltextSegments.map((s) => s.text).join("\n");
  }
}

function emptyIndex(): ChannelIndex {
  return { postings: new Map(), lengths: [], avgLength: 0 };
}

/**
 * A paraphrase-aware lexical matcher. Candidates are ranked by weighted BM25
 * across channels but are only surfaced when a verbatim shared n-gram
 * (>= SNIPPET_MIN_WORDS words) exists in one of the item's channels, so every
 * suggestion carries displayable evidence.
 *
 * Re-indexing is O(corpus) and runs once per corpus; rank() is O(query terms x
 * postings) plus snippet tokenization of the top TOP_FOR_SNIPPET items, which
 * keeps queries fast on a 500-item library.
 */
export class MatchingEngine {
  private items: SearchableItem[] = [];
  private channels: Record<ChannelName, ChannelIndex>;

  constructor(items: SearchableItem[]) {
    this.channels = {
      metadata: emptyIndex(),
      annotations: emptyIndex(),
      fulltext: emptyIndex(),
    };
    this.reindex(items);
  }

  reindex(items: SearchableItem[]): void {
    this.items = items;
    for (const name of CHANNEL_NAMES) {
      this.channels[name] = emptyIndex();
    }
    items.forEach((item, docIdx) => {
      for (const name of CHANNEL_NAMES) {
        const text = channelText(item, name);
        const tokens = contentTokens(text);
        const index = this.channels[name];
        index.lengths[docIdx] = tokens.length;
        const tf = new Map<string, number>();
        for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
        for (const [term, count] of tf) {
          let list = index.postings.get(term);
          if (!list) index.postings.set(term, (list = []));
          list.push([docIdx, count]);
        }
      }
    });
    for (const name of CHANNEL_NAMES) {
      const index = this.channels[name];
      const total = index.lengths.reduce((a, b) => a + b, 0);
      index.avgLength = items.length ? total / items.length : 0;
    }
  }

  /**
   * Rank sources for the sentence the user just wrote.
   * @param sentence Current sentence (weighted double).
   * @param prevSentence Previous sentence (context, weighted single).
   */
  rank(
    sentence: string,
    prevSentence: string,
    options: RankOptions = {},
  ): MatchCandidate[] {
    const weights: EngineWeights = { ...DEFAULT_WEIGHTS, ...options.weights };
    const qtf = new Map<string, number>();
    for (const t of contentTokens(sentence)) qtf.set(t, (qtf.get(t) ?? 0) + 2);
    for (const t of contentTokens(prevSentence))
      qtf.set(t, (qtf.get(t) ?? 0) + 1);
    if (!qtf.size || !this.items.length) return [];

    const scores = new Float64Array(this.items.length);
    const n = this.items.length;
    for (const [term, q] of qtf) {
      for (const name of CHANNEL_NAMES) {
        const postings = this.channels[name].postings.get(term);
        if (!postings) continue;
        const df = postings.length;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        const avg = this.channels[name].avgLength || 1;
        for (const [docIdx, tf] of postings) {
          const len = this.channels[name].lengths[docIdx];
          const denom = tf + K1 * (1 - B + B * (len / avg));
          scores[docIdx] += weights[name] * q * idf * ((tf * (K1 + 1)) / denom);
        }
      }
    }

    const scored: Array<{ idx: number; score: number }> = [];
    for (let i = 0; i < n; i++) {
      if (scores[i] > 0) scored.push({ idx: i, score: scores[i] });
    }
    scored.sort((a, b) => b.score - a.score);

    const candidates: MatchCandidate[] = [];
    for (const { idx, score } of scored.slice(0, TOP_FOR_SNIPPET)) {
      if (options.minScore !== undefined && score < options.minScore) break;
      const snippet = this.findSnippet(sentence, idx);
      if (!snippet) continue; // no verbatim evidence -> not a displayable candidate
      candidates.push({ item: this.items[idx], score, snippet });
      if (candidates.length >= (options.maxCandidates ?? 5)) break;
    }
    return candidates;
  }

  /** Best verbatim snippet for the sentence across the item's channels. */
  private findSnippet(sentence: string, itemIdx: number): MatchSnippet | null {
    const item = this.items[itemIdx];
    const segments: Array<{
      channel: ChannelName;
      text: string;
      page?: string;
    }> = [];
    for (const seg of item.annotationSegments) {
      segments.push({ channel: "annotations", text: seg.text, page: seg.page });
    }
    for (const seg of item.fulltextSegments) {
      segments.push({ channel: "fulltext", text: seg.text });
    }
    const meta = metadataText(item);
    if (meta) segments.push({ channel: "metadata", text: meta });

    let best: MatchSnippet | null = null;
    let bestRank = -1;
    for (const seg of segments) {
      const match = findSharedSnippet(sentence, seg.text, SNIPPET_MIN_WORDS);
      if (!match) continue;
      const rank = CHANNEL_SNIPPET_BOOST[seg.channel] + match.wordCount;
      if (rank > bestRank) {
        bestRank = rank;
        best = {
          text: match.text,
          channel: seg.channel,
          page: seg.page,
          wordCount: match.wordCount,
        };
      }
    }
    return best;
  }
}
