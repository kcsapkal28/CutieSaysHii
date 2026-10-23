const MINOR_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "off",
  "on", "or", "per", "so", "the", "to", "up", "via", "vs", "vs.", "yet",
]);
// No \p{Po}: "&amp;" must never become "&Amp;".
const LEADING_PUNCTUATION = /^[\p{Ps}\p{Pi}"'¿¡„]*/u;
const TRAILING_PUNCTUATION = /[.,;:!?\p{Pe}\p{Pf}"']+$/u;
const ENDS_WITH_COLON = /:[\p{Pe}\p{Pf}"']*$/u;
const COMPOUND_SEPARATOR = /([-‐‑])/;
// Digits count, so "NASA in 2024" keeps "in" minor; emoji and symbol-only tokens do not.
const IS_WORD = /[\p{L}\p{N}]/u;

// Only letter case changes, so callers escape and emphasise afterwards.
function casePart(part: string, capitaliseMinor: boolean): string {
  const lead = LEADING_PUNCTUATION.exec(part)![0];
  const core = part.slice(lead.length);
  const first = [...core][0];
  if (first === undefined) return part;
  const rest = core.slice(first.length);
  const bare = core.replace(TRAILING_PUNCTUATION, "");
  if (/\d/.test(core) || /\p{Lu}/u.test(rest) || /^\p{Lu}$/u.test(bare)) return part;
  const lower = core.toLowerCase();
  const minor = MINOR_WORDS.has(lower) || MINOR_WORDS.has(bare.toLowerCase());
  if (minor && !capitaliseMinor) return lead + lower;
  const upper = first.toUpperCase();
  if (upper.length !== first.length) return part;
  return lead + upper + rest;
}

function caseToken(token: string, capitaliseMinor: boolean): string {
  const pieces = token.split(COMPOUND_SEPARATOR);
  if (pieces.length === 1) return casePart(token, capitaliseMinor);
  // Compounds capitalise their first and last parts wherever they sit (Chicago/AP/APA).
  const last = pieces.length - 1;
  return pieces.map((piece, j) => (j % 2 === 1 ? piece : casePart(piece, j === 0 || j === last))).join("");
}

export function titleCase(text: string): string {
  // The capture group keeps whitespace runs at odd indices so they rejoin exactly.
  const tokens = text.split(/(\s+)/);
  const wordIndices = tokens.flatMap((t, i) => (i % 2 === 0 && IS_WORD.test(t) ? [i] : []));
  const firstWord = wordIndices[0];
  const lastWord = wordIndices.at(-1);
  let afterColon = false;
  return tokens
    .map((token, i) => {
      if (i % 2 === 1 || !token) return token;
      const isWord = IS_WORD.test(token);
      const cased = isWord ? caseToken(token, i === firstWord || i === lastWord || afterColon) : token;
      if (ENDS_WITH_COLON.test(token)) afterColon = true;
      else if (isWord) afterColon = false;
      return cased;
    })
    .join("");
}
