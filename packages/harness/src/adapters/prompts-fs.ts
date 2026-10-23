import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentPrompt } from "../agents/messages.ts";

export const DEFAULT_PROMPTS_DIR = fileURLToPath(new URL("../../prompts/", import.meta.url));

const PROMPT_FILE = /^([a-z][a-z0-9-]*)\.v(\d+)\.md$/;

/** The highest-versioned `<agent>.v<N>.md` per agent, keyed by agent. */
export async function loadPrompts(dir: string = DEFAULT_PROMPTS_DIR): Promise<Record<string, AgentPrompt>> {
  const latest = new Map<string, { version: number; file: string }>();
  for (const file of await readdir(dir)) {
    const m = PROMPT_FILE.exec(file);
    if (!m) continue;
    const [, agent, v] = m as unknown as [string, string, string];
    const version = Number(v);
    if (version > (latest.get(agent)?.version ?? -1)) latest.set(agent, { version, file });
  }
  const entries = await Promise.all(
    [...latest].map(async ([agent, { file }]) => {
      const prompt: AgentPrompt = { name: file.slice(0, -".md".length), text: await readFile(join(dir, file), "utf8") };
      return [agent, prompt] as const;
    }),
  );
  return Object.fromEntries(entries);
}
