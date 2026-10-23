import { describe, expect, it } from "vitest";
import {
  BlockSchema,
  BlockUnionSchema,
  BriefSpecSchema,
  DeckSpecSchema,
  LayoutSpecSchema,
  MotionPlanSchema,
  PatchSchema,
  RenderManifestSchema,
  ThemeSpecSchema,
} from "../src/index.ts";

const validBrief = {
  topic: "Solar",
  brief: "x".repeat(20),
  audience: "general",
  durationMin: 10,
  language: "en",
};

const font = { font: "Inter", weights: [400] };
const themeWithoutLayout = {
  familyId: "f",
  paletteId: "p",
  typeFamilyId: "t",
  roles: {
    bg: "#FFFFFF",
    surface: "#F0F0F0",
    text: "#111111",
    textMuted: "#444444",
    primary: "#123456",
    accent: "#654321",
    border: "#DDDDDD",
  },
  type: { display: font, body: font, mono: font, scale: 1.25, bodyLineHeight: 1.5, displayLineHeight: 1.1 },
  radius: "0",
  borderWidth: "1px",
  shadow: "none",
  texture: "none",
  gradients: false,
  imageTreatment: "clean",
  threeJs: false,
  mode: "light",
  density: "low",
  titleCase: "sentence",
};

const minimalLayout = {
  grid: { title: [1, 10], body: [1, 9], wide: [1, 13], aside: [10, 13] },
  align: "start",
  coverAnchor: "bottom",
  steps: { title: 3, display: 5, stat: 6 },
  kicker: "section",
  stat: "bento",
  panel: "flat",
  divider: "hairline",
  decoration: "none",
  decorationOn: [],
  imageLayout: "inset",
  emphasis: "underline",
  tracking: "normal",
};

const validTheme = { ...themeWithoutLayout, layout: minimalLayout };

const validMotion = {
  templateId: "m",
  reducedMotion: "fadeOnly",
  timing: { enter: 0.6, stagger: 0.08, transition: 0.5, easing: "power2.out" },
  slides: { a: { transition: "fade", enter: "fadeUp", emphasis: "none", exit: "fade" } },
};

const validManifest = {
  jobId: "j",
  entry: "index.html",
  slideIds: ["a"],
  assets: [{ path: "index.html", bytes: 10 }],
  totalBytes: 10,
  threeJs: false,
  warnings: [],
};

const without = <T extends object>(obj: T, key: keyof T) =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));

const slide = (id: string) => ({ id, type: "bullets", body: [], notes: "", emphasisTargets: [] });

describe("BriefSpec", () => {
  it("accepts a minimal valid brief", () => {
    expect(BriefSpecSchema.safeParse(validBrief).success).toBe(true);
  });

  it("rejects topic of 2 chars, brief of 1501 chars, durationMin 15", () => {
    expect(BriefSpecSchema.safeParse({ ...validBrief, topic: "ab" }).success).toBe(false);
    expect(BriefSpecSchema.safeParse({ ...validBrief, brief: "x".repeat(1501) }).success).toBe(false);
    expect(BriefSpecSchema.safeParse({ ...validBrief, durationMin: 15 }).success).toBe(false);
  });

  it("trims before checking length", () => {
    expect(BriefSpecSchema.safeParse({ ...validBrief, topic: "  ab  " }).success).toBe(false);
  });
});

describe("Block", () => {
  it("rejects Quiz with answerIndex === options.length", () => {
    const quiz = { type: "Quiz", question: "q", options: ["a", "b", "c"], answerIndex: 3, explanation: "e" };
    expect(BlockSchema.safeParse(quiz).success).toBe(false);
    expect(BlockSchema.safeParse({ ...quiz, answerIndex: 2 }).success).toBe(true);
  });

  it("rejects Chart whose series length differs from labels", () => {
    const chart = { type: "Chart", kind: "bar", labels: ["a", "b", "c"], series: [{ name: "s", values: [1, 2] }] };
    expect(BlockSchema.safeParse(chart).success).toBe(false);
  });

  it("accepts all 11 kinds", () => {
    const fixtures = [
      { type: "Bullets", items: ["a"] },
      { type: "Paragraph", text: "t" },
      { type: "Stat", value: "42%", label: "l", trend: "up" },
      { type: "Quote", text: "t", attribution: "a" },
      { type: "Diagram", mermaid: "graph TD; A-->B", hotspots: [{ nodeId: "A", label: "l", detail: "d" }] },
      { type: "Chart", kind: "line", labels: ["a", "b", "c"], series: [{ name: "s", values: [1, 2, 3] }], unit: "%" },
      { type: "Compare", leftTitle: "l", rightTitle: "r", rows: [{ left: "a", right: "b" }] },
      { type: "Timeline", steps: [{ label: "l", detail: "d", date: "2026" }] },
      { type: "Code", lang: "ts", code: "let x = 1;", highlightLines: [1] },
      { type: "Image", prompt: "p", alt: "a" },
      { type: "Quiz", question: "q", options: ["a", "b", "c"], answerIndex: 0, explanation: "e" },
    ];
    for (const f of fixtures) {
      expect(BlockSchema.safeParse(f).success, f.type).toBe(true);
    }
    expect(BlockUnionSchema.options.length).toBe(11);
  });
});

describe("DeckSpec", () => {
  it("rejects duplicate slide ids", () => {
    const deck = { title: "t", subtitle: "s", slides: [slide("a"), slide("a")] };
    expect(DeckSpecSchema.safeParse(deck).success).toBe(false);
    expect(DeckSpecSchema.safeParse({ ...deck, slides: [slide("a"), slide("b")] }).success).toBe(true);
  });
});

describe("ThemeSpec", () => {
  it('rejects roles.bg = "#FFF"', () => {
    expect(ThemeSpecSchema.safeParse(validTheme).success).toBe(true);
    expect(ThemeSpecSchema.safeParse({ ...validTheme, roles: { ...validTheme.roles, bg: "#FFF" } }).success).toBe(false);
  });
});

describe("ThemeSpec additions", () => {
  it("requires mode/density/titleCase", () => {
    for (const key of ["mode", "density", "titleCase"] as const) {
      expect(ThemeSpecSchema.safeParse(without(validTheme, key)).success, key).toBe(false);
    }
  });

  it("accepts optional backdropBlur/surfaceAlpha and rejects surfaceAlpha outside 0..1", () => {
    const glass = { ...validTheme, backdropBlur: "16px", surfaceAlpha: 0.55 };
    expect(ThemeSpecSchema.safeParse(glass).success).toBe(true);
    expect(ThemeSpecSchema.safeParse({ ...glass, surfaceAlpha: 1.5 }).success).toBe(false);
  });
});

describe("ThemeSpec layout", () => {
  it("ThemeSpec requires layout", () => {
    expect(ThemeSpecSchema.safeParse(themeWithoutLayout).success).toBe(false);
    expect(ThemeSpecSchema.safeParse(validTheme).success).toBe(true);
  });

  it("LayoutSpec rejects unknown keys and out-of-range spans", () => {
    expect(LayoutSpecSchema.safeParse(minimalLayout).success).toBe(true);
    const withTitle = (title: number[]) => ({ ...minimalLayout, grid: { ...minimalLayout.grid, title } });
    expect(LayoutSpecSchema.safeParse(withTitle([0, 10])).success).toBe(false);
    expect(LayoutSpecSchema.safeParse(withTitle([1, 14])).success).toBe(false);
    expect(LayoutSpecSchema.safeParse({ ...minimalLayout, extra: 1 }).success).toBe(false);
  });
});

describe("MotionPlan", () => {
  it("requires timing", () => {
    expect(MotionPlanSchema.safeParse(validMotion).success).toBe(true);
    expect(MotionPlanSchema.safeParse(without(validMotion, "timing")).success).toBe(false);
  });
});

describe("RenderManifest", () => {
  it("requires warnings", () => {
    expect(RenderManifestSchema.safeParse(validManifest).success).toBe(true);
    expect(RenderManifestSchema.safeParse(without(validManifest, "warnings")).success).toBe(false);
  });
});

describe("Patch", () => {
  it('rejects op "rewrite"', () => {
    expect(PatchSchema.safeParse({ slideId: "a", op: "rewrite", payload: {} }).success).toBe(false);
    expect(PatchSchema.safeParse({ slideId: "a", op: "splitSlide", payload: {} }).success).toBe(true);
  });
});
