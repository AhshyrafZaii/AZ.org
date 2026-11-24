/*
 * FOLD ENGINE 001 — UnDecided · FOLD INDEX · Collection 001
 * Parameter-controlled accordion-fold graphics engine.
 * p5.js 1.11.1 (instance mode, bundled in lib/). No other dependencies.
 *
 * Sections
 *   1. Constants        palette, formats, projection + light constants, timeline
 *   2. Parameters       defaults, ranges, validation
 *   3. Geometry         rigid-panel accordion surface in 3D model space
 *   4. Projection       orthographic front / oblique cabinet, model → canvas
 *   5. Timeline         deterministic frame-index → fold angle
 *   6. Rendering        draws one artwork into any p5 surface (screen or offscreen)
 *   7. Export           PNG, PNG frame sequence (ZIP), parameter configuration JSON
 *   8. Interface        HTML controls outside the artwork canvas
 *   9. p5 lifecycle
 *
 * Coordinate system (model space, units "u"):
 *   x → right, y → up, z → toward the viewer. Origin at the centre of the surface.
 *   Panels are vertical (parallel to y). Folding happens in the x–z plane.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 1. CONSTANTS
   * ------------------------------------------------------------------ */

  const ENGINE = { name: 'FOLD ENGINE 001', version: '1.0.0' };

  // Approved FOLD INDEX campaign palette. No other hues are used.
  const COLOURS = {
    espresso: '#49352C',
    powder:   '#ADC5D9',
    ivory:    '#EEE8D8',
    ink:      '#252724',
  };

  // Palettes are arrangements of the four approved colours only.
  // rising / falling = the two facet orientations of the accordion.
  const PALETTES = {
    campaign: { label: 'Campaign — ivory ground', ground: COLOURS.ivory,    rising: COLOURS.powder, falling: COLOURS.espresso, line: COLOURS.ink,   text: COLOURS.ink,   shade: COLOURS.ink },
    espresso: { label: 'Espresso ground',         ground: COLOURS.espresso, rising: COLOURS.powder, falling: COLOURS.ivory,    line: COLOURS.ivory, text: COLOURS.ivory, shade: COLOURS.ink },
    line:     { label: 'Line study — ivory',      ground: COLOURS.ivory,    rising: COLOURS.ivory,  falling: COLOURS.ivory,    line: COLOURS.ink,   text: COLOURS.ink,   shade: COLOURS.ink },
  };

  const FORMATS = {
    '1080x1350': { width: 1080, height: 1350, label: '1080 × 1350 · 4:5' },
    '1080x1920': { width: 1080, height: 1920, label: '1080 × 1920 · 9:16' },
  };

  // Oblique (cabinet) projection: receding depth drawn at 60°, foreshortened by k = 0.5.
  // 60° (not 45°) keeps both facet families front-facing for all θ ≤ 75°:
  // a facet turns away when tan θ > 1 / (k·cos α) → 76.0° at 60°, 70.5° at 45°.
  const OBLIQUE = { k: 0.5, alphaDeg: 60 };

  // Fixed directional light (front-right, 30° off axis), used only for facet tone. Normals have y = 0.
  const LIGHT = normalize3([0.5, 0, Math.sqrt(3) / 2]);
  const SHADE_STRENGTH = 0.35; // max mix toward the palette's shade colour

  // Finite 8 s sequence at 30 fps. Keys are [frameIndex, angleDeg].
  const TIMELINE = {
    fps: 30,
    frames: 240,
    keys: [[0, 0], [60, 0], [120, 75], [180, 30], [240, 30]],
  };

  const SERIF = 'Georgia, "Times New Roman", Times, serif';
  const MONO = '"SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';

  /* ------------------------------------------------------------------ *
   * 2. PARAMETERS
   * ------------------------------------------------------------------ */

  // Built-in copy of presets.json. Used when presets.json cannot be fetched
  // (e.g. index.html opened directly from disk via file://). QA checks both match.
  const BUILT_IN_PRESETS = {
    defaults: {
      format: '1080x1350',
      panelCount: 12,
      panelWidth: 64,
      panelHeight: 480,
      foldAngle: 0,
      projection: 'orthographic',
      offsetX: 0,
      offsetY: 0,
      displayScale: 1,
      palette: 'campaign',
      strokeWeight: 1,
      fillOpacity: 1,
      outlines: true,
      annotations: true,
      transparent: false,
      exportScale: 1,
    },
    presets: [
      { id: 'S01', name: 'Flat',        params: { foldAngle: 0 } },
      { id: 'S02', name: 'Articulated', params: { foldAngle: 30 } },
      { id: 'S03', name: 'Folded',      params: { foldAngle: 60 } },
      { id: 'S04', name: 'Compressed',  params: { foldAngle: 75 } },
    ],
  };

  const RANGES = {
    panelCount:   { min: 4,    max: 24,  step: 2,    even: true },
    panelWidth:   { min: 16,   max: 160, step: 1 },
    panelHeight:  { min: 120,  max: 960, step: 1 },
    foldAngle:    { min: 0,    max: 75,  step: 0.5 },
    offsetX:      { min: -540, max: 540, step: 1 },
    offsetY:      { min: -960, max: 960, step: 1 },
    displayScale: { min: 0.25, max: 2,   step: 0.01 },
    strokeWeight: { min: 0.25, max: 4,   step: 0.25 },
    fillOpacity:  { min: 0,    max: 1,   step: 0.01 },
  };
  const ENUMS = {
    format: Object.keys(FORMATS),
    projection: ['orthographic', 'oblique'],
    palette: Object.keys(PALETTES),
    exportScale: [1, 2],
  };
  const BOOLS = ['outlines', 'annotations', 'transparent'];

  let presetData = BUILT_IN_PRESETS;
  const defaults = () => ({ ...presetData.defaults });

  /** Returns a new, fully valid parameter object. Unknown keys are dropped. */
  function validateParams(raw, base) {
    raw = raw || {};
    base = base || BUILT_IN_PRESETS.defaults;
    const out = {};
    for (const [k, r] of Object.entries(RANGES)) {
      let v = Number(raw[k]);
      if (raw[k] === '' || raw[k] === null || raw[k] === undefined || !Number.isFinite(v)) v = base[k];
      v = clamp(v, r.min, r.max);
      if (r.even) v = clamp(2 * Math.round(v / 2), r.min, r.max);
      out[k] = v;
    }
    for (const [k, list] of Object.entries(ENUMS)) {
      const v = k === 'exportScale' ? Number(raw[k]) : raw[k];
      out[k] = list.includes(v) ? v : base[k];
    }
    for (const k of BOOLS) {
      const v = raw[k];
      out[k] = typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : base[k];
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 3. GEOMETRY — rigid-panel accordion
   *
   * N panels of true width w and height h. Each panel is inclined by ±θ
   * to the x-axis, alternating direction. Vertex i (a vertical fold line):
   *   x_i = −W/2 + i·w·cos θ          W = N·w·cos θ   (projected width)
   *   z_i = ±D/2 (odd i toward viewer) D = w·sin θ     (panel depth)
   * Adjacent panels share vertex objects, so shared edges are exact.
   * Odd vertices (toward viewer) are mountain folds, even interior ones valleys.
   * ------------------------------------------------------------------ */

  function buildGeometry(P, angleDeg) {
    const N = P.panelCount, w = P.panelWidth, h = P.panelHeight;
    const deg = angleDeg === undefined ? P.foldAngle : angleDeg;
    const theta = (deg * Math.PI) / 180;
    const c = Math.cos(theta), s = Math.sin(theta);
    const W = N * w * c;
    const D = w * s;

    const vertices = [];
    for (let i = 0; i <= N; i++) {
      vertices.push({
        index: i,
        x: -W / 2 + i * w * c,
        z: i % 2 === 1 ? D / 2 : -D / 2,
        type: i === 0 || i === N ? 'edge' : i % 2 === 1 ? 'mountain' : 'valley',
      });
    }

    const yTop = h / 2, yBottom = -h / 2;
    const panels = [];
    for (let i = 0; i < N; i++) {
      const v0 = vertices[i], v1 = vertices[i + 1];
      const dx = v1.x - v0.x, dz = v1.z - v0.z;
      const len = Math.hypot(dx, dz); // equals w (rigid panel)
      panels.push({
        index: i,
        family: i % 2 === 0 ? 'rising' : 'falling',
        v0, v1,
        normal: [-dz / len, 0, dx / len], // front-side unit normal (z ≥ 0)
        corners: [
          { x: v0.x, y: yTop,    z: v0.z },
          { x: v1.x, y: yTop,    z: v1.z },
          { x: v1.x, y: yBottom, z: v1.z },
          { x: v0.x, y: yBottom, z: v0.z },
        ],
      });
    }
    return { N, w, h, angleDeg: deg, theta, W, D, vertices, panels };
  }

  /* ------------------------------------------------------------------ *
   * 4. PROJECTION
   *   orthographic: (x, y, z) → (x, y)            — true front elevation
   *   oblique:      (x, y, z) → (x − k·z·cos α, y − k·z·sin α)
   *                 receding depth (−z) drawn up-right; z = 0 is unchanged.
   * ------------------------------------------------------------------ */

  function projectPoint(pt, mode) {
    if (mode === 'oblique') {
      const a = (OBLIQUE.alphaDeg * Math.PI) / 180;
      return { x: pt.x - pt.z * OBLIQUE.k * Math.cos(a), y: pt.y - pt.z * OBLIQUE.k * Math.sin(a) };
    }
    return { x: pt.x, y: pt.y };
  }

  /** Direction toward the viewer along the projectors (used for facing + draw order). */
  function viewVector(mode) {
    if (mode === 'oblique') {
      const a = (OBLIQUE.alphaDeg * Math.PI) / 180;
      return [OBLIQUE.k * Math.cos(a), OBLIQUE.k * Math.sin(a), 1];
    }
    return [0, 0, 1];
  }

  /** Model units → canvas pixels (canvas y grows downward). */
  function canvasLayout(P) {
    const F = FORMATS[P.format];
    return { cx: F.width / 2 + P.offsetX, cy: F.height / 2 + P.offsetY, s: P.displayScale };
  }
  function toCanvas(pt2, L) {
    return { x: L.cx + pt2.x * L.s, y: L.cy - pt2.y * L.s };
  }

  /* ------------------------------------------------------------------ *
   * 5. TIMELINE — angle is a pure function of the integer frame index.
   * ------------------------------------------------------------------ */

  function easeInOutCubic(u) {
    return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  }

  function angleAtFrame(frame) {
    const f = clamp(Math.round(frame), 0, TIMELINE.frames - 1);
    const keys = TIMELINE.keys;
    for (let i = 0; i < keys.length - 1; i++) {
      const [f0, a0] = keys[i], [f1, a1] = keys[i + 1];
      if (f <= f1) return a0 + (a1 - a0) * easeInOutCubic((f - f0) / (f1 - f0));
    }
    return keys[keys.length - 1][1];
  }

  /* ------------------------------------------------------------------ *
   * 6. RENDERING
   * ------------------------------------------------------------------ */

  /**
   * Draw one artwork into a p5 surface (the main sketch or a p5.Graphics).
   * opts: { angle, scale = 1, caption: { id, name, right } }
   */
  function renderArtwork(g, P, opts) {
    const scale = opts.scale || 1;
    const F = FORMATS[P.format];
    const pal = PALETTES[P.palette];
    const geo = buildGeometry(P, opts.angle);
    const L = canvasLayout(P);
    const view = viewVector(P.projection);

    g.push();
    if (P.transparent) g.clear();
    else g.background(...hexRgb(pal.ground));
    g.scale(scale);

    // Painter's order: draw facets farthest along the view direction first.
    const order = geo.panels
      .map((pn) => {
        const cx = (pn.v0.x + pn.v1.x) / 2, cz = (pn.v0.z + pn.v1.z) / 2;
        return { pn, depth: cx * view[0] + cz * view[2] };
      })
      .sort((a, b) => a.depth - b.depth || a.pn.index - b.pn.index);

    for (const { pn } of order) {
      const pts = pn.corners.map((c) => toCanvas(projectPoint(c, P.projection), L));
      const facing = dot3(pn.normal, view) >= 0;
      const n = facing ? pn.normal : pn.normal.map((v) => -v);
      const lambert = Math.max(0, dot3(n, LIGHT));
      const rgb = mixRgb(hexRgb(pal[pn.family]), hexRgb(pal.shade), SHADE_STRENGTH * (1 - lambert));

      g.noStroke();
      g.fill(rgb[0], rgb[1], rgb[2], 255 * P.fillOpacity);
      g.beginShape();
      for (const q of pts) g.vertex(q.x, q.y);
      g.endShape(g.CLOSE);

      if (P.outlines) drawPanelEdges(g, pts, pn, pal, P.strokeWeight);
    }

    if (P.annotations) drawAnnotations(g, P, geo, L, F, pal, opts.caption || captionFor(P, geo.angleDeg));
    g.pop();
    return geo;
  }

  // Crease convention: outer edges + mountain folds solid, valley folds dashed.
  function drawPanelEdges(g, pts, pn, pal, weight) {
    const ctx = g.drawingContext;
    g.noFill();
    g.stroke(...hexRgb(pal.line));
    g.strokeWeight(weight);
    g.strokeCap(g.SQUARE);
    g.line(pts[0].x, pts[0].y, pts[1].x, pts[1].y); // top
    g.line(pts[3].x, pts[3].y, pts[2].x, pts[2].y); // bottom
    const sides = [[pts[0], pts[3], pn.v0.type], [pts[1], pts[2], pn.v1.type]];
    for (const [a, b, type] of sides) {
      ctx.setLineDash(type === 'valley' ? [6, 5] : []);
      g.line(a.x, a.y, b.x, b.y);
    }
    ctx.setLineDash([]);
  }

  function captionFor(P, angleDeg) {
    const preset = presetData.presets.find((s) => s.params.foldAngle === angleDeg);
    if (preset) return { id: preset.id, name: preset.name, right: `${preset.id} · ${preset.name.toUpperCase()}` };
    return { id: 'C', name: 'Custom', right: `CUSTOM · θ ${fmt(angleDeg)}°` };
  }
  function sequenceCaption(frame) {
    return {
      id: 'Q01',
      name: 'Sequence — fold and release',
      right: `f ${String(frame).padStart(3, '0')} / ${TIMELINE.frames} · t ${(frame / TIMELINE.fps).toFixed(3)} s`,
    };
  }

  function drawAnnotations(g, P, geo, L, F, pal, cap) {
    const ctx = g.drawingContext;
    const M = 72, Wc = F.width, Hc = F.height;
    const ink = pal.text;

    // Header
    text(ctx, 'FOLD INDEX', M, 104, { font: SERIF, size: 22, tracking: 5, colour: ink });
    text(ctx, 'Collection 001 — Studies in Transformable Form', M, 132, { font: SERIF, size: 15, style: 'italic', colour: ink, alpha: 0.8 });
    text(ctx, ENGINE.name, Wc - M, 100, { font: MONO, size: 11, tracking: 2, align: 'right', colour: ink, alpha: 0.7 });
    text(ctx, cap.right, Wc - M, 130, { font: MONO, size: 12, align: 'right', colour: ink });
    hairline(g, M, 160, Wc - M, 160, ink);

    // Fold marks above each interior fold line (M = mountain, V = valley)
    const tops = geo.vertices.map((v) => toCanvas(projectPoint({ x: v.x, y: geo.h / 2, z: v.z }, P.projection), L));
    const bottoms = geo.vertices.map((v) => toCanvas(projectPoint({ x: v.x, y: -geo.h / 2, z: v.z }, P.projection), L));
    const topY = Math.min(...tops.map((t) => t.y));
    let minGap = Infinity;
    for (let i = 2; i < geo.N; i++) minGap = Math.min(minGap, Math.abs(tops[i].x - tops[i - 1].x));
    for (let i = 1; i < geo.N; i++) {
      const t = tops[i];
      hairline(g, t.x, topY - 10, t.x, topY - 18, ink);
      if (minGap >= 14) {
        text(ctx, geo.vertices[i].type === 'mountain' ? 'M' : 'V', t.x, topY - 26, { font: MONO, size: 10, align: 'center', colour: ink, alpha: 0.75 });
      }
    }

    // Dimension line for W (vertices 0 and N share z, so their span is exactly W·scale)
    const yDim = Math.max(...bottoms.map((b) => b.y)) + 44;
    const xL = bottoms[0].x, xR = bottoms[geo.N].x;
    hairline(g, xL, yDim, xR, yDim, ink);
    hairline(g, xL, yDim - 6, xL, yDim + 6, ink);
    hairline(g, xR, yDim - 6, xR, yDim + 6, ink);
    text(ctx, `W = ${fmt(geo.W)} u`, (xL + xR) / 2, yDim + 24, { font: MONO, size: 12, align: 'center', colour: ink });

    // Technical data block + footer
    const footerY = Hc - 72;
    const rowH = 22, y0 = footerY - 60 - 3 * rowH;
    const left = [['N', `${geo.N} panels`], ['w', `${fmt(geo.w)} u`], ['h', `${fmt(geo.h)} u`], ['θ', `${fmt(geo.angleDeg)}°`]];
    left.forEach(([k, v], i) => {
      text(ctx, k, M, y0 + i * rowH, { font: MONO, size: 12, colour: ink, alpha: 0.6 });
      text(ctx, v, M + 40, y0 + i * rowH, { font: MONO, size: 12, colour: ink });
    });
    const proj = P.projection === 'oblique'
      ? `oblique · cabinet ${OBLIQUE.alphaDeg}° · k ${OBLIQUE.k}`
      : 'orthographic · front';
    const right = [
      `W = N·w·cos θ = ${fmt(geo.W)} u`,
      `D = w·sin θ   = ${fmt(geo.D)} u`,
      `projection    ${proj}`,
      `scale         ${fmt(P.displayScale)} px/u`,
    ];
    right.forEach((r, i) => text(ctx, r, Wc / 2 + 24, y0 + i * rowH, { font: MONO, size: 12, colour: ink }));
    hairline(g, M, footerY - 36, Wc - M, footerY - 36, ink);
    text(ctx, `Fig. ${cap.id} — ${cap.name}`, M, footerY, { font: SERIF, size: 15, style: 'italic', colour: ink });
    text(ctx, 'FORM IS A VARIABLE.', Wc - M, footerY, { font: SERIF, size: 15, tracking: 3, align: 'right', colour: ink });
  }

  function hairline(g, x1, y1, x2, y2, hex) {
    const [r, gg, b] = hexRgb(hex);
    g.stroke(r, gg, b, 255 * 0.45);
    g.strokeWeight(0.75);
    g.strokeCap(g.SQUARE);
    g.line(x1, y1, x2, y2);
  }

  /** Canvas text with optional letter-spacing (tracking, px). Respects the current transform. */
  function text(ctx, str, x, y, o) {
    ctx.save();
    ctx.font = `${o.style || 'normal'} ${o.size}px ${o.font}`;
    const [r, g, b] = hexRgb(o.colour);
    ctx.fillStyle = `rgba(${r},${g},${b},${o.alpha === undefined ? 1 : o.alpha})`;
    ctx.textBaseline = 'alphabetic';
    const tracking = o.tracking || 0;
    const align = o.align || 'left';
    if (!tracking) {
      ctx.textAlign = align;
      ctx.fillText(str, x, y);
    } else {
      const chars = [...str];
      const widths = chars.map((ch) => ctx.measureText(ch).width);
      const total = widths.reduce((a, b) => a + b, 0) + tracking * (chars.length - 1);
      let cx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
      ctx.textAlign = 'left';
      chars.forEach((ch, i) => { ctx.fillText(ch, cx, y); cx += widths[i] + tracking; });
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ *
   * 7. EXPORT
   * ------------------------------------------------------------------ */

  let P5 = null; // p5 instance, set in section 9

  /** Render into a fresh offscreen surface at exact format × exportScale pixels. */
  function renderOffscreen(P, opts) {
    const F = FORMATS[P.format];
    const s = (opts && opts.scale) || P.exportScale;
    const g = P5.createGraphics(F.width * s, F.height * s);
    g.pixelDensity(1);
    renderArtwork(g, P, { ...opts, scale: s });
    return g;
  }

  function canvasToPngBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  function currentRenderOpts() {
    if (state.mode === 'sequence') return { angle: angleAtFrame(state.frame), caption: sequenceCaption(state.frame) };
    return { angle: state.params.foldAngle };
  }

  function exportName(P, ext) {
    const F = FORMATS[P.format];
    const tag = state.mode === 'sequence'
      ? `Q01-f${String(state.frame).padStart(3, '0')}`
      : captionFor(P, P.foldAngle).id === 'C' ? `custom-${fmt(P.foldAngle)}deg` : captionFor(P, P.foldAngle).id;
    const parts = ['FOLD-INDEX', tag, `${F.width * P.exportScale}x${F.height * P.exportScale}`, P.projection];
    if (P.transparent) parts.push('alpha');
    if (!P.annotations) parts.push('clean');
    return `${parts.join('_')}.${ext}`;
  }

  async function exportPNG() {
    const P = state.params;
    const g = renderOffscreen(P, currentRenderOpts());
    const blob = await canvasToPngBlob(g.elt);
    g.remove();
    downloadBlob(blob, exportName(P, 'png'));
    return blob;
  }

  function configObject() {
    return {
      engine: ENGINE.name,
      version: ENGINE.version,
      mode: state.mode,
      frame: state.frame,
      params: { ...state.params },
      derived: (() => {
        const geo = buildGeometry(state.params, currentRenderOpts().angle);
        return { angleDeg: geo.angleDeg, W: geo.W, D: geo.D };
      })(),
    };
  }

  function saveConfig() {
    const json = JSON.stringify(configObject(), null, 2) + '\n';
    downloadBlob(new Blob([json], { type: 'application/json' }), exportName(state.params, 'json'));
  }

  function applyConfig(obj) {
    const params = obj && obj.params ? obj.params : obj;
    state.params = validateParams(params, defaults());
    state.mode = obj && obj.mode === 'sequence' ? 'sequence' : 'static';
    state.frame = clamp(Math.round(Number(obj && obj.frame) || 0), 0, TIMELINE.frames - 1);
    state.playing = false;
    onParamsChanged();
  }

  /** Render all 240 frames into one uncompressed ZIP of PNGs (+ config). Deterministic. */
  async function buildFramesZip(P, onProgress) {
    const F = FORMATS[P.format];
    const s = P.exportScale;
    const g = P5.createGraphics(F.width * s, F.height * s);
    g.pixelDensity(1);
    const files = [];
    for (let f = 0; f < TIMELINE.frames; f++) {
      renderArtwork(g, P, { angle: angleAtFrame(f), caption: sequenceCaption(f), scale: s });
      const blob = await canvasToPngBlob(g.elt);
      files.push({ name: `frames/frame_${String(f).padStart(3, '0')}.png`, bytes: new Uint8Array(await blob.arrayBuffer()) });
      if (onProgress) onProgress(f + 1);
    }
    g.remove();
    const cfg = { engine: ENGINE.name, version: ENGINE.version, mode: 'sequence', params: { ...P }, timeline: TIMELINE };
    files.push({ name: 'frames/config.json', bytes: new TextEncoder().encode(JSON.stringify(cfg, null, 2) + '\n') });
    return makeZip(files);
  }

  async function exportFrames() {
    if (state.exporting) return;
    state.exporting = true;
    state.playing = false;
    const P = state.params;
    const zip = await buildFramesZip(P, (n) => setStatus(`Rendering frame ${n} / ${TIMELINE.frames}…`));
    const F = FORMATS[P.format];
    downloadBlob(zip, `FOLD-INDEX_Q01_frames_${F.width * P.exportScale}x${F.height * P.exportScale}_${P.projection}.zip`);
    setStatus(`Exported ${TIMELINE.frames} frames (${(zip.size / 1048576).toFixed(1)} MB ZIP).`);
    state.exporting = false;
    syncUI();
  }

  // Minimal ZIP writer (store method, no compression). Fixed timestamp → reproducible bytes.
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function makeZip(files) {
    const enc = new TextEncoder();
    const chunks = [], central = [];
    let offset = 0;
    const DOS_TIME = 0, DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01 00:00
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.bytes), size = f.bytes.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, DOS_TIME, true); lh.setUint16(12, DOS_DATE, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, f.bytes);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0, true); ch.setUint16(10, 0, true); ch.setUint16(12, DOS_TIME, true);
      ch.setUint16(14, DOS_DATE, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true);
      ch.setUint32(24, size, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((a, c) => a + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  function downloadBlob(blob, name) {
    // Optional host hook (used by the hosted preview, where downloads are blocked).
    if (typeof window.FoldEngineDeliver === 'function') return window.FoldEngineDeliver(blob, name);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* ------------------------------------------------------------------ *
   * 8. INTERFACE — plain HTML controls; never drawn into the artwork.
   * ------------------------------------------------------------------ */

  const state = {
    params: validateParams(BUILT_IN_PRESETS.defaults),
    mode: 'static',
    frame: 0,
    playing: false,
    exporting: false,
    presetsSource: 'built-in',
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  function setStatus(msg) { const el = $('#status'); if (el) el.textContent = msg; }

  function buildControls() {
    // Range + number pairs, generated from RANGES so limits live in one place.
    for (const el of $$('[data-range]')) {
      const key = el.dataset.range, r = RANGES[key];
      el.innerHTML =
        `<label for="r-${key}">${el.dataset.label}</label>` +
        `<input type="range" id="r-${key}" min="${r.min}" max="${r.max}" step="${r.step}">` +
        `<input type="number" id="n-${key}" min="${r.min}" max="${r.max}" step="${r.step}" aria-label="${el.dataset.label} value">` +
        `<span class="unit">${el.dataset.unit || ''}</span>`;
      const update = (v) => setParam(key, v);
      el.querySelector('input[type=range]').addEventListener('input', (e) => update(e.target.value));
      el.querySelector('input[type=number]').addEventListener('change', (e) => update(e.target.value));
    }
    fillSelect('#format', Object.entries(FORMATS).map(([k, f]) => [k, f.label]));
    fillSelect('#palette', Object.entries(PALETTES).map(([k, p]) => [k, p.label]));
    for (const id of ['format', 'projection', 'palette', 'exportScale']) {
      $('#' + id).addEventListener('change', (e) => setParam(id, e.target.value));
    }
    for (const id of BOOLS) $('#' + id).addEventListener('change', (e) => setParam(id, e.target.checked));

    $$('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    $('#play').addEventListener('click', togglePlay);
    $('#restart').addEventListener('click', () => { setMode('sequence'); state.frame = 0; state.playing = true; onParamsChanged(); });
    $('#scrub').max = TIMELINE.frames - 1;
    $('#scrub').addEventListener('input', (e) => { setMode('sequence'); state.playing = false; state.frame = Number(e.target.value); onParamsChanged(); });
    $('#exportPng').addEventListener('click', () => exportPNG().then(() => setStatus(`Exported ${exportName(state.params, 'png')}`)));
    $('#exportFrames').addEventListener('click', exportFrames);
    $('#saveConfig').addEventListener('click', saveConfig);
    $('#loadConfig').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try { applyConfig(JSON.parse(await file.text())); setStatus(`Loaded ${file.name}`); }
      catch (err) { setStatus(`Could not read ${file.name}: ${err.message}`); }
      e.target.value = '';
    });
    $('#reset').addEventListener('click', () => {
      state.params = validateParams(defaults());
      state.mode = 'static'; state.frame = 0; state.playing = false;
      onParamsChanged();
      setStatus('Parameters reset to defaults.');
    });
  }

  function buildPresetButtons() {
    const wrap = $('#presets');
    wrap.innerHTML = '';
    for (const s of presetData.presets) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.preset = s.id;
      b.innerHTML = `<b>${s.id}</b><span>${s.name} · ${s.params.foldAngle}°</span>`;
      b.addEventListener('click', () => applyPreset(s.id));
      wrap.appendChild(b);
    }
  }

  /** Preset = defaults + preset overrides. Output format is kept. */
  function applyPreset(id) {
    const s = presetData.presets.find((x) => x.id === id);
    if (!s) return;
    state.params = validateParams({ ...defaults(), ...s.params, format: state.params.format });
    state.mode = 'static'; state.playing = false;
    onParamsChanged();
  }

  function fillSelect(sel, pairs) {
    $(sel).innerHTML = pairs.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  }

  function setParam(key, value) {
    state.params = validateParams({ ...state.params, [key]: value }, state.params);
    onParamsChanged();
  }

  function setMode(mode) {
    if (state.mode === mode) return;
    state.mode = mode;
    if (mode === 'static') state.playing = false;
    onParamsChanged();
  }

  function togglePlay() {
    setMode('sequence');
    if (!state.playing && state.frame >= TIMELINE.frames - 1) state.frame = 0;
    state.playing = !state.playing;
    onParamsChanged();
  }

  function syncUI() {
    const P = state.params;
    for (const key of Object.keys(RANGES)) {
      const r = $('#r-' + key), n = $('#n-' + key);
      if (r) r.value = P[key];
      if (n && document.activeElement !== n) n.value = P[key];
    }
    for (const id of ['format', 'projection', 'palette', 'exportScale']) $('#' + id).value = String(P[id]);
    for (const id of BOOLS) $('#' + id).checked = P[id];
    $$('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
    $('#r-foldAngle').disabled = $('#n-foldAngle').disabled = state.mode === 'sequence';
    $$('[data-preset]').forEach((b) => {
      const s = presetData.presets.find((x) => x.id === b.dataset.preset);
      b.classList.toggle('active', state.mode === 'static' && s.params.foldAngle === P.foldAngle);
    });
    $('#play').textContent = state.playing ? 'Pause' : 'Play';
    $('#scrub').value = state.frame;
    const a = angleAtFrame(state.frame);
    $('#frameReadout').textContent =
      `f ${String(state.frame).padStart(3, '0')} · ${(state.frame / TIMELINE.fps).toFixed(2)} s · θ ${fmt(a)}°`;
    $('#exportFrames').disabled = state.exporting;
    $('#stage').classList.toggle('transparent', P.transparent);
    const geo = buildGeometry(P, currentRenderOpts().angle);
    $('#derived').textContent = `W ${fmt(geo.W)} u · D ${fmt(geo.D)} u · ${FORMATS[P.format].width * P.exportScale} × ${FORMATS[P.format].height * P.exportScale} px export`;
  }

  function onParamsChanged() {
    if (!P5) return;
    const F = FORMATS[state.params.format];
    if (P5.width !== F.width || P5.height !== F.height) P5.resizeCanvas(F.width, F.height);
    syncUI();
    if (state.playing) P5.loop();
    else { P5.noLoop(); P5.redraw(); }
  }

  async function loadPresets() {
    if (!/^https?:/.test(location.protocol)) {
      setStatus('Opened from disk: using built-in presets (identical to presets.json).');
      return;
    }
    try {
      const res = await fetch('presets.json', { cache: 'no-store' });
      const data = await res.json();
      if (!data || !data.defaults || !Array.isArray(data.presets)) throw new Error('unexpected structure');
      presetData = {
        defaults: validateParams(data.defaults),
        presets: data.presets.map((s) => ({ id: String(s.id), name: String(s.name), params: s.params || {} })),
      };
      state.presetsSource = 'presets.json';
      state.params = validateParams(presetData.defaults);
      setStatus('Presets loaded from presets.json.');
    } catch (err) {
      setStatus(`presets.json unavailable (${err.message}); using built-in presets.`);
    }
  }

  /* ------------------------------------------------------------------ *
   * 9. p5 LIFECYCLE
   * ------------------------------------------------------------------ */

  new p5((p) => {
    p.setup = () => {
      P5 = p;
      p.pixelDensity(1); // canvas pixels = artwork pixels
      const F = FORMATS[state.params.format];
      p.createCanvas(F.width, F.height).parent('stage');
      p.frameRate(TIMELINE.fps);
      p.noLoop();
      buildControls();
      buildPresetButtons();
      syncUI();
      loadPresets().then(() => { buildPresetButtons(); onParamsChanged(); window.FoldEngine.ready = true; });
    };

    p.draw = () => {
      renderArtwork(p, state.params, currentRenderOpts());
      if (state.playing) {
        if (state.frame < TIMELINE.frames - 1) state.frame += 1;
        else { state.playing = false; p.noLoop(); }
        syncUI();
      }
    };
  });

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function fmt(v) { return (Math.abs(v) < 5e-10 ? 0 : v).toFixed(2); }
  function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function normalize3(v) { const l = Math.hypot(...v); return v.map((x) => x / l); }
  function hexRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mixRgb(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }

  // Public surface for scripted use and QA. Not required for normal use.
  window.FoldEngine = {
    ENGINE, COLOURS, PALETTES, FORMATS, OBLIQUE, TIMELINE, RANGES, BUILT_IN_PRESETS,
    validateParams, buildGeometry, projectPoint, viewVector, angleAtFrame,
    renderOffscreen, canvasToPngBlob, buildFramesZip, makeZip, crc32,
    exportPNG, saveConfig, applyConfig, applyPreset, configObject, currentRenderOpts,
    state, get presets() { return presetData; }, ready: false,
  };
})();
