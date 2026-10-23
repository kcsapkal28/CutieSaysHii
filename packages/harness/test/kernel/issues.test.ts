import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatIssues, IssueSchema, zodToIssues, type Issue } from "../../src/kernel/issues.ts";

describe("zodToIssues", () => {
  it("maps paths with array indices and keeps zod's code and message", () => {
    const schema = z.object({ slides: z.array(z.object({ title: z.string(), body: z.array(z.number()) })) });
    const result = schema.safeParse({ slides: [{ title: "ok", body: [1] }, { title: 3, body: [1, "x"] }] });
    expect(result.success).toBe(false);
    const issues = zodToIssues(result.error!);
    expect(issues).toEqual([
      { path: "slides[1].title", code: "invalid_type", message: "Expected string, received number" },
      { path: "slides[1].body[1]", code: "invalid_type", message: "Expected number, received string" },
    ]);
    for (const issue of issues) expect(IssueSchema.parse(issue)).toEqual(issue);
  });

  it("uses an empty path for root issues", () => {
    const result = z.string().safeParse(1);
    expect(zodToIssues(result.error!)[0]?.path).toBe("");
  });
});

describe("formatIssues", () => {
  const issue = (i: number): Issue => ({ path: `slides[${i}]`, code: "limit", message: `too long ${i}` });

  it("one line per issue, root shown as (root)", () => {
    expect(formatIssues([issue(0), { path: "", code: "custom", message: "bad" }])).toBe(
      "- slides[0]: too long 0 (limit)\n- (root): bad (custom)",
    );
  });

  it("caps at max=20 and counts the rest", () => {
    const many = Array.from({ length: 23 }, (_, i) => issue(i));
    const lines = formatIssues(many).split("\n");
    expect(lines).toHaveLength(21);
    expect(lines[19]).toBe("- slides[19]: too long 19 (limit)");
    expect(lines[20]).toBe("… and 3 more");
    expect(formatIssues(many, 2).split("\n")).toEqual([
      "- slides[0]: too long 0 (limit)",
      "- slides[1]: too long 1 (limit)",
      "… and 21 more",
    ]);
  });

  it("empty list formats as empty string", () => {
    expect(formatIssues([])).toBe("");
  });
});
