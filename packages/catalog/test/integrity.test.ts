import { describe, expect, it } from "vitest";
import { checkIntegrity, type IntegrityIssue } from "../src/integrity.ts";
import { loadCatalog } from "../src/load.ts";
import { parseCatalogFiles } from "../src/parse.ts";
import { rawCatalog, type Raw } from "./helpers.ts";

const key = (i: IntegrityIssue) => `${i.file}|${i.path}|${i.message}`;

/** Issues the mutation introduces, ignoring any already present in the unmutated catalog. */
async function newIssues(mutate: (raw: Raw) => void): Promise<IntegrityIssue[]> {
  const base = new Set(checkIntegrity(parseCatalogFiles(await rawCatalog())).map(key));
  const raw = await rawCatalog();
  mutate(raw);
  return checkIntegrity(parseCatalogFiles(raw)).filter((i) => !base.has(key(i)));
}

const fam = (raw: Raw, id: string) => raw.styles.families.find((f: { id: string }) => f.id === id);

describe("checkIntegrity", () => {
  it("real catalog has zero integrity issues", async () => {
    expect(checkIntegrity(await loadCatalog())).toEqual([]);
  });

  it("rule 1: flags a default palette outside allowedPalettes", async () => {
    const issues = await newIssues((r) => (fam(r, "minimal").defaultPalette = "tokyo-grid"));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: "design-styles.json" });
    expect(issues[0]?.message).toContain("tokyo-grid");
  });

  it("rule 2: flags a light palette on a dark-only family", async () => {
    const issues = await newIssues((r) => fam(r, "atmospheric").allowedPalettes.push("warm-minimalist"));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: "design-styles.json" });
    expect(issues[0]?.message).toContain("warm-minimalist");
  });

  it("rule 3: flags an allowed type family that does not pair with the family", async () => {
    const issues = await newIssues((r) => {
      const t = r.types.families.find((x: { id: string }) => x.id === "geometric-modern");
      t.pairsWith = t.pairsWith.filter((id: string) => id !== "minimal");
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("geometric-modern");
  });

  it("rule 3: flags an unknown pairsWith id", async () => {
    const issues = await newIssues((r) => r.types.families[0].pairsWith.push("vaporwave"));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: "type-families.json" });
  });

  it("rule 4: flags a family missing from allowedMotion", async () => {
    const issues = await newIssues((r) => delete r.compat.allowedMotion.retro);
    expect(issues.some((i) => i.file === "compat-matrix.json" && i.message.includes("retro"))).toBe(true);
  });

  it("rule 4: flags a defaultMotion that the family does not allow", async () => {
    const issues = await newIssues((r) => (fam(r, "brutalist").defaultMotion = "calm"));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: "design-styles.json" });
  });

  it("rule 5: flags motion values outside the vocabulary", async () => {
    const issues = await newIssues((r) => (r.motion.templates[1].defaults.enter = "wiggle"));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: "motion-templates.json" });
    expect(issues[0]?.message).toContain("wiggle");
  });

  it("rule 6: flags a mode component that does not exist", async () => {
    const issues = await newIssues((r) => r.interactions.modes[0].components.push("df-nope"));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: "interactions.json" });
  });

  it("rule 7: flags a slide type accepting an unknown block", async () => {
    const issues = await newIssues((r) => r.slideTypes.types[3].accepts.push("Video"));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: "slide-types.json" });
  });

  it("rule 8: flags a golden combo whose palette the family does not allow", async () => {
    const issues = await newIssues((r) => (r.compat.golden[0].palette = "tokyo-grid"));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: "compat-matrix.json" });
  });

  it("rule 9: flags an assessment minDepth that is not a depth", async () => {
    const issues = await newIssues((r) => (r.compat.interactionRules.assessment.minDepth = "extreme"));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: "compat-matrix.json" });
  });

  it("rule 10: flags textMuted that fails AA on bg", async () => {
    const issues = await newIssues((r) => {
      const p = r.palettes.palettes.find((x: { id: string }) => x.id === "warm-minimalist");
      p.roles.textMuted = "#C8C6C2";
    });
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues.every((i) => i.file === "palettes.json")).toBe(true);
  });
});
