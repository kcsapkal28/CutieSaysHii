import { describe, expect, it } from "vitest";
import { checkSlideHtml } from "../src/agents/slide-check.ts";
import { slideHtml } from "./fakes.ts";

describe("checkSlideHtml", () => {
  it("accepts a contract-valid fragment", () => {
    expect(checkSlideHtml(slideHtml("s03"), "s03")).toEqual([]);
  });

  it("accepts prefixed selectors inside @media and prefixed @keyframes", () => {
    const html = slideHtml("s01").replace(
      "</style>",
      "@media (min-width: 1px){#s01 .a, #s01 .b:hover{color:var(--df-accent)}} @keyframes s01-pulse{from{opacity:0}to{opacity:1}}</style>",
    );
    expect(checkSlideHtml(html, "s01")).toEqual([]);
  });

  it("flags unscoped selectors, bad keyframes, wrong ids, imports and external URLs", () => {
    const html =
      `<section class="df-slide" id="s02"><img src="https://x.test/a.png"></section>` +
      `<style>.chip{color:red} body{margin:0} @keyframes pulse{to{opacity:1}} #s01 h1{width:50vw}</style>` +
      `<script type="module">import * as THREE from "three"; DF.slide("s01", () => ({}));</script>`;
    const problems = checkSlideHtml(html, "s01");
    expect(problems).toEqual(
      expect.arrayContaining([
        'the df-slide section must have id="s01"',
        'CSS selector ".chip" must start with #s01',
        'CSS selector "body" must start with #s01',
        '@keyframes "pulse" must be prefixed "s01-"',
        "no viewport units (vw/vh): lay out in px on the 1920×1080 canvas",
        "the script must be inline and classic (no type=module, no src)",
        "no import statements: use api.THREE and api.gsap",
        "no external resources (http URLs, @import): the deck must work offline",
        'put the speaker notes in <aside class="df-notes"> inside the section',
      ]),
    );
  });

  it("requires DF.slide with the slide's id", () => {
    expect(checkSlideHtml(slideHtml("s01").replace('DF.slide("s01"', 'DF.slide("s9"'), "s01")).toContain(
      'the script must call DF.slide("s01", (api) => …)',
    );
  });
});
