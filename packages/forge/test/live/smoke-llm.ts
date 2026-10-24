// Tiny live check of both models through the proxy: `pnpm --filter @deckforge/forge exec tsx test/live/smoke-llm.ts`.
import { z } from "zod";
import { createProxyLlm, MODELS } from "../../src/llm.ts";

const llm = createProxyLlm();
for (const model of [MODELS.sonnet, MODELS.opus]) {
  try {
    const t = await llm.callText({ label: "smoke", model, system: "Be terse.", user: "Say OK.", maxTokens: 20 });
    console.log(model, "text:", JSON.stringify(t.text), `${t.ms}ms`, t.usage);
    const r = await llm.callTool({
      label: "smoke",
      model,
      system: "Be terse.",
      user: "Give the number 7.",
      maxTokens: 100,
      tool: { name: "answer", description: "Answer with a number", schema: z.object({ n: z.number().int() }) },
    });
    console.log(model, "tool:", r.data, `${r.ms}ms`, r.usage);
  } catch (e) {
    console.log(model, "ERR", (e as Error).message);
  }
}
