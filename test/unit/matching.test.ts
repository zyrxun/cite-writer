import { describe, expect, it } from "vitest";

import { MatchingEngine, SNIPPET_MIN_WORDS } from "../../src/matching/engine";
import { SearchableItem, TextSegment } from "../../src/matching/engine";

const SLEEP_FULLTEXT =
  "Adolescents who slept fewer than six hours showed a measurable decline in recall accuracy during the word pair task. " +
  "Loss of rapid eye movement sleep was associated with weaker associative binding across all study conditions.";

const SLEEP_ANNOTATION = "memory consolidation depends critically on sleep duration";

function item(partial: Partial<SearchableItem>): SearchableItem {
  return {
    itemID: 1,
    key: "KEY1",
    libraryID: 1,
    title: "",
    creators: "",
    year: "",
    abstract: "",
    annotationSegments: [] as TextSegment[],
    fulltextSegments: [] as TextSegment[],
    ...partial,
  };
}

function fixtures(): SearchableItem[] {
  return [
    item({
      itemID: 1,
      key: "SLEEP2019",
      title: "Sleep Deprivation and Memory Consolidation in Adolescents",
      creators: "Laura Hendricks Miguel Ortiz",
      year: "2019",
      abstract:
        "We examine how acute sleep restriction affects declarative memory consolidation in high school students.",
      fulltextSegments: [{ text: SLEEP_FULLTEXT }],
      annotationSegments: [{ text: SLEEP_ANNOTATION, page: "114" }],
    }),
    item({
      itemID: 2,
      key: "SOIL2020",
      title: "Soil Carbon Sequestration in Tropical Agroforestry Systems",
      creators: "Amina Diallo",
      year: "2020",
      abstract: "Agroforestry plots store substantially more soil organic carbon than monoculture fields.",
      fulltextSegments: [
        {
          text:
            "Deep-rooted trees pump carbon below the surface layer, where turnover is slow and microbial activity is limited by temperature.",
        },
      ],
    }),
    item({
      itemID: 3,
      key: "CAFFEINE2021",
      title: "Caffeine Consumption and Sleep Quality in University Athletes",
      creators: "Petr Novak",
      year: "2021",
      abstract: "Evening caffeine intake degrades sleep quality markers in trained athletes.",
      fulltextSegments: [
        {
          text:
            "Athletes who consumed caffeine reported worse sleep quality before evening competition than on placebo nights.",
        },
      ],
    }),
    item({
      itemID: 4,
      key: "DREAM2018",
      title: "Dream Recall and Affect in Young Adults",
      creators: "Sofia Bianchi",
      year: "2018",
      abstract: "Survey evidence links poorer dream recall to elevated daytime affect variability in young adults.",
      // No PDF/fulltext: metadata-only item.
    }),
  ];
}

describe("MatchingEngine", () => {
  it("ranks a paraphrased sentence's source #1 with fulltext snippet evidence", () => {
    const engine = new MatchingEngine(fixtures());
    const sentence =
      "When participants slept fewer than six hours showed a measurable decline in recall accuracy, even after a single night of restriction.";
    const candidates = engine.rank(sentence, "");
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].item.key).toBe("SLEEP2019");
    expect(candidates[0].snippet.channel).toBe("fulltext");
    expect(candidates[0].snippet.wordCount).toBeGreaterThanOrEqual(SNIPPET_MIN_WORDS);
    expect(candidates[0].snippet.text).toContain("fewer than six hours");
  });

  it("prefers the annotation channel and reports the page number", () => {
    const engine = new MatchingEngine(fixtures());
    const sentence =
      "The authors conclude that memory consolidation depends critically on sleep duration rather than total time in bed.";
    const [top] = engine.rank(sentence, "");
    expect(top.item.key).toBe("SLEEP2019");
    expect(top.snippet.channel).toBe("annotations");
    expect(top.snippet.page).toBe("114");
    expect(top.snippet.text).toBe(SLEEP_ANNOTATION);
  });

  it("matches metadata-only items (no attached PDF) via the abstract", () => {
    const engine = new MatchingEngine(fixtures());
    const sentence =
      "Survey evidence links poorer dream recall to elevated daytime affect variability in young adults.";
    const [top] = engine.rank(sentence, "");
    expect(top.item.key).toBe("DREAM2018");
    expect(top.item.fulltextSegments).toHaveLength(0);
    expect(top.snippet.channel).toBe("metadata");
    expect(top.snippet.wordCount).toBeGreaterThanOrEqual(SNIPPET_MIN_WORDS);
  });

  it("returns no suggestion when there is no >=6-word verbatim overlap", () => {
    const engine = new MatchingEngine(fixtures());
    const sentence =
      "Adolescents sleeping badly perform worse on remembering paired words the following day.";
    expect(engine.rank(sentence, "")).toEqual([]);
  });

  it("still matches an item whose vocabulary only surfaces with real overlap", () => {
    const engine = new MatchingEngine(fixtures());
    const sentence =
      "Athletes who consumed caffeine reported worse sleep quality before evening competition than in training.";
    const [top] = engine.rank(sentence, "");
    expect(top.item.key).toBe("CAFFEINE2021");
  });

  it("uses the previous sentence as context without letting it dominate", () => {
    const engine = new MatchingEngine(fixtures());
    const prev = "Sleep loss studies typically measure recall after a fixed retention interval.";
    const sentence =
      "Adolescents who slept fewer than six hours showed a measurable decline in recall accuracy in this design.";
    const [top] = engine.rank(sentence, prev);
    expect(top.item.key).toBe("SLEEP2019");
  });

  it("honors minScore and maxCandidates", () => {
    const engine = new MatchingEngine(fixtures());
    const sentence =
      "When participants slept fewer than six hours showed a measurable decline in recall accuracy, even after a single night.";
    const all = engine.rank(sentence, "");
    expect(engine.rank(sentence, "", { minScore: all[0].score + 1 })).toEqual([]);
    const limited = engine.rank(sentence, "", { maxCandidates: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0].item.key).toBe("SLEEP2019");
  });

  it("handles an empty corpus and empty sentences", () => {
    expect(new MatchingEngine([]).rank("anything at all here now", "")).toEqual([]);
    const engine = new MatchingEngine(fixtures());
    expect(engine.rank("", "")).toEqual([]);
    expect(engine.rank("the of and to a", "")).toEqual([]);
  });

  it("ranks a 500-item corpus in under a second (index + query)", () => {
    const corpus = fixtures();
    for (let i = 0; i < 500; i++) {
      corpus.push(
        item({
          itemID: 100 + i,
          key: `FILLER${i}`,
          title: `Filler Study ${i} on Crop Rotations`,
          creators: `Author ${i}`,
          year: `${1950 + (i % 70)}`,
          abstract: `Filler abstract ${i} about wheat barley rice oats maize rye millet sorghum canola.`,
          fulltextSegments: [
            {
              text: Array.from(
                { length: 30 },
                (_, j) =>
                  `Filler passage ${i} block ${j} discusses topic ${i % 20} with words wheat barley rice oats maize rye millet sorghum canola flax hemp cotton jute kenaf sisal bamboo.`,
              ).join(" "),
            },
          ],
        }),
      );
    }
    const t0 = performance.now();
    const engine = new MatchingEngine(corpus);
    const sentence =
      "When participants slept fewer than six hours showed a measurable decline in recall accuracy.";
    const candidates = engine.rank(sentence, "");
    const elapsed = performance.now() - t0;
    expect(candidates[0].item.key).toBe("SLEEP2019");
    expect(elapsed).toBeLessThan(1000);
  });
});
