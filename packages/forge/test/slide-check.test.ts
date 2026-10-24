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

  it("reports the engine's contract issues plus the agent-side rules", () => {
    const html =
      `<section class="df-slide" id="s02"><img src="https://x.test/a.png"></section>` +
      `<style>.chip{color:red} @keyframes pulse{to{opacity:1}} #s01 h1{width:50vw}</style>` +
      `<script>import("three"); fetch("/x"); DF.slide("s01", () => ({}));</script>`;
    const problems = checkSlideHtml(html, "s01").join("\n");
    expect(problems).toMatch(/must have id="s01"/);
    expect(problems).toMatch(/selector ".chip" must start with "#s01"/);
    expect(problems).toMatch(/@keyframes "pulse" must be named with the slide prefix/);
    expect(problems).toMatch(/external reference/);
    expect(problems).toMatch(/no viewport units/);
    expect(problems).toMatch(/no import statements/);
    expect(problems).toMatch(/no network access/);
    expect(problems).toMatch(/df-notes/);
  });

  it("requires DF.slide with the slide's id", () => {
    expect(checkSlideHtml(slideHtml("s01").replace('DF.slide("s01"', 'DF.slide("s9"'), "s01").join("\n")).toMatch(/must call DF\.slide\("s01"/);
  });
});
