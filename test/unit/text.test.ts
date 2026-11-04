import { describe, expect, it } from "vitest";

import {
  STOPWORDS,
  contentTokens,
  findSharedSnippet,
  tokenize,
} from "../../src/matching/text";

describe("tokenize", () => {
  it("lowercases and keeps offsets", () => {
    const tokens = tokenize("Hello, World! It's 2026.");
    expect(tokens.map((t) => t.norm)).toEqual(["hello", "world", "it's", "2026"]);
    const s = "Hello, World! It's 2026.";
    for (const t of tokens) {
      expect(s.slice(t.start, t.end)).toMatch(/^[\p{L}\p{N}'’-]+$/u);
    }
  });

  it("filters stopwords in contentTokens", () => {
    const tokens = contentTokens("The decline of the DECLINE in recall accuracy");
    expect(tokens).toEqual(["decline", "decline", "recall", "accuracy"]);
    expect(STOPWORDS.has("the")).toBe(true);
  });
});

describe("findSharedSnippet", () => {
  const doc =
    "Adolescents who slept fewer than six hours showed a measurable decline in recall accuracy during the word pair task. Further analysis confirmed the pattern across cohorts.";

  it("finds a >=6-word verbatim overlap and a context window", () => {
    const match = findSharedSnippet(
      "Participants slept fewer than six hours showed a measurable decline in recall accuracy overall.",
      doc,
    );
    expect(match).not.toBeNull();
    expect(match!.wordCount).toBeGreaterThanOrEqual(6);
    expect(match!.text).toContain("fewer than six hours");
    expect(doc).toContain(match!.text); // verbatim
  });

  it("returns null below the 6-word threshold", () => {
    // Shares only a 5-word run with the doc ("recall accuracy during the word").
    expect(
      findSharedSnippet("recall accuracy during the word quiz happened", doc),
    ).toBeNull();
  });

  it("returns null for short inputs", () => {
    expect(findSharedSnippet("too short", doc)).toBeNull();
    expect(findSharedSnippet("a b c d e f g h", "x y")).toBeNull();
  });

  it("prefers the longest span when several overlap", () => {
    const longDoc = doc + " in recall accuracy during the word pair task indeed.";
    const match = findSharedSnippet(
      "They slept fewer than six hours showed a measurable decline in recall accuracy during the word pair task indeed.",
      longDoc,
    );
    expect(match!.wordCount).toBeGreaterThanOrEqual(10);
  });
});
