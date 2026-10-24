// Stylist: brief → Style (design style, palette, font pair, surface, motion, 3D, interactivity, density), with WCAG AA checked in code.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { Features, MotionLevel, Style } from "../contract.ts";
import { DESIGN_STYLES, SURFACE_CHOICES } from "../design-styles.ts";
import { LlmError, MODELS, type Llm } from "../llm.ts";
import { checkContrast, HEX, type ContrastFailure } from "./contrast.ts";
import { FORGE_DIR, loadPrompt } from "./prompts.ts";
import type { Brief } from "./schemas.ts";

/** The @fontsource ids installed in packages/forge (what the bundler can inline). */
export function installedFonts(forgeDir = FORGE_DIR): string[] {
  const pkg = JSON.parse(readFileSync(join(forgeDir, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
  return Object.keys(pkg.dependencies ?? {})
    .filter((d) => d.startsWith("@fontsource/"))
    .map((d) => d.slice("@fontsource/".length))
    .sort();
}

const isMono = (id: string) => id.includes("mono");

/** The catalogue as one line per style, for the stylist's prompt. */
export function designStyleMenu(): string {
  return DESIGN_STYLES.map((d) => `- \`${d.id}\`: ${d.name} (${d.category}). ${d.blurb}`).join("\n");
}
const Hex = z.string().regex(HEX);

export function stylistSchema(fonts: string[]) {
  const all = z.enum(fonts as [string, ...string[]]);
  const mono = fonts.filter(isMono);
  return z.object({
    designStyle: z.enum(["none", ...DESIGN_STYLES.map((d) => d.id)] as [string, ...string[]]),
    look: z.string(),
    rationale: z.string().describe("Two sentences: why this look suits the topic and audience."),
    dark: z.boolean(),
    colors: z.object({ bg: Hex, surface: Hex, text: Hex, muted: Hex, line: Hex, accent: Hex, accent2: Hex, accent3: Hex }),
    backdrop: z
      .string()
      .refine((v) => !/[<>{};\\]|url\s*\(|@import|\/\*/i.test(v), "only gradients and hex colours; no url(), semicolons or braces"),
    fonts: z.object({
      display: all,
      body: all,
      mono: z.enum((mono.length ? mono : fonts) as [string, ...string[]]),
    }),
    motion: MotionLevel,
    use3d: z.boolean(),
    interactivity: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    density: z.enum(["airy", "balanced", "dense"]),
    surface: z.object({
      radius: z.enum(SURFACE_CHOICES.radius),
      border: z.enum(SURFACE_CHOICES.border),
      depth: z.enum(SURFACE_CHOICES.depth),
      texture: z.enum(SURFACE_CHOICES.texture),
    }),
    features: Features,
  });
}
export type StylistOutput = z.infer<ReturnType<typeof stylistSchema>>;

export type StylistResult = { style: Style; rationale: string; attempts: number };

/** Hard preferences from the brief win over the model's picks. */
function applyPrefs(out: StylistOutput, brief: Brief): StylistOutput {
  const p = brief.prefs;
  return {
    ...out,
    ...(p.motion ? { motion: p.motion } : {}),
    ...(p.use3d === undefined ? {} : { use3d: p.use3d }),
    ...(p.interactivity === undefined ? {} : { interactivity: p.interactivity }),
    ...(p.density ? { density: p.density } : {}),
    features: { ...out.features, ...p.features },
    fonts: { ...out.fonts, ...Object.fromEntries(Object.entries(p.fonts ?? {}).filter(([, v]) => v)) },
  };
}

export async function runStylist(
  llm: Llm,
  brief: Brief,
  opts: { model?: string; maxAttempts?: number; fonts?: string[] } = {},
): Promise<StylistResult> {
  const fonts = opts.fonts ?? installedFonts();
  const schema = stylistSchema(fonts);
  const system = loadPrompt("stylist", { fonts: fonts.join(", "), designStyles: designStyleMenu() });
  const maxAttempts = opts.maxAttempts ?? 3;
  const base = [
    `Topic: ${brief.topic}`,
    `Audience: ${brief.audience}`,
    `Length: ${brief.minutes} minutes`,
    `Preferences: ${JSON.stringify(brief.prefs)}`,
  ].join("\n");

  let feedback = "";
  let last: { out: StylistOutput; failures: ContrastFailure[] } | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { data } = await llm.callTool({
      label: "stylist",
      model: opts.model ?? MODELS.sonnet,
      system,
      user: base + feedback,
      maxTokens: 2000,
      tool: { name: "recommend_style", description: "Recommend the deck's visual style.", schema },
    });
    const out = applyPrefs(data, brief);
    const failures = checkContrast(out.colors);
    if (failures.length === 0) {
      const style = Style.parse({
        look: out.look,
        designStyle: out.designStyle === "none" ? "" : out.designStyle,
        theme: { colors: out.colors, fonts: out.fonts, backdrop: out.backdrop },
        motion: out.motion,
        use3d: out.use3d,
        interactivity: out.interactivity,
        density: out.density,
        surface: out.surface,
        features: out.features,
      });
      return { style, rationale: out.rationale, attempts: attempt };
    }
    last = { out, failures };
    feedback =
      `\n\nYour previous palette failed WCAG AA:\n${JSON.stringify(out.colors)}\n` +
      failures.map((f) => `- ${f.fg} on ${f.bg}: ${f.ratio}:1, needs ${f.min}:1`).join("\n") +
      "\nKeep the look, but adjust the failing colours (lightness first, hue second) so every pair passes.";
  }
  throw new LlmError(
    `stylist: palette still fails WCAG AA after ${maxAttempts} attempts: ${last!.failures.map((f) => `${f.fg}/${f.bg} ${f.ratio}`).join(", ")}`,
  );
}
