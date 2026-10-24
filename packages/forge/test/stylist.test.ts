import { describe, expect, it } from "vitest";
import { checkContrast, contrastRatio } from "../src/agents/contrast.ts";
import { Brief } from "../src/agents/schemas.ts";
import { installedFonts, runStylist } from "../src/agents/stylist.ts";
import { fakeLlm, styleOut } from "./fakes.ts";

const brief = (prefs = {}) => Brief.parse({ topic: "How ANC works", audience: "engineers", minutes: 8, prefs, createdAt: "now" });

describe("contrast", () => {
  it("computes WCAG ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it("flags muted text that fails on the surface", () => {
    const failures = checkContrast({ ...styleOut().colors, muted: "#4a4560" });
    expect(failures.map((f) => `${f.fg}/${f.bg}`)).toEqual(["muted/bg", "muted/surface"]);
  });
});

describe("stylist", () => {
  it("lists the installed @fontsource ids", () => {
    expect(installedFonts()).toContain("ibm-plex-sans");
    expect(installedFonts()).toContain("jetbrains-mono");
  });

  it("re-asks with the failing pairs when the palette fails AA, then accepts a passing one", async () => {
    const llm = fakeLlm({
      recommend_style: (_req, n) => (n === 1 ? styleOut({ muted: "#4a4560", accent: "#2a2a3a" }) : styleOut()),
    });
    const { style, attempts } = await runStylist(llm, brief());
    expect(attempts).toBe(2);
    expect(style.theme.colors.muted).toBe("#b4aec6");
    const reask = JSON.stringify(llm.requests[1]!.messages[0]);
    expect(reask).toMatch(/failed WCAG AA/);
    expect(reask).toMatch(/muted on bg: [\d.]+:1, needs 4.5:1/);
    expect(reask).toMatch(/accent on surface: [\d.]+:1, needs 3:1/);
  });

  it("gives up after three failing palettes", async () => {
    const llm = fakeLlm({ recommend_style: () => styleOut({ text: "#333333" }) });
    await expect(runStylist(llm, brief())).rejects.toThrow(/still fails WCAG AA after 3 attempts/);
    expect(llm.calls.recommend_style).toBe(3);
  });

  it("lets hard preferences override the recommendation", async () => {
    const llm = fakeLlm({ recommend_style: () => styleOut() });
    const { style } = await runStylist(llm, brief({ use3d: false, interactivity: 1, features: { print: true } }));
    expect(style.use3d).toBe(false);
    expect(style.interactivity).toBe(1);
    expect(style.features).toEqual({ timer: true, notes: true, stepNav: false, print: true });
  });

  it("rejects fonts that aren't installed (validation retry)", async () => {
    const llm = fakeLlm({
      recommend_style: (_req, n) => (n === 1 ? { ...styleOut(), fonts: { display: "comic-sans", body: "inter", mono: "inter" } } : styleOut()),
    });
    await runStylist(llm, brief());
    expect(llm.calls.recommend_style).toBe(2);
    expect(JSON.stringify(llm.requests[1]!.messages.at(-1))).toMatch(/fonts\.display/);
  });
});
