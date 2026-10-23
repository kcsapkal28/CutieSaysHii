import type { Block, LayoutSpec, Slide } from "@deckforge/schemas";

export type LengthClass = "s" | "m" | "l";

const pad2 = (n: number) => String(n).padStart(2, "0");

// Cover, section and qa slides carry their own context, so they get no kicker.
const NO_KICKER = new Set(["title", "section", "qa"]);

/** Length bucket of a title in characters (code points), so long titles can step down a size. */
export function lengthClass(text: string): LengthClass {
  const n = [...text].length;
  return n <= 18 ? "s" : n <= 36 ? "m" : "l";
}

/** Raw kicker text for slide `index`; the caller cases and escapes it. */
export function kickerFor(slides: Slide[], index: number, layout: LayoutSpec): string {
  const slide = slides[index];
  if (!slide || NO_KICKER.has(slide.type)) return "";
  switch (layout.kicker) {
    case "section":
      return slides.slice(0, index).findLast((s) => s.type === "section")?.title ?? "";
    case "index":
      return pad2(index + 1);
    case "none":
      return "";
  }
}

/** On a section slide, its 1-based ordinal among section slides, padded to 2 digits; otherwise "". */
export function sectionNumber(slides: Slide[], index: number): string {
  if (slides[index]?.type !== "section") return "";
  return pad2(slides.slice(0, index + 1).filter((s) => s.type === "section").length);
}

export function decorates(layout: LayoutSpec, slideType: string): boolean {
  if (layout.decoration === "none") return false;
  return layout.decorationOn === "all" || layout.decorationOn.includes(slideType);
}

/** Items in the first list-like block: Bullets items, Stat blocks, Timeline steps or Compare rows; else 0. */
export function itemCount(blocks: Block[]): number {
  for (const b of blocks) {
    switch (b.type) {
      case "Bullets":
        return b.items.length;
      case "Stat":
        return blocks.filter((s) => s.type === "Stat").length;
      case "Timeline":
        return b.steps.length;
      case "Compare":
        return b.rows.length;
    }
  }
  return 0;
}
