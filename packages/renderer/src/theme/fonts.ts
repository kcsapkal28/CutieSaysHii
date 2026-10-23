import { createRequire } from "node:module";
import type { ThemeSpec } from "@deckforge/schemas";

const require = createRequire(import.meta.url);

export const fontSlug = (name: string): string => name.toLowerCase().trim().replace(/\s+/g, "-");

export type FontFaces = { css: string; files: { from: string; to: string }[] };

/** @font-face CSS plus the woff2 files to copy into `assets/`, one per distinct (font, weight). */
export function fontFaces(theme: ThemeSpec): FontFaces {
  const seen = new Set<string>();
  const files: FontFaces["files"] = [];
  const rules: string[] = [];
  for (const role of [theme.type.display, theme.type.body, theme.type.mono]) {
    const slug = fontSlug(role.font);
    for (const weight of role.weights) {
      const to = `fonts/${slug}-${weight}.woff2`;
      if (seen.has(to)) continue;
      seen.add(to);
      files.push({ from: require.resolve(`@fontsource/${slug}/files/${slug}-latin-${weight}-normal.woff2`), to });
      rules.push(
        `@font-face {\n  font-family: "${role.font}";\n  font-style: normal;\n  font-weight: ${weight};\n  font-display: swap;\n  src: url("${to}") format("woff2");\n}`,
      );
    }
  }
  return { css: rules.join("\n"), files };
}
