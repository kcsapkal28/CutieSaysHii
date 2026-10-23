import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultsForFamily, resolveMotionPlan, resolveTheme, type Catalog } from "@deckforge/catalog";
import { loadCatalog } from "@deckforge/catalog/node";
import {
  RenderManifestSchema,
  type DeckSpec,
  type InteractionPlan,
  type RenderManifest,
  type ThemeSpec,
} from "@deckforge/schemas";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { build, type BuildInput } from "../src/build.ts";
import { compileDeckCss } from "../src/css.ts";

const read = async <T>(rel: string) =>
  JSON.parse(await readFile(fileURLToPath(new URL(rel, import.meta.url)), "utf8")) as T;

let catalog: Catalog;
let deck: DeckSpec;
let interaction: InteractionPlan;
let theme: ThemeSpec;
let root: string;
let outA: string;
let outB: string;
let manifest: RenderManifest;

const inputFor = (outDir: string, patch: Partial<BuildInput> = {}): BuildInput => ({
  jobId: "job-1",
  deck,
  theme,
  motion: resolveMotionPlan(catalog, "calm", deck.slides),
  interaction,
  catalog,
  outDir,
  ...patch,
});

beforeAll(async () => {
  catalog = await loadCatalog();
  deck = await read<DeckSpec>("../fixtures/solar.deck.json");
  interaction = await read<InteractionPlan>("../fixtures/solar.interaction.json");
  const d = defaultsForFamily(catalog, "minimal");
  theme = resolveTheme(catalog, {
    depth: "standard",
    styleFamilyId: "minimal",
    paletteId: d.paletteId,
    typeFamilyId: d.typeFamilyId,
    motionTemplateId: "calm",
    interactionModeId: "linear",
    threeJs: false,
  });
  root = await mkdtemp(join(tmpdir(), "deckforge-build-"));
  outA = join(root, "a");
  outB = join(root, "b");
  manifest = await build(inputFor(outA));
  await build(inputFor(outB));
}, 180_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("build", () => {
  it("writes index.html and every asset listed in the manifest", async () => {
    expect(manifest.entry).toBe("index.html");
    expect(existsSync(join(outA, "index.html"))).toBe(true);
    for (const a of manifest.assets) {
      expect((await stat(join(outA, a.path))).size).toBe(a.bytes);
    }
    const paths = manifest.assets.map((a) => a.path);
    expect(paths).toEqual(expect.arrayContaining(["assets/deck.css", "assets/theme.css", "assets/deck.js"]));
    expect(paths.some((p) => p.startsWith("assets/fonts/") && p.endsWith(".woff2"))).toBe(true);
    expect(manifest.slideIds).toEqual(deck.slides.map((s) => s.id));
  });

  it("manifest parses as RenderManifest and totalBytes equals the sum of asset bytes", () => {
    const parsed = RenderManifestSchema.parse(manifest);
    expect(parsed.jobId).toBe("job-1");
    expect(parsed.totalBytes).toBe(parsed.assets.reduce((n, a) => n + a.bytes, 0));
    expect(parsed.threeJs).toBe(false);
  });

  it("stays under 2.5 MB", () => {
    console.info(`fixture totalBytes: ${manifest.totalBytes}`);
    expect(manifest.totalBytes).toBeLessThanOrEqual(2_621_440);
  });

  it('index.html has no absolute or remote URLs and no type="module"', async () => {
    const html = await readFile(join(outA, "index.html"), "utf8");
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/type=["']module["']/i);
    const refs = [...html.matchAll(/\s(?:src|href)="([^"]*)"/g)].map((m) => m[1]!);
    for (const ref of refs) expect(ref).toMatch(/^(?:assets\/|#)/);
    expect(html).toContain('href="assets/deck.css"');
    expect(html).toContain('src="assets/deck.js"');
  });

  it("deck.css contains a utility used by a template", async () => {
    const title = await readFile(fileURLToPath(new URL("../templates/title.hbs", import.meta.url)), "utf8");
    expect(title).toContain("text-df-accent-text");
    const css = await readFile(join(outA, "assets/deck.css"), "utf8");
    expect(css).toContain(".text-df-accent-text");
    expect(css).toContain(".bg-df-surface");
    expect(css).toContain(".font-display");
    expect(css).toContain(".fragment");
  });

  it("theme.css carries font faces and the theme variables", async () => {
    const css = await readFile(join(outA, "assets/theme.css"), "utf8");
    expect(css).toContain("@font-face");
    expect(css).toContain("--df-bg:");
  });

  it("is deterministic", async () => {
    const [a, b] = await Promise.all([readFile(join(outA, "index.html")), readFile(join(outB, "index.html"))]);
    expect(a.equals(b)).toBe(true);
  });

  it("css cache file exists after first compile", async () => {
    const css = await compileDeckCss();
    expect(css.length).toBeGreaterThan(1000);
    const cacheDir = fileURLToPath(new URL("../.cache/", import.meta.url));
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(cacheDir).some((f) => /^deck-[0-9a-f]{64}\.css$/.test(f))).toBe(true);
    expect(readdirSync(cacheDir).some((f) => /^runtime-[0-9a-f]{64}\.js$/.test(f))).toBe(true);
  });

  it("threeJs theme adds a warning", async () => {
    const m = await build(inputFor(join(root, "c"), { theme: { ...theme, threeJs: true } }));
    expect(m.threeJs).toBe(true);
    expect(m.warnings).toContain("threeJs requested but not supported by this renderer yet");
    expect(manifest.warnings).not.toContain("threeJs requested but not supported by this renderer yet");
  });

  it("build rejects with the abort reason and writes no index.html", async () => {
    const ac = new AbortController();
    const reason = new Error("cancelled mid-render");
    const launch = chromium.launch.bind(chromium);
    // Abort once diagram rendering has started, so the cancel lands inside renderDiagrams.
    const spy = vi.spyOn(chromium, "launch").mockImplementation(async (...args) => {
      const browser = await launch(...args);
      setTimeout(() => ac.abort(reason), 0);
      return browser;
    });
    try {
      const out = join(root, "aborted");
      await expect(build(inputFor(out, { signal: ac.signal }))).rejects.toBe(reason);
      expect(spy).toHaveBeenCalledOnce();
      expect(existsSync(join(out, "index.html"))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  }, 60_000);

  it("an already-aborted build rejects with the reason before any work", async () => {
    const reason = new Error("never started");
    const spy = vi.spyOn(chromium, "launch");
    try {
      const out = join(root, "pre-aborted");
      await expect(build(inputFor(out, { signal: AbortSignal.abort(reason) }))).rejects.toBe(reason);
      expect(spy).not.toHaveBeenCalled();
      expect(existsSync(out)).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects an invalid spec before writing anything", async () => {
    const bad = { ...deck, slides: [] } as DeckSpec;
    await expect(build(inputFor(join(root, "d"), { deck: bad }))).rejects.toThrow();
    expect(existsSync(join(root, "d"))).toBe(false);
  });
});
