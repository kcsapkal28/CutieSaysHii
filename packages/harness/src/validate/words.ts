import type { Block, DeckSpec, Slide } from "@deckforge/schemas";

export type CoverText = Pick<DeckSpec, "title" | "subtitle">;

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// Text the audience reads on the slide. Notes, code, mermaid source, image prompt and quiz
// explanations are not counted; image alt is shown only as the caption fallback.
export function blockTexts(block: Block): string[] {
  switch (block.type) {
    case "Bullets":
      return block.items;
    case "Paragraph":
      return [block.text];
    case "Stat":
      return [block.value, block.label];
    case "Quote":
      return [block.text, block.attribution];
    case "Compare":
      return [block.leftTitle, block.rightTitle, ...block.rows.flatMap((r) => [r.left, r.right])];
    case "Timeline":
      return block.steps.flatMap((s) => [s.label, s.detail, ...(s.date === undefined ? [] : [s.date])]);
    case "Chart":
      return [...block.labels, ...block.series.map((s) => s.name)];
    case "Quiz":
      return [block.question, ...block.options];
    case "Diagram":
    case "Code":
    case "Image":
      return [];
  }
}

// The renderer's cover shows deck title, deck subtitle and slide.title as a meta line (unless it
// repeats the deck title); body blocks are not rendered there.
function coverTexts(slide: Slide, cover: CoverText): string[] {
  const meta = slide.title && slide.title !== cover.title ? [slide.title] : [];
  return [cover.title, cover.subtitle, ...meta];
}

/** Pass `cover` when the slide renders as the deck cover. */
export function visibleTexts(slide: Slide, cover?: CoverText): string[] {
  if (cover) return coverTexts(slide, cover);
  const hasCaption = slide.body.some((b) => b.type === "Paragraph");
  const alts = hasCaption ? [] : slide.body.flatMap((b) => (b.type === "Image" ? [b.alt] : []));
  return [...(slide.title === undefined ? [] : [slide.title]), ...slide.body.flatMap(blockTexts), ...alts];
}

export function visibleWords(slide: Slide, cover?: CoverText): number {
  return visibleTexts(slide, cover).reduce((sum, text) => sum + countWords(text), 0);
}

// Fields the renderer passes through emphasize(); titles, chart text and image alt are never marked.
function blockEmphasisTexts(block: Block): string[] {
  switch (block.type) {
    case "Bullets":
      return block.items;
    case "Paragraph":
      return [block.text];
    case "Stat":
      return [block.value, block.label];
    case "Quote":
      return [block.text, block.attribution];
    case "Compare":
      return [block.leftTitle, block.rightTitle, ...block.rows.flatMap((r) => [r.left, r.right])];
    case "Timeline":
      return block.steps.flatMap((s) => [...(s.date === undefined ? [] : [s.date]), s.label, s.detail]);
    case "Quiz":
      return [block.question, ...block.options, block.explanation];
    case "Chart":
    case "Diagram":
    case "Code":
    case "Image":
      return [];
  }
}

/** Texts an emphasis target can be marked in (not for a cover, where nothing is emphasised). */
export function emphasisTexts(slide: Slide): string[] {
  return slide.body.flatMap(blockEmphasisTexts);
}
