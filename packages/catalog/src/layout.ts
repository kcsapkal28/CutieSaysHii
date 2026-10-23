import { CATALOG_FILES, type Catalog } from "./files.ts";
import type { IntegrityIssue } from "./integrity.ts";

const SPANS = ["title", "body", "wide", "aside"] as const;

/** Rule 11: each family's layout tokens are internally consistent and name real slide types. */
export function checkLayout(c: Catalog): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const slideTypeIds = new Set(c.slideTypes.types.map((t) => t.id));

  c.styles.families.forEach((f, i) => {
    const at = `families.${i}.layout`;
    const add = (path: string, message: string) =>
      issues.push({ file: CATALOG_FILES.styles, path: `${at}.${path}`, message: `${f.id}: ${message}` });
    const { grid, steps, decoration, decorationOn } = f.layout;

    for (const key of SPANS) {
      const [start, end] = grid[key];
      if (start >= end) add(`grid.${key}`, `grid.${key} starts at line ${start} but ends at ${end}`);
    }
    const [asideStart, asideEnd] = grid.aside;
    const [wideStart, wideEnd] = grid.wide;
    if (asideStart <= wideStart || asideEnd > wideEnd)
      add("grid.aside", `grid.aside [${asideStart}, ${asideEnd}] must sit inside grid.wide [${wideStart}, ${wideEnd}] and start after it`);

    if (steps.title >= steps.display)
      add("steps.title", `steps.title ${steps.title} must be below steps.display ${steps.display}`);
    if (steps.stat <= steps.title) add("steps.stat", `steps.stat ${steps.stat} must be above steps.title ${steps.title}`);

    if (Array.isArray(decorationOn))
      decorationOn.forEach((s, j) => {
        if (!slideTypeIds.has(s)) add(`decorationOn.${j}`, `unknown slide type "${s}"`);
      });
    const noSlides = Array.isArray(decorationOn) && decorationOn.length === 0;
    if ((decoration === "none") !== noSlides)
      add("decorationOn", decoration === "none"
        ? `decoration is "none" but decorationOn is ${JSON.stringify(decorationOn)}`
        : `decoration "${decoration}" applies to no slides`);
  });

  return issues;
}
