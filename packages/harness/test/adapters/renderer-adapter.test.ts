import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goldenChoices, resolveMotionPlan, resolveTheme, type Catalog } from "@deckforge/catalog";
import { build, type BuildInput } from "@deckforge/renderer/node";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRendererPort } from "../../src/adapters/renderer.ts";
import { CancelledError, RenderFailedError } from "../../src/kernel/errors.ts";
import type { RenderRequest } from "../../src/kernel/ports.ts";
import { testCatalog } from "../helpers/context.ts";
import { STANDARD_DECK } from "../validate/fixtures.ts";

let c: Catalog;
let jobDir: string;
let outDir: string;
beforeAll(async () => {
  c = await testCatalog();
});
beforeEach(async () => {
  jobDir = await mkdtemp(join(tmpdir(), "renderer-port-"));
  outDir = join(jobDir, "dist");
});
afterEach(async () => {
  await rm(jobDir, { recursive: true, force: true });
});

function request(o: Partial<RenderRequest> = {}): RenderRequest {
  const choices = goldenChoices(c)[0]!;
  return {
    jobId: "j_test",
    iteration: 1,
    deck: STANDARD_DECK,
    theme: resolveTheme(c, choices),
    motion: resolveMotionPlan(c, choices.motionTemplateId, STANDARD_DECK.slides),
    interaction: { modeId: choices.interactionModeId, slides: [] },
    outDir,
    ...o,
  };
}

/** A previous render's dist/, with a file the next render does not produce. */
async function previousDist() {
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "index.html"), "previous");
  await writeFile(join(outDir, "stale.txt"), "stale");
}

const exists = (p: string) => stat(p).then(() => true, () => false);

async function until(check: () => Promise<boolean>) {
  while (!(await check())) await new Promise((r) => setTimeout(r, 5));
}

describe("createRendererPort", () => {
  it("promotes a complete dist; stale files gone; no tmp/old left", async () => {
    await previousDist();
    const staged: string[] = [];
    const port = createRendererPort(c, { build: (input) => (staged.push(input.outDir), build(input)) });
    const manifest = await port.build(request(), new AbortController().signal);

    expect(staged).toHaveLength(1);
    expect(staged[0]).toMatch(/[/\\]dist\.tmp-1-[0-9a-f]{6}$/);
    expect(await readdir(jobDir)).toEqual(["dist"]);
    const files = await readdir(outDir);
    expect(files).toContain("index.html");
    expect(files).not.toContain("stale.txt");
    expect(await readFile(join(outDir, "index.html"), "utf8")).toContain("<!doctype html>");
    expect(manifest.slideIds).toEqual(STANDARD_DECK.slides.map((s) => s.id));
    expect(manifest.warnings).toEqual([]);
  });

  it("stale dist.tmp-* and dist.old-* from a crashed run are removed at the start", async () => {
    await previousDist();
    await mkdir(join(jobDir, "dist.tmp-0-abc123", "assets"), { recursive: true });
    await mkdir(join(jobDir, "dist.old-def456"), { recursive: true });
    await mkdir(join(jobDir, "accepted"), { recursive: true });
    await writeFile(join(jobDir, "dist.old-def456", "index.html"), "old");
    const seen: string[][] = [];
    const port = createRendererPort(c, { build: async (input) => (seen.push((await readdir(jobDir)).sort()), build(input)) });
    await port.build(request(), new AbortController().signal);

    // dist exists, so the leftovers are only cleared, never restored over it.
    expect(seen).toEqual([["accepted", "dist"]]);
    expect((await readdir(jobDir)).sort()).toEqual(["accepted", "dist"]);
  });

  it("a crash between the two renames: the next render restores dist.old-* first, then promotes", async () => {
    // The crash state: dist was moved aside, the staged build never took its place.
    await mkdir(join(jobDir, "dist.old-abc123"), { recursive: true });
    await writeFile(join(jobDir, "dist.old-abc123", "index.html"), "previous");
    await mkdir(join(jobDir, "dist.tmp-1-def456", "assets"), { recursive: true });
    const seen: { entries: string[]; index: string }[] = [];
    const port = createRendererPort(c, {
      build: async (input) => {
        seen.push({ entries: (await readdir(jobDir)).sort(), index: await readFile(join(outDir, "index.html"), "utf8") });
        return build(input);
      },
    });
    await port.build(request(), new AbortController().signal);

    expect(seen).toEqual([{ entries: ["dist"], index: "previous" }]);
    expect(await readdir(jobDir)).toEqual(["dist"]);
    expect(await readFile(join(outDir, "index.html"), "utf8")).toContain("<!doctype html>");
  });

  it("a crash between the two renames, then a failed build: the restored dist survives", async () => {
    await mkdir(join(jobDir, "dist.old-abc123"), { recursive: true });
    await writeFile(join(jobDir, "dist.old-abc123", "index.html"), "previous");
    await mkdir(join(jobDir, "dist.tmp-1-def456"), { recursive: true });
    const port = createRendererPort(c);
    const broken = request({ motion: { ...request().motion, slides: {} } });

    await expect(port.build(broken, new AbortController().signal)).rejects.toBeInstanceOf(RenderFailedError);
    expect(await readdir(jobDir)).toEqual(["dist"]);
    expect(await readFile(join(outDir, "index.html"), "utf8")).toBe("previous");
  });

  it("with several dist.old-* and no dist, the newest is restored", async () => {
    for (const [name, mtime] of [["dist.old-aaaaaa", 1_000], ["dist.old-bbbbbb", 3_000], ["dist.old-cccccc", 2_000]] as const) {
      await mkdir(join(jobDir, name), { recursive: true });
      await writeFile(join(jobDir, name, "index.html"), name);
      await utimes(join(jobDir, name), mtime, mtime);
    }
    const seen: string[] = [];
    const port = createRendererPort(c, { build: async () => (seen.push(await readFile(join(outDir, "index.html"), "utf8")), Promise.reject(new Error("boom"))) });

    await expect(port.build(request(), new AbortController().signal)).rejects.toBeInstanceOf(RenderFailedError);
    expect(seen).toEqual(["dist.old-bbbbbb"]);
    expect(await readdir(jobDir)).toEqual(["dist"]);
  });

  it("abort mid-build keeps the previous dist and removes the tmp dir", async () => {
    await previousDist();
    const ac = new AbortController();
    const reason = new CancelledError("cancelled");
    const port = createRendererPort(c, {
      build: async (input: BuildInput) => {
        let settled = false;
        const running = build(input).finally(() => {
          settled = true;
        });
        running.catch(() => {});
        // Abort once the build has started writing into its staging dir.
        await until(async () => settled || (await exists(input.outDir)));
        ac.abort(reason);
        return running;
      },
    });

    await expect(port.build(request(), ac.signal)).rejects.toBe(reason);
    expect(await readdir(jobDir)).toEqual(["dist"]);
    expect(await readFile(join(outDir, "index.html"), "utf8")).toBe("previous");
    expect(await readdir(outDir)).toContain("stale.txt");
  });

  it("abort after build resolves does not promote", async () => {
    await previousDist();
    const ac = new AbortController();
    const reason = new CancelledError("cancelled");
    const port = createRendererPort(c, {
      build: async (input) => {
        const manifest = await build(input);
        ac.abort(reason);
        return manifest;
      },
    });

    await expect(port.build(request(), ac.signal)).rejects.toBe(reason);
    expect(await readdir(jobDir)).toEqual(["dist"]);
    expect(await readFile(join(outDir, "index.html"), "utf8")).toBe("previous");
  });

  it("build error → RenderFailedError, previous dist intact", async () => {
    await previousDist();
    const port = createRendererPort(c);
    const broken = request({ motion: { ...request().motion, slides: {} } });

    const error = await port.build(broken, new AbortController().signal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RenderFailedError);
    expect((error as Error).message).toMatch(/motion plan has no entry/);
    expect(await readdir(jobDir)).toEqual(["dist"]);
    expect(await readFile(join(outDir, "index.html"), "utf8")).toBe("previous");
  });

  it("a first render with no previous dist promotes", async () => {
    await createRendererPort(c).build(request(), new AbortController().signal);
    expect(await readdir(jobDir)).toEqual(["dist"]);
    expect(await readdir(outDir)).toContain("index.html");
  });
});
