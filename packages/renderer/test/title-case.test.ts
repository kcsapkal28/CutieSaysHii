import { describe, expect, it } from "vitest";
import { emphasize, escapeHtml } from "../src/blocks/escape.ts";
import { titleCase } from "../src/blocks/title-case.ts";

const briefCases: [string, string][] = [
  ["path of a photon", "Path of a Photon"],
  ["how solar cells work", "How Solar Cells Work"],
  ["the iPhone and mRNA: a story", "The iPhone and mRNA: A Story"],
  ["GPT-4 vs. 3D printing", "GPT-4 vs. 3D Printing"],
  ["energy-intensive purification", "Energy-Intensive Purification"],
  ["what is it for", "What Is It For"],
  ['a "quoted" word', 'A "Quoted" Word'],
  ["NASA in 2024", "NASA in 2024"],
  ["", ""],
  ["  two  spaces ", "  Two  Spaces "],
];

const compoundCases: [string, string][] = [
  ["an in-depth look", "An In-Depth Look"],
  ["keeping up-to-date records", "Keeping Up-to-Date Records"],
  ["our in-house tools", "Our In-House Tools"],
  ["follow-up", "Follow-Up"],
  ["trade-off", "Trade-Off"],
  ["state-of-the-art", "State-of-the-Art"],
  ["a follow-up plan", "A Follow-Up Plan"],
  ["non‐stop and well‑known", "Non‐Stop and Well‑Known"],
];

const singleLetterCases: [string, string][] = [
  ["vitamin A in food", "Vitamin A in Food"],
  ["plan A or plan B", "Plan A or Plan B"],
  ["Series A funding", "Series A Funding"],
  ["choose a side", "Choose a Side"],
];

const unicodeCases: [string, string][] = [
  ["ﬁnance", "ﬁnance"],
  ["ßtraße ahead", "ßtraße Ahead"],
  ["the élan of über cool 5G and 10x gains", "The Élan of Über Cool 5G and 10x Gains"],
  ["𐐨 deseret word", "𐐀 Deseret Word"],
];

const wordTokenCases: [string, string][] = [
  ["🚀 the launch plan", "🚀 The Launch Plan"],
  ["what it stands on 🚀", "What It Stands On 🚀"],
  ["what it stands on — 2024", "What It Stands on — 2024"],
];

const punctuationCases: [string, string][] = [
  ["[draft] notes", "[Draft] Notes"],
  ["«le monde»", "«Le Monde»"],
  ["(early) “wins” and ‘losses’", "(Early) “Wins” and ‘Losses’"],
  ["¿qué pasa? ¡vamos!", "¿Qué Pasa? ¡Vamos!"],
  ["salt &amp; pepper", "Salt &amp; Pepper"],
  ["&amp; more", "&amp; More"],
  ['"x:" a tale', '"X:" A Tale'],
  ["the plan (v2:) a guide", "The Plan (v2:) A Guide"],
];

const otherCases: [string, string][] = [
  ["The Rise Of The Machines", "The Rise of the Machines"],
  ["what it stands on", "What It Stands On"],
  ["line\tand\nbreak", "Line\tand\nBreak"],
  ["rock & roll <b>bold</b> moves", "Rock & Roll <b>bold</b> Moves"],
];

const allCases = [
  ...briefCases,
  ...compoundCases,
  ...singleLetterCases,
  ...unicodeCases,
  ...wordTokenCases,
  ...punctuationCases,
  ...otherCases,
];

describe("titleCase", () => {
  it.each(briefCases)("titleCase cases: %j", (input, expected) => {
    expect(titleCase(input)).toBe(expected);
  });

  it.each(compoundCases)("capitalises the first and last part of every compound: %j", (input, expected) => {
    expect(titleCase(input)).toBe(expected);
  });

  it.each(singleLetterCases)("leaves a lone uppercase letter alone: %j", (input, expected) => {
    expect(titleCase(input)).toBe(expected);
  });

  it.each(unicodeCases)("cases by code point and never expands a letter: %j", (input, expected) => {
    expect(titleCase(input)).toBe(expected);
  });

  it.each(wordTokenCases)("picks first and last among word tokens only: %j", (input, expected) => {
    expect(titleCase(input)).toBe(expected);
  });

  it.each(punctuationCases)("skips opening punctuation and sees colons through closers: %j", (input, expected) => {
    expect(titleCase(input)).toBe(expected);
  });

  it.each(otherCases)("handles minor words, markup and whitespace: %j", (input, expected) => {
    expect(titleCase(input)).toBe(expected);
  });

  it.each(allCases)("is idempotent: %j", (input) => {
    const once = titleCase(input);
    expect(titleCase(once)).toBe(once);
  });

  const htmlish = ["rock & roll <b>bold</b> moves", "salt &amp; pepper", "a <script>x</script> tag", "it's 'fine' & \"done\""];

  it.each(htmlish)("only changes letter case, so escaping is unaffected: %j", (input) => {
    const cased = titleCase(input);
    expect(cased.toLowerCase()).toBe(input.toLowerCase());
    expect(escapeHtml(cased).toLowerCase()).toBe(escapeHtml(input).toLowerCase());
  });

  it("keeps emphasis targets matching after casing", () => {
    expect(emphasize(titleCase("path of a photon"), ["photon"])).toBe(
      'Path of a <mark class="df-emph" data-emphasis>Photon</mark>',
    );
    expect(emphasize(titleCase("rock & roll <b>forever</b>"), ["& roll <b>"])).toBe(
      'Rock <mark class="df-emph" data-emphasis>&amp; Roll &lt;b&gt;</mark>forever&lt;/b&gt;',
    );
  });
});
