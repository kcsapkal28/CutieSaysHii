// Live run of the word and storyboard stages through the proxy (no engine needed):
//   tsx test/live/run-stages.ts new "<topic>" "<audience>" <minutes>     → creates a project, runs style → storyboard
//   tsx test/live/run-stages.ts <projectDir> <stage> [<stage>…]           → re-runs stages on an existing project
import { createProject, createProxyLlm, openProject, runStage, type ForgeEvent, type Stage } from "../../src/pipeline/index.ts";

const log = (e: ForgeEvent) => {
  if (e.type === "usage") console.log(`  · ${e.label} ${e.model} ${(e.ms / 1000).toFixed(1)}s in=${e.usage.input} out=${e.usage.output}`);
  else if (e.type === "stage:done") console.log(`✓ ${e.stage} ${(e.ms / 1000).toFixed(1)}s calls=${e.calls} in=${e.usage.input} out=${e.usage.output}`);
  else if (e.type === "stage:start") console.log(`▶ ${e.stage}${e.invalidated.length ? ` (invalidated ${e.invalidated.join(", ")})` : ""}`);
  else if (e.type === "stage:error") console.log(`✗ ${e.stage}: ${e.error}`);
};

const [cmd, ...rest] = process.argv.slice(2);
const llm = createProxyLlm();
let project;
let stages: Stage[];
if (cmd === "new") {
  const [topic, audience, minutes] = rest;
  project = createProject({ topic: topic!, audience: audience!, minutes: Number(minutes) });
  stages = ["style", "research", "outline", "script", "storyboard"];
} else {
  project = openProject(cmd!);
  stages = rest as Stage[];
}
console.log(project.dir);
for (const stage of stages) await runStage(project, stage, { llm, onEvent: log });
