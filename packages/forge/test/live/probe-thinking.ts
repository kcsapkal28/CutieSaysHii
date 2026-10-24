// Probe: where do a builder call's output tokens go (thinking, text, tool input)? Uses a real project's slide.
//   tsx test/live/probe-thinking.ts <slug> <slideId> [default|between_tools]
import { builderSchema, builderSystem, builderUser } from "../../src/agents/builder.ts";
import { loadExemplars, pickExemplars } from "../../src/agents/exemplars.ts";
import { toJsonSchema } from "../../src/agents/json-schema.ts";
import { loadLlmEnv, MODELS, sdkTransport } from "../../src/llm.ts";
import { loadOutline, loadProject, loadScript, loadStoryboard, loadStyle } from "../../src/pipeline/index.ts";

const [slug, id, mode = "default"] = process.argv.slice(2);
const p = loadProject(slug!);
const script = loadScript(p);
const sb = loadStoryboard(p);
const slide = script.slides.find((s) => s.id === id)!;
const board = sb.slides.find((s) => s.id === id)!;
const exemplars = pickExemplars(loadExemplars(), board);
const user = builderUser({ deckTitle: loadOutline(p).title, style: loadStyle(p), slide, board, deck: sb, index: 1, total: script.slides.length });
const started = Date.now();
const res = await sdkTransport(loadLlmEnv())(
  {
    model: MODELS.sonnet,
    max_tokens: 64000,
    system: `${builderSystem(exemplars, board)}\n\nRespond only by calling the \`write_slide\` tool, exactly once, with no other text.`,
    messages: [{ role: "user", content: user.map((u) => (u.type === "text" ? u : { type: "text", text: "" })) }],
    tools: [{ name: "write_slide", description: "Write the slide fragment.", input_schema: toJsonSchema(builderSchema(id!)) }],
    tool_choice: { type: "auto" },
    ...(mode === "between_tools" ? { thinking: { type: "between_tools" } } : {}),
  } as never,
  { signal: AbortSignal.timeout(900_000) },
);
const blocks = res.content as { type: string; text?: string; thinking?: string; input?: { html?: string } }[];
console.log(
  mode,
  `${((Date.now() - started) / 1000).toFixed(0)}s`,
  JSON.stringify(res.usage),
  blocks.map((b) => `${b.type}:${(b.text ?? b.thinking ?? b.input?.html ?? "").length}`).join(" "),
);
