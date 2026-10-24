// Prompt files live in packages/forge/prompts/*.md. `{{> name}}` includes another prompt file; `{{var}}` substitutes.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "prompts");
export const FORGE_DIR = join(PROMPTS_DIR, "..");

export function loadPrompt(name: string, vars: Record<string, string> = {}, dir = PROMPTS_DIR): string {
  const raw = readFileSync(join(dir, `${name}.md`), "utf8");
  const withIncludes = raw.replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, inc: string) => loadPrompt(inc, vars, dir));
  return withIncludes.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key: string) => {
    const v = vars[key];
    if (v === undefined) throw new Error(`prompt ${name}: no value for {{${key}}}`);
    return v;
  });
}
