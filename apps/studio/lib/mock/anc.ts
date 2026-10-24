// Fake but realistic stage outputs for an "Inside ANC earbuds" deck.
import type { Brief, Outline, Script, Storyboard } from "../types";

export const ANC_BRIEF: Brief = {
  topic: "How active noise cancellation works in wireless earbuds",
  audience: "Hardware and firmware engineers new to audio DSP",
  minutes: 20,
  goal: "Leave them able to sketch the feedforward and feedback paths and explain the latency budget.",
  notes: "Dark, cinematic. Show the real parts in 3D. One hands-on simulation of the anti-noise wave.",
};

export const ANC_RESEARCH = `# Active noise cancellation in wireless earbuds

## Summary
Active noise cancellation (ANC) plays a sound wave that is the inverse of incoming noise, so the two cancel in the ear canal. It works best on steady, low-frequency sound (roughly 50 Hz–1 kHz). Passive isolation from the ear tip handles the higher frequencies [1].

## How the signal path works
- **Feedforward**: an outer microphone hears noise before it reaches the ear. The DSP filters and inverts it, then the driver plays the anti-noise. It reacts early but cannot see the result [2].
- **Feedback**: an inner microphone sits between the driver and the eardrum. It measures what is left over and corrects it in a closed loop. It is accurate but limited in bandwidth by loop stability [2].
- **Hybrid** designs run both paths. Most premium earbuds since 2019 use hybrid ANC [3].

## Latency is the hard constraint
- The anti-noise must arrive within a fraction of a period. At 1 kHz a 90° phase error leaves almost no cancellation, which happens after only 250 µs [4].
- Dedicated ANC hardware runs fixed biquad filters at 384–768 kHz with total path delay around 20 µs, much faster than the general-purpose audio path [5].

## Parts that matter
- Two to three MEMS microphones per bud (feedforward, feedback, voice).
- A balanced-armature or dynamic driver; the sealed front volume shapes the low-frequency response.
- A Bluetooth SoC with a hardware ANC block, plus an amplifier, battery (~50 mAh) and antenna [3].

## Limits
- Sudden sounds (speech, clatter) change faster than the adaptive filter converges [1].
- A poor ear-tip seal leaks bass and can cut ANC performance by 10–15 dB [6].
- Wind noise on the outer mic can make feedforward ANC add noise; firmware detects wind and backs off [5].

## Sources
1. Kuo & Morgan, *Active Noise Control: A Tutorial Review*, Proc. IEEE, 1999.
2. Hansen, *Understanding Active Noise Cancellation*, Spon Press, 2001.
3. iFixit teardowns: AirPods Pro 2, Sony WF-1000XM5, 2023.
4. Analog Devices, *ANC headphone design considerations*, AN-1450.
5. Qualcomm, *Adaptive ANC whitepaper*, 2022.
6. Liebich et al., *Ear-tip seal and ANC performance*, JAES, 2019.
`;

export const ANC_OUTLINE: Outline = {
  title: "Inside ANC",
  sections: [
    {
      name: "Why",
      slides: [
        { id: "s01", title: "Inside ANC", point: "A tiny computer that makes sound to remove sound." },
        { id: "s02", title: "Sound is a pressure wave", point: "Noise is air pressure rising and falling; a mirror wave can cancel it." },
        { id: "s03", title: "Passive blocks highs, active cancels lows", point: "The ear tip handles treble; ANC handles the rumble." },
      ],
    },
    {
      name: "Hardware",
      slides: [{ id: "s04", title: "Fourteen parts in a 5-gram bud", point: "Mics, driver, DSP and battery each play a role in cancelling noise." }],
    },
    {
      name: "Signal path",
      slides: [
        { id: "s05", title: "Feedforward: hear it first", point: "The outer mic catches noise early; the DSP inverts it before it reaches the ear." },
        { id: "s06", title: "Feedback: fix what's left", point: "The inner mic measures the residual and closes the loop." },
        { id: "s07", title: "The anti-noise wave", point: "Cancellation depends on phase: small timing errors leave noise behind." },
        { id: "s08", title: "A 20-microsecond budget", point: "Dedicated hardware keeps the whole path inside 20 µs." },
      ],
    },
    {
      name: "In practice",
      slides: [
        { id: "s09", title: "Hybrid and transparency", point: "Run both paths, or flip the filter to let the world back in." },
        { id: "s10", title: "What ANC can't cancel", point: "Steady lows: yes. Voices, clatter, wind: much less." },
      ],
    },
  ],
};

export const ANC_SCRIPT: Script = {
  slides: [
    { id: "s01", title: "Inside ANC", keyMessage: "ANC makes sound to remove sound.", narration: "A wireless noise-cancelling earbud. Let's look inside to see how signal processing makes it quieter.", budgetSec: 60 },
    { id: "s02", title: "Sound is a pressure wave", keyMessage: "Noise is pressure going up and down; an inverted wave cancels it.", narration: "Sound is just air pressure rising and falling. If we add a second wave that falls exactly when the first one rises, the two sum to nothing.", budgetSec: 100 },
    { id: "s03", title: "Passive blocks highs, active cancels lows", keyMessage: "Ear tips handle treble; ANC handles rumble.", narration: "The silicone tip already blocks high frequencies well. ANC earns its keep below about one kilohertz, where engines and air conditioning live.", budgetSec: 110 },
    { id: "s04", title: "Fourteen parts in a 5-gram bud", keyMessage: "Every part, from tip to shell, contributes to quiet.", narration: "Fourteen parts, layered from the ear tip to the outer shell. Three of them are microphones; one is a dedicated ANC processor.", budgetSec: 150 },
    { id: "s05", title: "Feedforward: hear it first", keyMessage: "The outer mic hears noise before your ear does.", narration: "The outer mic sits on the shell. Noise reaches it a fraction of a millisecond before it reaches your ear, so the DSP has time to invert it.", budgetSec: 140 },
    { id: "s06", title: "Feedback: fix what's left", keyMessage: "The inner mic closes the loop on the residual.", narration: "The inner mic hears what's actually in your ear canal, after the anti-noise. Whatever is left becomes the error signal for the next correction.", budgetSec: 130 },
    { id: "s07", title: "The anti-noise wave", keyMessage: "Phase error decides how much noise survives.", narration: "Drag the phase error. At zero, the waves cancel completely. At ninety degrees, the 'anti-noise' is adding almost as much as it removes.", budgetSec: 160 },
    { id: "s08", title: "A 20-microsecond budget", keyMessage: "Fixed-function hardware keeps the path under 20 µs.", narration: "Convert, filter, convert back, and push air: all inside twenty microseconds. That is why ANC runs on dedicated hardware, not the main audio path.", budgetSec: 120 },
    { id: "s09", title: "Hybrid and transparency", keyMessage: "Both paths together; flip the filter to hear the room.", narration: "Hybrid ANC runs both paths at once. Transparency mode reuses the same mics with a different filter, adding the outside back in.", budgetSec: 110 },
    { id: "s10", title: "What ANC can't cancel", keyMessage: "Steady lows, yes. Voices, clatter and wind, much less.", narration: "ANC is superb on steady low rumble and weaker on anything sudden. A good seal matters as much as the algorithm.", budgetSec: 120 },
  ],
};

export const ANC_STORYBOARD: Storyboard = {
  slides: [
    { id: "s01", layout: "Title left, hero object right, caption bottom centre", visual: "3d-object", interaction: "Slow idle rotation of the earbud", motionBeats: ["Title fades up", "Earbud rotates into three-quarter view"], object3d: "Earbud: ellipsoid head, capsule stem, translucent ear tip, metal nozzle" },
    { id: "s02", layout: "Full-width canvas with headline above", visual: "simulation", interaction: "None; animated longitudinal wave", motionBeats: ["Particles compress and spread", "Pressure curve traces underneath"] },
    { id: "s03", layout: "Two panels side by side", visual: "comparison", interaction: "Step reveals the active panel", motionBeats: ["Passive bars grow", "Active bars grow on step"] },
    { id: "s04", layout: "Exploded object fills the canvas, labels with leader lines", visual: "3d-object", interaction: "Step explodes the assembly", motionBeats: ["Assembled bud", "Parts slide apart along x", "Labels fade in"], object3d: "Nine named parts: tip, nozzle, driver, chamber, board, ANC chip, housing, battery, mics" },
    { id: "s05", layout: "Signal chain across the middle, legend below", visual: "diagram", interaction: "Packets flow mic → ADC → DSP → DAC → driver", motionBeats: ["Blocks draw in", "Packets start flowing", "DSP highlights on step"] },
    { id: "s06", layout: "Closed loop on the left, explanation right", visual: "diagram", interaction: "A pulse travels the loop", motionBeats: ["Loop draws", "Residual pulse circulates"] },
    { id: "s07", layout: "Canvas with three waves, slider and readout on the right", visual: "simulation", interaction: "Phase-error slider updates the sum and the dB readout", motionBeats: ["Noise", "Anti-noise", "Sum"] },
    { id: "s08", layout: "Big stats over a segmented timeline", visual: "chart", interaction: "None", motionBeats: ["Segments fill left to right"] },
    { id: "s09", layout: "Mode toggle above a two-mic diagram", visual: "diagram", interaction: "Toggle ANC / Transparency / Off", motionBeats: ["Mic paths light per mode"] },
    { id: "s10", layout: "Attenuation chart with three curves", visual: "chart", interaction: "Step adds the combined curve", motionBeats: ["Passive curve", "Active curve", "Combined"] },
  ],
};

/** What the critic "finds" per slide in the mock build: one array per round that failed. */
export const ANC_CRITIC: Record<string, string[][]> = {
  s01: [["Title and earbud overlap at 1280px-wide crops; move the object 80px right."]],
  s02: [],
  s03: [["Bar labels at 18px are below the 22px minimum."], ["Active panel heading wraps to two lines."]],
  s04: [["Labels 06 and 09 collide.", "Battery is hidden behind the board in step 0."]],
  s05: [],
  s06: [["Loop arrow direction is ambiguous; add arrowheads."]],
  s07: [["Residual readout shows -Infinity dB at 0°; clamp to -60 dB."], ["Slider thumb has no focus style."]],
  s08: [],
  s09: [["Transparency mode leaves the DSP block lit."]],
  s10: [],
};

export const RESEARCH_LOG = [
  "Reading the brief: 20 min, engineers new to audio DSP",
  "Searching: feedforward vs feedback ANC architecture",
  "Reading Kuo & Morgan, Active Noise Control: A Tutorial Review",
  "Searching: ANC latency budget microseconds",
  "Reading Analog Devices AN-1450",
  "Searching: AirPods Pro 2 teardown microphones",
  "Cross-checking part counts across three teardowns",
  "Searching: ear tip seal ANC attenuation dB",
  "Writing research.md with 6 sources",
];
export const OUTLINE_LOG = ["Grouping facts into a narrative arc", "Budgeting 10 slides for 20 minutes", "Drafting section titles", "Checking every slide makes one point"];
export const SCRIPT_LOG = ["Writing narration for s01–s04", "Writing narration for s05–s08", "Writing narration for s09–s10", "Balancing time budgets to 20:00"];
export const STORYBOARD_LOG = [
  "Choosing a visual for each key message",
  "s01, s04: specifying procedural earbud parts",
  "s07: designing the phase-error simulation",
  "Planning motion beats per step",
  "Checking interactivity level against the style",
];
