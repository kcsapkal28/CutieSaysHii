import type { Style } from "@/lib/types";

const FAMILY: Record<string, string> = {
  fraunces: "Fraunces",
  "ibm-plex-mono": "IBM Plex Mono",
  "ibm-plex-sans": "IBM Plex Sans",
  inter: "Inter",
  "inter-tight": "Inter Tight",
  "jetbrains-mono": "JetBrains Mono",
  "playfair-display": "Playfair Display",
  "source-serif-4": "Source Serif 4",
  "space-grotesk": "Space Grotesk",
  "work-sans": "Work Sans",
};
export const familyOf = (id: string) => `"${FAMILY[id] ?? id}", system-ui, sans-serif`;

/** A tiny CSS rendering of a style: backdrop, a headline in the display face and the accent ramp. */
export function StylePoster({ style, title, className }: { style: Style; title: string; className?: string }) {
  const c = style.theme.colors;
  return (
    <div
      className={`relative aspect-video w-full overflow-hidden [container-type:inline-size] ${className ?? ""}`}
      style={{ background: style.theme.backdrop || c.bg, color: c.text, fontFamily: familyOf(style.theme.fonts.body) }}
      aria-hidden
    >
      <div className="absolute left-[7%] top-[28%] right-[7%]">
        <div style={{ fontFamily: familyOf(style.theme.fonts.mono), color: c.accent, fontSize: "2.6cqw", letterSpacing: ".22em" }} className="uppercase">
          {style.look.replace(/-/g, " ")}
        </div>
        <div
          style={{ fontFamily: familyOf(style.theme.fonts.display), fontSize: "8.5cqw", lineHeight: 1.05, letterSpacing: "-0.01em", fontWeight: 500 }}
          className="mt-[2.5cqw] line-clamp-2"
        >
          {title}
        </div>
        <div className="mt-[4cqw] flex gap-[1.6cqw]">
          {[c.accent, c.accent2, c.accent3].map((x, i) => (
            <span key={i} className="h-[1.6cqw] w-[9cqw] rounded-full" style={{ background: x }} />
          ))}
        </div>
      </div>
      <div className="absolute bottom-[10%] left-[7%] right-[7%] h-px" style={{ background: c.line }} />
    </div>
  );
}
