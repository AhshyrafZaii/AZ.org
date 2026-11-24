# QA REPORT — FOLD ENGINE 001

**Run:** 2026-11-24 16:20 UTC
**Method:** the actual `index.html` engine loaded in headless Chromium (Playwright), driven through its real controls and its `window.FoldEngine` functions.
**Script:** `qa/run_qa.js`. Raw output: `qa/qa_results.json`.
**Reproduce:** `node qa/run_qa.js`, from `Fold_Engine_001/`; needs Node and Playwright.
**Scope:** no result below is assumed. Each one was produced by the run above, except where it is marked NOT TESTED.

## Required tests

| ID | Result | Evidence |
|---|---|---|
| MAT-01 | **PASS** | θ = 0°: W = N·w·cos θ = 768. The measured projected span from vertex 0 to vertex N is also 768, exact to a tolerance of 1e-9. |
| MAT-02 | **PASS** | θ = 60°: W = 384.0000000000001; the measured span is the same, within a 1e-9 tolerance. The 1e-13 difference is floating-point rounding of cos 60°. |
| MAT-03 | **PASS** | θ = 75°: W = 198.77302663873593 ≈ 198.77, within 0.005; the measured span is the same. |
| GEO-01 | **PASS** | 4,983 configurations (N 4–24 even × θ 0–75° in 0.5° steps × w 16/64/160). There were 0 shared-edge mismatches, compared by exact equality in 3D and in both projections. The maximum error in a rigid panel's true width was 4.6e-13 u, so panels do not stretch. |
| GEO-02 | **PASS** | The same 4,983 configurations gave 0 structural failures: vertex and panel counts were correct and no value was NaN or infinite. Maximum centring error 0 u; maximum W/D formula error 0 u. Range validation also passed (supplementary VAL-00 below). |
| GEO-03 | **PASS** | Orthographic output ignores z. Oblique minus orthographic equals (−k·z·cos α, −k·z·sin α) at every vertex, with a maximum error of 1.1e-13. At θ = 0° the two modes are identical (maximum difference 0). The oblique outer-edge span equals W (maximum error 2.3e-13). |
| DET-01 | **PASS** | Two independent geometry builds produced identical JSON. Two independent renders, the second from a serialised and re-validated copy of the parameters, produced identical pixel SHA-256 hashes (`9d4cb0e6…`). |
| MOT-01 | **PASS** | Frames 0 / 60 / 120 / 180 / 239 (t = 0 / 2 / 4 / 6 / 7.967 s) give exactly 0° / 0° / 75° / 30° / 30°. Both holds are exact. The fold (60–120) only increases and the release (120–180) only decreases. Midpoints are 37.5° and 52.5°, as expected for cubic easing. The largest per-frame step is 3.63°. |
| MOT-02 | **PASS** | The full 240-frame ZIP was built twice and both copies had the same SHA-256 (`a45ce748…`, 18.4 MB, 240 PNGs + config.json). Frame 90 exported through the interface's timeline scrubber is byte-identical to `frame_090.png` in the ZIP. |
| EXP-01 | **PASS** | Each exported PNG header was checked: 1080 × 1350 → 1080 × 1350; 1080 × 1920 → 1080 × 1920; 2× gives 2160 × 2700 and 2160 × 3840. |
| EXP-02 | **PASS** | In a transparent, annotation-free export, the corner and margin pixels have alpha 0 and the geometry centre has alpha 255. The opaque share is 12.76%, against a geometric footprint of 12.64%; the difference is the outline stroke and edge anti-aliasing. |
| EXP-03 | **PASS** | The PNG exported through the interface is byte-identical to a render of the artwork function alone, with no UI involved. It is exactly 1080 × 1350 with no interface margin, and no controls sit inside the artwork container. |
| SRC-01 | **PASS** | All six specified files are present. `sketch.js` is 789 lines of plain, unminified JavaScript in 9 labelled sections with 90 comment lines. There is no build step, and the code passes `node --check`. |
| ART-01 | **NOT TESTED** | Whether the work meets the Creative Taste DNA is an artistic judgement, and that belongs to the founder. **Supporting evidence:** a palette pixel audit passed. Every dominant colour in an S03 plate is an approved colour or an approved colour mixed toward Ink: ivory rgb(238,232,216) 87.4%, shaded powder blue rgb(125,142,154) 6.3%, shaded espresso rgb(71,52,44) 6.3%. For review, see `exports/`. |

## Supplementary checks

| ID | Result | Evidence |
|---|---|---|
| VAL-00 | PASS | Out-of-range values are corrected: panels 5→6, 3→4, 30→24; angle 90→75, −5→0, "abc"→default (0); opacity 2→1; an unknown projection or format falls back to the default. |
| PRE-00 | PASS | `presets.json` is identical to the built-in fallback copy in `sketch.js`. |
| CFG-00 | PASS | A configuration saved with *Save config* and reloaded with *Load config* re-exports a byte-identical PNG. |
| EXP-00 | PASS | In an annotation-free export, no pixel outside the geometry box differs from the ivory ground. |
| RUN-00 | PASS | Opening `index.html` directly via file:// works with no errors and uses the built-in presets. |
| RUN-01 | PASS | No page errors or console errors occurred during the full run. |
| MP4 | PASS | A preview was assembled from the 240 exported frames using the ffmpeg already present in the cloud build environment; no encoder was installed. ffprobe reports 1080 × 1350, 30/1 fps, duration 8.000000 s, 240 frames. |

## Not verified

- **Safari and iPhone rendering.** Only Chromium was tested here. Geometry is deterministic in any browser. Pixel hashes are only reproducible within the same browser and operating system, because font rasterising and anti-aliasing differ between engines.
- **Typography.** The annotations ask for Georgia (serif) and SF Mono or Menlo (monospace), which are present on macOS and iOS. The cloud test machine substituted fallback fonts, so its typography is approximate.
- **Real-time playback.** Smoothness on the founder's devices was not measured. Exported frames do not depend on playback speed.
- **Frame-ZIP export on iPhone.** Memory limits and download behaviour for the 18 MB ZIP were not tested.
