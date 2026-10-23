import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";

const TEMPLATES_DIR = fileURLToPath(new URL("../../templates/", import.meta.url));
const PARTIALS_DIR = join(TEMPLATES_DIR, "partials");

let cache: ReadonlyMap<string, Handlebars.TemplateDelegate> | undefined;

const hbsFiles = (dir: string) => readdirSync(dir).filter((f) => f.endsWith(".hbs")).sort();

/**
 * Reads and compiles templates/*.hbs once; the key is the slide-type id (file basename). templates/partials/*.hbs
 * are registered as partials by basename in a private Handlebars environment and are not slide types.
 */
export function loadTemplates(): ReadonlyMap<string, Handlebars.TemplateDelegate> {
  if (cache) return cache;
  const env = Handlebars.create();
  for (const file of hbsFiles(PARTIALS_DIR)) {
    env.registerPartial(basename(file, ".hbs"), readFileSync(join(PARTIALS_DIR, file), "utf8"));
  }
  const out = new Map<string, Handlebars.TemplateDelegate>();
  for (const file of hbsFiles(TEMPLATES_DIR)) {
    out.set(basename(file, ".hbs"), env.compile(readFileSync(join(TEMPLATES_DIR, file), "utf8"), { strict: true }));
  }
  cache = out;
  return out;
}
