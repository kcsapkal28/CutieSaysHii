// Prints a slide file as the builder sees it when it is picked as an exemplar (trimmed to MAX_EXEMPLAR_CHARS).
//   npx tsx test/live/trim-preview.ts <slide.html>
import { readFileSync } from "node:fs";
import { trimExemplar } from "../../src/agents/exemplars.ts";

const file = process.argv[2];
if (!file) throw new Error("usage: trim-preview.ts <slide.html>");
const html = readFileSync(file, "utf8");
const out = trimExemplar(html);
console.log(out);
console.error(`\n[${html.length} chars -> ${out.length}]`);
