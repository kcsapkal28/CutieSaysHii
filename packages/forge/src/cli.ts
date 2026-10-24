#!/usr/bin/env tsx
// DeckForge CLI (engine commands). The pipeline adds its own commands elsewhere.
//   forge bundle <projectDir>                          -> <projectDir>/versions/<n>/deck.html
//   forge shoot <deck.html> [--slides s01,s03] --out <dir>
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { bundleDeck } from "./bundle.ts";
import { ContractError } from "./check.ts";
import { nextVersionDir, readProject, writeShots } from "./project.ts";
import { shootDeck } from "./shoot.ts";

const USAGE = `usage:
  forge bundle <projectDir>
  forge shoot <deck.html> [--slides s01,s03] --out <dir>`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === "bundle") {
    const { positionals } = parseArgs({ args: rest, allowPositionals: true });
    const dir = positionals[0];
    if (!dir) return fail(USAGE);
    const { config, slides } = readProject(resolve(dir));
    const outFile = join(nextVersionDir(resolve(dir)), "deck.html");
    await bundleDeck({ config, slides, outFile });
    console.log(outFile);
    return 0;
  }
  if (cmd === "shoot") {
    const { positionals, values } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { slides: { type: "string" }, out: { type: "string" } },
    });
    const deck = positionals[0];
    if (!deck || !values.out) return fail(USAGE);
    const slideIds = values.slides?.split(",").map((s) => s.trim()).filter(Boolean);
    const started = Date.now();
    const result = await shootDeck({ deckFile: resolve(deck), slideIds });
    const files = writeShots(result, resolve(values.out));
    const errors = Object.entries(result.errors).flatMap(([k, list]) => list.map((m) => `${k}: ${m}`));
    console.log(`${files.length} shots in ${((Date.now() - started) / 1000).toFixed(1)}s -> ${resolve(values.out)}`);
    for (const e of errors) console.error(`error ${e}`);
    for (const u of result.externalRequests) console.error(`external request ${u}`);
    return errors.length || result.externalRequests.length ? 1 : 0;
  }
  return fail(USAGE);
}

function fail(msg: string): number {
  console.error(msg);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    if (e instanceof ContractError) console.error(e.message);
    else console.error(e);
    process.exit(1);
  },
);
