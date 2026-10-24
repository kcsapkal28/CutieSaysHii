import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exemplarSection, loadExemplars, pickExemplars, type Exemplar } from "../src/agents/exemplars.ts";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const ex = (name: string, technique: string, domain: string): Exemplar => ({ name, html: `<section>${name}</section>`, technique, domain });

describe("exemplars", () => {
  it("picks by technique, then fills with other domains, never more than 3", () => {
    const all = [
      ex("a", "particle-flow", "engineering"),
      ex("b", "slider-simulation", "economics"),
      ex("c", "timeline-scrub", "history"),
      ex("d", "slider-simulation", "biology"),
      ex("e", "exploded-3d-callouts", "engineering"),
    ];
    expect(pickExemplars(all, { explainer: "simulation", technique: "slider-simulation" }).map((e) => e.name)).toEqual(["b", "d"]);
    expect(pickExemplars(all, { explainer: "timeline", technique: "timeline-scrub" }).map((e) => e.name)[0]).toBe("c");
    expect(pickExemplars(all, { explainer: "map", technique: "choropleth" })).toHaveLength(2);
  });

  it("loads the library index when present", () => {
    const lib = mkdtempSync(join(tmpdir(), "ex-"));
    dirs.push(lib);
    mkdirSync(join(lib, "flow"));
    writeFileSync(join(lib, "flow", "s01.html"), "<section>flow</section>");
    writeFileSync(join(lib, "index.json"), JSON.stringify([{ path: "flow/s01.html", technique: "particle-flow", domain: "networks", whatMakesItGood: "labels land" }]));
    expect(loadExemplars(lib, [])).toEqual([{ name: "flow/s01.html", html: "<section>flow</section>", technique: "particle-flow", domain: "networks", why: "labels land" }]);
  });

  it("falls back to the proof deck's richest slides and never picks a static text slide", () => {
    const picks = pickExemplars(loadExemplars(join(tmpdir(), "missing-lib")), { explainer: "3d-object", technique: "x" });
    expect(picks.length).toBeGreaterThan(0);
    for (const p of picks) expect(p.html).toMatch(/onFrame\(|<input|df-btn/);
    expect(picks.map((p) => p.name)).not.toContain("s05.html");
  });

  it("tells the builder not to copy content, palette or layout", () => {
    expect(exemplarSection([ex("a", "particle-flow", "x")])).toMatch(/Do not copy their subject, wording, palette, layout or composition/);
  });
});
