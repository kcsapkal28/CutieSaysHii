import { getInteractionMode, slideCountRange, wordsPerSlideMax, type Catalog } from "@deckforge/catalog";
import type { Block, Depth, SlideType } from "@deckforge/schemas";
import type { ContentChoices } from "../kernel/contracts.ts";
import { InternalError } from "../kernel/errors.ts";

export type DeckRules = {
  depth: Depth;
  slides: [number, number];
  wordsPerSlideMax: number;
  notesWords: [number, number];
  firstType: string | undefined;
  lastType: string | undefined;
  penultimateOrLastType: string | undefined;
  /** Types the renderer draws as the deck cover (they have a meta region). */
  coverTypes: string[];
  /** Types whose `requiredWhen` holds for these choices. */
  requiredTypes: string[];
  /** Types restricted (`onlyIn`) to modes other than the chosen one. */
  modeOnlyTypes: string[];
  /** Types whose body takes a Quiz block. */
  quizTypes: string[];
  quizCount: number;
  types: ReadonlyMap<string, SlideType>;
};

const QUIZ_BLOCK: Block["type"] = "Quiz";
const COVER_REGION = "meta";
const REQUIRED_WHEN = /^depth\s*(==|!=)\s*([\w-]+)$/;

export function evalRequiredWhen(expr: string, choices: Pick<ContentChoices, "depth">): boolean {
  const m = REQUIRED_WHEN.exec(expr.trim());
  if (!m) throw new InternalError(`unsupported requiredWhen "${expr}": expected "depth == <id>" or "depth != <id>"`);
  return m[1] === "==" ? choices.depth === m[2] : choices.depth !== m[2];
}

export function deckRules(c: Catalog, choices: ContentChoices): DeckRules {
  const depth = c.slideTypes.depth[choices.depth];
  if (!depth) throw new InternalError(`no depth rule for "${choices.depth}" in slide-types.json`);
  const types = c.slideTypes.types;
  const mode = getInteractionMode(c, choices.interactionModeId);
  const questionCount = mode.options?.questionCount;
  const requiredAt = (where: SlideType["required"]) => types.find((t) => t.required === where)?.id;

  return {
    depth: choices.depth,
    slides: slideCountRange(c, choices.depth),
    wordsPerSlideMax: wordsPerSlideMax(c, choices.depth, choices.styleFamilyId),
    notesWords: depth.notesWordsPerSlide,
    firstType: requiredAt("first"),
    lastType: requiredAt("last"),
    penultimateOrLastType: requiredAt("penultimate-or-last"),
    coverTypes: types.filter((t) => t.regions.includes(COVER_REGION)).map((t) => t.id),
    requiredTypes: types.filter((t) => t.requiredWhen !== undefined && evalRequiredWhen(t.requiredWhen, choices)).map((t) => t.id),
    modeOnlyTypes: types.filter((t) => t.onlyIn !== undefined && !t.onlyIn.includes(mode.id)).map((t) => t.id),
    quizTypes: types.filter((t) => t.accepts.includes(QUIZ_BLOCK)).map((t) => t.id),
    quizCount: questionCount ? (choices.questionCount ?? questionCount.default) : 0,
    types: new Map(types.map((t) => [t.id, t])),
  };
}
