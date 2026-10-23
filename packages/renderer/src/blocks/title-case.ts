const MINOR_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "off",
  "on", "or", "per", "so", "the", "to", "up", "via", "vs", "vs.", "yet",
]);
const LEADING_PUNCTUATION = /^["'(“‘]*/;
const TRAILING_PUNCTUATION = /[.,;:!?"')’”]+$/;

// Only letter case changes, so callers escape and emphasise afterwards.
function casePart(part: string, capitaliseMinor: boolean): string {
  const lead = LEADING_PUNCTUATION.exec(part)![0];
  const core = part.slice(lead.length);
  if (/\d/.test(core) || /\p{Lu}/u.test(core.slice(1))) return part;
  const lower = core.toLowerCase();
  const minor = MINOR_WORDS.has(lower) || MINOR_WORDS.has(lower.replace(TRAILING_PUNCTUATION, ""));
  if (minor && !capitaliseMinor) return lead + lower;
  return lead + core.charAt(0).toUpperCase() + core.slice(1);
}

export function titleCase(text: string): string {
  // The capture group keeps whitespace runs at odd indices so they rejoin exactly.
  const tokens = text.split(/(\s+)/);
  const wordIndices = tokens.flatMap((t, i) => (i % 2 === 0 && t ? [i] : []));
  const firstWord = wordIndices[0];
  const lastWord = wordIndices.at(-1);
  let afterColon = false;
  return tokens
    .map((token, i) => {
      if (i % 2 === 1 || !token) return token;
      const parts = token.split("-");
      const cased = parts.map((part, j) => {
        const opens = j === 0 && (i === firstWord || afterColon);
        const closes = j === parts.length - 1 && i === lastWord;
        return casePart(part, opens || closes);
      });
      afterColon = token.endsWith(":");
      return cased.join("-");
    })
    .join("");
}
