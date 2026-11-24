# FOLD ENGINE 001

UnDecided · FOLD INDEX · Collection 001 — *Studies in Transformable Form*

A small p5.js engine that draws a rigid-panel accordion fold. The same geometry drives static editorial graphics (PNG) and an 8-second procedural fold sequence (PNG frames). Each output follows from its parameters alone: identical parameters give identical pixels.

---

## Run it

**On the MacBook (simplest):**
1. Download the `Fold_Engine_001` folder.
2. Double-click `index.html` to open it in Safari or Chrome. Nothing needs installing, and it works offline because p5.js is bundled in `lib/`.

The status line under the artwork will say *"Opened from disk: using built-in presets"*. This is expected. Browsers block reading `presets.json` from disk, so the engine uses an identical built-in copy of it.

**Optional local server** (only needed if you edit `presets.json` and want the engine to read your edits):
```
cd Fold_Engine_001
python3 -m http.server 8000      # then open http://localhost:8000
```

**On iPhone:** use the private hosted preview (a claude.ai artifact, visible only to you unless you share it). It is built from these same sources by `tools/build_preview.py`, with everything inlined into one page.
- *Export PNG* opens the full-size image in an overlay: press and hold it, then choose *Save to Photos*.
- *Save config* shows the JSON with a Copy button.
- The 240-frame ZIP export is available only on the Mac, because the hosted page cannot download files.

iOS's Files app cannot open a local HTML page with scripts, so `index.html` itself needs the Mac.

---

## Controls (all outside the artwork)

| Group | Control | Range / options |
|---|---|---|
| Mode | Static / Sequence | Sequence uses the timeline angle in place of the fold-angle control |
| Presets | S01 Flat 0° · S02 Articulated 30° · S03 Folded 60° · S04 Compressed 75° | A preset resets to the defaults plus its angle and keeps the current format |
| Geometry | Panels | 4–24, even numbers only (an odd value rounds to the nearest even) |
| | Panel width | 16–160 u |
| | Panel height | 120–960 u |
| | Fold angle | 0–75° |
| | Projection | Orthographic (true front elevation) · Oblique (cabinet 60°, k 0.5) |
| Composition | Format | 1080 × 1350 · 1080 × 1920 |
| | Position X / Y | ±540 / ±960 px from centre (+Y moves down) |
| | Display scale | 0.25–2 px per unit |
| Treatment | Palette | Campaign (ivory ground) · Espresso ground · Line study |
| | Stroke weight | 0.25–4 px |
| | Fill opacity | 0–1 |
| | Structural outlines / Technical annotations / Transparent background | on / off |
| Sequence | Play · Pause · Restart · timeline scrubber (frame 0–239) | |
| Export | PNG size 1× / 2× · Export PNG · Save config · Load config · Reset parameters | |

Every value is validated and clamped, whether it comes from a control, a typed number or a loaded configuration file.

---

## Export

**Static PNG.** Click *Export PNG*.
- At 1× the file matches the format exactly (1080 × 1350 or 1080 × 1920). At 2× it is 2160 × 2700 or 2160 × 3840.
- Untick *Technical annotations* to export the geometry only.
- Tick *Transparent background* to get a PNG with an alpha channel. The checkerboard you see on screen is only an interface preview and is not included in the file.
- Files are named by their content, for example `FOLD-INDEX_S03_1080x1350_orthographic_alpha_clean.png`.

**Parameter configuration.** *Save config* downloads a `.json` file containing every parameter plus the derived W and D. *Load config* restores it exactly; QA confirmed that a reloaded configuration re-exports a byte-identical PNG.

**For Canva.** Use a transparent, annotation-free PNG at 2× for layered compositions, and an annotated PNG on ivory when the plate is the page. Canva then lets you place, crop and set type around it.

**Animation frames.** Click *Export 240 frames (PNG · ZIP)* to get `frames/frame_000.png … frame_239.png` plus `config.json`, at the current format and size.
- The angle comes from the frame number only, so the ZIP is identical every time (confirmed by SHA-256).
- At 1080 × 1350 the ZIP is about 18 MB and takes roughly 10–60 s to build, depending on the device.

**MP4: limitations.**
- The engine does not encode video, and no encoder was installed.
- `exports/FOLD-INDEX_Q01_preview_1080x1350.mp4` was assembled in the cloud build environment from the engine's own 240 frames, using an ffmpeg that was already present there. It is H.264, 30 fps, exactly 8.000 s and 240 frames.
- To make your own MP4 from a frame ZIP you need a tool that can import an image sequence. If ffmpeg is ever approved and installed, the command is:
  `ffmpeg -framerate 30 -i frame_%03d.png -c:v libx264 -pix_fmt yuv420p -crf 18 out.mp4`
- Without that, review the provided preview MP4. Real-time playback inside the engine is only a preview and may drop frames on slow devices; the exported frames are always exact.

---

## Mathematics

**Model space.** x points right, y up, and z toward the viewer, in units "u", with the origin at the centre of the surface. N rigid panels of width w and height h alternate in direction at ±θ to the x-axis:

```
x_i = −W/2 + i · w · cos θ          W = N · w · cos θ    (total projected width)
z_i = +D/2 (odd i) / −D/2 (even i)  D = w · sin θ        (panel depth)
```

- Odd fold lines face the viewer and are **mountain** folds (M, solid line). Even interior fold lines are **valley** folds (V, dashed line), following origami crease convention.
- Adjacent panels share the same vertex objects, so their shared edges match exactly.

**Orthographic projection** `(x, y, z) → (x, y)`.
- This is the true front elevation. Depth is invisible, and only the projected width W changes.
- Defaults: W = 768 u at 0°, 384 u at 60° and 198.77 u at 75°.

**Oblique projection (cabinet)** `(x, y, z) → (x − k·z·cos α, y − k·z·sin α)` with k = 0.5 and α = 60°.
- This is an explicit drawing convention for making depth visible, not a camera.
- It equals the orthographic projection wherever z = 0, so the two modes agree completely at θ = 0°.
- α = 60° was chosen over the more common 45° because a facet turns away from the viewer when tan θ > 1/(k·cos α). That happens at 70.5° with α = 45° but only at 76.0° with α = 60°, so both facet families stay visible over the full 0–75° range.

**Shading.** A fixed directional light from the front-right, 30° off axis, gives Lambert facet tone by mixing each plane's colour toward Ink by up to 35%. No other colours are introduced.

- In both projections, plane colour shows facet orientation (rising facets powder blue, falling facets espresso). It does not mean the outer side and lining of a physical sheet.
- Drawing order uses depth along the view direction (painter's algorithm), which is exact for a vertical zigzag.

**Timeline.** 30 fps, 240 frames, with the angle a pure function of the integer frame index `f` (t = f / 30 s). Cubic ease-in/ease-out:

| Frames | Time | Angle |
|---|---|---|
| 0–60 | 0–2 s | hold 0° |
| 60–120 | 2–4 s | 0° → 75° |
| 120–180 | 4–6 s | 75° → 30° |
| 180–239 | 6–8 s | hold 30° |

The sequence is finite and does not loop. The camera is fixed.

---

## Files

```
Fold_Engine_001/
├── index.html        page + control markup
├── sketch.js         engine: constants · parameters · geometry · projection · timeline · rendering · export · interface
├── styles.css        interface styles (neutral grey, kept separate from the artwork palette)
├── presets.json      defaults + S01–S04 (edit here; sketch.js holds an identical fallback copy)
├── README.md
├── QA_REPORT.md
├── lib/p5.min.js     p5.js v1.11.1 (LGPL-2.1, see lib/p5.LICENSE.txt)
├── qa/run_qa.js      automated QA (Node + Playwright; not needed to use the engine)
├── tools/build_preview.py  builds the single-file iPhone preview
├── qa/qa_results.json
└── exports/          sample outputs produced by the QA run
```

**Editing tips**
- Palettes, the oblique constants, the light and the timeline keys are all at the top of `sketch.js`, in section 1.
- If you change the defaults or presets in `presets.json`, mirror the change in `BUILT_IN_PRESETS` in `sketch.js`. The QA check `PRE-00` flags any mismatch.

**Dependency.** p5.js 1.11.1 (`lib/p5.min.js`, SHA-256 `2dbe3fbaf46e43ec61d65fd614cb4300e38b1bc2dc4c0885b4c627d77503c1df`), from the npm registry.
