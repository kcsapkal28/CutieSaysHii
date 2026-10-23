import { z } from "zod";

export const IssueSchema = z.object({ path: z.string(), code: z.string(), message: z.string() });
export type Issue = z.infer<typeof IssueSchema>;

export function issuePath(path: ReadonlyArray<string | number>): string {
  return path.reduce<string>((out, key) => (typeof key === "number" ? `${out}[${key}]` : out ? `${out}.${key}` : key), "");
}

export function zodToIssues(error: z.ZodError): Issue[] {
  return error.issues.map((i) => ({ path: issuePath(i.path), code: i.code, message: i.message }));
}

export function formatIssues(issues: readonly Issue[], max = 20): string {
  const lines = issues.slice(0, max).map((i) => `- ${i.path || "(root)"}: ${i.message} (${i.code})`);
  if (issues.length > max) lines.push(`… and ${issues.length - max} more`);
  return lines.join("\n");
}
