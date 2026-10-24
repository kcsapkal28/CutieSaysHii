import type { FontOption } from "../theme-vars";
import { engine } from "./engine";

const WEIGHTS = [300, 400, 500, 600, 700];

/** The engine's FONT_IDS with family names, for the font pickers. */
export async function fontOptions(): Promise<FontOption[]> {
  const { FONT_IDS, fontMeta } = await engine();
  return FONT_IDS.map((id) => {
    const m = fontMeta(id);
    return { id, family: m.family, category: m.category };
  });
}

let css: Promise<string> | undefined;

/** @font-face rules for every engine font, served lazily from /fonts/<id>/<weight>. Used by the studio UI and the preview. */
export function fontFaceLinksCss(): Promise<string> {
  css ??= engine().then(({ FONT_IDS, fontMeta }) => {
    const rules: string[] = [];
    for (const id of FONT_IDS) {
      const m = fontMeta(id);
      for (const w of WEIGHTS) {
        if (!m.weights.includes(w)) continue;
        rules.push(`@font-face{font-family:"${m.family}";font-style:normal;font-weight:${w};font-display:swap;src:url(/fonts/${id}/${w}) format("woff2")}`);
      }
    }
    return rules.join("\n");
  });
  return css;
}
