import type { Catalog } from "@deckforge/catalog";
import type { Block, DeckSpec, Slide } from "@deckforge/schemas";
import { issuePath, type Issue } from "../kernel/issues.ts";
import type { DeckRules } from "./rules.ts";
import { countWords, emphasisTexts, visibleWords } from "./words.ts";

type Path = (string | number)[];
type Measurement = { path: Path; value: number; noun: string };
/** `cover`: the renderer draws this slide as the deck cover (deck title/subtitle, slide.title as meta, no body). */
type MeasureInput = { deck: DeckSpec; slide: Slide; index: number; cover: boolean };
type Measure = (x: MeasureInput) => Measurement[];
type BlockOf<T extends Block["type"]> = Extract<Block, { type: T }>;

// Off the cover, a Paragraph renders into one of these regions when the body doesn't take it.
const PARAGRAPH_REGIONS = ["subtitle", "aside", "caption"];
const PARAGRAPH: Block["type"] = "Paragraph";

function blocksOf<T extends Block["type"]>(slide: Slide, type: T): { block: BlockOf<T>; at: number }[] {
  return slide.body.flatMap((block, at) => (block.type === type ? [{ block: block as BlockOf<T>, at }] : []));
}

const wordsIn = (slide: Slide, ...types: ("Paragraph" | "Quote")[]): number =>
  types.reduce((sum, t) => sum + blocksOf(slide, t).reduce((s, { block }) => s + countWords(block.text), 0), 0);

// One measurement per block of `type`; a slide without one measures 0, so minimums still apply.
function perBlock<T extends Block["type"]>(type: T, field: string, noun: string, count: (b: BlockOf<T>) => number): Measure {
  return ({ slide, index }) => {
    const found = blocksOf(slide, type);
    if (found.length === 0) return [{ path: ["slides", index, "body"], value: 0, noun }];
    return found.map(({ block, at }) => ({ path: ["slides", index, "body", at, field], value: count(block), noun }));
  };
}

const codeLines = (code: string) => code.split("\n");

const MEASURES: Record<string, Measure> = {
  titleWords: ({ deck, slide, index, cover }) => [
    cover
      ? { path: ["title"], value: countWords(deck.title), noun: "title words" }
      : { path: ["slides", index, "title"], value: countWords(slide.title ?? ""), noun: "title words" },
  ],
  subtitleWords: ({ deck, cover }) => (cover ? [{ path: ["subtitle"], value: countWords(deck.subtitle), noun: "subtitle words" }] : []),
  items: perBlock("Bullets", "items", "bullet items", (b) => b.items.length),
  wordsPerItem: ({ slide, index }) =>
    blocksOf(slide, "Bullets").flatMap(({ block, at }) =>
      block.items.map((item, j) => ({
        path: ["slides", index, "body", at, "items", j],
        value: countWords(item),
        noun: `words in bullet ${j + 1}`,
      })),
    ),
  words: ({ slide, index }) => [{ path: ["slides", index, "body"], value: wordsIn(slide, "Paragraph", "Quote"), noun: "body words" }],
  stats: ({ slide, index }) => [{ path: ["slides", index, "body"], value: blocksOf(slide, "Stat").length, noun: "Stat blocks" }],
  steps: perBlock("Timeline", "steps", "timeline steps", (b) => b.steps.length),
  options: perBlock("Quiz", "options", "quiz options", (b) => b.options.length),
  rows: perBlock("Compare", "rows", "compare rows", (b) => b.rows.length),
  series: perBlock("Chart", "series", "chart series", (b) => b.series.length),
  points: perBlock("Chart", "labels", "chart points", (b) => b.labels.length),
  lines: perBlock("Code", "code", "code lines", (b) => codeLines(b.code).length),
  cols: perBlock("Code", "code", "characters in the longest code line", (b) => Math.max(...codeLines(b.code).map((l) => l.length))),
  // The caption is the Paragraph text, or the image alt when there is none.
  captionWords: ({ slide, index }) => {
    const alt = blocksOf(slide, "Image").reduce((sum, { block }) => sum + countWords(block.alt), 0);
    const value = blocksOf(slide, "Paragraph").length > 0 ? wordsIn(slide, "Paragraph") : alt;
    return [{ path: ["slides", index, "body"], value, noun: "caption words" }];
  },
};

export const MEASURED_LIMITS: readonly string[] = Object.keys(MEASURES);
/** Limits QA checks on the rendered slide; the deck JSON can't measure them reliably. */
export const UNMEASURED_LIMITS: readonly string[] = ["nodes", "columns"];

type Limit = number | [number, number];
const within = (value: number, limit: Limit) =>
  typeof limit === "number" ? value <= limit : value >= limit[0] && value <= limit[1];
const describeLimit = (limit: Limit) => (typeof limit === "number" ? `at most ${limit}` : `${limit[0]}–${limit[1]}`);
const range = ([min, max]: [number, number]) => `${min}–${max}`;

export function validateDeck(_c: Catalog, rules: DeckRules, deck: DeckSpec): Issue[] {
  const issues: Issue[] = [];
  const add = (path: Path, code: string, message: string) => issues.push({ path: issuePath(path), code, message });
  const slides = deck.slides;
  const n = slides.length;
  const typeName = (id: string) => `"${id}" (${rules.types.get(id)?.name ?? id})`;

  if (n < rules.slides[0] || n > rules.slides[1])
    add(["slides"], "slide-count", `deck has ${n} slides; ${rules.depth} needs ${range(rules.slides)}`);

  const firstOfType = (id: string) => slides.findIndex((s) => s.type === id);
  const lastOfType = (id: string) => slides.map((s) => s.type).lastIndexOf(id);

  if (rules.firstType && slides[0] && slides[0].type !== rules.firstType)
    add(["slides", 0, "type"], "first-slide", `the first slide must be ${typeName(rules.firstType)}; got "${slides[0].type}"`);
  if (rules.lastType && n > 0 && slides[n - 1]!.type !== rules.lastType)
    add(["slides", n - 1, "type"], "last-slide", `the last slide must be ${typeName(rules.lastType)}; got "${slides[n - 1]!.type}"`);
  slides.forEach((s, i) => {
    if (rules.firstType && s.type === rules.firstType && i > firstOfType(s.type))
      add(["slides", i, "type"], "first-slide", `slide ${s.id} is a second ${typeName(s.type)} slide; it belongs only at the start of the deck`);
    if (rules.lastType && s.type === rules.lastType && i < lastOfType(s.type))
      add(["slides", i, "type"], "last-slide", `slide ${s.id} is a second ${typeName(s.type)} slide; it belongs only at the end of the deck`);
  });
  const closing = rules.penultimateOrLastType;
  if (closing && n > 0 && slides.slice(-2).every((s) => s.type !== closing))
    add(["slides", Math.max(0, n - 2), "type"], "penultimate-slide", `${typeName(closing)} must be the penultimate or last slide`);

  const present = new Set(slides.map((s) => s.type));
  for (const id of rules.requiredTypes)
    if (!present.has(id)) {
      const where = rules.firstType ? `right after the "${rules.firstType}" slide` : "near the start";
      add(["slides"], "required-slide", `deck needs a ${typeName(id)} slide at ${rules.depth} depth; it belongs ${where}`);
    }

  const isQuiz = (s: Slide) => rules.quizTypes.includes(s.type) && !rules.modeOnlyTypes.includes(s.type);
  const quizzes = slides.filter(isQuiz).length;
  if (quizzes !== rules.quizCount)
    add(["slides"], "quiz-count", `deck has ${quizzes} quiz slides; needs ${rules.quizCount}`);

  slides.forEach((slide, index) => {
    const at = (...rest: Path): Path => ["slides", index, ...rest];
    const label = `slide ${slide.id} (${slide.type})`;
    const type = rules.types.get(slide.type);
    const cover = rules.coverTypes.includes(slide.type);

    if (!type) {
      const usable = [...rules.types.keys()].filter((id) => !rules.modeOnlyTypes.includes(id));
      add(at("type"), "unknown-slide-type", `slide ${slide.id} has unknown type "${slide.type}"; use one of: ${usable.join(", ")}`);
    } else if (rules.modeOnlyTypes.includes(type.id)) {
      add(at("type"), "slide-type-not-in-mode", `slide ${slide.id} is "${type.id}", which is only available in ${type.onlyIn?.join("/")} mode; use another slide type`);
    }
    if (index > 0 && isQuiz(slide) && isQuiz(slides[index - 1]!))
      add(at("type"), "quiz-adjacent", `quiz slides ${slides[index - 1]!.id} and ${slide.id} are adjacent; put a content slide between them`);

    if (type) {
      const accepted = new Set(type.accepts);
      if (!cover && type.regions.some((r) => PARAGRAPH_REGIONS.includes(r))) accepted.add(PARAGRAPH);
      slide.body.forEach((block, b) => {
        if (!accepted.has(block.type)) {
          const takes = accepted.size > 0 ? `it takes ${[...accepted].join(", ")}` : "it takes no body blocks";
          add(at("body", b, "type"), "block-not-accepted", `${label} cannot hold a ${block.type} block; ${takes}`);
        }
      });

      for (const [key, limit] of Object.entries(type.limits ?? {})) {
        const measure = MEASURES[key];
        if (!measure) continue;
        for (const m of measure({ deck, slide, index, cover }))
          if (!within(m.value, limit)) add(m.path, "limit", `${label} has ${m.value} ${m.noun}; allowed ${describeLimit(limit)}`);
      }
    }

    const shown = visibleWords(slide, cover ? deck : undefined);
    if (shown > rules.wordsPerSlideMax)
      add(at(), "words-per-slide", `slide ${slide.id} has ${shown} visible words; limit ${rules.wordsPerSlideMax}`);

    if (index > 0) {
      const notes = countWords(slide.notes);
      if (notes < rules.notesWords[0] || notes > rules.notesWords[1])
        add(at("notes"), "notes-length", `slide ${slide.id} notes have ${notes} words; need ${range(rules.notesWords)} at ${rules.depth} depth`);
    }

    // Mirrors the renderer's emphasize(): case-insensitive, within one emphasised field; nothing on the cover.
    const marked = cover ? [] : emphasisTexts(slide).map((t) => t.toLowerCase());
    slide.emphasisTargets.forEach((target, j) => {
      const needle = target.toLowerCase();
      if (!needle || !marked.some((t) => t.includes(needle)))
        add(at("emphasisTargets", j), "emphasis-missing",
          `slide ${slide.id} emphasis target "${target}" is not in any text the slide emphasises (body text; not titles, chart labels or the cover)`);
    });
  });

  return issues;
}
