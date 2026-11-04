import { describe, expect, it } from "vitest";

import {
  CitationInstance,
  CitationRegistry,
  numbersFromSequence,
} from "../../src/numbering/registry";

function seq(...itemKeys: string[]): CitationInstance[] {
  return itemKeys.map((itemKey, i) => ({ anchorId: `anchor${i}`, itemKey }));
}

describe("numbersFromSequence", () => {
  it("assigns numbers by order of first appearance", () => {
    const numbers = numbersFromSequence(seq("b", "a", "a", "c"));
    expect(numbers.get("b")).toBe(1);
    expect(numbers.get("a")).toBe(2);
    expect(numbers.get("c")).toBe(3);
    expect(numbers.size).toBe(3);
  });
});

describe("CitationRegistry", () => {
  it("inserts, assigns numbers by first appearance, and reuses numbers on re-cite", () => {
    const reg = new CitationRegistry();
    expect(reg.insert("sleep", reg.nextAnchorId())).toBe(1);
    expect(reg.insert("soil", reg.nextAnchorId())).toBe(2);
    // Re-citing sleep reuses its number.
    expect(reg.insert("sleep", reg.nextAnchorId())).toBe(1);
    expect(reg.insert("dream", reg.nextAnchorId())).toBe(3);
    expect(reg.entries().map((e) => [e.itemKey, e.number])).toEqual([
      ["sleep", 1],
      ["soil", 2],
      ["dream", 3],
    ]);
    expect(reg.entries().find((e) => e.itemKey === "sleep")?.count).toBe(2);
  });

  it("inserts before an existing anchor", () => {
    const reg = new CitationRegistry();
    const a1 = reg.nextAnchorId();
    const a2 = reg.nextAnchorId();
    reg.insert("x", a1);
    reg.insert("y", a2);
    expect(reg.insert("z", reg.nextAnchorId(), a1)).toBe(1);
    expect(reg.entries().map((e) => e.itemKey)).toEqual(["z", "x", "y"]);
  });

  it("renumbers after a source's last citation is removed", () => {
    const reg = new CitationRegistry();
    const a1 = reg.nextAnchorId();
    const a2 = reg.nextAnchorId();
    const a3 = reg.nextAnchorId();
    reg.insert("x", a1);
    reg.insert("y", a2);
    reg.insert("z", a3);
    reg.remove(a1);
    expect(reg.numberFor("x")).toBeUndefined();
    expect(reg.numberFor("y")).toBe(1);
    expect(reg.numberFor("z")).toBe(2);
    expect(reg.entries().map((e) => e.number)).toEqual([1, 2]);
  });

  it("renumbers when the first marker of a source is removed, even if later markers remain", () => {
    const reg = new CitationRegistry();
    const a1 = reg.nextAnchorId();
    const a2 = reg.nextAnchorId();
    const a3 = reg.nextAnchorId();
    reg.insert("x", a1);
    reg.insert("y", a2);
    reg.insert("x", a3);
    reg.remove(a1);
    // With x's first marker gone, y's marker now appears first in the doc.
    expect(reg.numberFor("y")).toBe(1);
    expect(reg.numberFor("x")).toBe(2);
  });

  it("syncs from a DOM scan, dedupes anchors, and renumbers on reorder", () => {
    const reg = new CitationRegistry();
    reg.insert("x", reg.nextAnchorId());
    reg.insert("y", reg.nextAnchorId());
    // DOM now (after user moved/deleted markers): y then x, plus duplicate y.
    const numbers = reg.sync(seq("y", "x", "y"));
    expect(reg.entries().map((e) => e.itemKey)).toEqual(["y", "x"]);
    expect(numbers.get("x")).toBe(2);
    expect(numbers.get("y")).toBe(1);
  });

  it("reset clears everything", () => {
    const reg = new CitationRegistry();
    reg.insert("x", reg.nextAnchorId());
    reg.reset();
    expect(reg.entries()).toEqual([]);
    expect(reg.numberFor("x")).toBeUndefined();
  });
});
