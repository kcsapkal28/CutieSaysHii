import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";

const TEMPLATES_DIR = fileURLToPath(new URL("../../templates/", import.meta.url));

let cache: Map<string, Handlebars.TemplateDelegate> | undefined;

/** Reads and compiles templates/*.hbs once; the key is the slide-type id (file basename). */
export function loadTemplates(): Map<string, Handlebars.TemplateDelegate> {
  if (cache) return cache;
  const out = new Map<string, Handlebars.TemplateDelegate>();
  for (const file of readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith(".hbs")).sort()) {
    const source = readFileSync(join(TEMPLATES_DIR, file), "utf8");
    out.set(basename(file, ".hbs"), Handlebars.compile(source, { strict: true }));
  }
  cache = out;
  return out;
}
