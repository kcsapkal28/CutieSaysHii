// Design checks that cannot pass yet (design.spec.ts marks them fixme). Before committing, each owning task
// deletes the two lines of every entry that now passes for every deck; Task 11 requires the set to be empty.
// One block per entry, so deleting one never touches a neighbour's lines.
export const PENDING: ReadonlySet<string> = new Set<string>([
  // Task 6a
  "fills-frame",

  // Task 6a
  "vertical-overflow",

  // Task 6a
  "compare-rows-align",

  // Task 6a
  "min-text-size",

  // Task 6a
  "graphics-3to1",

  // Task 6b
  "decorations-behind",

  // Task 6b
  "emphasis-legible",

  // Task 6c
  "chrome-legible",

  // Task 6c
  "slide-number-once",

  // Task 5
  "stat-aria",

  // Task 9
  "image-caption-legible",
]);
