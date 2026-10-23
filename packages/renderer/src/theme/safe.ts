export class UnsafeThemeValueError extends Error {
  constructor(public readonly field: string) {
    super(`theme value "${field}" contains characters not allowed in CSS output`);
    this.name = "UnsafeThemeValueError";
  }
}

// ThemeSpec comes from an LLM: nothing that could close a declaration or block, or open a comment, may reach the CSS.
const UNSAFE = /[;{}<>\\]|\/\*|\*\//;
export const UNSAFE_IN_QUOTES = /["\r\n]/;

export function assertSafe(field: string, value: string, extra?: RegExp): string {
  if (UNSAFE.test(value) || extra?.test(value)) throw new UnsafeThemeValueError(field);
  return value;
}
