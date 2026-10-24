// The design-style catalogue: well-known visual styles the Style Studio offers and the agents read.
// Each entry has a short blurb for people, a longer `prompt` for the agents, and defaults for the Style.
// Client-safe: only type imports, so the Studio can import it from client components.
import type { MotionLevel, Style, Surface, Theme } from "./contract.ts";
import { resolveSurface, SURFACE_VARS } from "./surface.ts";

export * from "./surface.ts";

export const DESIGN_CATEGORIES = [
  "Minimal and modernist",
  "Material and depth",
  "Bold and graphic",
  "Retro and futurist",
  "Editorial and print",
  "Technical",
  "Natural and handmade",
  "Atmospheric",
] as const;
export type DesignCategory = (typeof DESIGN_CATEGORIES)[number];

export interface DesignStyle {
  id: string;
  name: string;
  category: DesignCategory;
  /** One line, for the Studio. */
  blurb: string;
  /** Shapes, borders, depth, texture, type, colour and motion character, for the agents. */
  prompt: string;
  colors: Theme["colors"];
  backdrop: string;
  fonts: Theme["fonts"];
  motion: MotionLevel;
  density: Style["density"];
  surface: Surface;
}

type Def = [
  id: string,
  name: string,
  category: DesignCategory,
  blurb: string,
  prompt: string,
  /** bg, surface, text, muted, line, accent, accent2, accent3 */
  colors: string,
  backdrop: string,
  /** display body mono */
  fonts: string,
  motion: MotionLevel,
  density: Style["density"],
  /** radius border depth texture */
  surface: string,
];

const DEFS: Def[] = [
  // ---------------------------------------------------------------- minimal and modernist
  [
    "minimalism", "Minimalism", "Minimal and modernist", "Few elements, lots of space, one accent.",
    "Reduce every slide to the fewest elements that carry the idea. Shapes: plain rectangles, thin rules, no ornament. Borders: hairlines or none; separate things with space, not boxes. Depth: flat. Texture: none. Type: one neutral sans in two or three weights, a large headline, small quiet labels. Colour: near-monochrome neutrals with a single accent kept for the one thing that matters. Motion: slow fades and short eased moves, nothing decorative.",
    "#f6f6f4 #ffffff #161616 #5e5e5e #e2e2de #c4410c #1c5fc9 #0b7f57", "", "inter-tight inter jetbrains-mono", "subtle", "airy", "soft hairline flat none",
  ],
  [
    "swiss", "Swiss / International", "Minimal and modernist", "Strict grid, flush-left grotesk, red and black.",
    "International Typographic Style. Shapes: a visible modular grid, strict alignment, asymmetric layouts built from large fields of flat colour. Borders: none, or heavy rules on the grid lines. Depth: completely flat. Texture: a faint construction grid at most. Type: a grotesk set flush-left and ragged-right, very large headlines with tight tracking, numerals used as graphic elements, small all-caps labels. Colour: white, black and one strong red, with colour fields used as structure. Motion: precise moves along the grid axes; elements snap into their columns.",
    "#f4f3ef #ffffff #111111 #555555 #d5d3cc #d7050f #1d4ed8 #9a5a00", "", "inter-tight inter ibm-plex-mono", "subtle", "balanced", "sharp none flat grid",
  ],
  [
    "bauhaus", "Bauhaus", "Minimal and modernist", "Primary colours, circles, squares and triangles.",
    "Bauhaus geometry. Shapes: circles, squares, triangles and semicircles as the building blocks; diagrams are compositions of primitive shapes held in balance. Borders: thick black outlines or none. Depth: flat. Texture: a faint paper grain. Type: geometric sans, bold headlines, a word sometimes rotated 90° along an edge. Colour: primary red, blue and a deep yellow on off-white, each primary carrying one meaning. Motion: shapes rotate, slide and stack with confident mechanical easing.",
    "#f2ede1 #fbf8f0 #141414 #4f4a40 #d8d0bd #c8231b #1f4fa8 #8f6a00", "", "space-grotesk work-sans jetbrains-mono", "rich", "balanced", "sharp bold flat grain",
  ],
  [
    "scandinavian", "Scandinavian", "Minimal and modernist", "Warm whites, muted pastels, calm and soft.",
    "Scandinavian calm. Shapes: soft rounded rectangles with plenty of air, simple pictograms. Borders: none; areas separate by tonal fills. Depth: very soft, low shadows. Texture: a subtle grain like matte paper or linen. Type: a friendly humanist sans in regular and medium weights, never shouty. Colour: warm whites, oat and birch neutrals with muted sage, dusty blue and clay accents. Motion: gentle, slow eased fades and rises.",
    "#f3efe8 #fbf8f3 #2b2824 #6a645b #e0d9cc #557359 #4a6a8a #a9502f", "", "work-sans work-sans ibm-plex-mono", "subtle", "airy", "round none soft grain",
  ],
  [
    "japandi", "Japandi", "Minimal and modernist", "Wabi-sabi quiet: ink, stone, wood and paper.",
    "Japanese and Scandinavian restraint. Shapes: asymmetric balance, large negative space, thin ink lines, a single circle or brush-like stroke as focal point. Borders: hairlines only. Depth: flat. Texture: rice-paper grain. Type: a refined serif for headlines with a light sans for labels, generous letter spacing on small caps. Colour: paper, charcoal ink and stone grey with one muted vermilion or moss. Motion: very slow and sparse, like strokes appearing one at a time.",
    "#f1ede4 #f8f5ee #1f1d1a #625d55 #d9d2c4 #b0412a #56633f #85663a", "", "source-serif-4 work-sans ibm-plex-mono", "subtle", "airy", "soft hairline flat grain",
  ],
  [
    "mid-century", "Mid-century modern", "Minimal and modernist", "Atomic-age shapes in mustard, teal and walnut.",
    "Mid-century modern. Shapes: boomerangs, kidney shapes, starbursts, slim tapered legs and lines, overlapping translucent shapes. Borders: none. Depth: flat, with slight print misregistration between colour layers. Texture: grain like old printed paper. Type: geometric or slightly quirky sans, bold headlines, lowercase labels. Colour: mustard, burnt orange, teal and olive on cream, with walnut brown for text. Motion: playful swings and small bounces.",
    "#f3ead7 #fbf4e4 #2a2118 #6b5a45 #e2d3b5 #b74f18 #1b6f6a #8c6a00", "", "space-grotesk work-sans ibm-plex-mono", "rich", "balanced", "round none flat grain",
  ],
  // ---------------------------------------------------------------- material and depth
  [
    "flat", "Flat design", "Material and depth", "Solid colour shapes, no shadows, crisp icons.",
    "Flat design. Shapes: simple geometric shapes and icon-like illustrations made of solid fills. Borders: none. Depth: none at all: no gradients, no shadows, no bevels. Texture: none. Type: a clean sans with bold headlines. Colour: a bright, saturated palette on white where each colour is one category. Motion: quick, clean slides and scale-ins.",
    "#f5f7fa #ffffff #1b2533 #586375 #dfe4ec #2563eb #d63f25 #0b8466", "", "inter inter jetbrains-mono", "subtle", "balanced", "soft none flat none",
  ],
  [
    "material", "Material design", "Material and depth", "Paper layers, purposeful elevation, bold colour.",
    "Material design. Shapes: cards as sheets of paper at defined elevations, 8–16px corners, floating action buttons, chips. Borders: none; elevation separates layers. Depth: soft ambient plus key shadows that grow with importance. Texture: none. Type: a neo-grotesk sans with a clear type scale. Colour: one primary, one secondary and neutral surfaces. Motion: meaningful transitions: elements expand from where they came from, ripples on press, standard ease-out curves.",
    "#f3f4f9 #ffffff #1a1c22 #5a5e6b #e1e3ec #4f46e5 #0a7f78 #c9481c", "", "inter-tight inter jetbrains-mono", "subtle", "balanced", "soft none soft none",
  ],
  [
    "skeuomorphism", "Skeuomorphism", "Material and depth", "Real materials: brushed metal, leather, glossy buttons.",
    "Skeuomorphism. Shapes: things imitate their physical counterparts: knobs, toggle switches, dials, gauges, paper sheets, glass. Borders: bevelled edges with inner highlights. Depth: realistic soft shadows, gradients that model curvature, specular highlights. Texture: material grain (leather, brushed metal, paper). Type: classic sans or serif labels, embossed or debossed. Colour: natural material colours: warm leather, brushed aluminium, amber indicator lights. Motion: physical: knobs turn with inertia, switches snap, needles settle.",
    "#1d1a17 #2a2622 #f3ede4 #b3a898 #403a33 #e8a33c #6fb7d8 #e0684d",
    "radial-gradient(1400px 900px at 50% 0%, #3a322a 0%, #1d1a17 70%)", "ibm-plex-sans ibm-plex-sans ibm-plex-mono", "rich", "balanced", "soft hairline soft grain",
  ],
  [
    "neumorphism", "Neumorphism", "Material and depth", "Soft extruded shapes pressed from one surface.",
    "Neumorphism (soft UI). Shapes: elements look pushed out of, or pressed into, the same background, with generous rounded corners. Borders: none. Depth: paired soft shadows, a light one top-left and a dark one bottom-right; pressed states use inset shadows. Texture: none. Type: a friendly sans in medium weights. Colour: one low-saturation tint for every surface; accents only for active states and data, with dark text so contrast holds. Motion: soft press-in and press-out, gentle.",
    "#e6e9ef #e9ecf2 #2b3140 #555d6f #d3d8e2 #4558e0 #0b7a70 #b8452b", "", "work-sans work-sans jetbrains-mono", "subtle", "airy", "round none soft none",
  ],
  [
    "glassmorphism", "Glassmorphism", "Material and depth", "Frosted panels floating over colourful light.",
    "Glassmorphism. Shapes: translucent frosted panels with background blur over vivid blurred colour blobs. Borders: a 1px light, semi-transparent edge. Depth: layered panels with large soft shadows and an inner top highlight. Texture: none. Type: a clean sans, light text on colour. Colour: a saturated gradient backdrop (violet, blue, pink) under white text and bright accents. Motion: slow drifting light, panels float with gentle parallax.",
    "#120f2a #241f4a #f6f4ff #c0b9e6 #3d3670 #5ee1ff #ff7ad9 #ffd166",
    "radial-gradient(900px 700px at 15% 20%, #5a33d6 0%, transparent 60%), radial-gradient(800px 700px at 85% 75%, #b23a7c 0%, transparent 55%), radial-gradient(900px 800px at 70% 0%, #1a7fc0 0%, transparent 55%), #120f2a",
    "inter-tight inter jetbrains-mono", "rich", "balanced", "round hairline glass none",
  ],
  [
    "claymorphism", "Claymorphism", "Material and depth", "Puffy, rounded, pastel clay shapes.",
    "Claymorphism. Shapes: chunky pills and blobs with very rounded corners, like soft clay or inflated toys. Borders: none. Depth: a soft outer shadow plus an inner highlight and inner shade so shapes look inflated. Texture: none. Type: a bold, friendly rounded sans. Colour: candy pastels (lilac, mint, peach, sky) as fills on a light pastel ground, with dark text and saturated accents for meaning. Motion: bouncy squash-and-stretch with springy overshoot.",
    "#f1ecfb #fbf8ff #2a2340 #5f5878 #e1d9f2 #7346d8 #0b8370 #c94b28", "", "work-sans work-sans jetbrains-mono", "rich", "airy", "round none soft none",
  ],
  [
    "isometric", "Isometric", "Material and depth", "30° axonometric blocks and exploded systems.",
    "Isometric illustration. Shapes: diagrams drawn in isometric projection (30° axes): stacked blocks, layered platforms, exploded systems, pipes. Borders: crisp 1–2px outlines. Depth: from three face tones per object (light top, mid left, dark right), not from blur. Texture: an optional faint grid of guides. Type: a clean sans, labels on leader lines. Colour: each object in three tints of one hue, a clear accent per role. Motion: blocks rise, slide along the iso axes and layers separate.",
    "#eef2f7 #ffffff #17202e #546074 #d4dbe6 #3b5bdb #0a7f77 #c8500b", "", "inter-tight inter jetbrains-mono", "subtle", "balanced", "sharp hairline flat grid",
  ],
  // ---------------------------------------------------------------- bold and graphic
  [
    "brutalism", "Brutalism", "Bold and graphic", "Raw web energy: system type, hard edges, no polish.",
    "Brutalist web design. Shapes: raw, unpolished layouts that expose their structure: default-looking boxes, visible borders, overlapping blocks, deliberate awkwardness. Borders: thick black lines. Depth: flat. Texture: none. Type: monospace and plain grotesk at large sizes, underlines, uppercase labels. Colour: black and white with one loud highlight. Motion: abrupt: instant cuts, no easing, blinking cursors.",
    "#f2f2f0 #ffffff #0a0a0a #474747 #bdbdb8 #0033ff #d4001c #007a3d", "", "jetbrains-mono ibm-plex-sans jetbrains-mono", "subtle", "dense", "sharp bold flat none",
  ],
  [
    "neo-brutalism", "Neo-brutalism", "Bold and graphic", "Thick outlines, hard offset shadows, loud colour.",
    "Neo-brutalism. Shapes: chunky blocks, stickers and badges, some slightly rotated. Borders: thick black outlines on everything. Depth: hard offset shadows with no blur. Texture: none. Type: a bold grotesk in heavy weights. Colour: bright flat fills (lemon, pink, cyan, lime as tints) on cream, with black text and saturated accents. Motion: snappy pops; controls press down into their shadow.",
    "#fff4dc #ffffff #111111 #4a4a4a #d9cba8 #d92d63 #2559d9 #0b7d47", "", "space-grotesk space-grotesk jetbrains-mono", "rich", "balanced", "soft bold hard none",
  ],
  [
    "memphis", "Memphis", "Bold and graphic", "80s squiggles, confetti shapes, clashing colour.",
    "Memphis design. Shapes: playful confetti around the content: squiggles, zigzags, dots, triangles, half circles, terrazzo specks. Borders: black outlines. Depth: flat or small hard shadows. Texture: halftone dots or stripes. Type: a bold geometric sans, sometimes tilted. Colour: clashing brights and pastels (pink, teal, yellow, purple) on white. Motion: bouncy and wiggly: shapes spin and pop in.",
    "#fdf7f2 #ffffff #1d1630 #5b5170 #e9dfd5 #d42a72 #0b7f80 #6a3fd1", "", "space-grotesk work-sans jetbrains-mono", "rich", "balanced", "round bold hard halftone",
  ],
  [
    "pop-art", "Pop art", "Bold and graphic", "Comic halftones, speech bubbles, primary punch.",
    "Pop art. Shapes: comic panels, speech bubbles, burst shapes, Ben-Day dots. Borders: thick black outlines. Depth: flat with hard shadows. Texture: halftone dots. Type: heavy condensed sans, all caps, punchy short words. Colour: primary red, yellow and blue with black outlines on white. Motion: punchy zooms, shakes and burst reveals.",
    "#fff6e0 #ffffff #111111 #4b4436 #e3d6b5 #d7191f #1a56c4 #9a6600", "", "inter-tight work-sans jetbrains-mono", "rich", "balanced", "sharp bold hard halftone",
  ],
  [
    "risograph", "Risograph", "Bold and graphic", "Two-ink print: grainy overlaps, misregistration.",
    "Risograph print. Shapes: bold shapes printed in two or three spot inks that overlap (mix-blend-mode: multiply), with slight misregistration offsets. Borders: none. Depth: flat. Texture: heavy ink grain. Type: a bold grotesk, sometimes outlined or knocked out. Colour: fluorescent pink, blue and yellow inks on off-white paper; overlaps make the in-between colours. Motion: layers slide into register, slight print jitter.",
    "#f4efe6 #fbf8f2 #1e1b33 #5c566d #ddd4c4 #d42f72 #1d62b0 #9a6300", "", "space-grotesk work-sans ibm-plex-mono", "subtle", "balanced", "sharp none flat grain",
  ],
  [
    "duotone", "Duotone", "Bold and graphic", "Two colours only, high contrast and graphic.",
    "Duotone. Shapes: graphic silhouettes and diagrams in two colours, a dark and a bright, with every in-between value a tint of the two. Borders: none. Depth: flat. Texture: halftone dots for tone. Type: a bold sans at large sizes. Colour: one dark ground plus one vivid hue; a second accent only where meaning needs it. Motion: wipes, masks and colour inversions.",
    "#13123a #1d1c4f #f4f1ff #b9b4e3 #2e2c66 #ff5c8a #ffb3c8 #9c99ff", "", "inter-tight inter jetbrains-mono", "subtle", "airy", "sharp none flat halftone",
  ],
  [
    "maximalism", "Maximalism", "Bold and graphic", "More is more: layered pattern, colour and type.",
    "Maximalism. Shapes: dense layered compositions, mixed patterns, frames within frames, oversized type crossing the imagery. Borders: mixed, ornamental. Depth: layers with soft shadows. Texture: grain. Type: an expressive display serif mixed with a grotesk, many sizes. Colour: rich jewel tones (gold, magenta, emerald) together on a deep ground. Motion: lavish staggered reveals and parallax.",
    "#1a0f24 #261633 #fbf1e6 #cdb8c9 #45304f #ffb627 #ff4f9a #2fd3a4",
    "radial-gradient(1100px 800px at 85% 10%, #4a1a4a 0%, transparent 60%), radial-gradient(900px 700px at 10% 90%, #133a33 0%, transparent 60%), #1a0f24",
    "playfair-display work-sans jetbrains-mono", "rich", "dense", "soft hairline soft grain",
  ],
  [
    "constructivism", "Constructivism", "Bold and graphic", "Diagonals, red and black, poster energy.",
    "Russian constructivism. Shapes: dynamic diagonals, bold wedges and bars, cut-out shapes, strong asymmetry. Borders: none. Depth: flat. Texture: old-print grain. Type: heavy condensed sans in all caps, set on angles. Colour: red, black and off-white, with a little ochre or blue. Motion: forceful diagonal slides and sweeping wedges.",
    "#ece4d4 #f6f0e3 #141210 #574f43 #d3c7b0 #c01e1a #1d4d8f #8a5f00", "", "inter-tight work-sans jetbrains-mono", "rich", "balanced", "sharp none flat grain",
  ],
  // ---------------------------------------------------------------- retro and futurist
  [
    "art-deco", "Art Deco", "Retro and futurist", "Gold geometry, fans, sunbursts and symmetry.",
    "Art Deco. Shapes: symmetrical compositions, stepped forms, sunbursts, fans, chevrons and thin parallel gold lines framing the content. Borders: thin single or double gold lines. Depth: flat, with metallic gradients on ornaments. Texture: none. Type: a high-contrast serif or tall geometric capitals with wide tracking. Colour: black and deep teal with gold and cream. Motion: elegant symmetric reveals; lines draw out from the centre.",
    "#0f1416 #182024 #f3ead6 #bfb39a #3a3a30 #d4af5a #5fb3a1 #e07a5f",
    "radial-gradient(1200px 800px at 50% -10%, #23302f 0%, #0f1416 65%)", "playfair-display work-sans ibm-plex-mono", "subtle", "balanced", "sharp hairline flat none",
  ],
  [
    "art-nouveau", "Art Nouveau", "Retro and futurist", "Whiplash curves, botanical ornament, jewel tones.",
    "Art Nouveau. Shapes: flowing whiplash curves, vines and stems framing the content, arched panels. Borders: ornamental curving lines. Depth: flat. Texture: parchment grain. Type: a decorative, soft serif. Colour: sage, ochre, plum and teal on parchment. Motion: lines grow like tendrils, slow unfurling reveals.",
    "#efe7d6 #f8f2e4 #2a2219 #63574a #d8ccb2 #2f6f5e #8a3b5c #96621a", "", "fraunces source-serif-4 ibm-plex-mono", "subtle", "airy", "round hairline flat grain",
  ],
  [
    "vaporwave", "Vaporwave", "Retro and futurist", "Pastel pink-cyan haze and 90s computer nostalgia.",
    "Vaporwave. Shapes: retro 90s computer windows with title bars, perspective grid floors, low-poly forms, sunsets. Borders: bevelled window frames. Depth: flat with hard window shadows. Texture: a grid. Type: a wide sans or monospace, sometimes widely spaced. Colour: pastel pink, cyan and lavender on deep purple. Motion: slow drifting loops, a dreamy pace.",
    "#1d1335 #2a1c4a #fbeaff #c9b2e3 #4a3570 #ff71ce #01cdfe #c08aff",
    "linear-gradient(180deg, #2b1650 0%, #1d1335 60%, #3a1446 100%)", "space-grotesk work-sans jetbrains-mono", "rich", "balanced", "sharp hairline hard grid",
  ],
  [
    "synthwave", "Synthwave", "Retro and futurist", "Neon sunset, laser grids and chrome at night.",
    "Synthwave / outrun. Shapes: a glowing striped horizon sun, a perspective laser-grid floor, neon outline shapes. Borders: glowing 2px neon lines. Depth: glow (box-shadow in the accent colour) instead of shadow. Texture: a grid. Type: a bold wide sans, chrome or neon-outlined titles. Colour: deep purple-black with magenta, orange and cyan neon. Motion: the grid scrolls toward the viewer, glows pulse.",
    "#0d0221 #1a0b3a #fdf0ff #c2a8e0 #3a1f66 #ff2a6d #05d9e8 #ff9f1c",
    "linear-gradient(180deg, #0d0221 0%, #261447 55%, #541b5e 100%)", "space-grotesk inter jetbrains-mono", "rich", "balanced", "sharp hairline flat grid",
  ],
  [
    "y2k", "Y2K", "Retro and futurist", "Chrome blobs, bubbles, iridescent optimism.",
    "Y2K aesthetic. Shapes: glossy bubbles and blobs, pill buttons, star sparkles, chrome or iridescent gradients. Borders: thin light outlines. Depth: glossy highlights and soft shadows. Texture: none. Type: a rounded, futuristic sans. Colour: icy silver, baby blue and lilac, with electric blue and magenta accents. Motion: bouncy floating, shine sweeps across surfaces.",
    "#eef1fb #f9faff #1b1f3b #565c80 #d8ddf0 #3f5bff #b336c4 #0b8462",
    "radial-gradient(900px 600px at 80% 0%, #dfe6ff 0%, transparent 60%), radial-gradient(700px 600px at 10% 90%, #f3defc 0%, transparent 60%), #eef1fb",
    "space-grotesk inter jetbrains-mono", "rich", "balanced", "round hairline glass none",
  ],
  [
    "cyberpunk", "Cyberpunk", "Retro and futurist", "Neon on black, glitch, HUD brackets, warning tape.",
    "Cyberpunk. Shapes: angular panels with clipped corners (clip-path), HUD brackets, warning stripes, glitch offsets, scanlines. Borders: 1–2px neon lines. Depth: neon glow. Texture: a fine grid. Type: monospace and condensed sans in uppercase, codes and serial numbers as decoration. Colour: black with acid yellow, hot magenta and cyan. Motion: glitch jitter, flicker, fast data streams.",
    "#07070b #12121a #f1f1f6 #a3a3b8 #2a2a3a #fcee0a #ff2e88 #00f0ff", "", "inter-tight ibm-plex-sans jetbrains-mono", "rich", "dense", "sharp hairline flat grid",
  ],
  [
    "retro-futurism", "Retro-futurism", "Retro and futurist", "1960s space-age: orbits, rockets, rounded panels.",
    "Space-age retro-futurism. Shapes: orbits, rockets, rounded control panels, dials, radar sweeps, starfields. Borders: rounded capsule frames. Depth: soft shadows. Texture: print grain. Type: a wide geometric sans. Colour: deep navy with cream, burnt orange, teal and gold. Motion: smooth orbits, radar sweeps, countdowns.",
    "#10172a #1a2340 #f6efe2 #b6b2a6 #2f3a5c #ff8a3d #4fd1c5 #f2c14e",
    "radial-gradient(1300px 900px at 80% 0%, #22305a 0%, #10172a 65%)", "space-grotesk work-sans ibm-plex-mono", "rich", "balanced", "round hairline soft grain",
  ],
  [
    "pixel", "Pixel / 8-bit", "Retro and futurist", "Blocky pixel art, chunky borders, arcade colour.",
    "Pixel art and 8-bit games. Shapes: everything on a coarse pixel grid: blocky sprites, stepped edges (draw on canvas with imageSmoothingEnabled off, or SVG rects), health bars, dialogue boxes. Borders: thick, square. Depth: hard offset shadows. Texture: none. Type: monospace in uppercase for titles and labels. Colour: a limited arcade palette (yellow, green, red) on deep indigo. Motion: stepped, frame-by-frame animation (steps() easing), blinking prompts.",
    "#12122a #1e1e3f #f4f4ff #aeb0d6 #34366a #ffd23f #3ddc97 #ff5d73", "", "jetbrains-mono ibm-plex-sans jetbrains-mono", "rich", "balanced", "sharp bold hard none",
  ],
  // ---------------------------------------------------------------- editorial and print
  [
    "editorial", "Editorial", "Editorial and print", "Magazine serif headlines, columns, pull quotes.",
    "Magazine editorial. Shapes: column grids, large serif headlines, drop caps, pull quotes, captions with rules, generous margins. Borders: thin rules between columns. Depth: flat. Texture: none. Type: a high-contrast serif display with a refined text serif, italics for emphasis. Colour: paper white, ink black and one editorial accent (deep red or cobalt). Motion: calm fades, text revealed line by line.",
    "#f5f2ea #fcfaf5 #17150f #5d584c #dcd5c5 #b3261e #1f4fd1 #2e6b4f", "", "playfair-display source-serif-4 ibm-plex-mono", "subtle", "airy", "sharp hairline flat none",
  ],
  [
    "newspaper", "Newspaper", "Editorial and print", "Broadsheet columns, rules, datelines, dense headlines.",
    "Broadsheet newspaper. Shapes: a dense multi-column grid, heavy and hairline rules, datelines, boxed figures with numbered captions. Borders: rules. Depth: flat. Texture: newsprint grain. Type: a bold serif for headlines, a text serif for body, small caps for labels. Colour: newsprint off-white and black with sparing spot red. Motion: minimal: column-by-column or typewriter reveals.",
    "#ecebe4 #f5f4ee #111111 #4f4f4a #c9c7bc #ad1f19 #2d4f8a #6b5a1e", "", "fraunces source-serif-4 ibm-plex-mono", "subtle", "dense", "sharp hairline flat grain",
  ],
  [
    "zine", "Zine / collage", "Editorial and print", "Photocopied cut-and-paste, tape and scrawl.",
    "DIY zine collage. Shapes: torn paper shapes, tape strips, rotated cut-outs, stamped labels, hand-drawn arrows and circles. Borders: rough or none. Depth: hard shadows under pasted pieces. Texture: heavy photocopy grain. Type: a mix of typewriter mono and bold sans with ransom-note contrast. Colour: black on photocopy white with one fluorescent highlight. Motion: jerky stop-motion; pieces slap onto the page.",
    "#efede8 #faf9f6 #141414 #4e4c48 #cfccc4 #d4006a #1f5fd6 #a85500", "", "space-grotesk work-sans ibm-plex-mono", "subtle", "dense", "sharp none hard grain",
  ],
  [
    "letterpress", "Letterpress", "Editorial and print", "Debossed type, ink on cotton paper, ornaments.",
    "Vintage letterpress. Shapes: centred classical compositions, ornamental rules and fleurons, numbered plates and figures. Borders: double rules. Depth: a slight deboss (inset shadow) on type and panels. Texture: cotton-paper grain. Type: a classic serif with small caps and italics. Colour: cream paper, deep ink blue-black and oxblood. Motion: slow and measured.",
    "#f2ebdc #f9f4e9 #1c1a2a #5b5666 #dacfb9 #8c1c2b #24477a #5e5d18", "", "fraunces source-serif-4 ibm-plex-mono", "subtle", "airy", "sharp hairline flat grain",
  ],
  [
    "kinetic-type", "Kinetic typography", "Editorial and print", "Type is the visual: huge words that move.",
    "Kinetic typography. Shapes: words carry the slide: oversized type, words that scale, slide, split and stack on each step; few other shapes. Borders: none. Depth: flat. Texture: none. Type: one strong grotesk at extreme sizes and weights, tight leading. Colour: high-contrast black and white with one accent for key words. Motion: rich, choreographed type: staggered letters, masks and wipes timed to the steps.",
    "#0c0c0d #18181b #fafafa #a1a1aa #2a2a2f #ff5a1f #3dd6ff #c6f432", "", "inter-tight inter jetbrains-mono", "rich", "airy", "sharp none flat none",
  ],
  [
    "academic", "Academic paper", "Editorial and print", "Journal figures, numbered captions, restrained serif.",
    "Scientific journal. Shapes: numbered figures with captions, labelled axes, error bars, equations, footnote markers. Borders: thin rules and figure frames. Depth: flat. Texture: none. Type: a text serif with sans or mono figure labels. Colour: white and black with a colour-blind-safe categorical palette (blue, vermilion, green). Motion: minimal; figures build step by step.",
    "#fbfbf9 #ffffff #1a1a1a #555555 #dddddd #0072b2 #c55600 #007d5a", "", "source-serif-4 source-serif-4 ibm-plex-mono", "subtle", "dense", "sharp hairline flat none",
  ],
  // ---------------------------------------------------------------- technical
  [
    "blueprint", "Blueprint", "Technical", "White line drawings on engineering blue.",
    "Engineering blueprint. Shapes: thin linework, dimension lines with arrowheads, construction grids, callout circles, section hatching. Borders: 1px lines. Depth: flat. Texture: a construction grid. Type: a technical sans and mono in uppercase labels. Colour: deep blueprint blue with white and pale cyan lines and one warning orange. Motion: lines draw themselves (stroke-dashoffset), measured and precise.",
    "#0d2a52 #12346a #f0f6ff #a9c3e6 #2c5390 #7fd6ff #ffd27a #ff9a66", "", "ibm-plex-sans ibm-plex-sans ibm-plex-mono", "subtle", "balanced", "sharp hairline flat grid",
  ],
  [
    "terminal", "Terminal", "Technical", "Phosphor on black, monospace everything.",
    "Command-line terminal. Shapes: prompts, cursors, ASCII boxes and tables, log lines, progress bars made of characters. Borders: 1px or box-drawing characters. Depth: flat, with a faint phosphor glow on text. Texture: none. Type: monospace for everything. Colour: near-black with phosphor green, amber and cyan. Motion: typing, a blinking cursor, lines scrolling in.",
    "#0a0f0b #111a13 #d6f5dc #8fb79a #1f3326 #39ff88 #ffb000 #4fd6ff", "", "jetbrains-mono ibm-plex-mono jetbrains-mono", "subtle", "dense", "sharp hairline flat none",
  ],
  [
    "dashboard", "Data dashboard", "Technical", "Dense panels, KPIs, sparklines, live numbers.",
    "Control-room dashboard. Shapes: a grid of panels, KPI tiles with big tabular numbers, sparklines, small multiples, status pills. Borders: hairline panel edges. Depth: flat. Texture: none. Type: a neo-grotesk sans with tabular mono numerals. Colour: dark graphite with semantic colours (blue neutral, green good, red bad). Motion: numbers count up, charts draw in, live ticks.",
    "#0f1217 #171b22 #eef1f6 #9aa3b2 #262c36 #4c9aff #2fd18b #ff6b5a", "", "inter-tight inter jetbrains-mono", "subtle", "dense", "soft hairline flat none",
  ],
  [
    "wireframe", "Wireframe", "Technical", "Grey boxes, crosses and redline annotations.",
    "Low-fidelity wireframe. Shapes: grey boxes with crossed placeholders, dashed outlines, numbered annotation markers, redlines with measurements. Borders: 1.5px dashed or solid. Depth: flat. Texture: a grid. Type: a neutral sans and mono. Colour: greys plus one or two annotation colours (blue, red). Motion: boxes appear, then get annotated step by step.",
    "#f4f5f7 #ffffff #1f2328 #5b6169 #d0d4da #1f6feb #cf222e #8250df", "", "ibm-plex-sans ibm-plex-sans ibm-plex-mono", "subtle", "balanced", "sharp hairline flat grid",
  ],
  [
    "hud", "Sci-fi HUD", "Technical", "Holographic rings, ticks and targeting brackets.",
    "Sci-fi heads-up display. Shapes: thin concentric rings, tick scales, corner brackets, scanning arcs, floating readouts around a subject. Borders: hairline cyan lines with clipped corners. Depth: soft glow and translucent panels. Texture: none. Type: a technical sans and mono in tracked uppercase. Colour: near-black teal with cyan and a warning amber or red. Motion: rotating rings, scanning sweeps, flickering numbers.",
    "#050d12 #0b1a22 #e6fbff #8fb6c2 #173340 #35e0ff #ffb547 #ff5470",
    "radial-gradient(1200px 900px at 50% 40%, #0d2a33 0%, #050d12 70%)", "space-grotesk inter jetbrains-mono", "rich", "balanced", "sharp hairline glass none",
  ],
  [
    "infographic", "Infographic", "Technical", "Big numbers, pictograms, clear friendly charts.",
    "Infographic. Shapes: big numbers, pictograms, simple charts, arrows and flow lines, numbered steps. Borders: none. Depth: flat. Texture: none. Type: a bold sans for numbers and headlines, a readable body sans. Colour: three coded colours on a light ground, each carrying one variable through the whole deck. Motion: count-ups, bars that grow, icons that pop in.",
    "#f7f6f2 #ffffff #1d2430 #5a6271 #e2e0d8 #0b78b5 #c8500b #23803e", "", "work-sans work-sans jetbrains-mono", "subtle", "balanced", "soft none flat none",
  ],
  // ---------------------------------------------------------------- natural and handmade
  [
    "organic", "Organic", "Natural and handmade", "Soft blobs, leafy greens, natural curves.",
    "Organic, biophilic design. Shapes: flowing blobs, leaf and wave curves, no hard corners. Borders: none. Depth: soft shadows. Texture: natural grain. Type: a soft serif for headlines with a humanist sans. Colour: leaf green, moss, sand and sky. Motion: slow breathing, growing and swaying.",
    "#eef1e8 #f8faf3 #1f2a1f #56614f #d6ddca #2f7d4a #2a6f97 #a85d1a", "", "fraunces work-sans ibm-plex-mono", "subtle", "airy", "round none soft grain",
  ],
  [
    "hand-drawn", "Hand-drawn sketch", "Natural and handmade", "Pencil lines, doodles, notebook warmth.",
    "Sketchnotes. Shapes: wobbly hand-drawn strokes (SVG paths with slight seeded jitter), arrows, circles around key words, doodled icons. Borders: imperfect hand-drawn lines. Depth: flat. Texture: paper grain. Type: a friendly sans (no fake handwriting fonts). Colour: graphite on paper with marker accents (blue, red, ochre highlighter). Motion: strokes draw on as if sketched live.",
    "#f7f4ec #fffdf7 #222222 #5b5850 #ddd6c6 #1f5fbf #c9302a #8a6d00", "", "work-sans work-sans ibm-plex-mono", "subtle", "balanced", "soft hairline flat grain",
  ],
  [
    "earthy", "Earthy", "Natural and handmade", "Terracotta, sand and olive; sun-baked and tactile.",
    "Earthy, sun-baked style. Shapes: arches, rounded tiles, sun motifs, simple stacked forms. Borders: none. Depth: flat. Texture: plaster grain. Type: a warm serif for headlines. Colour: terracotta, sand, olive, ochre and deep brown. Motion: slow, warm fades.",
    "#f1e6d6 #f9f1e4 #2b1d14 #6a5444 #e0cdb4 #a94d26 #5d6b2f #2d6a73", "", "fraunces work-sans ibm-plex-mono", "subtle", "airy", "round none flat grain",
  ],
  [
    "chalkboard", "Chalkboard", "Natural and handmade", "Chalk lines and diagrams on slate.",
    "Classroom chalkboard. Shapes: dusty chalk strokes, hand-drawn diagrams, underlines, boxed formulas. Borders: chalky lines. Depth: flat. Texture: slate grain. Type: a clean sans (no fake handwriting fonts). Colour: dark slate green with chalk white, yellow and pink. Motion: strokes draw on, erase and redraw.",
    "#1f2b26 #283731 #f1f3ee #b8c2ba #3a4c44 #f6e27a #ff9eb5 #8fd3ff", "", "work-sans work-sans ibm-plex-mono", "subtle", "balanced", "sharp hairline flat grain",
  ],
  [
    "paper-craft", "Paper craft", "Natural and handmade", "Layered cut paper with soft shadows.",
    "Paper craft. Shapes: layered paper cut-outs stacked in depth, wavy cut edges, pop-up folds. Borders: none. Depth: each layer casts a soft shadow on the one below. Texture: paper grain. Type: a friendly bold sans. Colour: tonal layers of one or two hues (teal to navy) with a warm accent. Motion: layers parallax apart, pop-up-book reveals.",
    "#e9f0ef #f6faf9 #15302e #4d6563 #cfdedc #0d726d #c4502f #3b5aa8", "", "work-sans work-sans jetbrains-mono", "subtle", "balanced", "round none soft grain",
  ],
  // ---------------------------------------------------------------- atmospheric
  [
    "dark-cinematic", "Dark cinematic", "Atmospheric", "Deep void, one glowing light, hero objects.",
    "Dark cinematic. Shapes: a single subject lit dramatically against darkness, light rays, a vignette. Borders: faint hairlines. Depth: glows and soft shadows. Texture: film grain. Type: a light-weight sans at large sizes, mono kickers. Colour: near-black with a faint hue and one or two glowing accents. Motion: slow camera moves, light sweeps, drifting particles.",
    "#0b0d14 #151925 #f1f3f9 #9aa1b5 #262c3d #5cc8ff #a58cff #ff9a62",
    "radial-gradient(1400px 900px at 75% 5%, #1f2540 0%, #0b0d14 65%)", "ibm-plex-sans ibm-plex-sans ibm-plex-mono", "rich", "airy", "soft hairline soft grain",
  ],
  [
    "aurora", "Aurora gradient", "Atmospheric", "Soft mesh gradients and luminous colour fields.",
    "Aurora gradients. Shapes: large blurred gradient meshes behind clean panels, luminous colour fields. Borders: translucent hairlines. Depth: frosted glass panels. Texture: none. Type: a modern sans, big and light. Colour: aurora green, teal and violet on a deep night ground. Motion: slowly shifting gradients, gentle float.",
    "#0a1020 #121a30 #f2f6ff #a6b2cc #26304a #4ff0b4 #8f9bff #ff8fc7",
    "radial-gradient(1000px 700px at 20% 0%, #134a46 0%, transparent 60%), radial-gradient(1000px 800px at 90% 30%, #2e2a6e 0%, transparent 60%), #0a1020",
    "inter-tight inter jetbrains-mono", "rich", "airy", "round hairline glass none",
  ],
  [
    "noir", "Film noir", "Atmospheric", "Black-and-white drama, hard light, deep shadow.",
    "Film noir. Shapes: hard-edged light shafts, venetian-blind stripes, silhouettes, strong diagonals. Borders: none. Depth: flat, with dramatic light and shadow shapes. Texture: film grain. Type: a high-contrast serif or condensed caps. Colour: black, greys and white, with one sparing red and a little gold. Motion: slow, suspenseful reveals; light sweeping across.",
    "#0c0c0c #181818 #f2f2f2 #a8a8a8 #2c2c2c #e23b3b #c9a227 #7fa7c9", "", "playfair-display ibm-plex-sans ibm-plex-mono", "subtle", "airy", "sharp none flat grain",
  ],
];

function build(d: Def): DesignStyle {
  const [id, name, category, blurb, prompt, colors, backdrop, fonts, motion, density, surface] = d;
  const [bg, surf, text, muted, line, accent, accent2, accent3] = colors.split(" ") as string[];
  const [display, body, mono] = fonts.split(" ") as string[];
  const [radius, border, depth, texture] = surface.split(" ");
  return {
    id,
    name,
    category,
    blurb,
    prompt,
    colors: { bg: bg!, surface: surf!, text: text!, muted: muted!, line: line!, accent: accent!, accent2: accent2!, accent3: accent3! },
    backdrop,
    fonts: { display: display!, body: body!, mono: mono! },
    motion,
    density,
    surface: { radius, border, depth, texture } as Surface,
  };
}

export const DESIGN_STYLES: DesignStyle[] = DEFS.map(build);

export function designStyle(id: string | undefined | null): DesignStyle | undefined {
  return id ? DESIGN_STYLES.find((d) => d.id === id) : undefined;
}

/** `base` with a design style's defaults applied (palette, backdrop, fonts, motion, density, surface). 3D, interactivity and presenter features stay as they were. */
export function applyDesignStyle(base: Style, d: DesignStyle): Style {
  return {
    ...base,
    look: d.name,
    designStyle: d.id,
    theme: { colors: { ...d.colors }, fonts: { ...d.fonts }, backdrop: d.backdrop },
    motion: d.motion,
    density: d.density,
    surface: { ...d.surface },
  };
}

/** True when the style no longer matches the defaults of the design style it started from. */
export function isCustomised(s: Style): boolean {
  const d = designStyle(s.designStyle);
  if (!d) return false;
  const want = applyDesignStyle(s, d);
  const key = (x: Style) => JSON.stringify([x.theme, x.motion, x.density, resolveSurface(x.surface)]);
  return key(want) !== key(s);
}

const RADIUS_TEXT = { sharp: "sharp (0px)", soft: "soft (18px cards, 10px chips)", round: "round (36px cards, pill chips)" };
const BORDER_TEXT = { none: "none", hairline: "hairline (1px, --df-line)", bold: "bold (3px, in the text colour)" };
const DEPTH_TEXT = { flat: "flat (no shadows)", soft: "soft blurred shadows", hard: "hard offset shadows (no blur, text colour)", glass: "frosted glass (translucent panel, backdrop blur)" };
const TEXTURE_TEXT = { none: "none", grain: "grain", grid: "grid", halftone: "halftone dots" };

/** The design style and surface settings, written for the storyboarder and builder. */
export function designBrief(s: Pick<Style, "designStyle" | "surface">): string {
  const sf = resolveSurface(s.surface);
  const d = designStyle(s.designStyle);
  const lines = [
    d ? `Design style: ${d.name}. ${d.prompt}` : "Design style: none chosen; follow the look and the theme tokens.",
    `Surface settings: corners ${RADIUS_TEXT[sf.radius]}, borders ${BORDER_TEXT[sf.border]}, depth ${DEPTH_TEXT[sf.depth]}, backdrop texture ${TEXTURE_TEXT[sf.texture]} (the shell paints it).`,
    `The kit classes already follow these. Use the same variables for your own cards, chips, nodes and controls: ${SURFACE_VARS.join(", ")}.`,
  ];
  if (d) lines.push("Where the design style and the theme tokens or surface settings differ, the tokens and settings win: the presenter may have customised them.");
  return lines.join("\n");
}
