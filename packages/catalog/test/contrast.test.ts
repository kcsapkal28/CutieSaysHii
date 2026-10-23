import { describe, expect, it } from "vitest";
import { AA_RATIO, contrastRatio, normalizeHex, passesAA } from "../src/contrast.ts";

describe("contrast", () => {
  it("black on white is 21", () => {
    expect(contrastRatio("#000", "#FFFFFF")).toBeCloseTo(21, 2);
  });

  it("ratio is symmetric", () => {
    expect(contrastRatio("#3D2C29", "#FBF3E4")).toBe(contrastRatio("#FBF3E4", "#3D2C29"));
  });

  it("normalizes hex case and shorthand", () => {
    expect(normalizeHex("#d0253b")).toBe("#D0253B");
    expect(normalizeHex("#fff")).toBe("#FFFFFF");
    expect(() => normalizeHex("red")).toThrow();
    expect(() => normalizeHex("#12345")).toThrow();
  });

  it("case does not change the ratio", () => {
    expect(contrastRatio("#d0253b", "#f5f2eb")).toBe(contrastRatio("#D0253B", "#F5F2EB"));
  });

  it("fixed palettes pass", () => {
    expect(AA_RATIO).toBe(4.5);
    expect(passesAA("#FBF3E4", "#60578D")).toBe(true);
    expect(passesAA("#F5F2EB", "#D0253B")).toBe(true);
  });

  it("old values fail", () => {
    expect(passesAA("#FBF3E4", "#786FA6")).toBe(false);
  });
});
