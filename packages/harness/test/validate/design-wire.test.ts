import type { Catalog } from "@deckforge/catalog";
import { beforeAll, describe, expect, it } from "vitest";
import { assertUnionBudget, compileWireSchema, type JsonSchema } from "../../src/wire/schema.ts";
import { designWireSchema, enumOrString } from "../../src/validate/design-wire.ts";
import { testCatalog } from "../helpers/context.ts";
import { finalDesignEnums } from "./fixtures.ts";

let c: Catalog;
beforeAll(async () => {
  c = await testCatalog();
});

type Props = Record<string, JsonSchema>;
const at = (schema: JsonSchema, ...keys: string[]): JsonSchema =>
  keys.reduce<JsonSchema>((s, k) => (k === "[]" ? (s.items as JsonSchema) : (s.properties as Props)[k]!), schema);

describe("enumOrString", () => {
  it("enum for values, plain string for none", () => {
    expect(enumOrString(["a", "b"]).safeParse("c").success).toBe(false);
    expect(enumOrString([]).safeParse("c").success).toBe(true);
    expect(enumOrString(undefined).safeParse("c").success).toBe(true);
  });
});

describe("designWireSchema", () => {
  it("enums applied", () => {
    const vocabulary = c.motion.vocabulary;
    const { jsonSchema } = compileWireSchema(
      designWireSchema({ slideIds: ["s01", "s02"], overrideSlideIds: ["s01"], componentIds: ["df-notes"], vocabulary }),
    );
    const override = at(jsonSchema, "motion", "overrides", "[]");
    const placement = at(jsonSchema, "interaction", "placements", "[]");
    expect(at(override, "slideId")).toEqual({ type: "string", enum: ["s01"] });
    expect(at(override, "enter")).toEqual({ type: "string", enum: vocabulary.enter });
    expect(at(override, "transition")).toEqual({ type: "string", enum: vocabulary.transition });
    expect(at(override, "easing")).toEqual({ anyOf: [{ type: "string", enum: vocabulary.easing }, { type: "null" }] });
    expect(at(override, "reason")).toEqual({ type: "string" });
    expect(at(placement, "slideId")).toEqual({ type: "string", enum: ["s01", "s02"] });
    expect(at(placement, "componentId")).toEqual({ type: "string", enum: ["df-notes"] });
    expect(at(placement, "blockIndex")).toEqual({ anyOf: [{ type: "integer" }, { type: "null" }] });
    expect(at(placement, "propsJson")).toEqual({ type: "string" });
  });

  it("plain strings when empty", () => {
    for (const schema of [designWireSchema(), designWireSchema({ slideIds: [], overrideSlideIds: [], componentIds: [] })]) {
      const { jsonSchema } = compileWireSchema(schema);
      expect(at(jsonSchema, "motion", "overrides", "[]", "slideId")).toEqual({ type: "string" });
      expect(at(jsonSchema, "motion", "overrides", "[]", "exit")).toEqual({ type: "string" });
      expect(at(jsonSchema, "interaction", "placements", "[]", "componentId")).toEqual({ type: "string" });
    }
  });

  it("round-trips through normalize keeping easing:null and blockIndex:null", () => {
    const schema = designWireSchema({ slideIds: ["s01", "s06"], overrideSlideIds: ["s06"], vocabulary: c.motion.vocabulary });
    const raw = {
      motion: {
        overrides: [
          { slideId: "s06", transition: "fade", enter: "scaleIn", emphasis: "countUp", exit: "fade", easing: null, reason: "r" },
        ],
      },
      interaction: { placements: [{ slideId: "s01", componentId: "df-notes", blockIndex: null, propsJson: "{}" }] },
    };
    const parsed = schema.parse(compileWireSchema(schema).normalize(structuredClone(raw)));
    expect(parsed).toEqual(raw);
    expect(parsed.motion.overrides[0]).toHaveProperty("easing", null);
    expect(parsed.interaction.placements[0]).toHaveProperty("blockIndex", null);
  });

  it("final emit_design schema fits the strict union budget", () => {
    const wire = compileWireSchema(designWireSchema(finalDesignEnums(c)));
    expect(wire.unionParamCount).toBe(2);
    expect(() => assertUnionBudget([wire])).not.toThrow();
  });
});
