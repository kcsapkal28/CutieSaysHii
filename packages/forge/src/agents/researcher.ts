// Researcher: topic → research notes (rendered to research.md). Model knowledge today; web search plugs in via `search`.
import { MODELS, type Llm } from "../llm.ts";
import { loadPrompt } from "./prompts.ts";
import { Research, type Brief } from "./schemas.ts";

export type WebResult = { title: string; url: string; snippet: string };
/**
 * Hook for milestone 3 (web research with citations). When given, the researcher runs these queries first
 * and passes the results to the model, which cites them as `kind: "web"` sources.
 */
export type WebSearch = (query: string) => Promise<WebResult[]>;

export async function runResearcher(
  llm: Llm,
  brief: Brief,
  opts: { model?: string; search?: WebSearch } = {},
): Promise<{ research: Research; markdown: string }> {
  let web = "";
  if (opts.search) {
    const results = await opts.search(brief.topic);
    web = `\n\nWeb results (cite these by URL where used):\n${results.map((r) => `- [${r.title}](${r.url}): ${r.snippet}`).join("\n")}`;
  }
  const { data } = await llm.callTool({
    label: "researcher",
    model: opts.model ?? MODELS.sonnet,
    system: loadPrompt("researcher"),
    user: `Topic: ${brief.topic}\nAudience: ${brief.audience}\nTalk length: ${brief.minutes} minutes${web}`,
    maxTokens: 12000,
    tool: { name: "record_research", description: "Record the research notes.", schema: Research },
  });
  return { research: data, markdown: researchToMarkdown(brief.topic, data) };
}

export function researchToMarkdown(topic: string, r: Research): string {
  const lines = [`# Research: ${topic}`, "", "## Summary", "", r.summary, "", "## Key facts", ""];
  for (const f of r.keyFacts) lines.push(`- **${f.fact}** ${f.detail}`);
  lines.push("", "## Numbers", "");
  for (const n of r.numbers) lines.push(`- **${n.value}**: ${n.what} (${n.context})`);
  lines.push("", "## Mechanisms", "");
  for (const m of r.mechanisms) {
    lines.push(`### ${m.name}`, "", m.howItWorks, "");
    m.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push("");
  }
  lines.push("## Visual hooks", "");
  for (const v of r.visualHooks) lines.push(`- ${v}`);
  lines.push("", "## Misconceptions", "");
  for (const m of r.misconceptions) lines.push(`- ${m}`);
  lines.push("", "## Glossary", "");
  for (const g of r.glossary) lines.push(`- **${g.term}**: ${g.definition}`);
  lines.push("", "## Sources", "");
  for (const s of r.sources) lines.push(`- ${s.url ? `[${s.title}](${s.url})` : s.title} (${s.kind})${s.note ? `: ${s.note}` : ""}`);
  return `${lines.join("\n")}\n`;
}
