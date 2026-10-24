import { goldenChoices, type Catalog } from "@deckforge/catalog";
import type { DeckSpec, Patch } from "@deckforge/schemas";
import { beforeAll, describe, expect, it } from "vitest";
import { ContentChoicesSchema } from "../../src/kernel/contracts.ts";
import { applyPatches } from "../../src/patches/apply.ts";
import { deckRules, type DeckRules } from "../../src/validate/rules.ts";
import { visibleWords } from "../../src/validate/words.ts";
import { testCatalog } from "../helpers/context.ts";
import { STANDARD_DECK } from "../validate/fixtures.ts";

let c: Catalog;
let rules: DeckRules;
beforeAll(async () => {
  c = await testCatalog();
  rules = deckRules(c, ContentChoicesSchema.parse(goldenChoices(c)[0]));
});

const slide = (deck: DeckSpec, id: string) => deck.slides.find((s) => s.id === id)!;
const SHORT_BULLETS = { type: "Bullets", items: ["Photons carry energy", "Enough energy frees an electron"] };
const half = (title: string, items: string[]) => ({
  title,
  body: [{ type: "Bullets", items }],
  notes: "Speaker notes for this half.",
  emphasisTargets: [],
});

function apply(...patches: Patch[]) {
  return applyPatches(STANDARD_DECK, patches, rules);
}

function applied(...patches: Patch[]): DeckSpec {
  const result = apply(...patches);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.deck;
}

function issuesOf(...patches: Patch[]) {
  const result = apply(...patches);
  if (result.ok) throw new Error("expected issues");
  return result.issues;
}

describe("applyPatches", () => {
  it("shortenText replaces", () => {
    const deck = applied({ slideId: "s04", op: "shortenText", payload: { title: "The effect in brief", body: [SHORT_BULLETS] } });
    expect(slide(deck, "s04")).toEqual({ ...slide(STANDARD_DECK, "s04"), title: "The effect in brief", body: [SHORT_BULLETS] });
    expect(visibleWords(slide(deck, "s04"))).toBeLessThan(visibleWords(slide(STANDARD_DECK, "s04")));
    expect(deck.slides.map((s) => s.id)).toEqual(STANDARD_DECK.slides.map((s) => s.id));
    expect(slide(STANDARD_DECK, "s04").body).not.toEqual([SHORT_BULLETS]);
  });

  it("shortenText with a null title keeps the original", () => {
    const deck = applied({ slideId: "s04", op: "shortenText", payload: { title: null, body: [SHORT_BULLETS] } });
    expect(slide(deck, "s04").title).toBe(slide(STANDARD_DECK, "s04").title);
  });

  it("changed types → patch-shape", () => {
    const issues = issuesOf({ slideId: "s04", op: "shortenText", payload: { title: null, body: [{ type: "Paragraph", text: "Short." }] } });
    expect(issues).toEqual([
      expect.objectContaining({ path: "patches[0].payload.body", code: "patch-shape", message: expect.stringContaining("(Bullets)") }),
    ]);
    const extra = issuesOf({ slideId: "s04", op: "shortenText", payload: { title: null, body: [SHORT_BULLETS, SHORT_BULLETS] } });
    expect(extra.map((i) => i.code)).toEqual(["patch-shape"]);
  });

  it("not shorter", () => {
    const same = slide(STANDARD_DECK, "s04").body;
    const original = same[0] as { type: "Bullets"; items: string[] };
    const longer = { ...original, items: [...original.items, "one more line"] };
    for (const body of [same, [longer]]) {
      const issues = issuesOf({ slideId: "s04", op: "shortenText", payload: { title: null, body } });
      expect(issues).toEqual([expect.objectContaining({ code: "patch-not-shorter", message: expect.stringMatching(/slide s04 .*\d+ visible words/) })]);
    }
  });

  it("split in place s04a/s04b", () => {
    const deck = applied({
      slideId: "s04",
      op: "splitSlide",
      payload: { halves: [half("Light in", ["Photons carry energy", "Colour sets the energy"]), half("Electrons out", ["Enough energy frees an electron", "The rest is heat"])] },
    });
    const ids = deck.slides.map((s) => s.id);
    expect(ids).toEqual(STANDARD_DECK.slides.flatMap((s) => (s.id === "s04" ? ["s04a", "s04b"] : [s.id])));
    expect(slide(deck, "s04a")).toEqual({ id: "s04a", type: "bullets", ...half("Light in", ["Photons carry energy", "Colour sets the energy"]) });
    expect(slide(deck, "s04b").type).toBe("bullets");
  });

  it("split onto an existing id → duplicate-id", () => {
    const deck: DeckSpec = { ...STANDARD_DECK, slides: [...STANDARD_DECK.slides, { ...slide(STANDARD_DECK, "s05"), id: "s04b" }] };
    const result = applyPatches(deck, [{ slideId: "s04", op: "splitSlide", payload: { halves: [half("a", ["x"]), half("b", ["y"])] } }], rules);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toEqual([expect.objectContaining({ code: "duplicate-id", message: expect.stringContaining("s04b") })]);
  });

  it("split needs exactly two halves", () => {
    const issues = issuesOf({ slideId: "s04", op: "splitSlide", payload: { halves: [half("a", ["x"])] } });
    expect(issues.map((i) => i.code)).toEqual(["patch-shape"]);
  });

  it("swapLayout changes the type when the new type accepts the body", () => {
    const deck = applied({ slideId: "s04", op: "swapLayout", payload: { type: "summary" } });
    expect(slide(deck, "s04")).toEqual({ ...slide(STANDARD_DECK, "s04"), type: "summary" });
  });

  it("swap rejecting body", () => {
    const issues = issuesOf({ slideId: "s04", op: "swapLayout", payload: { type: "stat" } });
    expect(issues).toEqual([
      expect.objectContaining({ path: "patches[0].payload.type", code: "block-not-accepted", message: expect.stringMatching(/Bullets.*"stat" takes Stat/) }),
    ]);
  });

  it("swapLayout to Paragraph-region types follows acceptedBlocks", () => {
    // `section` accepts no blocks but has a subtitle region, so it takes a Paragraph (not on the cover type).
    expect(slide(applied({ slideId: "s05", op: "swapLayout", payload: { type: "section" } }), "s05").type).toBe("section");
    expect(issuesOf({ slideId: "s05", op: "swapLayout", payload: { type: rules.coverTypes[0]! } }).map((i) => i.code)).toEqual(["block-not-accepted"]);
  });

  it("swapLayout to an unknown type → unknown-slide-type", () => {
    expect(issuesOf({ slideId: "s04", op: "swapLayout", payload: { type: "poster" } }).map((i) => i.code)).toEqual(["unknown-slide-type"]);
  });

  it("dropBlock removes the block", () => {
    const deck = applied({ slideId: "s06", op: "dropBlock", payload: { blockIndex: 2 } });
    expect(slide(deck, "s06").body).toEqual(slide(STANDARD_DECK, "s06").body.slice(0, 2));
  });

  it("dropBlock out of range", () => {
    for (const blockIndex of [3, -1]) {
      const issues = issuesOf({ slideId: "s06", op: "dropBlock", payload: { blockIndex } });
      expect(issues).toEqual([
        expect.objectContaining({ path: "patches[0].payload.blockIndex", code: "patch-shape", message: expect.stringContaining("3 blocks") }),
      ]);
    }
  });

  it("split-away id → unknown-slide", () => {
    const issues = issuesOf(
      { slideId: "s04", op: "splitSlide", payload: { halves: [half("a", ["x"]), half("b", ["y"])] } },
      { slideId: "s04", op: "dropBlock", payload: { blockIndex: 0 } },
    );
    expect(issues).toEqual([
      expect.objectContaining({ path: "patches[1].slideId", code: "unknown-slide", message: expect.stringContaining("split it into s04a and s04b") }),
    ]);
    expect(issuesOf({ slideId: "s99", op: "dropBlock", payload: { blockIndex: 0 } }).map((i) => i.code)).toEqual(["unknown-slide"]);
  });

  it("patches apply in order; later patches see earlier results", () => {
    const deck = applied(
      { slideId: "s04", op: "splitSlide", payload: { halves: [half("a", ["x", "y"]), half("b", ["z"])] } },
      { slideId: "s04a", op: "shortenText", payload: { title: null, body: [{ type: "Bullets", items: ["x"] }] } },
    );
    expect(slide(deck, "s04a").body).toEqual([{ type: "Bullets", items: ["x"] }]);
  });

  it("a malformed payload → patch-shape", () => {
    expect(issuesOf({ slideId: "s06", op: "dropBlock", payload: { blockIndex: "2" } }).map((i) => i.code)).toEqual(["patch-shape"]);
  });

  it("is pure: the input deck is untouched", () => {
    const before = structuredClone(STANDARD_DECK);
    applied({ slideId: "s06", op: "dropBlock", payload: { blockIndex: 0 } }, { slideId: "s04", op: "swapLayout", payload: { type: "summary" } });
    expect(STANDARD_DECK).toEqual(before);
  });
});
