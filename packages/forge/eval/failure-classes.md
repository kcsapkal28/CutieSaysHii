# Critic failure classes (87 reviews, 528 issues, mean score 5.8; mined 2026-10-24)

Counts are keyword clusters over every review.json produced so far (Moon, Roman, Bill, digital-marketing, db-index before/after, v2-eval). Use them to decide what the prompts and the reference library must teach; keep everything topic-agnostic.


## labels/leader/legend — 205 issues (55 high)

- [high] The knockout labels are filled solid gold with dim text that barely reads. They should be muted mono 18px on a background-coloured knockout. The label widths are uneven, and '03 INTERFERENCE' touches 'Grandmaster's champ
  fix: Set the background to var(--df-bg) and the colour to var(--df-muted), with padding 4px 10px, centred on x=960 via translateX(-50%). Start the Hulk cell content at x=1060, not at the spine.
- [high] The axis line itself doesn't show. Only the ticks and year labels appear at y≈560, so the timeline reads as the background grid. The 2012 marker also has no visible leader up to its card, and the 2017 leader stops at the
  fix: Draw the axis as a 2px line in #006d8f (or brighter) from x=160 to 1760, above the grid (z-index). Add a 1px leader from the 2012 marker's top edge to the chip's bottom edge, and run the 2017 leader t
- [high] The 14px lavender token parks over the middle of each active stage box and covers its label: 'Pro▪oked' in step 1, 'Hurt o▪taunted' in step 2 and 'baseli▪e' in step 4.
  fix: Park the token on the circle path at the stage's angle, not at the box centre. Alternatively, offset it outside the box: place it at the box edge where the circle crosses it, or 12px below the box. Th
- [high] The 'beats $2.50 bid' chip is white text on an off-white background (1.3:1), so it is effectively invisible. The storyboard asks for a blue chip reading 'beats $4.00 bid', but the copy shows $2.50, which is the winner's 
  fix: Give .chip a solid blue background (the deck's blue token) with white text, 22-24px, and set its text to 'beats $4.00 bid' (the highest losing bid). For .pw, use a white or off-white fill with the red
- [high] The bars and the black label bars run off the bottom edge. 'A · BID $4.00 · Q 5' is cut by the canvas, and the ground line exits at the bottom-left. The bars are too short and low (tops at y≈300–560 of 1080), so the lowe
  fix: Raise the baseline by about 90px so all three black label bars sit fully inside the canvas with ≥40px of bottom margin. Scale bar heights by about 1.3× so B's top reaches y≈250. At step 1 add a faint 
- [high] The budget-off bar and its caption collide with the Retention band. The bar runs straight through the band's bottom edge, and the 'OWNED + EARNED KEEP WORKING' label is cut to 'WNED + EARNED KEEP WORKING' where it overla
  fix: Move the bar and its labels below the lowest band. The band bottom is about y=1055 at 1920 scale, so either shift the whole staircase up and shrink band spacing, or put the bar at y≈1000 with 40px cle
- [high] The visual is timid and under-scaled. Chips are about 14px caps and the band-name labels are small. The staircase hugs the right and leaves the left third and the bottom empty, apart from a tiny 4-line subtitle. The funn
  fix: Scale the staircase up about 1.25x, to 190px-tall bands with chips at 24-26px. Start the first band at x≈120 so it fills the lower two-thirds. Raise the subtitle to about 30px and set it in a wider me
- [high] The legend does not encode the colours. All three dots (PAID, OWNED, EARNED) are the same red, and no ochre appears anywhere. The storyboard asks for owned and earned to be ochre, and the surviving chips in step 5 (PR, R
  fix: Give each legend dot its own fill (PAID red #c3201a, OWNED ochre #c8962e, EARNED a lighter or hatched ochre). Keep the owned and earned chips as solid ochre bars with dark text in media mode, and fade
- [high] In the budget-off state the red chips fade to pale pink with near-invisible text (SOCIAL ADS, VIDEO, DISPLAY, RETARGETING, SEARCH ADS). The surviving chips lose their bars and read as loose text, so the 'ochre keeps glow
  fix: Dim paid chips to about 35% opacity but keep a legible outline or strike-through. Render owned and earned chips as filled ochre with a soft glow (box-shadow 0 0 24px ochre) and a slow pulse. Keep chip
- [high] The '200 CUSTOMERS' bar is essentially invisible. The text is #f6f0e3 on the #e8e1d2 background (1.1:1), the bar has no visible blue fill, and the label floats unattached below gate 03, so the payoff of the slide is lost
  fix: Give .bar a solid blue fill (about 360×56px) under gate 03 with the pipe end feeding into it. Set the label to cream #f6f0e3 on that blue, or to dark text. The contrast must reach at least 3:1, and id
- [high] The blue 200 CUSTOMERS bar and blue dots are effectively invisible in step 5. The label is cream (#f6f0e3) on a cream (#e8e1d2) background at 22px, measured at 1.1:1 contrast. Only a faint blue speck shows near the pipe 
  fix: Make the bar a solid blue block (the deck's blue accent), at least 220×56px, placed under the pipe end where the blue dots drop into it. Set the label to white or near-black at 26–28px, with at least 
- [high] The funnel does not show the effect of the sliders. At conversion 3% (step 3) the SPEND, IMPRESSIONS and CLICKS bars are unchanged, and only the CUSTOMERS bar grows, from 200 to 600, a few pixels wider. At step 5, with b
  fix: Draw the baseline funnel as a 2px dashed muted outline (#8a8478 at 60% opacity) of the same slanted bar shapes, behind the live bars, at the step-1 values. Change the bar-length map so a 3x change is 

## steps/motion not visible — 107 issues (39 high)

- [high] In step 5 the FRAME 01 frame scales to 1.12 from its top-left corner, not its centre. Its top edge (y≈165) ends up overlapping the 72px title, and its left edge moves out to x≈120, past the 160 margin. The frame was alre
  fix: Set transform-origin: 50% 50% on the frame. Move the 2012 card down so the frame starts at y≥250 (e.g. frame y 250–430) and stays at least 40px below the title even at 1.12 scale.
- [high] The tab states are reversed. When a tab is active it turns light grey, and the inactive tabs show solid accent3 gold. On the final step all tabs are white even though the storyboard says they should all be filled.
  fix: Swap the classes. Inactive tabs get a transparent fill with a 1px muted border and muted text. Use .is-active / .is-seen to set background: var(--accent3) with dark text, and on step 6 apply the fille
- [high] In the Calm step, the 'GAP 80' readout is drawn underneath 'RAGE 0%': faint blue text is visible behind the 'RAGE' glyphs at about (1560,530). The blue redline from the fill top to the ceiling is a hairline at x≈1515, ou
  fix: Run the redline at x=1500 (just right of the frame), 2px, in line blue with 12px end ticks. Place the 'GAP nn' label beside the line at its midpoint (x=1510, mono 22px). Move the RAGE/STRENGTH readout
- [high] At step 3 the price reads $2.50, which is just B's own bid, so the headline 'pay less' is not shown. The storyboard has the price at $2.22 only from step 4, so the number is correct only if step 3 is meant to show the bi
  fix: At step 3 hide the saves chip and the 'beats' chip, or show the price as '—'. Animate .pval from $2.50 to $2.22 over 0.8 s at step 4 and fade in 'saves $0.28' only after the count-down finishes.
- [high] The blue 'beats $4.00 bid' chip is effectively invisible: white text on a #e8e1d2 background (measured 1.3:1). The chip's blue fill is not rendering, so the text floats on the paper colour.
  fix: Give the chip an explicit solid background of the deck's blue accent (e.g. background:var(--blue,#1f4fd8)) with white text for contrast above 4.5:1, padding 6px 14px, border-radius 4px, font-size 24px
- [high] The step 3 price tag reads $2.50, which is B's own bid. It then jumps to $2.22 at step 4. The 'WINNER PAYS B PER CLICK' headline also shows no savings or runner-up context at that point. The slide's message (pay less tha
  fix: At step 3 show a neutral placeholder (e.g. '—' or a muted '$?.??') until the dashed runner-up line drops. Or start the count-down from a value that is not B's bid. Only reveal the red numeral once the
- [high] The particle flow, which is the point of the slide, is barely visible. Steps 3 and 5 show only a few 3–4px grey specks, and there are no visible red dots flowing, no muted grains falling away, and no blue dots dropping i
  fix: Draw particles at 10–14px in the red accent on the pipe, with a visible trail. At each gate, make about 99% of them fall away in muted grey-beige with gravity over 600–800ms. Make the survivors contin
- [high] The particle flow, which is the whole explanation, is essentially absent. Step 1 shows no red dots in the pipe. Step 3 shows only 3–4 tiny pale-grey specks near the gates, where 99% of the dots should fall away. The view
  fix: Render a dense stream of at least 150 red dots, about 8–10px, in a lighter red or cream so they read against the #c01f18 pipe. At each gate, drop about 90% as muted grains 40–120px below the pipe, fal
- [high] The ghost baseline outline is not visible in any step. In step 5 the bars grow but nothing is left behind to compare against. In step 3 the customers bar triples with no 200 outline behind it. This is the core comparison
  fix: Render a muted outline (2px stroke, about 40% opacity, dashed or solid) of the default simulate() result behind each bar. Keep it at the baseline lengths whatever the sliders say. Label it 'baseline: 
- [high] The wedge in steps 2 and 3 is a lumpy, stepped silhouette, with wobbly shoulders and bulges around the IMPRESSIONS and CLICKS stages, ending in a thin ribbon. It reads as a bottle or paddle rather than the single clean t
  fix: Build the narrowing as a smooth, monotonic polygon with 4 width stops (420 → 300 → 200 → 120px) and straight or gently eased segments, no bulges. Rebuild the clip-path or SVG path so the edges stay co
- [high] The kicker 'DIGITAL MARKETING · AN INTRODUCTION' is cut off by the canvas edge. Its left end ('D') is clipped at x=0 and its right end runs off the top edge ('INTRODUC…'). It is rotated with the title block but sits part
  fix: Move the kicker inside the safe margin (left ≥120px, top ≥90px). Either rotate it with the title group around a pivot that keeps it on-canvas, or set it unrotated above the title. Verify that no glyph
- [high] The KPI reads '+0.0' next to a PASS pill, and the classical output trace is still fully pink-noisy. The storyboard calls for +12.0 dB with a clean output (10% residual). In the captured state the beat says the opposite o
  fix: On step entry, set the KPI's final value to 12.0 (count up from there, or tween over 0.8 s and make sure the step's settled state is +12.0). Apply residual 0.10 to the top output's noise amplitude rig

## (other) — 64 issues (15 high)

- [high] The stamp is a solid gold rectangle with white text instead of accent3 text inside a 3px accent3 outline. Because it is opaque, it covers the frame 02 hammer arc, the knock-back redline and most of frame 03's slam, so th
  fix: Set the stamp to background: transparent; color: var(--accent3); border: 3px solid var(--accent3); font: 64px 'IBM Plex Mono'; letter-spacing: .2em; transform: rotate(-6deg). If it needs some separati
- [high] Sketches break out of their frames. In frame 03, the overhead Thor and Hulk's head sit above the frame's top edge and run into the tab rail next to tab 03. In frame 04, Hulk's head goes above the frame top and the jet ru
  fix: Scale the frame 03 and 04 sketch groups to about 0.8 and shift them down so the highest point stays at least 16px below the frame top (y≥346). Add clip-path or overflow:hidden on each frame's SVG view
- [high] Both figures are about the same height (Thor ~530px from head y≈228 to feet y≈760, Hulk ~540px). This drops the planned 500 vs 600px ratio that is supposed to hint at the next slide.
  fix: Scale the Thor group to exactly 500px (top at y=260) and the Hulk group to 600px (top at y=160), both on the y=760 baseline. Use transform scale on each <g> from a bottom-centre origin.
- [high] The curves don't match the stated model or the axis. The red marginal line crosses the $150 LTV line at about $12k on the x-axis instead of about $22k, and it flattens into a near-horizontal segment past $37k instead of 
  fix: Recompute the paths from the model: y=50*exp(S/20000) for marginal, S/(400*(1-exp(-S/20000))) for blended, and y=150 for LTV. Use one shared x/y scale inside the rotated group so the LTV line is horiz
- [high] The title 'Learned Filters' runs under the scope panel. The final 's' is hidden behind the panel's left edge (about x=900), so the title reads 'Learned Filter'.
  fix: Keep the title inside the left column (x=128–820). Drop the font-size from 120px to about 104px, or set max-width:692px and let 'Filters' wrap onto a second line. Also give the title column z-index ab
- [high] The Earth-view disc is inverted. It shows full cream at New Moon (0% lit), solid navy at Full Moon (100% lit), and a thin crescent at Waning gibbous (75% lit). The lit and dark fills are swapped, which breaks the slide's
  fix: In the disc renderer, swap the fills: draw a navy base circle, then a cream lit region built from a semicircle plus the terminator ellipse (rx = R·|cos θ|). Add the ellipse to the lit side when k > 0.
- [high] In free play the readout says 'Waning gibbous, 75% lit', but the disc shows a thin crescent lit on the left (about 25%). This is the same inversion bug, and the rendered fraction comes out as 1−k.
  fix: Drive both the ellipse rx and the gibbous/crescent branch from the same k = (1 − cos θ)/2 used for the % readout. Use gibbous (ellipse adds to the lit side) when k > 0.5. Waning lights the left side.
- [high] The '29.5 days' bracket line at y≈520 runs right through the 'Waning crescent' phase name under the big Moon. The text gets struck through.
  fix: Shorten or lower the Moon and readout group. Move the Moon centre to (1500, 300) with r=180, and put the name at y≈470 and % lit at y≈505. Or raise the bracket so it sits above or below the readout bl
- [high] The dark hemisphere isn't dark. The right half of the Moon renders mid-tone olive-khaki at nearly the same brightness as the lit half, and the terminator shows only as a narrow black stripe. A viewer can't see 'lit half 
  fix: Remove or cut down every non-key light. Set the hemisphere/ambient light to ≤0.06 in navy (#1a2550), set the rim light to 0.25, and place it behind the Moon (e.g. position (2,0,-3)) so it only edges t
- [high] The crescent view doesn't read as a crescent. The far side is uniformly lit grey-olive with clear crater detail, and the lit sliver on the left limb is barely brighter than the rest, so 'it can look like a banana' isn't 
  fix: Use the same lighting fix so the anti-sun side falls to near-black navy (only faint earthshine). Check that the DirectionalLight is fixed in world space at (-1,0.15,0) and isn't parented to the camera
- [high] The numbers are in the wrong colours. '1,250,000' renders in the text colour, not accent3 coral, and '4' renders in the text colour, not accent2 amber. That drops the deck's colour code and the 'read-stamp' motif.
  fix: Set color:var(--df-accent3) on the 1,250,000 element and color:var(--df-accent2) on the 4. Check that the count-up and stamp tweens end on these colours and don't overwrite them with inline styles.
- [high] The two numbers don't carry their accent colours. '1,250,000' should be accent3 coral and '4' should be accent2 amber, but both render in the pale text colour, so the cost versus the cheap read isn't encoded.
  fix: Apply color: var(--df-accent3) to the seq-scan number element and color: var(--df-accent2) to the index-scan '4'. Check for a more specific rule, such as .readout .num { color: var(--df-text) }, that 

## overlap/collision — 48 issues (19 high)

- [high] The chips are solid gold blocks. '2012 · INCONCLUSIVE' is #8aa5b0 on gold, a contrast of 1.3:1, so it is practically invisible. The verdict chip is #e9f4f7 on gold, 3.1:1. The storyboard wants a muted outlined chip and a
  fix: Set the chips to background: transparent. Give the 2012 chip a 1px muted border with muted text, and the verdict chip a 1px var(--df-accent3) border with accent3 text. Put both in a flex row with gap 
- [high] The stage numerals 01 and 02 (about 100px, rotated) overlap the second line of the title ('CUSTOMERS, AT') and the subtitle ('Each gate… what enters'), making both illegible. The numerals sit at y≈150–200 instead of just
  fix: Anchor each numeral directly above its gate, with its baseline about 40px above the gate top (gate tops are at y≈250–270 in the 1024 render, roughly y≈470–500 at 1920). Cap the numeral font-size at ab
- [high] The funnel is crammed into a small upper-left area. The bars sit around x 50–430 and y 195–450 of the 1024-wide screenshot, while the storyboard calls for the funnel to fill the left two-thirds. The region right of the b
  fix: Scale the funnel to roughly 1.8x: bar height about 120px, a diagonal offset of about 150px per stage, and a maximum bar length of about 900px. Let it reach down toward y~900 so it fills x 80–1260. Anc
- [high] The giant 3:1 is mostly hidden behind the LTV block and the title bar. The '3' and the colon are cut by the blue block and the red title banner overlaps its top. The '1' pokes off the top edge of the canvas and the thesi
  fix: Move the 3:1 so it clears the blue block: put it above or right of the LTV block (e.g. left edge at x≈1000, baseline above the block top at y≈500, in 1920 space). Keep it fully inside the canvas (no t
- [high] The giant '3:1' runs off the top of the canvas (the top of the '1' is clipped) and its '3' tucks under the red title banner, so the title bar and numeral collide. It reads as an accident, not as 'behind the beam', and it
  fix: Scale and move the numeral so it sits fully inside the canvas. Keep about 40px of top margin, start it at x≥1250 (at 1920 scale), and put its baseline just above the LTV block around y≈480. Keep the -
- [high] The '04 First quarter' chip overlaps the caption line and hides its end ('we see the whole lit f…', 'only ou… angle.').
  fix: Move the First-quarter chip to the right of its ghost Moon, at y≈930 (anchor around x=780, y=920 with a short leader), or move the caption to y=1010 and limit its width to x<760. Make sure the caption
- [high] The caption 'Eight handy names for one smooth change, like a dimmer switch.' is drawn on top of the title's second line, 'days, with eight handy names'. The two texts overlap and neither can be read.
  fix: Move the caption out of the title block. Put it at bottom-left (x=128, y=1010, 30px) or under the Moon readout at x=1500. If it has to stay under the title, set its top to title bottom + 32px (about y
- [high] After the camera orbit, the '02 Moon: lit half' chip re-projects to about (430–580, 180–208) in the downscaled screenshot and overlaps the italic title word 'sunlight'. Both are hard to read.
  fix: Clamp chip positions so they stay out of the title bounding box (getBoundingClientRect of the h1 plus 24px padding). For step 3, place the chip at about x=1000, y=260 (1920 space) or at the crescent's
- [high] The title wraps to two lines ('Four pages' / 'deep'). The second line, 'deep', overlaps the dimension line and the subtitle 'How a database index turns…', which makes both hard to read.
  fix: Lay out the title block as a flex column with real flow: kicker, then h1 (line-height 1.0), then the dimension line (margin-top 24px), then the subtitle (margin-top 20px). Don't absolutely position th
- [high] The title 'farmer-soldier' runs under the 'Who can serve?' toggle button. The hyphen and the button text collide, and the button's dot sits on the word.
  fix: Give the title a max-width of 1180px so it wraps cleanly ('…starved / the farmer-soldier'), and move the toggle to top-right at x=1600–1840, y=60, clear of the title block.
- [high] The caption 'The lesson everyone drew: force pays.' overlaps the '70S–60S BC · EXTRAORDINARY COMMANDS' chip.
  fix: Move the caption into the empty top-right air above the ghosts. Right-align it at x=1760, y=170–260, which is above the chips. Alternatively, lower the chips so the topmost one sits at y≥440.

## contrast — 35 issues (8 high)

- [high] The accent2 (lavender) colour resolves to black. 'HULK' renders #000000 on #0a1c25, a contrast of 1.2:1. It also has no lavender underline. The Hulk cells render near-white instead of lavender, and the '0' in the stat is
  fix: The CSS var is probably misnamed. Use var(--df-accent2) and check that it is defined, or add a fallback such as var(--df-accent2, #b9a7ff). Apply it to #s05-hh, its 2px border-bottom underline, the Hu
- [high] The handoff bar is a solid black slab, not a lavender wash. 'RAGE ?' renders #000 on #091a22, a contrast of 1.2:1. The exit motif into s06 is lost.
  fix: Set the bar's fill to accent2 at about 0.35 opacity, add a 1px accent2 stroke, and set the 'RAGE ?' text fill to accent2. Do this with the same resolved token as above.
- [high] The verdict chip 'INCONCLUSIVE' measures 1.2:1 contrast (text #2a2a2a on #0a1b24), so it is effectively invisible. The 'HULK WINS*' segment is just as dark. These chips are the slide's key message, and the chip borders d
  fix: Set .chip to color: var(--accent3) with border: 1px solid var(--accent3) and padding: 4px 10px. Make sure the chip colour isn't taken from a light-theme token. Keep the '· Thor restrained' segment as 
- [high] In Mask net mode the hero heatmap still shows the full pink click stripes and babble. It seems to draw the noisy input Y, not the output X̂ = G·Y. The storyboard says the output should be clean cyan harmonics with only f
  fix: When method ≠ Noisy, render X̂ = G·Y. Take lightness from log10(G·Y) and the tint from (G·N)/(G·S+G·N). The Mask net clicks then drop out, while the Wiener clicks stay bright pink.
- [high] In the zoom-out handoff, the stamped page shrinks to a tile at about (140,300) that is almost invisible: two faint hairlines with no visible amber border, so it doesn't stand out from the ghost tiles. The exit state ('th
  fix: Give the final 80×48 tile a solid 2px amber (--df-amber) border and a 12% amber fill. Keep the mint row-17 hairline visible inside it. Don't let it inherit the ghost tiles' opacity: set opacity:1 on t
- [high] The pediment, architrave and all five columns are filled solid pure black. The storyboard asks for ink outlines with a 20% verdigris wash. The pure #000 fill breaks the theme, buries the fluting detail and makes the faca
  fix: Give each column, architrave and pediment path an explicit fill: var(--verdigris) with fill-opacity:0.2 (or fill:none plus a wash rect). Set stroke:var(--ink) and stroke-width:2. Check that no shape i
- [high] At k=6 none of the 58 dropped coefficients turn faint coral. The right grid looks exactly as it did at k=64, so the viewer can't see what was thrown away.
  fix: On slider input, for each cell with zigzagIndex >= k, set the background to rgba(coral, 0.18) and the text colour to coral at 60% opacity. Put a 200ms transition on background-color.
- [high] The Augustus pillar covers the pediment rake lines and both entablature bands, so it sits in front of the temple. It should be behind it. The concept depends on the front still looking intact while the strength runs behi
  fix: Render the pillar group before the facade group in the SVG/DOM (or give it a lower z-index). Give the pediment, entablature and plinth a background fill (e.g. the paper tone at 0.85 opacity) so the pi
- [medium] The active 'As fought' button shows #ffaa00 text on a #e9f4f7 background, a contrast of 1.7:1.
  fix: Draw the active state as a gold background with dark text (var(--df-bg)), or a transparent background with a gold 1px border and gold text.
- [medium] The kicker '#a77b00' on #0e2c3a has a contrast of 3.8:1 at 18px.
  fix: Use the full accent gold (#f5b400-ish) for the kicker so the contrast reaches 4.5:1 or more.
- [medium] The kicker 'PART 2 · THE FIGHTS' measures 3.8:1 contrast (#a77b00 on #0e2c39), below the 4.5:1 AA requirement.
  fix: Lighten the kicker to the gold accent at about #e0a800, or set it to 20px.
- [medium] The gold caption 'FIG. A · THOR' (20px, #a77b00 on #0d2935) measures 4.0:1, below the 4.5:1 AA threshold. The muted kicker 'THE QUESTION · WHO IS THE STRONGEST AVENGER?' is also visibly faint against the grid.
  fix: Use a lighter gold tint (e.g. #c9a032) for small caption text and keep #a77b00 for strokes. Raise the kicker colour to the muted token at ≥4.5:1 (e.g. #8fa9b2).

## storyboard mismatch/missing element — 19 issues (4 high)

- [high] The LTV block is not seated on the beam. It floats with a visible ~0px gap above the right end, which is the beam's high end, so it reads as hovering rather than 'hanging low' and tipping the beam. A square ~490px block 
  fix: Flip the beam rotation so the right end is low (about +12° in CSS, whichever sign makes the right end drop). Anchor the CAC block's bottom to the beam's high left end and the LTV block's bottom edge t
- [high] The owned curve is drawn as a solid black filled area, not the storyboard's ochre curve. It reads as a heavy black blob that matches neither the ochre accent nor the 'no shadows, flat planes' look. On the ochre lower-rig
  fix: Remove the black fill, or set it to a translucent ochre tint at about 25% opacity. Draw the curve as a 10–12px stroke in the deck's ochre token (e.g. #C98A1B). Keep the seam as the only black shape, s
- [high] The page-tile stamps render as solid black squares (near-#000) instead of amber. The read-stamp motif the deck depends on doesn't show up, and the black looks like a rendering bug.
  fix: Set the stamp rect fill to var(--df-accent2). Check that the variable is defined on :root, or add a fallback such as var(--df-accent2, #f2b134). Also make sure the stamp GSAP tween ends at the amber f
- [high] The hero number is rendered in near-white/pale blue, not the coral accent3 the storyboard specifies. The deck's accent colour code (coral = cost) is lost, and the slide looks monochrome apart from the amber details.
  fix: Set the number's colour to the accent3 coral token (e.g. color: var(--accent3)). Keep the amber only for the underline, the lit tile and the leader.
- [medium] The 2018 and 2019 markers render as solid filled amber squares, so they look just as important as the fight markers. The storyboard calls for dashed, muted outline squares. The 01/02 markers are also filled amber when th
  fix: For the same-side markers use background: transparent and border: 1.5px dashed var(--muted). For the fight markers use background: transparent and border: 1.5px solid var(--accent3), with the number i
- [medium] The 'clean' learned output at +11.0 dB PASS still shows pink noise of similar amplitude to the input, so the trace doesn't show the 12% residual.
  fix: Scale the pink noise amplitude by the residual value (0.12 versus 0.60 on the top scope) so the difference is obvious, and ease it over 0.6 s.
- [medium] The Noisy state is a flat, fully saturated pink field from 0.5k to 8k with no log-energy shading. The storyboard says the fan hum is a haze heaviest in the low bins, so the heatmap reads as a coloured block rather than a
  fix: Map lightness from 10·log10(power), normalised to −60…0 dB and gamma-compressed, so the 1/(f+5) hum gets dimmer toward 8 kHz. Cap noise-only bins at about 55% lightness so the speech harmonics stay th
- [medium] The grid's nonzero cells are only partly visible. The zero cells are near-black on a black background, with no coral zeros shown in the grid, and the amber values sit behind the path. The storyboard calls for amber nonze
  fix: Render all 64 values. Put zeros in coral at 60% opacity on a dark grey cell (#1c1c1c) with 1px gaps, and draw the path beneath the value text, or with lower opacity.
- [medium] BITS/PIXEL 12.0 stays fixed at k=6 and sits apart from the other stats. It isn't in the storyboard and implies nothing is saved.
  fix: Remove it from this slide, or compute it from k and move it into the stats column under the DC readout using the same label/value styles.
- [medium] The zero count '57' is white, but the storyboard asks for it in coral. Chip 04 says '~60 of 63' while the counter shows 57, so the two disagree.
  fix: Set the counter numeral to color var(--accent2). Change the chip text to '57 of 63 AC → 0 (smooth block)', or build it from the live count.
- [medium] The teal accent from the storyboard is missing. The '10:1 to 20:1' figure renders in the off-white text colour, and the 'JPEG · ~1–2 bits/pixel' chip text is also off-white. This loses the colour code where teal means co
  fix: Set color: var(--teal) on the ratio figure and on the JPEG chip label (or give that chip a teal 1px border). Keep the 'Original' chip neutral.
- [medium] The chip 'BEFORE: SOLDIER → STATE' breaks across two lines and leaves 'STATE' on its own line. It also sits at the far left (x≈100–425) instead of under the seal at y=570, as the storyboard asked.
  fix: Add white-space:nowrap and let the chip size to its text (about 400px wide). Centre it under the seal at x=560, y=570, and make its leader a short vertical line up to the bottom of the seal ring.

## empty/sparse/dead space — 16 issues (1 high)

- [high] The cell fill doesn't follow |coef|^0.5. Cells showing 0, ±1 or ±2 are almost all fully saturated amber, the same as −102 and −44. The grid reads as an amber checkerboard, not 'one or two big numbers, the rest near-empty
  fix: Set each cell's fill to rgba(amber, a) with a = Math.sqrt(Math.abs(F)/maxAbs), where maxAbs is the largest |F| (DC included). Floor a at about 0.04 so near-zero cells stay almost background. Also chec
- [medium] The CONVERSION chip row overruns its band. 'APP STORE' extends to x≈983 in the screenshot while the band ends at ≈907, so the chip hangs off the band into the empty canvas and breaks the docking idea. The RETENTION chips
  fix: Size the chips so each row fits inside its band: reduce padding or gap for the conversion row, or lengthen band 3 to ≥ chip row width + 40px. Use one chip font size (~22px at 1920) in all rows and let
- [medium] The composition is lopsided and the funnel is timid. The bars occupy a small band (about x50–560, y205–505) of the left two-thirds, with large empty space to their right. The CAC readout and a stray thin blue line float 
  fix: Scale the funnel to span x80–1260 and about y300–900, with bar lengths mapped to log10 across that full width. Anchor the CAC readout under the CUSTOMERS bar with a leader line that ends on it. Remove
- [medium] The '>50%' stat block floats in the empty lower right with no relation to the wedge or the blue tip, and is not aligned to the title grid or the footnote. The caption wraps with the orphan 'NOW DIGITAL' on its own line, 
  fix: Align the stat's left edge to a deliberate column (e.g. the CLICKS label x or the footnote block). Narrow the caption measure so it breaks as 'WELL OVER HALF OF / AD SPEND IS NOW DIGITAL'. Consider ty
- [medium] The Sun glow ellipse is cut off at the canvas's left edge and looks like a lopsided blob, not a deliberate Sun.
  fix: Replace it with a radial-gradient circle centred at x=-80, y=630, radius about 360px, that fades to transparent so the edge looks intentional. Alternatively, keep the whole glow inside x≥128 and send 
- [medium] The diagrams in both panels are small. The Earth–Moon arrangement takes up only about 360×220px inside each 640×560 panel, which leaves dead space below each diagram before its small caption.
  fix: Scale each panel's diagram group by about 1.35 around the panel centre, so Earth sits at a radius of about 55px and the Moon at about 60px. Then move the panel sub-captions up to about y=820 and set t
- [medium] The page tile stamps render as black or dark dots instead of amber stamps. The tiles are also small and sit far from the 4 (x≈1500–1740 with an empty gap), so they read as disconnected.
  fix: Fill the stamp with var(--df-accent2) (for example an 18px amber square or circle at opacity 1). Move the tile row to start about 40px right of the 'PAGES' label and align it to the baseline of the 4.
- [medium] The map is an abstract diagonal band with a straight coastline, and it doesn't read as Italy. The Rubicon double line runs along the coast instead of flowing into the sea, and the empty right side looks like an unexplain
  fix: Draw a recognisable peninsula path: a coast that bends at Ravenna and Ancona, and a Tyrrhenian side on the left. Label the sea 'Adriatic' in italic. Draw the Rubicon as a short river running from inla
- [medium] The composition is lopsided. The grid fills only about x=200–1135 and y=340–900, with a big empty gap between the grid and Rome and between Rome and the bar. Rome is small and reads as an afterthought.
  fix: Follow the layout spec: grid x=200–1160, Rome at x=1420, bar at x=1700. Enlarge the Rome circle to r=90 so the walking crowd reads, and drop the connector line if the figure path replaces it.
- [medium] The composition is lopsided. The lower half (y 540–1000 in canvas space) is empty except for the caption, and the tape sits at y≈980px-scale ≈ 493 in the screenshot instead of 720. The grid is small, about 230px displaye
  fix: Follow the layout spec: grid at y=260 with 44px cells, chips at y=600, tape at y=720 across x=180–1792, and bit stream at y=860.
- [medium] The bottom ~40% of the canvas (y 560–1000) is mostly empty. The grid is small (~370px), and the bottom-right 'bits/pixel 24' widget repeats the counter.
  fix: Enlarge the grid cells to 52px. Use the lower band for the chip row and bit stream as the storyboard laid out. Either drop the bottom-right widget or fold it into the counter.
- [medium] The image is about 1600×595 but the layout leaves a large empty band between the image bottom (about y=825) and the caption. The bits/pixel meter also sits apart from everything, bottom-right.
  fix: Shift the image down to fit the corrected title. Put the caption and chip 04 on a clear rhythm (y=870 and y=970), and line the meter up with the caption's baseline.

## 3D lighting/framing — 11 issues (1 high)

- [high] The silhouettes don't read as Thor or Hulk. Hulk is a rounded oval torso with tiny legs and looks like a snowman or Baymax: no hunch, no clenched fists hanging low, no head set forward. Thor faces straight ahead instead 
  fix: Redraw the paths. Hulk: drop the head below the shoulder line with a forward neck, trapezius peaks, shoulders ~1.6× Thor's width, arms hanging to fists at knee height (draw the fists as boxy knuckle p
- [medium] The beam doesn't read as pivoting on the triangle. The fulcrum is a small triangle with a separate flat base bar, and the beam is a thin line that runs into the LTV block and past the lower right. The LTV block floats, w
  fix: Seat the beam's centre exactly on the triangle's apex and rotate the whole group about that point. Rotate the blocks with the beam, or counter-rotate them so each sits flush on the beam surface. Short
- [medium] The 'wrong' Moon doesn't read as shadow-made. It's a half-lit disc with a small coral sliver, much like the right panel's Moon. The shadow cone points right at Earth's level, so it doesn't reach the Moon at all.
  fix: Aim the coral cone so it visibly hits the Moon, or paint a large coral crescent smear over the Moon's dark half. Make the dark side coral-tinted at about 60% opacity so the misconception is explicit.
- [medium] The page tiles are about 36×56px and look like tiny icons, not page glyphs. They start at x~1280 instead of filling x 1500–1760, so the right side of the INDEX SCAN row looks light.
  fix: Render each tile at the specified 44×56px or larger (about 52×66px would better balance the 160px '4'), use a 16px gap, and position the row from x 1500 to 1760, vertically centred on the 4's cap heig
- [low] The orbit crossing-point marker is a near-black dot that almost disappears against the navy shadow.
  fix: Fill the node dot with the gold accent (or cream) at an 8px radius, and add a tiny 'crossing point' label at 20px.
- [low] The crater rims read as embossed outline rings, more like stamped circles than lunar relief, so the Moon looks slightly toy-like.
  fix: Soften the height map: blur the crater canvas by 2–3px, reduce bumpScale by about 40%, vary crater radii more widely, and add low-frequency maria noise to the albedo.
- [low] The kicker 'BORROWED LIGHT' is small, about 19–20px.
  fix: Set the kicker font-size to 22–24px.
- [low] The tile field is cropped unevenly. A partial row sits at the bottom edge, and the column and row grid lines (offset from the tiles) cut through the tiles, which looks slightly messy. The amber tile does not clearly snap
  fix: Align the blueprint grid lines to the tile pitch (or the gutter centres), and size the field so the margins are equal on all sides. Draw the amber tile as one of the field's own tiles at the same size
- [low] The subtitle wraps so that only 'ever be king' sits on the second line, which is a slightly unbalanced break.
  fix: Set max-width to about 640px or use text-wrap:balance so the two lines are even.
- [low] The right column ends at about y≈1000 (y≈500 in the downscaled shot) and leaves a dead block in the lower right. The column also sits higher than the slab's centre, which makes the composition slightly top-heavy on the r
  fix: Shift the whole right column down by about 60px so the toggle sits at y≈420 and the readout lines up with the stack's centre. Or increase the readout to 96px to fill the space.
- [low] Staggering the chips over two rows works, but the alternating heights look slightly busy next to the calm facade.
  fix: Optionally put all chips on a single row at y=800 with a font-size of 22px and padding of 10px 16px, so each chip fits inside its 160px column pitch. Keep two rows only if a chip would collide.

## clipped/cut off/out of bounds — 7 issues (4 high)

- [high] The chip 'THE RUBICON: EDGE OF HIS PROVINCE' is cut off at the right edge of the canvas and reads 'EDGE OF HIS PROVI…'.
  fix: Anchor the chip by its right edge at x≤1800 (right: 120px), or move it into the empty sea at around x=1300, y=480 with the leader running up-left to the river. Alternatively, break the text into two l
- [high] The chip 'PAY AND LAND FROM THE GENERAL' is clipped at the right canvas edge and reads 'PAY AND LAND FROM THE GEN'.
  fix: Anchor the chip so its right edge stays inside the 128px safe margin: set right:128px instead of a fixed left. Or move it below the coin and land glyphs at x≈1500, y≈470, letting the text wrap to two 
- [high] The zigzag path is wrong. It draws a single line through the nonzero cells and then a series of parallel diagonal strokes with hooks. It does not visibly trace the standard JPEG zigzag through all 64 cells, and the strok
  fix: Build the polyline from cell centres in standard zigzag index order (0,1,8,16,9,2,…). Use cellCenter = x0 + (col+0.5)*44 and stroke it in one path with linejoin round.
- [high] The map shape isn't recognisable as Italy. It is a wedge cut off flat at y≈130 and y≈1000, with straight-cut edges and a notch at the top right. The Adriatic sits in the upper right instead of along the east coast of the
  fix: Redraw the province and Italy paths from simplified real coastline coordinates: the Po valley at the top, a Po-delta bulge near Ravenna and the Adriatic coast running SE down the right side. Let the c
- [medium] The CUSTOMERS end is under-built. The blue wedge is a small triangle jammed into the top-right corner and clipped by the canvas edge. The tick floats on it, and the '04 CUSTOMERS' chip sits detached below with no connect
  fix: Place a fully visible blue wedge notch exactly at the red tip, inside the canvas (about 140–180px long, with margin from the right edge). Align the tick with it. Set the CUSTOMERS label as mono text i
- [medium] The Full Moon glow is drawn around a dark disc, so it reads as an eclipse instead of a bloom.
  fix: Once the disc fill is fixed, tie the gold glow's opacity to k (for example, opacity = k²) so it only blooms when the disc is mostly cream.
- [medium] The bpp curve hits the 4 bpp axis ceiling near Q90 and runs flat along the top edge. It looks clipped rather than measured.
  fix: Set the left axis max to ceil(max(bppCurve)) (e.g. 0–6). Otherwise, let the curve leave the plot area with a clipPath and add a small '↑' marker, instead of clamping values to 4.

## controls/interaction — 6 issues (0 high)

- [low] The slider thumb is a flat grey circle that doesn't match the gold/navy tokens.
  fix: Style the thumb: cream fill (#f5efe0), 3px gold border and a soft gold box-shadow.
- [low] The toggle is an unstyled light box with mismatched type (Inter, sentence case), and it has no visible on/off state.
  fix: Style it as a pill switch in deck tokens: Plex Mono 22px uppercase, ink border, a knob that shows the on/off state, and a 'shield' glyph.
- [low] The caption is centred at x=960 and its right end comes close to the toggle. The two compete at the same baseline.
  fix: Move the toggle up to y≈60 at the top-right, or set the caption at y=1000 with the toggle at y=1010 and leave at least 120px between them.
- [low] The raster toggle has no active-state styling, and the raster comparison or '+N bits' coral chip never appears.
  fix: Highlight the active segment with an amber fill. In the final step, show the raster count in muted text next to the counter.
- [low] The 'Show the legal limit' toggle looks like a plain outlined button, with no switch state or icon showing it is a toggle.
  fix: Style it as a switch: add a pill track with a verdigris knob and aria-pressed styling, plus the label 'Show the legal limit'.

## text too small/legibility — 4 issues (0 high)

- [medium] The marker numbers '01' and '02' render at 14px, below the 16px minimum.
  fix: Make the markers 32px squares and set the number to 16px mono.
- [medium] The subtitle (mono, ~15px at the 1024px preview, roughly 28px at full size) is muted slate on the busy tile grid, so it reads weakly. The long line also has no backing, so grid lines run through it. It is the only place 
  fix: Add a navy backing, e.g. padding 8px 20px with background rgba(10,20,40,.85), or lift the text colour to the full text token. Keep it at least 28px and reduce the grid opacity behind y≈860–940.
- [medium] The chip 'Before: soldier → State' sits about 15px from the left canvas edge, which breaks the 128px margin used everywhere else.
  fix: Move it under the seal as the storyboard specifies: centred at x=560, y=600, with a short vertical leader up to the seal's bottom edge. Alternatively, start it at x≥128.
- [low] The wipe line runs about 10px past the photo's top and bottom edges, so it looks unanchored next to the 4px-radius frame.
  fix: Clamp the line to the photo bounds (top:0; bottom:0 inside the photo container), or end it in small caps that sit exactly on the frame edge.

## generic/polish — 4 issues (0 high)

- [medium] The grid backdrop is coarse and bright, with ~80px cells in saturated teal, and its lines run straight through both figures. That fights the 1.5px outlines and makes the image feel busy instead of quiet.
  fix: Drop the major grid line opacity to ~0.25 and add a faint minor grid at 0.08. Alternatively, mask the grid behind each figure with a soft radial fade so the outlines sit on calmer ground.
- [medium] The landmass is a generic S-shaped band with a straight western coast and no gulf or Po delta, so it doesn't read as Italy. Cisalpine Gaul also fades out at the top as a narrow strip.
  fix: Replace the band path with a simplified real outline of north-central Italy, with the Adriatic coast bulging at Ancona and the Tyrrhenian coast angling in. Widen Cisalpine Gaul across the top, so the 
- [low] The columns are generic fluted shafts, with nothing that reads as a domino. That weakens the 'Domino Century' motif the later slides depend on.
  fix: Give each shaft a domino-like rounded-rectangle body with a thin horizontal divider and one or two small pip dots near the top in a 30%-opacity ink stroke. Keep the capital and base so it still reads 
- [low] The 23 tally strokes are small (about 25px each) and packed into a narrow block. As the visual for '23 wounds' they feel timid next to the large calendar tile.
  fix: Widen the stroke spacing to about 44px and make each stroke about 34px long at 4px width. Let the grid fill the full 260px tile width, at y=720–860 as the layout specifies.

## theme/colour/font misuse — 2 issues (1 high)

- [high] The 'Mask net' block in the mini pipeline is a pure black (#000) rectangle with no hairline border, and it never turns amber or glows. The particle dots run over the glyphs of 'STFT', 'Mask net' and 'iSTFT'.
  fix: Style the block like the others: surface fill, 1px var(--df-accent2) border, amber text. Add box-shadow: 0 0 24px var(--df-accent2) in step 4. Route the dots along the connector lines only, with z-ind
- [low] The first bronze token is drawn faded, unlike the other four, so it looks like a rendering glitch rather than intentional.
  fix: Make sure every token is at full opacity once the step's entry animation finishes. For example, set opacity to 1 when the step completes, or give each token's fade-in delay its own end state.
