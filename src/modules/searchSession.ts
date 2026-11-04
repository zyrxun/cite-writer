// Orchestrates corpus collection and the matching engine. The corpus is
// cached per scope and invalidated when the library changes (notifier) or
// when scope/trigger prefs change, so per-query work stays fast.

import {
  MatchCandidate,
  MatchingEngine,
  RankOptions,
} from "../matching/engine";
import { collectCorpus, Corpus } from "./corpus";
import { getPref } from "../utils/prefs";
import { logError } from "../utils/error";

export interface SearchSession {
  /** Rank sources for a sentence. Returns [] while the corpus builds. */
  rank(
    sentence: string,
    prevSentence: string,
    options?: RankOptions,
  ): Promise<MatchCandidate[]>;
  /** Zotero item id for a corpus item key. */
  itemID(key: string): number | undefined;
  /** Drop the cached corpus (library changed, or scope pref changed). */
  invalidate(): void;
}

export function createSearchSession(): SearchSession {
  let cached: { scope: string; corpus: Corpus; engine: MatchingEngine } | null =
    null;
  let building: Promise<void> | null = null;

  function currentScope(): string {
    return String(getPref("scope"));
  }

  function ensureCorpus(): Promise<void> {
    const scope = currentScope();
    if (cached?.scope === scope) return Promise.resolve();
    if (!building) {
      building = collectCorpus()
        .then((result) => {
          cached = {
            scope: result.scope,
            corpus: result.corpus,
            engine: new MatchingEngine(result.corpus.items),
          };
        })
        .catch((e: unknown) => {
          logError(e);
        })
        .finally(() => {
          building = null;
        });
    }
    return building;
  }

  return {
    async rank(sentence, prevSentence, options) {
      if (getPref("enable") === false) return [];
      await ensureCorpus();
      if (!cached) return [];
      return cached.engine.rank(sentence, prevSentence, options);
    },

    itemID(key: string) {
      return cached?.corpus.itemIDByKey.get(key);
    },

    invalidate() {
      cached = null;
    },
  };
}
