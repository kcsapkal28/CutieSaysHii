import { randomBytes } from "node:crypto";
import { readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Catalog } from "@deckforge/catalog";
import { build as renderBuild, type BuildInput } from "@deckforge/renderer/node";
import type { RenderManifest } from "@deckforge/schemas";
import { RenderFailedError } from "../kernel/errors.ts";
import type { RendererPort } from "../kernel/ports.ts";

export type RendererDeps = { build?: (input: BuildInput) => Promise<RenderManifest> };

const hex = () => randomBytes(3).toString("hex");
const isEnoent = (e: unknown) => (e as { code?: unknown } | null)?.code === "ENOENT";

async function removeStale(jobDir: string, name: string): Promise<void> {
  const entries = await readdir(jobDir).catch((e: unknown) => (isEnoent(e) ? [] : Promise.reject(e)));
  const stale = entries.filter((e) => e.startsWith(`${name}.tmp-`) || e.startsWith(`${name}.old-`));
  await Promise.all(stale.map((e) => rm(join(jobDir, e), { recursive: true, force: true })));
}

/** Swaps the staged build in: dist → dist.old-<hex>, tmp → dist, then drops old; restores dist if the swap fails. */
async function promote(tmp: string, outDir: string): Promise<void> {
  const old = join(dirname(outDir), `${basename(outDir)}.old-${hex()}`);
  const moved = await rename(outDir, old).then(
    () => true,
    (e: unknown) => (isEnoent(e) ? false : Promise.reject(e)),
  );
  try {
    await rename(tmp, outDir);
  } catch (e) {
    if (moved) await rename(old, outDir).catch(() => {});
    throw e;
  }
  if (moved) await rm(old, { recursive: true, force: true });
}

/**
 * The RendererPort over the real renderer. Each build goes into <jobDir>/dist.tmp-<iteration>-<hex>
 * and is promoted to dist by rename only when the build succeeded and the signal is not aborted, so
 * an aborted or failed render leaves the previous dist untouched.
 */
export function createRendererPort(catalog: Catalog, deps: RendererDeps = {}): RendererPort {
  const build = deps.build ?? renderBuild;
  return {
    async build(req, signal) {
      const jobDir = dirname(req.outDir);
      const name = basename(req.outDir);
      try {
        await removeStale(jobDir, name);
      } catch (e) {
        throw new RenderFailedError(`could not clear stale render dirs in ${jobDir}: ${(e as Error).message}`, { cause: e });
      }
      const tmp = join(jobDir, `${name}.tmp-${req.iteration}-${hex()}`);
      const { jobId, deck, theme, motion, interaction } = req;

      try {
        const manifest = await build({ jobId, deck, theme, motion, interaction, catalog, outDir: tmp, signal });
        signal.throwIfAborted();
        await promote(tmp, req.outDir);
        return manifest;
      } catch (e) {
        await rm(tmp, { recursive: true, force: true });
        if (signal.aborted) throw signal.reason;
        throw new RenderFailedError(`render failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
    },
  };
}
