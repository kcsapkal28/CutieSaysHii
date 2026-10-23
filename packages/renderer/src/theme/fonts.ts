import { createRequire } from "node:module";
import type { ThemeSpec } from "@deckforge/schemas";
import { assertSafe, UNSAFE_IN_QUOTES, UnsafeThemeValueError } from "./safe.ts";

const require = createRequire(import.meta.url);

const SAFE_SLUG = /^[a-z0-9-]+$/;

export const fontSlug = (name: string): string => name.toLowerCase().trim().replace(/\s+/g, "-");

export type FontFaces = { css: string; files: { from: string; to: string }[] };

/** @font-face CSS plus the woff2 files to copy into `assets/`, one per distinct (font, weight). */
export function fontFaces(theme: ThemeSpec): FontFaces {
  const seen = new Set<string>();
  const files: FontFaces["files"] = [];
  const rules: string[] = [];
  const roles = [
    ["type.display.font", theme.type.display],
    ["type.body.font", theme.type.body],
    ["type.mono.font", theme.type.mono],
  ] as const;
  // Validate every role up front so nothing is produced for a hostile theme.
  const slugs = roles.map(([field, role]) => {
    assertSafe(field, role.font, UNSAFE_IN_QUOTES);
    const slug = fontSlug(role.font);
    if (!SAFE_SLUG.test(slug)) throw new UnsafeThemeValueError(field);
    return slug;
  });
  for (const [i, [, role]] of roles.entries()) {
    const slug = slugs[i]!;
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
