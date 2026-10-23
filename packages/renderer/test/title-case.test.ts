import { describe, expect, it } from "vitest";
import { emphasize, escapeHtml } from "../src/blocks/escape.ts";
import { titleCase } from "../src/blocks/title-case.ts";

describe("titleCase", () => {
  it.each([
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
  ])("titleCase cases: %j", (input, expected) => {
    expect(titleCase(input)).toBe(expected);
  });

  it.each([
    ["The Rise Of The Machines", "The Rise of the Machines"],
    ["state-of-the-art lasers", "State-of-the-Art Lasers"],
    ["(early) “wins” and ‘losses’", "(Early) “Wins” and ‘Losses’"],
    ["what it stands on", "What It Stands On"],
    ["line\tand\nbreak", "Line\tand\nBreak"],
  ])("handles minor words, compounds, punctuation and whitespace: %j", (input, expected) => {
    expect(titleCase(input)).toBe(expected);
  });

  const htmlish = ["rock & roll <b>bold</b> moves", "salt &amp; pepper", "a <script>x</script> tag", "it's 'fine' & \"done\""];

  it.each(htmlish)("only changes letter case, so escaping is unaffected: %j", (input) => {
    const cased = titleCase(input);
    expect(cased.toLowerCase()).toBe(input.toLowerCase());
    expect(escapeHtml(cased).toLowerCase()).toBe(escapeHtml(input).toLowerCase());
  });

  it("leaves markup-like and entity-like words untouched", () => {
    expect(titleCase("rock & roll <b>bold</b> moves")).toBe("Rock & Roll <b>bold</b> Moves");
    expect(titleCase("salt &amp; pepper")).toBe("Salt &amp; Pepper");
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
