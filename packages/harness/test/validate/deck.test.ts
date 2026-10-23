import type { Catalog } from "@deckforge/catalog";
import type { DeckSpec, Slide } from "@deckforge/schemas";
import { beforeAll, describe, expect, it } from "vitest";
import type { ContentChoices } from "../../src/kernel/contracts.ts";
import type { Issue } from "../../src/kernel/issues.ts";
import { MEASURED_LIMITS, UNMEASURED_LIMITS, validateDeck } from "../../src/validate/deck.ts";
import { deckRules, evalRequiredWhen } from "../../src/validate/rules.ts";
import { testCatalog } from "../helpers/context.ts";
import { STANDARD_DECK as FIXTURE } from "./fixtures.ts";

const LINEAR: ContentChoices = { depth: "standard", styleFamilyId: "minimal", interactionModeId: "linear" };
const ASSESSMENT = (questionCount: number): ContentChoices => ({
  depth: "standard",
  styleFamilyId: "minimal",
  interactionModeId: "assessment",
  questionCount,
});

let c: Catalog;
beforeAll(async () => {
  c = await testCatalog();
});

const deck = (edit?: (d: DeckSpec) => void): DeckSpec => {
  const d = structuredClone(FIXTURE);
  edit?.(d);
  return d;
};
const slideById = (d: DeckSpec, id: string): Slide => {
  const s = d.slides.find((x) => x.id === id);
  if (!s) throw new Error(`no slide ${id}`);
  return s;
};
const words = (n: number, word = "word") => Array.from({ length: n }, () => word).join(" ");
const quiz = (id: string): Slide => ({
  id,
  type: "quiz",
  title: "Quick check",
  body: [{ type: "Quiz", question: "Which layer?", options: ["n-type", "p-type", "metal"], answerIndex: 0, explanation: "n" }],
  notes: words(70),
  emphasisTargets: [],
});

const run = (d: DeckSpec, choices: ContentChoices = LINEAR): Issue[] => validateDeck(c, deckRules(c, choices), d);
const codes = (issues: Issue[]) => issues.map((i) => i.code);
const withCode = (issues: Issue[], code: string) => issues.filter((i) => i.code === code);

describe("deckRules", () => {
  it("standard linear rules come from the catalog", () => {
    const r = deckRules(c, LINEAR);
    expect(r.slides).toEqual([10, 14]);
    expect(r.wordsPerSlideMax).toBe(35);
    expect(r.notesWords).toEqual([60, 120]);
    expect([r.firstType, r.penultimateOrLastType, r.lastType]).toEqual(["title", "summary", "qa"]);
    expect(r.requiredTypes).toEqual(["agenda"]);
    expect(r.coverTypes).toEqual(["title"]);
    expect(r.modeOnlyTypes).toEqual(["quiz"]);
    expect(r.quizTypes).toEqual(["quiz"]);
    expect(r.quizCount).toBe(0);
    expect(r.types.get("bullets")?.name).toBe("Bullets");
  });

  it("assessment allows quiz slides and takes the question count", () => {
    const r = deckRules(c, ASSESSMENT(4));
    expect(r.modeOnlyTypes).toEqual([]);
    expect(r.quizCount).toBe(4);
  });

  it("evalRequiredWhen rejects \"audience == x\"", () => {
    expect(() => evalRequiredWhen("audience == x", LINEAR)).toThrow(/audience == x/);
  });

  it("evalRequiredWhen evaluates == and !=", () => {
    expect(evalRequiredWhen("depth != overview", LINEAR)).toBe(true);
    expect(evalRequiredWhen("depth == overview", LINEAR)).toBe(false);
    expect(evalRequiredWhen("depth==standard", LINEAR)).toBe(true);
  });
});

describe("validateDeck", () => {
  it("fixture has no issues", () => {
    expect(run(FIXTURE)).toEqual([]);
  });

  it("9 slides → slide-count", () => {
    const d = deck((x) => (x.slides = x.slides.filter((s) => !["s05", "s07", "s08"].includes(s.id))));
    const issues = withCode(run(d), "slide-count");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("has 9 slides; standard needs 10–14");
  });

  it("unknown slide type", () => {
    const d = deck((x) => (slideById(x, "s05").type = "hero"));
    expect(withCode(run(d), "unknown-slide-type")).toEqual([
      { path: "slides[3].type", code: "unknown-slide-type", message: expect.stringContaining('"hero"') },
    ]);
  });

  it("unknown-slide-type hint omits types the mode disallows", () => {
    const d = deck((x) => (slideById(x, "s05").type = "hero"));
    const [issue] = withCode(run(d), "unknown-slide-type");
    expect(issue?.message).toContain("bullets");
    expect(issue?.message).not.toMatch(/\bquiz\b/);
    const [assessment] = withCode(run(d, ASSESSMENT(2)), "unknown-slide-type");
    expect(assessment?.message).toMatch(/\bquiz\b/);
  });

  it("a second title slide mid-deck → first-slide", () => {
    const d = deck((x) => x.slides.splice(5, 0, { ...structuredClone(x.slides[0]!), id: "t2", notes: words(70) }));
    expect(withCode(run(d), "first-slide")).toEqual([
      { path: "slides[5].type", code: "first-slide", message: expect.stringMatching(/t2.*"title"/) },
    ]);
  });

  it("a second qa slide mid-deck → last-slide", () => {
    const d = deck((x) => x.slides.splice(5, 0, { ...structuredClone(x.slides[11]!), id: "q2" }));
    expect(withCode(run(d), "last-slide")).toEqual([
      { path: "slides[5].type", code: "last-slide", message: expect.stringMatching(/q2.*"qa"/) },
    ]);
  });

  it("first slide must be the required-first type", () => {
    const d = deck((x) => ([x.slides[0], x.slides[1]] = [x.slides[1]!, x.slides[0]!]));
    const issues = withCode(run(d), "first-slide");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("slides[0].type");
    expect(issues[0]?.message).toContain('"title"');
  });

  it("last slide must be the required-last type", () => {
    const d = deck((x) => x.slides.pop());
    expect(codes(run(d))).toEqual(["last-slide"]);
  });

  it("penultimate-or-last type must close the deck", () => {
    const d = deck((x) => {
      const [summary] = x.slides.splice(10, 1);
      x.slides.splice(3, 0, summary!);
    });
    expect(codes(run(d))).toEqual(["penultimate-slide"]);
  });

  it("standard without agenda → required-slide", () => {
    const d = deck((x) => (x.slides = x.slides.filter((s) => s.type !== "agenda")));
    const issues = withCode(run(d), "required-slide");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('"agenda"');
    expect(issues[0]?.message).toMatch(/right after the "title" slide/);
  });

  it("overview without agenda → none", () => {
    const d = deck((x) => (x.slides = x.slides.filter((s) => s.type !== "agenda")));
    expect(codes(run(d, { ...LINEAR, depth: "overview" }))).not.toContain("required-slide");
  });

  it("quiz in linear → slide-type-not-in-mode", () => {
    const d = deck((x) => x.slides.splice(5, 0, quiz("q1")));
    const issues = run(d);
    expect(codes(issues)).toEqual(["slide-type-not-in-mode"]);
    expect(issues[0]?.message).toContain("assessment");
  });

  it("assessment questionCount 4 with 3 quizzes → quiz-count", () => {
    const d = deck((x) => {
      x.slides.splice(8, 0, quiz("q3"));
      x.slides.splice(6, 0, quiz("q2"));
      x.slides.splice(4, 0, quiz("q1"));
      x.slides = x.slides.filter((s) => !["s05", "s07"].includes(s.id));
    });
    const issues = run(d, ASSESSMENT(4));
    expect(codes(issues)).toEqual(["quiz-count"]);
    expect(issues[0]?.message).toContain("has 3 quiz slides; needs 4");
  });

  it("adjacent quizzes", () => {
    const d = deck((x) => x.slides.splice(4, 0, quiz("q1"), quiz("q2")));
    const issues = run(d, ASSESSMENT(2));
    expect(codes(issues)).toEqual(["quiz-adjacent"]);
    expect(issues[0]?.path).toBe("slides[5].type");
    expect(issues[0]?.message).toContain("q2");
  });

  it("Bullets on stat → block-not-accepted", () => {
    const d = deck((x) => slideById(x, "s06").body.push({ type: "Bullets", items: ["a"] }));
    expect(withCode(run(d), "block-not-accepted")).toEqual([
      { path: "slides[4].body[3].type", code: "block-not-accepted", message: expect.stringContaining("Bullets") },
    ]);
  });

  it("Paragraph on section accepted", () => {
    const d = deck((x) =>
      x.slides.splice(2, 0, {
        id: "sec",
        type: "section",
        title: "From sunlight to current",
        body: [{ type: "Paragraph", text: "Four ideas take a photon to a circuit." }],
        notes: words(70),
        emphasisTargets: [],
      }),
    );
    expect(run(d)).toEqual([]);
  });

  it("6 bullets → limit", () => {
    const d = deck((x) => (slideById(x, "s04").body = [{ type: "Bullets", items: ["a", "b", "c", "d", "e", "f"] }]));
    const issues = withCode(run(d), "limit");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("slides[2].body[0].items");
    expect(issues[0]?.message).toMatch(/s04.*6 bullet items.*2–5/);
  });

  it("13-word bullet → limit", () => {
    const d = deck((x) => (slideById(x, "s04").body = [{ type: "Bullets", items: ["short", words(13)] }]));
    const issues = withCode(run(d), "limit");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("slides[2].body[0].items[1]");
    expect(issues[0]?.message).toMatch(/13 words.*at most 12/);
  });

  it("9-word deck title on the cover → limit", () => {
    const d = deck((x) => (x.title = words(9)));
    const issues = withCode(run(d), "limit");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("title");
    expect(issues[0]?.message).toMatch(/9 title words.*at most 8/);
  });

  it("image alt is measured as the caption when there is no Paragraph", () => {
    const image = (body: Slide["body"]): Slide => ({ id: "img", type: "image", body, notes: words(70), emphasisTargets: [] });
    const alt = { type: "Image", prompt: "cross-section of a cell", alt: words(16) } as const;
    const bare = deck((x) => x.slides.splice(5, 0, image([alt])));
    expect(run(bare)).toEqual([
      { path: "slides[5].body", code: "limit", message: expect.stringMatching(/16 caption words.*at most 15/) },
    ]);
    const captioned = deck((x) => x.slides.splice(5, 0, image([alt, { type: "Paragraph", text: "Two layers meet." }])));
    expect(run(captioned)).toEqual([]);
  });

  it("the cover's slide.title is its meta line, not its title", () => {
    const d = deck((x) => (x.slides[0]!.title = words(9)));
    expect(run(d)).toEqual([]);
  });

  it("Paragraph on title → block-not-accepted", () => {
    const d = deck((x) => x.slides[0]!.body.push({ type: "Paragraph", text: "A subtitle that never renders." }));
    expect(run(d)).toEqual([
      { path: "slides[0].body[0].type", code: "block-not-accepted", message: expect.stringContaining("Paragraph") },
    ]);
  });

  it("cover words = deck title + deck subtitle + slide title", () => {
    // 8 + 14 + 14 = 36 > 35; the body Paragraph and a meta line equal to the deck title don't count.
    const over = deck((x) => {
      x.title = words(8);
      x.subtitle = words(14);
      x.slides[0]!.title = words(14, "meta");
    });
    expect(codes(run(over))).toEqual(["words-per-slide"]);
    expect(run(over)[0]?.message).toMatch(/s01.*36 visible words/);
    const sameMeta = deck((x) => {
      x.title = words(8);
      x.subtitle = words(14);
      x.slides[0]!.title = x.title;
    });
    expect(run(sameMeta)).toEqual([]);
  });

  it("deck subtitle is measured on the first-type slide", () => {
    const d = deck((x) => (x.subtitle = words(15)));
    const issues = withCode(run(d), "limit");
    expect(issues).toEqual([{ path: "subtitle", code: "limit", message: expect.stringMatching(/15 subtitle words/) }]);
  });

  it("too few items is a limit too", () => {
    const d = deck((x) => (slideById(x, "s02").body = [{ type: "Bullets", items: ["a", "b"] }]));
    expect(withCode(run(d), "limit")[0]?.message).toMatch(/2 bullet items.*3–6/);
  });

  it("words-per-slide", () => {
    const d = deck((x) => (slideById(x, "s04").body = [{ type: "Bullets", items: [1, 2, 3, 4, 5].map(() => words(8)) }]));
    const issues = run(d);
    expect(codes(issues)).toEqual(["words-per-slide"]);
    expect(issues[0]?.message).toMatch(/s04.*45 visible words.*35/);
  });

  it("59-word notes on slide 2 → notes-length", () => {
    const d = deck((x) => (x.slides[1]!.notes = words(59)));
    expect(run(d)).toEqual([
      { path: "slides[1].notes", code: "notes-length", message: expect.stringMatching(/s02.*59 words.*60–120/) },
    ]);
  });

  it("names every short slide", () => {
    const d = deck((x) => {
      x.slides[3]!.notes = words(10);
      x.slides[7]!.notes = words(130);
    });
    const messages = withCode(run(d), "notes-length").map((i) => i.message);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatch(/s05.*10 words.*60–120/);
    expect(messages[1]).toMatch(/s09.*130 words.*60–120/);
  });

  it("slide 1 notes unchecked", () => {
    const d = deck((x) => (x.slides[0]!.notes = "Welcome."));
    expect(run(d)).toEqual([]);
  });

  it("emphasis-missing", () => {
    const d = deck((x) => slideById(x, "s06").emphasisTargets.push("99%"));
    expect(run(d)).toEqual([
      { path: "slides[4].emphasisTargets[2]", code: "emphasis-missing", message: expect.stringContaining('"99%"') },
    ]);
  });

  it("emphasis: a target only in the slide title is flagged", () => {
    const d = deck((x) => slideById(x, "s04").emphasisTargets.push("in brief"));
    expect(codes(run(d))).toEqual(["emphasis-missing"]);
  });

  it("emphasis: chart labels and series names are not emphasised", () => {
    const d = deck((x) => slideById(x, "s09").emphasisTargets.push("2015", "Installed capacity"));
    expect(codes(run(d))).toEqual(["emphasis-missing", "emphasis-missing"]);
  });

  it("emphasis: nothing on the cover is emphasised", () => {
    const d = deck((x) => x.slides[0]!.emphasisTargets.push("solar"));
    expect(codes(run(d))).toEqual(["emphasis-missing"]);
  });

  it('emphasis matches case-insensitively ("Silicon" vs "silicon")', () => {
    const d = deck((x) => slideById(x, "s10").emphasisTargets.push("Silicon", "THIN FILM"));
    expect(run(d)).toEqual([]);
  });

  it("emphasis: a target only in a quiz explanation passes", () => {
    const d = deck((x) => {
      const q = quiz("q1");
      q.emphasisTargets = ["doped with phosphorus"];
      q.body = [{ type: "Quiz", question: "Which layer?", options: ["n", "p", "metal"], answerIndex: 0, explanation: "It is doped with phosphorus." }];
      x.slides.splice(5, 0, q);
    });
    expect(withCode(run(d), "emphasis-missing")).toEqual([]);
  });

  it("every catalog limit key measured or unmeasured", () => {
    const known = new Set<string>([...MEASURED_LIMITS, ...UNMEASURED_LIMITS]);
    const keys = c.slideTypes.types.flatMap((t) => Object.keys(t.limits ?? {}));
    expect(keys.filter((k) => !known.has(k))).toEqual([]);
  });
});
