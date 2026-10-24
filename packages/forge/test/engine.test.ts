import { describe, expect, it } from "vitest";
import { bundleHtml, checkSlide, ContractError, externalRefs, FONT_IDS, fontFaceCss, readProject, themeCss, ThemeError, type DeckConfig } from "../src/index.ts";

const light = readProject(new URL("./fixtures/light", import.meta.url).pathname);
const theme = light.config.style.theme;

const ok = `<section class="df-slide" id="s01"><h1 class="t">Hi</h1></section>
<style>#s01 .t { color: var(--df-accent) } @media (min-width: 1px) { #s01 .t { color: red } } @keyframes s01-in { from { opacity: 0 } }</style>
<script>DF.slide("s01", (api) => ({ steps: 2 }));</script>`;

function deck(slides: Record<string, string>): { config: DeckConfig; slides: Record<string, string> } {
  const config: DeckConfig = { ...light.config, slides: Object.keys(slides).map((id) => ({ id, title: id })) };
  return { config, slides };
}

describe("theme", () => {
  it("emits every --df-* variable", () => {
    const css = themeCss(theme);
    for (const v of ["bg", "surface", "text", "muted", "line", "accent", "accent-2", "accent-3"]) expect(css).toContain(`--df-${v}:`);
    expect(css).toContain(`--df-accent:${theme.colors.accent}`);
    expect(css).toMatch(/--df-font-display:"Inter Tight", /);
    expect(css).toMatch(/--df-font-mono:"JetBrains Mono", /);
    expect(css).toContain("--df-backdrop:var(--df-bg)");
  });

  it("rejects unknown fonts and unsafe values", () => {
    expect(() => themeCss({ ...theme, fonts: { ...theme.fonts, body: "comic-sans" } })).toThrow(ThemeError);
    expect(() => themeCss({ ...theme, backdrop: "url(https://x.test/a.png)" })).toThrow(ThemeError);
    expect(() => themeCss({ ...theme, colors: { ...theme.colors, bg: "red;}</style>" } })).toThrow(ThemeError);
  });

  it("inlines latin woff2 for the requested weights only", () => {
    expect(FONT_IDS).toContain("ibm-plex-sans");
    const css = fontFaceCss(["inter"], [400, 700]);
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css).toContain("data:font/woff2;base64,");
    expect(css).not.toMatch(/https?:/);
  });
});

describe("contract check", () => {
  it("accepts a valid slide", () => {
    expect(checkSlide("s01", ok).issues).toEqual([]);
  });

  const cases: [string, string, RegExp][] = [
    ["wrong id", ok.replace('id="s01"', 'id="s02"'), /must have id="s01"/],
    ["two sections", ok + '<section class="df-slide" id="s01"></section>', /exactly one <section/],
    ["unscoped selector", ok.replace("#s01 .t {", ".t {"), /selector "\.t" must start with "#s01"/],
    ["unscoped in @media", ok.replace("{ #s01 .t { color: red }", "{ body { color: red }"), /selector "body"/],
    ["global keyframes", ok.replace("s01-in", "fade"), /@keyframes "fade" must be named/],
    ["missing DF.slide", ok.replace('DF.slide("s01"', 'DF.slide("s09"'), /must call DF\.slide\("s01"/],
    ["syntax error", ok.replace("({ steps: 2 })", "({ steps: })"), /JavaScript syntax error/],
    ["external script", `${ok}<script src="https://cdn.test/x.js"></script>`, /script src/],
    ["remote image", ok.replace("<h1", '<img src="https://x.test/a.png"><h1'), /external reference/],
    ["@import", ok.replace("<style>", "<style>@import url(https://fonts.test/a.css);"), /@import/],
    ["full document", `<html>${ok}</html>`, /remove <html>/],
  ];
  it.each(cases)("flags %s", (_name, src, re) => {
    const { issues } = checkSlide("s01", src);
    expect(issues.join("\n")).toMatch(re);
  });

  it("bundle throws ContractError listing issues of every slide", async () => {
    const bad = deck({ s01: ok.replace("#s01 .t {", ".t {"), s02: ok });
    const err = await bundleHtml(bad).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ContractError);
    const issues = (err as ContractError).issues.join("\n");
    expect(issues).toMatch(/^s01: <style> selector/m);
    expect(issues).toMatch(/^s02: the <section class="df-slide"> must have id="s02"/m);
  });
});

describe("bundle", () => {
  it("is self-contained: no external URLs, fonts and libs inlined", async () => {
    const html = await bundleHtml(light);
    expect(externalRefs(html)).toEqual([]);
    expect(html).not.toMatch(/<(script|link|img)\b[^>]*\s(src|href)\s*=\s*["']?https?:/i);
    expect(html).not.toMatch(/@import/);
    expect(html).toContain("data:font/woff2;base64,");
    expect(html).toContain('id="df-lib-gsap"');
    expect(html).not.toContain('id="df-lib-three"'); // no slide uses THREE
    expect(html).toContain('<section class="df-slide" id="s01">');
    expect(html).toContain("DF.boot()");
  });

  it("writes the style's surface as --df-* variables (defaults for an old deck.json)", async () => {
    expect(await bundleHtml(light)).toContain("--df-radius:18px");
    const style = { ...light.config.style, surface: { radius: "sharp", border: "bold", depth: "hard", texture: "grain" } as const };
    const html = await bundleHtml({ ...light, config: { ...light.config, style } });
    expect(html).toMatch(/--df-radius:0px;.*--df-border-w:3px;.*--df-shadow:10px 10px 0 0 var\(--df-text\)/);
    expect(html).toContain("--df-texture:url(\"data:image/svg+xml,");
    expect(externalRefs(html)).toEqual([]);
  });

  it("adds Three.js only when a slide uses it", async () => {
    const three = ok.replace("({ steps: 2 })", "{ const k = api.three(api.el); return {}; }");
    const html = await bundleHtml(deck({ s01: three }));
    expect(html).toContain('id="df-lib-three"');
    expect(externalRefs(html)).toEqual([]);
  });
});
