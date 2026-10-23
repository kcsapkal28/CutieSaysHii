import { getComponent, getInteractionMode, getMotionTemplate, type Catalog } from "@deckforge/catalog";
import type { DeckSkeleton, DesignChoices, DesignPlan } from "../kernel/contracts.ts";
import { zodToIssues } from "../kernel/issues.ts";
import type { ToolSpec } from "../kernel/llm-port.ts";
import { designWireSchema, type DesignWireEnums } from "../validate/design-wire.ts";
import { validateDesign } from "../validate/design.ts";
import { assertUnionBudget, compileWireSchema } from "../wire/schema.ts";
import { assembleDesign } from "../design/assemble.ts";
import type { ParseResult } from "./invoke-tool.ts";
import type { AgentPrompt, AgentRequest } from "./messages.ts";

export const DESIGN_EFFORT = "low";
export const DESIGN_MAX_TOKENS = 8000;

export type DesignInput = { choices: DesignChoices; skeleton: DeckSkeleton };
export type DesignRequestOptions = { prompt: AgentPrompt; model: string };

// Strict: the grammar compiles (spike, verified live); assertUnionBudget guards the union count.
const DESIGN_TOOL = {
  name: "emit_design",
  description: "Emit the motion overrides and interaction placements for the deck in one call.",
  strict: true,
} as const;

export function designEnums(c: Catalog, i: DesignInput): DesignWireEnums {
  const overrideTypes = new Set(c.compat.designRules.motionOverrideSlideTypes);
  return {
    slideIds: i.skeleton.slides.map((s) => s.id),
    overrideSlideIds: i.skeleton.slides.filter((s) => overrideTypes.has(s.type)).map((s) => s.id),
    componentIds: getInteractionMode(c, i.choices.interactionModeId).components,
    vocabulary: c.motion.vocabulary,
  };
}

/** N3: Agent B sees motion, interaction and deck structure only; never the theme, palette, type or family. */
export function designAgentInput(c: Catalog, i: DesignInput) {
  const template = getMotionTemplate(c, i.choices.motionTemplateId);
  const mode = getInteractionMode(c, i.choices.interactionModeId);
  return {
    motionTemplate: {
      id: template.id,
      name: template.name,
      intensity: template.intensity,
      defaults: template.defaults,
      bySlideType: template.bySlideType,
    },
    vocabulary: c.motion.vocabulary,
    mode: {
      id: mode.id,
      name: mode.name,
      components: mode.components.map((id) => {
        const x = getComponent(c, id);
        return {
          id: x.id,
          name: x.name,
          binds: x.binds,
          ...(x.disallowedSlideTypes === undefined ? {} : { disallowedSlideTypes: x.disallowedSlideTypes }),
          props: x.props,
          description: x.description,
        };
      }),
      minComponentsPerSlides: mode.minComponentsPerSlides,
      questionCount: i.choices.questionCount ?? mode.options?.questionCount?.default ?? null,
    },
    designRules: c.compat.designRules,
    skeleton: i.skeleton,
  };
}

export function buildDesignRequest(i: DesignInput, c: Catalog, o: DesignRequestOptions): AgentRequest {
  const wire = compileWireSchema(designWireSchema(designEnums(c, i)));
  assertUnionBudget([wire]);
  const tool: ToolSpec = { ...DESIGN_TOOL, inputSchema: wire.jsonSchema };
  return {
    model: o.model,
    effort: DESIGN_EFFORT,
    maxTokens: DESIGN_MAX_TOKENS,
    system: o.prompt.text,
    input: designAgentInput(c, i),
    tool,
    normalize: wire.normalize,
  };
}

// Parsed against the enum-free wire so validateDesign, not a bare enum error, explains each mistake.
export function parseDesign(c: Catalog, i: DesignInput): (input: unknown) => ParseResult<DesignPlan> {
  const schema = designWireSchema();
  return (input) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, issues: zodToIssues(parsed.error) };
    const issues = validateDesign(c, i.choices, i.skeleton, parsed.data);
    return issues.length > 0 ? { ok: false, issues } : { ok: true, value: assembleDesign(c, i.choices, i.skeleton, parsed.data) };
  };
}
