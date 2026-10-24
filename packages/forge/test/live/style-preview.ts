// Runs the stylist for several briefs without touching any project (to judge variety across topics):
//   tsx test/live/style-preview.ts "<topic>|<audience>" …
import { Brief } from "../../src/agents/schemas.ts";
import { runStylist } from "../../src/agents/stylist.ts";
import { createProxyLlm } from "../../src/llm.ts";

const llm = createProxyLlm();
await Promise.all(
  process.argv.slice(2).map(async (arg) => {
    const [topic, audience] = arg.split("|");
    const brief = Brief.parse({ topic, audience, minutes: 6, prefs: {}, createdAt: new Date().toISOString() });
    const { style, attempts } = await runStylist(llm, brief);
    const c = style.theme.colors;
    console.log(
      `${topic}\n  ${style.look}\n  bg ${c.bg} surface ${c.surface} text ${c.text} accents ${c.accent} ${c.accent2} ${c.accent3} | ` +
        `${Object.values(style.theme.fonts).join("/")} | ${style.motion} 3d=${style.use3d} int=${style.interactivity} ${style.density} (attempts ${attempts})`,
    );
  }),
);
