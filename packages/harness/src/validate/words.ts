import type { Block, Slide } from "@deckforge/schemas";

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// Text the audience reads on the slide. Notes, code, mermaid source, image prompt/alt and quiz
// explanations are not counted.
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

export function visibleTexts(slide: Slide): string[] {
  return [...(slide.title === undefined ? [] : [slide.title]), ...slide.body.flatMap(blockTexts)];
}

export function visibleWords(slide: Slide): number {
  return visibleTexts(slide).reduce((sum, text) => sum + countWords(text), 0);
}
