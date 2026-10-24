// Live evaluation run through the proxy and the real engine:
//   tsx test/live/live-run.ts new "<topic>" "<audience>" <minutes> [--to storyboard|build]
//   tsx test/live/live-run.ts <projectDirOrSlug> <stage> [<stage>…]
// Prints one line per event; appends usage/timing per stage to the project's log.jsonl.
import { createProject, loadProject, runStage, STAGES, type ForgeEvent, type Stage } from "../../src/pipeline/index.ts";

const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s`;
const tokens = (u: { input: number; output: number; cacheRead: number; cacheWrite: number }) =>
  `in=${u.input + u.cacheRead + u.cacheWrite} (cached ${u.cacheRead}) out=${u.output}`;

function log(e: ForgeEvent) {
  const line = (() => {
    switch (e.type) {
      case "stage:start":
        return `▶ ${e.stage}${e.invalidated.length ? ` (invalidated ${e.invalidated.join(", ")})` : ""}`;
      case "stage:done":
        return `✓ ${e.stage} ${(e.ms / 1000).toFixed(1)}s calls=${e.calls} ${tokens(e.usage)}`;
      case "stage:error":
        return `✗ ${e.stage}: ${e.error}`;
      case "usage":
        return `  · ${e.label} ${e.model} ${(e.ms / 1000).toFixed(1)}s ${tokens(e.usage)}`;
      case "slide:round":
        return e.phase === "build" ? `  ${e.id} r${e.round} build ${e.model}${e.escalated ? " (escalated)" : ""}` : undefined;
      case "slide:verdict":
        return `  ${e.id} r${e.round} ${e.verdict} score=${e.score} issues=${e.issues} errors=${e.errors}`;
      case "slide:error":
        return `  ${e.id} r${e.round} ERROR ${e.error.slice(0, 300)}`;
      case "slide:escalate":
        return `  ${e.id} escalating r${e.round} to ${e.model}`;
      case "slide:done":
        return `  ${e.id} DONE ${e.verdict} best=r${e.bestRound}/${e.rounds} score=${e.score}`;
      case "deck:done":
        return `■ deck v${e.version}: ${e.file}`;
      default:
        return undefined;
    }
  })();
  if (line) console.log(`${ts()} ${line}`);
}

const args = process.argv.slice(2);
let project;
let stages: Stage[];
if (args[0] === "new") {
  const [, topic, audience, minutes] = args;
  const to = (args[args.indexOf("--to") + 1] as Stage | undefined) ?? "storyboard";
  project = createProject({ topic: topic!, audience: audience!, minutes: Number(minutes) });
  stages = STAGES.slice(0, STAGES.indexOf(args.includes("--to") ? to : "storyboard") + 1);
} else {
  project = loadProject(args[0]!);
  stages = args.slice(1) as Stage[];
}
console.log(project.dir);
for (const stage of stages) await runStage(project, stage, { onEvent: log });
