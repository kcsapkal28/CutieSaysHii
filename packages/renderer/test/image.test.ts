import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { LayoutSpecSchema, type Block } from "@deckforge/schemas";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/blocks/hash.ts";
import { imageAlt, placeholderImageSvg } from "../src/blocks/image.ts";

type ImageBlock = Extract<Block, { type: "Image" }>;

const read = (rel: string) => readFile(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const image = (prompt: string, alt = "a picture"): ImageBlock => ({ type: "Image", prompt, alt });
const PROMPTS = Array.from({ length: 60 }, (_, i) => `prompt ${i}: rows of solar panels at dawn`);
const ids = (svg: string) => [...svg.matchAll(/ id="([^"]*)"/g)].map((m) => m[1]!);
const num = (s: string | undefined) => Number(s);

describe("placeholderImageSvg", () => {
  it("placeholder is deterministic and slice-fitted", () => {
    const img = image("Cross-section of a silicon solar cell");
    const a = placeholderImageSvg(img);
    expect(placeholderImageSvg({ ...img })).toBe(a);
    expect(placeholderImageSvg(image("another prompt"))).not.toBe(a);
    expect(a).toContain('viewBox="0 0 1600 900"');
    expect(a).toContain('preserveAspectRatio="xMidYMid slice"');
    expect(a).not.toMatch(/NaN|Infinity|undefined/);
  });

  it("two prompts never share gradient ids", () => {
    const seen = new Map<string, string>();
    for (const prompt of PROMPTS) {
      const svg = placeholderImageSvg(image(prompt));
      const own = ids(svg);
      expect(own.length).toBeGreaterThan(0);
      for (const id of own) {
        expect(id.startsWith(`df-img-${sha256Hex(prompt).slice(0, 8)}`)).toBe(true);
        expect(seen.get(id) ?? prompt).toBe(prompt);
        seen.set(id, prompt);
      }
      // Every url(#…) reference resolves to an id in the same svg.
      for (const [, ref] of svg.matchAll(/url\(#([^)]+)\)/g)) expect(own).toContain(ref);
    }
  });

  it("placeholder uses only theme variables", () => {
    for (const prompt of PROMPTS) {
      const svg = placeholderImageSvg(image(prompt));
      expect(svg).not.toMatch(/#[0-9a-f]{3,8}(?![\w-])/i);
      expect(svg).not.toMatch(/rgba?\(|hsla?\(|\b(?:white|black)\b/i);
      const paints = [...svg.matchAll(/(?:fill|stroke|stop-color):([^;"]+)/g)].map((m) => m[1]!.trim());
      expect(paints.length).toBeGreaterThan(0);
      for (const p of paints) expect(p).toMatch(/^(?:var\(--df-[a-z0-9-]+\)|url\(#df-img-[0-9a-f]{8}-[a-z]+\)|none)$/);
    }
  });

  it("composes a gradient field, a focal circle on a thirds intersection and 2-3 horizon bands", () => {
    const thirds = (v: number, size: number) => [size / 3, (2 * size) / 3].some((t) => Math.abs(v - t) <= 1);
    for (const prompt of PROMPTS) {
      const svg = placeholderImageSvg(image(prompt));
      expect(svg).toMatch(/<linearGradient[^>]*>.*stop-color:var\(--df-surface\).*stop-color:var\(--df-fill-1\).*<\/linearGradient>/);
      const circles = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)];
      expect(circles).toHaveLength(1);
      const [, cx, cy, r] = circles[0]!;
      expect(thirds(num(cx), 1600) && thirds(num(cy), 900)).toBe(true);
      expect(num(r)).toBeGreaterThanOrEqual(160);
      expect(num(r)).toBeLessThanOrEqual(260);
      const bands = [...svg.matchAll(/<path class="df-img-band" d="[^"]*" style="fill:var\(--df-(graphic-2|fill-2)\);fill-opacity:([\d.]+)"/g)];
      expect(bands.length).toBeGreaterThanOrEqual(2);
      expect(bands.length).toBeLessThanOrEqual(3);
      for (const [, , o] of bands) {
        expect(num(o)).toBeGreaterThanOrEqual(0.35);
        expect(num(o)).toBeLessThanOrEqual(0.8);
      }
    }
  });

  it("escapes alt", () => {
    const svg = placeholderImageSvg(image("p", 'x "y" <z> & \'w\''));
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="x &quot;y&quot; &lt;z&gt; &amp; &#39;w&#39;"');
    expect(svg).toContain("<title>x &quot;y&quot; &lt;z&gt; &amp; &#39;w&#39;</title>");
    expect(svg).not.toContain("<z>");
    const evil = placeholderImageSvg(image('"><script>alert(1)</script>', '"><script>alert(1)</script>'));
    expect(evil).not.toContain("<script>");
  });

  it("never emits an empty or whitespace alt", () => {
    expect(imageAlt(image("  Rows of panels\n at dawn ", " \n\t "))).toBe("Rows of panels at dawn");
    expect(imageAlt(image("   ", ""))).toBe("Illustration");
    expect(imageAlt(image("p", "  A   cell  "))).toBe("A cell");
    const svg = placeholderImageSvg(image("a quiet hillside", "   "));
    expect(svg).toContain('aria-label="a quiet hillside"');
    expect(svg).not.toMatch(/aria-label="\s*"/);
  });
});

describe("images.css", () => {
  it("every imageLayout value has a rule in images.css", async () => {
    const css = await read("../src/styles/images.css");
    for (const v of LayoutSpecSchema.shape.imageLayout.options) {
      expect(css).toContain(`[data-df-image-layout="${v}"] .df-slide--image`);
    }
  });

  it("duotone treatments blend on an overlay inside an isolated figure", async () => {
    const css = (await read("../src/styles/images.css")).replace(/\/\*[\s\S]*?\*\//g, "");
    // Declarations of every rule whose selector list names `selector` exactly.
    const declsFor = (selector: string) =>
      [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
        .filter((m) => m[1]!.split(",").some((s) => s.trim() === selector))
        .map((m) => m[2]!)
        .join("");
    for (const v of ["duotone", "neon-duotone"]) {
      expect(declsFor(`[data-df-image="${v}"] .df-image::after`)).toContain("mix-blend-mode:");
      const figure = declsFor(`[data-df-image="${v}"] .df-image`);
      expect(figure).toContain("isolation: isolate");
      // The figure itself never blends with the slide behind it.
      expect(figure).not.toContain("mix-blend-mode");
    }
    expect(css).not.toMatch(/\.df-image\s*\{[^}]*mix-blend-mode/);
  });
});
