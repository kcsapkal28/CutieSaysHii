#!/usr/bin/env tsx
// DeckForge CLI.
//   forge bundle <projectDir>                          -> <projectDir>/versions/<n>/deck.html
//   forge shoot <deck.html> [--slides s01,s03] --out <dir>
//   forge journal <projectDir> [--last | --run <id>]   summary of the project's log.jsonl
//   forge eval [--topics f] [--label l] [--only id] [--slides n] [--out dir] --yes   real LLM calls: costs money
//   forge eval compare <labelA> <labelB> [--out dir]
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { bundleDeck } from "./bundle.ts";
import { ContractError } from "./check.ts";
import { compareResults, DEFAULT_TOPICS_FILE, estimateUsd, loadTopics, readResults, runEval } from "./eval.ts";
import { repoRoot } from "./llm.ts";
import { formatRun, readJournal, summarizeRuns } from "./pipeline/journal.ts";
import { nextVersionDir, readProject, writeShots } from "./project.ts";
import { shootDeck } from "./shoot.ts";

const USAGE = `usage:
  forge bundle <projectDir>
  forge shoot <deck.html> [--slides s01,s03] --out <dir>
  forge journal <projectDir> [--last | --run <id>]
  forge eval [--topics <file>] [--label <name>] [--only <topicId>] [--slides <n>] [--out <dir>] [--yes]
  forge eval compare <labelA> <labelB> [--out <dir>]`;

const defaultEvalOut = () => join(repoRoot(), ".eval");

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
  if (cmd === "journal") {
    const { positionals, values } = parseArgs({ args: rest, allowPositionals: true, options: { last: { type: "boolean" }, run: { type: "string" } } });
    const dir = positionals[0];
    if (!dir) return fail(USAGE);
    const file = join(resolve(dir), "log.jsonl");
    let runs = summarizeRuns(readJournal(file));
    if (values.run) runs = runs.filter((r) => r.run === values.run);
    if (values.last) runs = runs.slice(-1);
    if (!runs.length) return fail(`no journal runs in ${file}`);
    console.log(runs.map(formatRun).join("\n\n"));
    return 0;
  }
  if (cmd === "eval" && rest[0] === "compare") {
    const { positionals, values } = parseArgs({ args: rest.slice(1), allowPositionals: true, options: { out: { type: "string" } } });
    const [a, b] = positionals;
    if (!a || !b) return fail(USAGE);
    const out = values.out ? resolve(values.out) : defaultEvalOut();
    console.log(compareResults(readResults(out, a), readResults(out, b)));
    return 0;
  }
  if (cmd === "eval") {
    const { values } = parseArgs({
      args: rest,
      options: {
        topics: { type: "string" },
        label: { type: "string" },
        only: { type: "string" },
        slides: { type: "string" },
        out: { type: "string" },
        yes: { type: "boolean" },
      },
    });
    const topics = loadTopics(values.topics ? resolve(values.topics) : DEFAULT_TOPICS_FILE);
    const chosen = values.only ? topics.filter((t) => t.id === values.only) : topics;
    if (!chosen.length) return fail(`no eval topic "${values.only}"`);
    const slides = values.slides ? Number(values.slides) : undefined;
    if (slides !== undefined && !(Number.isInteger(slides) && slides > 0)) return fail("--slides must be a positive integer");
    const label = values.label ?? new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const out = values.out ? resolve(values.out) : defaultEvalOut();
    const count = chosen.reduce((a, t) => a + (slides ?? t.slides), 0);
    const estimate = `${chosen.length} topic(s), ${count} slides, roughly $${Math.round(estimateUsd(chosen, slides))} of real LLM calls`;
    // A real eval spends real money: it only starts with an explicit --yes.
    if (!values.yes) return fail(`forge eval runs the full pipeline through the LLM proxy: ${estimate}.\nRe-run with --yes to start.`);
    console.log(`eval ${label}: ${estimate} -> ${join(out, label)}`);
    const results = await runEval({
      topics,
      label,
      outDir: out,
      ...(values.only ? { only: values.only } : {}),
      ...(slides ? { slides } : {}),
      log: (line) => console.log(line),
    });
    console.log(join(out, label, "results.md"));
    return results.overall.metrics.errors ? 1 : 0;
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
