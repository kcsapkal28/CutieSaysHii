import { BlockSchema, type DeckSpec, type Patch, type Slide } from "@deckforge/schemas";
import { z } from "zod";
import { issuePath, type Issue } from "../kernel/issues.ts";
import { acceptedBlocks, type DeckRules } from "../validate/rules.ts";
import { visibleWords } from "../validate/words.ts";

type Op = Patch["op"];

const SlideHalfSchema = z.object({
  title: z.string(),
  body: z.array(BlockSchema),
  notes: z.string(),
  emphasisTargets: z.array(z.string()),
});

/**
 * The payload each op carries. The patch wire schema is built from these, so the domain and the
 * tool agree. A split's two halves are one array: two separate Slide fields would overrun the
 * strict-mode union budget.
 */
export const PatchPayloadSchemas = {
  shortenText: z.object({ title: z.string().nullable(), body: z.array(BlockSchema) }),
  splitSlide: z.object({ halves: z.array(SlideHalfSchema).length(2) }),
  swapLayout: z.object({ type: z.string() }),
  dropBlock: z.object({ blockIndex: z.number().int() }),
} satisfies Record<Op, z.AnyZodObject>;

type Payload<O extends Op> = z.infer<(typeof PatchPayloadSchemas)[O]>;
type Path = (string | number)[];
type Problem = { path: Path; code: string; message: string };
type Step = { slides: Slide[] } | Problem;
type OpContext = { deck: DeckSpec; slides: readonly Slide[]; rules: DeckRules };

export type ApplyResult = { ok: true; deck: DeckSpec } | { ok: false; issues: Issue[] };

const typesOf = (body: readonly { type: string }[]) => body.map((b) => b.type).join(", ");
const isCover = (rules: DeckRules, type: string) => rules.coverTypes.includes(type);
const words = (x: OpContext, slide: Slide) => visibleWords(slide, isCover(x.rules, slide.type) ? x.deck : undefined);

const OPS: { [O in Op]: (slide: Slide, p: Payload<O>, x: OpContext) => Step } = {
  shortenText(slide, { title, body }, x) {
    const same = body.length === slide.body.length && body.every((b, i) => b.type === slide.body[i]!.type);
    if (!same)
      return {
        path: ["payload", "body"],
        code: "patch-shape",
        message: `shortenText on slide ${slide.id} must keep its block types in order (${typesOf(slide.body)}); got (${typesOf(body)})`,
      };
    const next: Slide = { ...slide, body, ...(title === null ? {} : { title }) };
    const before = words(x, slide);
    const after = words(x, next);
    if (after >= before)
      return {
        path: ["payload"],
        code: "patch-not-shorter",
        message: `shortenText on slide ${slide.id} must show fewer words: it had ${before} visible words and would have ${after}`,
      };
    return { slides: [next] };
  },

  splitSlide(slide, { halves }, x) {
    const ids = [`${slide.id}a`, `${slide.id}b`];
    const taken = ids.find((id) => x.slides.some((s) => s.id === id));
    if (taken)
      return { path: ["slideId"], code: "duplicate-id", message: `splitSlide on slide ${slide.id} would create ${taken}, which is already in the deck` };
    return { slides: halves.map((h, i) => ({ id: ids[i]!, type: slide.type, ...h })) };
  },

  swapLayout(slide, { type }, x) {
    const def = x.rules.types.get(type);
    if (!def)
      return {
        path: ["payload", "type"],
        code: "unknown-slide-type",
        message: `swapLayout on slide ${slide.id} names unknown type "${type}"; use one of: ${[...x.rules.types.keys()].join(", ")}`,
      };
    const accepted = acceptedBlocks(def, isCover(x.rules, type));
    const rejected = [...new Set(slide.body.map((b) => b.type).filter((t) => !accepted.includes(t)))];
    if (rejected.length > 0) {
      const takes = accepted.length > 0 ? `"${type}" takes ${accepted.join(", ")}` : `"${type}" takes no body blocks`;
      return {
        path: ["payload", "type"],
        code: "block-not-accepted",
        message: `swapLayout on slide ${slide.id} cannot keep its ${rejected.join(", ")} block(s); ${takes}`,
      };
    }
    return { slides: [{ ...slide, type }] };
  },

  dropBlock(slide, { blockIndex }) {
    if (blockIndex < 0 || blockIndex >= slide.body.length)
      return {
        path: ["payload", "blockIndex"],
        code: "patch-shape",
        message: `dropBlock on slide ${slide.id}: block ${blockIndex} does not exist; the slide has ${slide.body.length} blocks (0-based)`,
      };
    return { slides: [{ ...slide, body: slide.body.filter((_, i) => i !== blockIndex) }] };
  },
};

function runOp<O extends Op>(op: O, slide: Slide, payload: unknown, x: OpContext): Step {
  const parsed = PatchPayloadSchemas[op].safeParse(payload);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      path: ["payload", ...(first?.path ?? [])],
      code: "patch-shape",
      message: `${op} on slide ${slide.id} has a malformed payload: ${parsed.error.issues.map((i) => `${issuePath(i.path) || "(payload)"}: ${i.message}`).join("; ")}`,
    };
  }
  return OPS[op](slide, parsed.data as Payload<O>, x);
}

/**
 * Applies the patches in order; each sees the deck the earlier ones produced. A patch that fails is
 * skipped and reported, and any issue fails the whole set. Pure: the input deck is never mutated.
 */
export function applyPatches(deck: DeckSpec, patches: readonly Patch[], rules: DeckRules): ApplyResult {
  const issues: Issue[] = [];
  const splitInto = new Map<string, string[]>();
  const slides = patches.reduce<Slide[]>((current, patch, i) => {
    const at = (path: Path) => issuePath(["patches", i, ...path]);
    const index = current.findIndex((s) => s.id === patch.slideId);
    if (index < 0) {
      const split = splitInto.get(patch.slideId);
      const why = split ? `; an earlier patch split it into ${split.join(" and ")}` : "";
      issues.push({ path: at(["slideId"]), code: "unknown-slide", message: `patch names slide "${patch.slideId}", which is not in the deck${why}` });
      return current;
    }
    const step = runOp(patch.op, current[index]!, patch.payload, { deck, slides: current, rules });
    if (!("slides" in step)) {
      issues.push({ path: at(step.path), code: step.code, message: step.message });
      return current;
    }
    if (patch.op === "splitSlide") splitInto.set(patch.slideId, step.slides.map((s) => s.id));
    return [...current.slice(0, index), ...step.slides, ...current.slice(index + 1)];
  }, [...deck.slides]);

  return issues.length > 0 ? { ok: false, issues } : { ok: true, deck: { ...deck, slides } };
}
