// Design checks that cannot pass yet, mapped to the task that owns them. design.spec.ts still runs each one,
// annotates whether it fails or now passes, then marks it fixme. Before committing, an owning task deletes the
// two lines of every entry that now passes for every deck; Task 11 requires the map to be empty.
// One block per entry, so deleting one never touches a neighbour's lines.
export const PENDING: ReadonlyMap<string, string> = new Map([
  // Task 6a
  ["fills-frame", "6a"],

  // Task 6a
  ["title-ratio", "6a"],

  // Task 6a
  ["compare-rows-align", "6a"],

  // Task 6a
  ["min-text-size", "6a"],

  // Task 6a
  ["graphics-3to1", "6a"],

  // Task 6b
  ["decorations-behind", "6b"],

  // Task 6b
  ["emphasis-legible", "6b"],

  // Task 6c
  ["chrome-legible", "6c"],

  // Task 6c
  ["slide-number-once", "6c"],
]);
