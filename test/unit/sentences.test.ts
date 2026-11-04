import { describe, expect, it } from "vitest";

import { sentenceContext } from "../../src/matching/sentences";

describe("sentenceContext", () => {
  const text =
    "Prior work ignored this. We argue that memory depends on sleep, and we test it here. Next sentence follows.";

  it("returns the sentence containing the caret as current", () => {
    const caret = text.indexOf("memory");
    const { current, previous } = sentenceContext(text, caret);
    expect(current).toContain("memory depends on sleep");
    expect(previous).toBe("Prior work ignored this.");
  });

  it("includes the partial sentence after the caret", () => {
    const caret = text.indexOf("we test it");
    const { current } = sentenceContext(text, caret);
    expect(current).toBe(
      "We argue that memory depends on sleep, and we test it here.",
    );
  });

  it("matches the just-completed sentence when the caret is right after its end", () => {
    const caret = text.indexOf("Next") - 1; // right after "here."
    const { current, previous } = sentenceContext(text, caret);
    expect(current).toBe(
      "We argue that memory depends on sleep, and we test it here.",
    );
    expect(previous).toBe("Prior work ignored this.");
  });

  it("treats the new sentence under the caret as current", () => {
    const caret = text.indexOf("Next");
    const { current, previous } = sentenceContext(text, caret);
    expect(current).toBe("Next sentence follows.");
    expect(previous).toContain("memory depends on sleep");
  });

  it("handles text without any boundaries", () => {
    expect(sentenceContext("no boundary here", 5).current).toBe(
      "no boundary here",
    );
    expect(sentenceContext("no boundary here", 5).previous).toBe("");
  });

  it("handles empty text", () => {
    expect(sentenceContext("", 0)).toEqual({ current: "", previous: "" });
  });
});
