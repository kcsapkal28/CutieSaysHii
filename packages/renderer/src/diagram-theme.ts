// Mermaid's theme, derived from the same computed colours theme.css emits, so a diagram matches its deck.
import { readFile } from "node:fs/promises";
import { contrastRatio } from "@deckforge/catalog";
import type { ThemeSpec } from "@deckforge/schemas";
import type { FontData } from "./diagram-page/main.ts";
import { graphicPalette, mix, panelFills } from "./theme/colours.ts";
import { fontFaces, fontSlug } from "./theme/fonts.ts";
import { assertSafe, UNSAFE_IN_QUOTES, UnsafeThemeValueError } from "./theme/safe.ts";

const HEX = /^#[0-9a-f]{6}$/i;
const AA = 4.5;
const SCALE_COUNT = 12;

type Roles = ThemeSpec["roles"];
const ROLES = ["bg", "surface", "text", "textMuted", "primary", "accent", "border"] as const satisfies (keyof Roles)[];

/** Every role checked as a hex and upper-cased: Mermaid inlines these into the SVG's <style>. */
function validRoles(roles: Roles): Roles {
  const out = {} as Roles;
  for (const name of ROLES) {
    const value = roles[name];
    if (!HEX.test(value)) throw new UnsafeThemeValueError(`roles.${name}`);
    out[name] = value.toUpperCase();
  }
  return out;
}

/**
 * Mermaid `themeVariables` for theme "base": nodes on surface and the panel fills, lines and borders from the
 * graphic palette (3:1 on bg and surface), text in roles.text. Every colour is an upper-case #RRGGBB.
 */
export function mermaidThemeVariables(theme: ThemeSpec): Record<string, string | boolean> {
  const roles = validRoles(theme.roles);
  const { bg, surface, text } = roles;
  const g = graphicPalette(roles);
  const [g1, g2, g3] = g as [string, string, string];
  const { fill1, fill2 } = panelFills(roles);

  // Wedge labels sit on the wedges: whichever of text and bg reads better on the worst wedge, or none at all.
  const worst = (c: string) => Math.min(...g.map((wedge) => contrastRatio(c, wedge)));
  const pieText = worst(text) >= worst(bg) ? text : bg;

  const scale = [fill1, fill2, surface];
  const cScale = Object.fromEntries(
    Array.from({ length: SCALE_COUNT }, (_, i) => [
      [`cScale${i}`, scale[i % scale.length]!],
      [`cScaleLabel${i}`, text],
    ]).flat(),
  );

  return {
    primaryColor: surface,
    primaryTextColor: text,
    primaryBorderColor: g1,
    secondaryColor: fill1,
    secondaryTextColor: text,
    secondaryBorderColor: g1,
    tertiaryColor: fill2,
    tertiaryTextColor: text,
    tertiaryBorderColor: g2,
    mainBkg: surface,
    nodeBorder: g1,
    nodeTextColor: text,

    textColor: text,
    titleColor: text,
    lineColor: g3,
    background: bg,
    edgeLabelBackground: bg,

    clusterBkg: mix(bg, surface, 0.5),
    clusterBorder: g3,
    noteBkgColor: fill2,
    noteTextColor: text,
    noteBorderColor: g2,

    actorBkg: surface,
    actorBorder: g1,
    actorTextColor: text,
    actorLineColor: g3,
    signalColor: g3,
    signalTextColor: text,
    labelBoxBkgColor: surface,
    labelBoxBorderColor: g1,
    labelTextColor: text,
    loopTextColor: text,

    ...Object.fromEntries(g.map((c, i) => [`pie${i + 1}`, c])),
    pieStrokeColor: bg,
    pieOuterStrokeColor: g3,
    pieTitleTextColor: text,
    pieLegendTextColor: text,
    pieSectionTextColor: pieText,
    pieSectionTextSize: worst(pieText) < AA ? "0px" : "24px",

    ...cScale,

    fontFamily: `"${assertSafe("type.body.font", theme.type.body.font, UNSAFE_IN_QUOTES)}", sans-serif`,
    fontSize: "28px",
    darkMode: theme.mode === "dark",
  };
}

/**
 * The body font's faces as bytes for the diagram page. Mermaid sizes every node and label from text it
 * measures there; measured in a fallback font, labels drawn in the deck's wider face would be clipped.
 */
export async function diagramFonts(theme: ThemeSpec): Promise<FontData[]> {
  const { font: family, weights } = theme.type.body;
  const files = new Map(fontFaces(theme).files.map((f) => [f.to, f.from]));
  return Promise.all(
    [...new Set(weights)].map(async (weight) => {
      const from = files.get(`fonts/${fontSlug(family)}-${weight}.woff2`);
      if (from === undefined) throw new Error(`no font file for ${family} ${weight}`);
      return { family, weight, base64: (await readFile(from)).toString("base64") };
    }),
  );
}
