import type { Catalog } from "@deckforge/catalog";
import type { DeckSpec, Patch, QAReport } from "@deckforge/schemas";
import { z } from "zod";
import type { PatchChoices } from "../kernel/contracts.ts";
import { issuePath, zodToIssues, type Issue } from "../kernel/issues.ts";
import type { ToolSpec } from "../kernel/llm-port.ts";
import { applyPatches, PatchPayloadSchemas } from "../patches/apply.ts";
import { failingSlideIds, qaFailures } from "../qa/failures.ts";
import { validateDeck } from "../validate/deck.ts";
import { enumOrString } from "../validate/design-wire.ts";
import { deckRules } from "../validate/rules.ts";
import { assertUnionBudget, compileWireSchema } from "../wire/schema.ts";
import { contentRules } from "./deck-tool.ts";
import type { ParseResult } from "./invoke-tool.ts";
import type { AgentPrompt, AgentRequest } from "./messages.ts";

export const PATCH_EFFORT = "low";
export const PATCH_MAX_TOKENS = 8000;

// Non-strict (spike: the strict grammar counts over 16 union params); assertUnionBudget still bounds it.
const PATCH_TOOL = {
  name: "emit_patches",
  description: "Emit the patches that fix the slides that failed QA, in the order to apply them, in one call.",
  strict: false,
} as const;

export type PatchWireEnums = { slideIds?: readonly string[]; slideTypeIds?: readonly string[] };

export function patchWireSchema(e: PatchWireEnums = {}) {
  const slideId = enumOrString(e.slideIds);
  const p = PatchPayloadSchemas;
  return z.object({
    patches: z.array(
      z.discriminatedUnion("op", [
        z.object({ op: z.literal("shortenText"), slideId, ...p.shortenText.shape }),
        z.object({ op: z.literal("splitSlide"), slideId, ...p.splitSlide.shape }),
        z.object({ op: z.literal("swapLayout"), slideId, type: enumOrString(e.slideTypeIds) }),
        z.object({ op: z.literal("dropBlock"), slideId, ...p.dropBlock.shape }),
      ]),
    ),
  });
}

export type PatchWire = z.infer<ReturnType<typeof patchWireSchema>>;
export type WirePatch = PatchWire["patches"][number];

/** The emit_patches tool for one round: slideId is limited to the failing slides. */
export function patchTool(c: Catalog, failingIds: readonly string[]): { tool: ToolSpec; normalize(raw: unknown): unknown } {
  const wire = compileWireSchema(patchWireSchema({ slideIds: failingIds, slideTypeIds: c.slideTypes.types.map((t) => t.id) }));
  assertUnionBudget([wire]);
  return { tool: { ...PATCH_TOOL, inputSchema: wire.jsonSchema }, normalize: wire.normalize };
}

export function toDomainPatch(w: WirePatch): Patch {
  const { slideId, op, ...payload } = w;
  return { slideId, op, payload };
}

/** What the patch request is built from. */
export type PatchRequestInput = { deck: DeckSpec; report: QAReport; choices: PatchChoices; wordCap: number };
export type PatchRequestOptions = { prompt: AgentPrompt; model: string };

/** Agent C sees the failures and the failing slides only, plus the rules a patched deck must keep. */
export function patchAgentInput(c: Catalog, i: PatchRequestInput) {
  const failures = qaFailures(i.report, i.wordCap);
  const failing = new Set(failures.map((f) => f.slideId));
  return {
    report: { failures },
    slides: i.deck.slides.filter((s) => failing.has(s.id)),
    wordCap: i.wordCap,
    rules: { ...contentRules(c, deckRules(c, i.choices)), slideCount: i.deck.slides.length },
  };
}

export function buildPatchRequest(i: PatchRequestInput, c: Catalog, o: PatchRequestOptions): AgentRequest {
  const { tool, normalize } = patchTool(c, failingSlideIds(i.report, i.wordCap));
  return {
    model: o.model,
    effort: PATCH_EFFORT,
    maxTokens: PATCH_MAX_TOKENS,
    system: o.prompt.text,
    input: patchAgentInput(c, i),
    tool,
    normalize,
  };
}

export type PatchResult = { patches: Patch[]; deck: DeckSpec };

/**
 * Parses an emit_patches reply against the enum-free wire, so a wrong id is explained rather than
 * just failing an enum. The patches then apply, and the patched deck must pass validateDeck.
 */
export function parsePatches(c: Catalog, i: PatchRequestInput): (input: unknown) => ParseResult<PatchResult> {
  const schema = patchWireSchema();
  const rules = deckRules(c, i.choices);
  const failing = failingSlideIds(i.report, i.wordCap);
  return (input) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, issues: zodToIssues(parsed.error) };
    const patches = parsed.data.patches.map(toDomainPatch);
    if (patches.length === 0)
      return { ok: false, issues: [{ path: "patches", code: "no-patches", message: `emit at least one patch; these slides failed QA: ${failing.join(", ")}` }] };

    const offTarget: Issue[] = patches.flatMap((p, n) =>
      failing.includes(p.slideId)
        ? []
        : [{ path: issuePath(["patches", n, "slideId"]), code: "patch-not-failing", message: `slide ${p.slideId} did not fail QA; patch only: ${failing.join(", ")}` }],
    );
    if (offTarget.length > 0) return { ok: false, issues: offTarget };

    const applied = applyPatches(i.deck, patches, rules);
    if (!applied.ok) return applied;
    const issues = validateDeck(c, rules, applied.deck);
    return issues.length > 0 ? { ok: false, issues } : { ok: true, value: { patches, deck: applied.deck } };
  };
}
