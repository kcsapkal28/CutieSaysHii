// Projects from before the Outline, Script and Storyboard stages were merged keep loading (fixtures: test/fakes.ts).
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Outline } from "../src/agents/schemas.ts";
import { createProject, loadOutline, loadProject, loadScript, loadStoryboard, migrateProject, projectStatus, type Project } from "../src/pipeline/index.ts";
import { legacyOutline, legacyScript, legacyStoryboard } from "./fakes.ts";

let root: string;
let project: Project;
const put = (name: string, v: unknown) => writeFileSync(join(project.dir, name), JSON.stringify(v));
const has = (name: string) => existsSync(join(project.dir, name));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "forge-migrate-"));
  project = createProject({ topic: "How active noise cancellation works", audience: "engineers", minutes: 8, root });
  writeFileSync(join(project.dir, "style.json"), "{}");
  writeFileSync(join(project.dir, "research.md"), "# Notes\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("migrating old projects", () => {
  it("merges the old outline, script and storyboard into one outline.json and keeps the old files under legacy/", () => {
    put("outline.json", legacyOutline);
    put("script.json", legacyScript);
    put("storyboard.json", legacyStoryboard());
    put("build.json", { version: 1 });

    loadProject(project.dir);
    expect(["script.json", "storyboard.json"].some(has)).toBe(false);
    for (const f of ["legacy/outline.json", "legacy/script.json", "legacy/storyboard.json"]) expect(has(f), f).toBe(true);
    expect(JSON.parse(readFileSync(join(project.dir, "legacy/outline.json"), "utf8"))).toEqual(legacyOutline);

    const outline = loadOutline(project);
    expect(Outline.safeParse(outline).success).toBe(true);
    expect(outline).toMatchObject({ title: "Inside ANC", totalSec: 480, visualThroughline: "One earbud, four signal colours.", motifs: ["cyan anti-noise particles"] });
    expect(outline.sections.map((s) => [s.name, s.slides.map((x) => x.id)])).toEqual([
      ["Hook", ["s01"]],
      ["How", ["s02"]],
    ]);
    expect(outline.sections[1]!.slides[0]).toMatchObject({
      title: "Claim for s02",
      subtitle: "Edited caption",
      point: "Inverted waves cancel.",
      role: "mechanism",
      notes: "Then this.",
      budgetSec: 290,
      visual: { explainer: "animated-diagram", technique: "parametric-sim", concept: "Two waves sum to flat." },
    });
    expect(outline.sections[1]!.slides[0]!.visual).not.toHaveProperty("id");

    // The builder's inputs round-trip to what the old files said; the stages stay done.
    expect(loadScript(project)).toEqual(legacyScript);
    expect(loadStoryboard(project)).toEqual(legacyStoryboard());
    expect(projectStatus(project)).toEqual({ style: true, research: true, outline: true, build: true });

    // Loading again changes nothing.
    expect(migrateProject(project)).toBe("none");
  });

  it("treats the outline as not done when only the old outline exists, without inventing content", () => {
    put("outline.json", legacyOutline);
    expect(migrateProject(project)).toBe("rerun");
    expect(has("outline.json")).toBe(false);
    expect(has("legacy/outline.json")).toBe(true);
    expect(projectStatus(project).outline).toBe(false);
  });

  it("needs a re-run when the script exists but the storyboard doesn't, or misses a slide", () => {
    put("outline.json", legacyOutline);
    put("script.json", legacyScript);
    expect(migrateProject(project)).toBe("rerun");
    expect(has("legacy/script.json")).toBe(true);

    put("outline.json", legacyOutline);
    put("script.json", legacyScript);
    put("storyboard.json", legacyStoryboard(["s01"]));
    expect(migrateProject(project)).toBe("rerun");
    // A second backup of the same file gets its own name.
    expect(has("legacy/script-2.json")).toBe(true);
    expect(has("outline.json")).toBe(false);
  });

  it("leaves new and unrecognised outlines alone", () => {
    expect(migrateProject(project)).toBe("none");
    put("outline.json", { something: "else" });
    expect(migrateProject(project)).toBe("none");
    expect(has("outline.json")).toBe(true);
    expect(has("legacy")).toBe(false);
  });
});
