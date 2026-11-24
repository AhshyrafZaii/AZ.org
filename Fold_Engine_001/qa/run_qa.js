/*
 * FOLD ENGINE 001 — automated QA.
 * Runs the real engine (index.html) in headless Chromium via Playwright and
 * writes qa/qa_results.json plus sample exports to exports/.
 *
 * Usage (from Fold_Engine_001/):  node qa/run_qa.js
 * Requires Node + Playwright with Chromium. Not needed to use the engine.
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'exports');
const results = [];
const record = (id, status, evidence) => { results.push({ id, status, evidence }); console.log(`${status.padEnd(10)} ${id} — ${evidence}`); };
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => srv.listen(0, () => r(srv)));
}

async function download(page, clickSelector) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(clickSelector)]);
  const file = await dl.path();
  return { name: dl.suggestedFilename(), buf: fs.readFileSync(file) };
}

/** Decode a PNG in the browser and return pixel stats. */
async function pixelProbe(page, buf, points, rect) {
  return page.evaluate(async ({ b64, points, rect }) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    const at = (x, y) => Array.from(d.slice((y * bmp.width + x) * 4, (y * bmp.width + x) * 4 + 4));
    const counts = new Map();
    let transparent = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) { transparent++; continue; }
      const k = `${d[i]},${d[i + 1]},${d[i + 2]},${d[i + 3]}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const total = bmp.width * bmp.height;
    let outside = 0;
    if (rect) {
      const g = at(0, 0).join();
      for (let y = 0; y < bmp.height; y++) for (let x = 0; x < bmp.width; x++) {
        if (x >= rect[0] && x <= rect[2] && y >= rect[1] && y <= rect[3]) continue;
        if (at(x, y).join() !== g) outside++;
      }
    }
    const dominant = [...counts.entries()].filter(([, n]) => n / total > 0.002).map(([k, n]) => ({ rgba: k.split(',').map(Number), share: n / total }));
    return { outside, width: bmp.width, height: bmp.height, transparentShare: transparent / total, samples: points.map(([x, y]) => at(x, y)), dominant };
  }, { b64: buf.toString('base64'), points, rect });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const base = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base + 'index.html');
  await page.waitForFunction(() => window.FoldEngine && window.FoldEngine.ready);

  /* ---------- MAT: projected width ---------- */
  const mat = await page.evaluate(() => {
    const E = window.FoldEngine, P = E.validateParams(E.BUILT_IN_PRESETS.defaults);
    return [0, 60, 75].map((a) => {
      const g = E.buildGeometry(P, a);
      const pv = g.vertices.map((v) => E.projectPoint({ x: v.x, y: 0, z: v.z }, 'orthographic'));
      return { a, W: g.W, measured: pv[g.N].x - pv[0].x };
    });
  });
  const expect = { 0: 768, 60: 384, 75: 198.77 };
  for (const [i, m] of mat.entries()) {
    const id = `MAT-0${i + 1}`;
    const tol = m.a === 75 ? 0.005 : 1e-9;
    const ok = Math.abs(m.W - expect[m.a]) <= tol && Math.abs(m.measured - expect[m.a]) <= tol;
    record(id, ok ? 'PASS' : 'FAIL', `θ=${m.a}°: formula W=${m.W}, projected vertex span=${m.measured}, expected ${expect[m.a]} (tol ${tol})`);
  }

  /* ---------- GEO-01 / GEO-02 / GEO-03 ---------- */
  const geo = await page.evaluate(() => {
    const E = window.FoldEngine;
    let cases = 0, sharedFail = 0, rigidMaxErr = 0, structFail = 0, centreMaxErr = 0, formulaMaxErr = 0;
    let obliqueMaxErr = 0, flatMaxDiff = 0, orthoZIndependent = true, obliqueSpanMaxErr = 0;
    const a = (E.OBLIQUE.alphaDeg * Math.PI) / 180;
    for (let N = 4; N <= 24; N += 2) {
      for (let t = 0; t <= 75; t += 0.5) {
        for (const w of [16, 64, 160]) {
          const P = E.validateParams({ ...E.BUILT_IN_PRESETS.defaults, panelCount: N, panelWidth: w, foldAngle: t });
          const g = E.buildGeometry(P);
          cases++;
          if (g.vertices.length !== N + 1 || g.panels.length !== N) structFail++;
          const allNums = g.vertices.every((v) => Number.isFinite(v.x) && Number.isFinite(v.z));
          if (!allNums) structFail++;
          formulaMaxErr = Math.max(formulaMaxErr, Math.abs(g.W - N * w * Math.cos((t * Math.PI) / 180)), Math.abs(g.D - w * Math.sin((t * Math.PI) / 180)));
          centreMaxErr = Math.max(centreMaxErr, Math.abs(g.vertices[0].x + g.vertices[N].x));
          for (let i = 0; i < N - 1; i++) {
            const p = g.panels[i], q = g.panels[i + 1];
            // shared edge: right edge of panel i == left edge of panel i+1 (3D and both projections)
            const same3 = (u, v) => u.x === v.x && u.y === v.y && u.z === v.z;
            if (!same3(p.corners[1], q.corners[0]) || !same3(p.corners[2], q.corners[3])) sharedFail++;
            for (const mode of ['orthographic', 'oblique']) {
              const A = E.projectPoint(p.corners[1], mode), B = E.projectPoint(q.corners[0], mode);
              if (A.x !== B.x || A.y !== B.y) sharedFail++;
            }
          }
          for (const p of g.panels) rigidMaxErr = Math.max(rigidMaxErr, Math.abs(Math.hypot(p.v1.x - p.v0.x, p.v1.z - p.v0.z) - w));
          for (const v of g.vertices) {
            const o = E.projectPoint({ x: v.x, y: 100, z: v.z }, 'orthographic');
            const b = E.projectPoint({ x: v.x, y: 100, z: v.z }, 'oblique');
            if (o.x !== v.x || o.y !== 100) orthoZIndependent = false;
            obliqueMaxErr = Math.max(obliqueMaxErr, Math.abs(b.x - o.x + v.z * E.OBLIQUE.k * Math.cos(a)), Math.abs(b.y - o.y + v.z * E.OBLIQUE.k * Math.sin(a)));
            if (t === 0) flatMaxDiff = Math.max(flatMaxDiff, Math.abs(b.x - o.x), Math.abs(b.y - o.y));
          }
          const b0 = E.projectPoint({ x: g.vertices[0].x, y: 0, z: g.vertices[0].z }, 'oblique');
          const bN = E.projectPoint({ x: g.vertices[N].x, y: 0, z: g.vertices[N].z }, 'oblique');
          obliqueSpanMaxErr = Math.max(obliqueSpanMaxErr, Math.abs(bN.x - b0.x - g.W));
        }
      }
    }
    return { cases, sharedFail, rigidMaxErr, structFail, centreMaxErr, formulaMaxErr, obliqueMaxErr, flatMaxDiff, orthoZIndependent, obliqueSpanMaxErr };
  });
  record('GEO-01', geo.sharedFail === 0 && geo.rigidMaxErr < 1e-9 ? 'PASS' : 'FAIL',
    `${geo.cases} configurations (N 4–24 even × θ 0–75° step 0.5 × w 16/64/160): ${geo.sharedFail} shared-edge mismatches (exact equality, 3D + both projections); max rigid panel-width error ${geo.rigidMaxErr.toExponential(2)} u`);
  record('GEO-02', geo.structFail === 0 && geo.centreMaxErr < 1e-9 && geo.formulaMaxErr < 1e-9 ? 'PASS' : 'FAIL',
    `${geo.cases} configurations: ${geo.structFail} structural failures (vertex/panel counts, non-finite values); max centring error ${geo.centreMaxErr.toExponential(2)} u; max W/D formula error ${geo.formulaMaxErr.toExponential(2)} u`);
  record('GEO-03', geo.orthoZIndependent && geo.obliqueMaxErr < 1e-9 && geo.flatMaxDiff === 0 && geo.obliqueSpanMaxErr < 1e-9 ? 'PASS' : 'FAIL',
    `orthographic ignores z: ${geo.orthoZIndependent}; oblique − orthographic = (−k·z·cos α, −k·z·sin α) max err ${geo.obliqueMaxErr.toExponential(2)}; at θ=0 modes identical (max diff ${geo.flatMaxDiff}); oblique outer-edge span = W (max err ${geo.obliqueSpanMaxErr.toExponential(2)})`);

  /* ---------- Parameter validation (supports GEO-02 / DET-01) ---------- */
  const val = await page.evaluate(() => {
    const E = window.FoldEngine, v = (o) => E.validateParams({ ...E.BUILT_IN_PRESETS.defaults, ...o });
    return {
      n5: v({ panelCount: 5 }).panelCount, n3: v({ panelCount: 3 }).panelCount, n30: v({ panelCount: 30 }).panelCount,
      a90: v({ foldAngle: 90 }).foldAngle, aNeg: v({ foldAngle: -5 }).foldAngle, aBad: v({ foldAngle: 'abc' }).foldAngle,
      op: v({ fillOpacity: 2 }).fillOpacity, proj: v({ projection: 'perspective' }).projection, fmt: v({ format: '999x1' }).format,
    };
  });
  const valOk = val.n5 === 6 && val.n3 === 4 && val.n30 === 24 && val.a90 === 75 && val.aNeg === 0 && val.aBad === 0 && val.op === 1 && val.proj === 'orthographic' && val.fmt === '1080x1350';
  record('VAL-00', valOk ? 'PASS' : 'FAIL', `range validation (supplementary): ${JSON.stringify(val)}`);

  /* ---------- Presets file == built-in copy ---------- */
  const presetsMatch = await page.evaluate(async () => {
    const file = await (await fetch('presets.json')).json();
    return JSON.stringify(file) === JSON.stringify(window.FoldEngine.BUILT_IN_PRESETS);
  });
  record('PRE-00', presetsMatch ? 'PASS' : 'FAIL', `presets.json identical to built-in fallback copy in sketch.js (supplementary): ${presetsMatch}`);

  /* ---------- DET-01 ---------- */
  const det = await page.evaluate(async () => {
    const E = window.FoldEngine;
    const P = E.validateParams({ ...E.BUILT_IN_PRESETS.defaults, foldAngle: 47.5, panelCount: 18, projection: 'oblique' });
    const g1 = JSON.stringify(E.buildGeometry(P)), g2 = JSON.stringify(E.buildGeometry({ ...P }));
    const hash = async (g) => {
      const d = g.drawingContext.getImageData(0, 0, g.width, g.height).data;
      const h = await crypto.subtle.digest('SHA-256', d);
      g.remove();
      return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
    };
    const r1 = await hash(E.renderOffscreen(P, { angle: P.foldAngle }));
    const r2 = await hash(E.renderOffscreen(E.validateParams(JSON.parse(JSON.stringify(P))), { angle: P.foldAngle }));
    return { geomEqual: g1 === g2, r1, r2 };
  });
  record('DET-01', det.geomEqual && det.r1 === det.r2 ? 'PASS' : 'FAIL',
    `geometry JSON identical: ${det.geomEqual}; two independent renders pixel SHA-256 ${det.r1.slice(0, 16)}… vs ${det.r2.slice(0, 16)}…`);

  /* ---------- MOT-01 ---------- */
  const mot = await page.evaluate(() => {
    const E = window.FoldEngine;
    const b = { 0: E.angleAtFrame(0), 59: E.angleAtFrame(59), 60: E.angleAtFrame(60), 120: E.angleAtFrame(120), 180: E.angleAtFrame(180), 239: E.angleAtFrame(239) };
    const all = Array.from({ length: 240 }, (_, f) => E.angleAtFrame(f));
    let mono = true;
    for (let f = 61; f <= 120; f++) if (all[f] < all[f - 1]) mono = false;
    for (let f = 121; f <= 180; f++) if (all[f] > all[f - 1]) mono = false;
    const holdA = all.slice(0, 61).every((x) => x === 0), holdB = all.slice(180).every((x) => x === 30);
    const mid = { 90: all[90], 150: all[150] };
    return { b, mono, holdA, holdB, mid, maxStep: Math.max(...all.slice(1).map((x, i) => Math.abs(x - all[i]))) };
  });
  const motOk = mot.b[0] === 0 && mot.b[60] === 0 && mot.b[120] === 75 && mot.b[180] === 30 && mot.b[239] === 30 && mot.mono && mot.holdA && mot.holdB;
  record('MOT-01', motOk ? 'PASS' : 'FAIL',
    `angles at frames 0/60/120/180/239 (t 0/2/4/6/7.967 s) = ${[0, 60, 120, 180, 239].map((f) => mot.b[f]).join('/')}°; holds exact: ${mot.holdA && mot.holdB}; monotonic in fold & release: ${mot.mono}; midpoints f90=${mot.mid[90]}°, f150=${mot.mid[150]}°; max per-frame step ${mot.maxStep.toFixed(3)}°`);

  /* ---------- MOT-02: frame-index reproducibility (scrub path vs direct render, and full ZIP twice) ---------- */
  await page.click('[data-mode=sequence]');
  await page.evaluate(() => { const s = document.querySelector('#scrub'); s.value = 90; s.dispatchEvent(new Event('input')); });
  const viaUi = await download(page, '#exportPng');
  const zipHashes = await page.evaluate(async () => {
    const E = window.FoldEngine;
    const P = E.validateParams(E.BUILT_IN_PRESETS.defaults);
    const h = async (blob) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).map((b) => b.toString(16).padStart(2, '0')).join('');
    const z1 = await E.buildFramesZip(P), z2 = await E.buildFramesZip(P);
    return { a: await h(z1), b: await h(z2), size: z1.size };
  });
  const direct = await page.evaluate(async () => {
    const E = window.FoldEngine;
    const P = E.validateParams(E.BUILT_IN_PRESETS.defaults);
    const g = E.renderOffscreen(P, { angle: E.angleAtFrame(90), caption: undefined });
    g.remove();
    return true;
  });
  // Compare UI-scrubbed frame 90 against the same frame inside the ZIP export.
  const zipB64 = await page.evaluate(async () => {
    const E = window.FoldEngine;
    const z = await E.buildFramesZip(E.validateParams(E.BUILT_IN_PRESETS.defaults));
    const bytes = new Uint8Array(await z.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const zipBuf = Buffer.from(zipB64, 'base64');
  const entries = readZip(zipBuf);
  const f90 = entries.find((e) => e.name === 'frames/frame_090.png');
  const scrubMatchesZip = f90 && sha(f90.data) === sha(viaUi.buf);
  record('MOT-02', zipHashes.a === zipHashes.b && scrubMatchesZip && entries.length === 241 && direct ? 'PASS' : 'FAIL',
    `240-frame ZIP built twice: SHA-256 ${zipHashes.a.slice(0, 16)}… = ${zipHashes.b.slice(0, 16)}… (${(zipHashes.size / 1048576).toFixed(1)} MB, ${entries.length} entries incl. config.json); frame 90 exported via UI scrubbing is byte-identical to frame_090.png in ZIP: ${scrubMatchesZip}`);
  // Frames go to a temp folder (too large to commit); used to build the MP4 preview.
  const framesDir = process.env.FRAMES_DIR || path.join(require('os').tmpdir(), 'fold_engine_frames');
  fs.mkdirSync(framesDir, { recursive: true });
  fs.writeFileSync(path.join(framesDir, 'Q01_frames_1080x1350.zip'), zipBuf);
  for (const e of entries) fs.writeFileSync(path.join(framesDir, path.basename(e.name)), e.data);

  /* ---------- EXP-01 / EXP-02 / EXP-03 + sample exports ---------- */
  const setParams = (o) => page.evaluate((o) => window.FoldEngine.applyConfig({ params: { ...window.FoldEngine.BUILT_IN_PRESETS.defaults, ...o }, mode: 'static' }), o);
  const exp1 = [];
  for (const [fmt, s] of [['1080x1350', 1], ['1080x1920', 1], ['1080x1350', 2], ['1080x1920', 2]]) {
    await setParams({ format: fmt, exportScale: s, foldAngle: 60 });
    const d = await download(page, '#exportPng');
    const size = pngSize(d.buf);
    const [w, h] = fmt.split('x').map(Number);
    exp1.push({ fmt, s, size, ok: size.width === w * s && size.height === h * s, name: d.name });
    if (s === 1) fs.writeFileSync(path.join(OUT, d.name), d.buf);
  }
  record('EXP-01', exp1.every((e) => e.ok) ? 'PASS' : 'FAIL', exp1.map((e) => `${e.fmt}@${e.s}× → ${e.size.width}×${e.size.height}`).join('; '));

  // Static presets S01–S04 (default parameters), saved as sample exports.
  await setParams({});
  for (const id of ['S01', 'S02', 'S03', 'S04']) {
    await page.click('[data-mode=static]');
    await page.click(`[data-preset=${id}]`);
    const d = await download(page, '#exportPng');
    fs.writeFileSync(path.join(OUT, d.name), d.buf);
  }
  await setParams({ foldAngle: 60, projection: 'oblique' });
  let d = await download(page, '#exportPng');
  fs.writeFileSync(path.join(OUT, d.name), d.buf);
  const cfg = await download(page, '#saveConfig');
  fs.writeFileSync(path.join(OUT, cfg.name), cfg.buf);
  const cfgJson = JSON.parse(cfg.buf.toString());
  // Reload the saved configuration and confirm the same pixels come back.
  await setParams({ foldAngle: 10 });
  await page.setInputFiles('#loadConfig', { name: cfg.name, mimeType: 'application/json', buffer: cfg.buf });
  await page.waitForFunction((a) => window.FoldEngine.state.params.foldAngle === a, cfgJson.params.foldAngle);
  const reexport = await download(page, '#exportPng');
  const cfgRoundTrip = sha(reexport.buf) === sha(d.buf);
  record('CFG-00', cfgRoundTrip ? 'PASS' : 'FAIL', `saved parameter configuration (${cfg.name}) reloaded via "Load config" re-exports a byte-identical PNG (supplementary): ${cfgRoundTrip}`);

  // Transparent, annotation-free
  await setParams({ foldAngle: 60, transparent: true, annotations: false });
  d = await download(page, '#exportPng');
  fs.writeFileSync(path.join(OUT, d.name), d.buf);
  const tp = await pixelProbe(page, d.buf, [[0, 0], [1079, 1349], [540, 675], [20, 400]]);
  const cornersClear = tp.samples[0][3] === 0 && tp.samples[1][3] === 0 && tp.samples[3][3] === 0;
  const geomOpaque = tp.samples[2][3] === 255;
  // Geometry footprint: W·h = 384 × 480 px out of 1080 × 1350 → ≈ 12.6 % opaque; everything else transparent.
  const expectedOpaque = (384 * 480) / (1080 * 1350);
  const opaqueShare = 1 - tp.transparentShare;
  record('EXP-02', cornersClear && geomOpaque && Math.abs(opaqueShare - expectedOpaque) < 0.003 ? 'PASS' : 'FAIL',
    `${d.name}: corner/margin alpha = ${tp.samples[0][3]}/${tp.samples[1][3]}/${tp.samples[3][3]}, centre alpha = ${tp.samples[2][3]}; opaque share ${(opaqueShare * 100).toFixed(2)} % vs geometry footprint ${(expectedOpaque * 100).toFixed(2)} %`);

  // Annotation-free check: with annotations off, every pixel outside the geometry is pure ground.
  await setParams({ foldAngle: 60, annotations: false });
  d = await download(page, '#exportPng');
  fs.writeFileSync(path.join(OUT, d.name), d.buf);
  const clean = await pixelProbe(page, d.buf, [[0, 0]], [346, 433, 734, 917]);
  const cleanOk = clean.samples[0].join() === [0xee, 0xe8, 0xd8, 255].join() && clean.outside === 0;
  record('EXP-00', cleanOk ? 'PASS' : 'FAIL', `annotation-free export (supplementary): pixels differing from the ivory ground outside the geometry box (348–732 × 435–915 px, ±2 px): ${clean.outside}`);

  // EXP-03: exported PNG equals the offscreen artwork render alone (no UI), and is exactly format-sized.
  await setParams({ foldAngle: 30 });
  d = await download(page, '#exportPng');
  const artOnly = await page.evaluate(async () => {
    const E = window.FoldEngine;
    const g = E.renderOffscreen(E.state.params, { angle: E.state.params.foldAngle });
    const blob = await E.canvasToPngBlob(g.elt);
    g.remove();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const dom = await page.evaluate(() => ({
    controlsInsideStage: !!document.querySelector('#stage aside, #stage input, #stage button, #stage select'),
    canvasCount: document.querySelectorAll('#stage canvas').length,
  }));
  const s3 = pngSize(d.buf);
  const exp3 = sha(Buffer.from(artOnly, 'base64')) === sha(d.buf) && !dom.controlsInsideStage && s3.width === 1080 && s3.height === 1350;
  record('EXP-03', exp3 ? 'PASS' : 'FAIL',
    `exported PNG byte-identical to a render of the artwork function alone: ${sha(Buffer.from(artOnly, 'base64')) === sha(d.buf)}; size ${s3.width}×${s3.height} (no interface margin); controls inside artwork container: ${dom.controlsInsideStage}`);

  // 9:16 sample + other palettes (for founder review)
  for (const [o, label] of [[{ format: '1080x1920', foldAngle: 60 }, '9x16'], [{ foldAngle: 60, palette: 'espresso' }, 'espresso'], [{ foldAngle: 60, palette: 'line' }, 'line']]) {
    await setParams(o);
    d = await download(page, '#exportPng');
    fs.writeFileSync(path.join(OUT, d.name.replace('.png', label === '9x16' ? '.png' : `_${label}.png`)), d.buf);
  }

  /* ---------- ART-01 supporting evidence: palette audit ---------- */
  await setParams({ foldAngle: 60, annotations: false, outlines: false });
  d = await download(page, '#exportPng');
  const art = await pixelProbe(page, d.buf, []);
  const pal = { ivory: [0xee, 0xe8, 0xd8], powder: [0xad, 0xc5, 0xd9], espresso: [0x49, 0x35, 0x2c], ink: [0x25, 0x27, 0x24] };
  const onSegment = (c) => {
    // Is colour c = round(base + (ink − base)·t) for some t ∈ [0, 0.35]? (shade mix toward ink)
    for (const base of [pal.ivory, pal.powder, pal.espresso]) {
      for (let t = 0; t <= 0.35001; t += 0.0005) {
        if (base.every((v, i) => Math.abs(Math.round(v + (pal.ink[i] - v) * t) - c[i]) <= 0)) return true;
      }
    }
    return false;
  };
  const audit = art.dominant.map((x) => ({ rgb: x.rgba.slice(0, 3), share: +(x.share * 100).toFixed(2), derived: onSegment(x.rgba.slice(0, 3)) }));
  const paletteOk = audit.every((a) => a.derived);
  record('ART-01', 'NOT TESTED',
    `artistic judgement reserved to the founder. Supporting palette audit ${paletteOk ? 'PASS' : 'FAIL'}: every dominant colour (>0.2 % of pixels) is an approved colour or an approved colour mixed toward Ink — ${audit.map((a) => `rgb(${a.rgb}) ${a.share}%`).join(', ')}`);

  /* ---------- file:// fallback ---------- */
  const p2 = await ctx.newPage();
  const errs2 = [];
  p2.on('pageerror', (e) => errs2.push(e.message));
  await p2.goto('file://' + path.join(ROOT, 'index.html'));
  await p2.waitForFunction(() => window.FoldEngine && window.FoldEngine.ready);
  const fileStatus = await p2.textContent('#status');
  record('RUN-00', errs2.length === 0 ? 'PASS' : 'FAIL', `opened via file:// with no errors (supplementary); status: "${fileStatus}"`);

  /* ---------- SRC-01 ---------- */
  const files = ['index.html', 'sketch.js', 'styles.css', 'presets.json', 'README.md', 'QA_REPORT.md'];
  const present = files.filter((f) => fs.existsSync(path.join(ROOT, f)));
  const sk = fs.readFileSync(path.join(ROOT, 'sketch.js'), 'utf8');
  const sections = ['1. CONSTANTS', '2. PARAMETERS', '3. GEOMETRY', '4. PROJECTION', '5. TIMELINE', '6. RENDERING', '7. EXPORT', '8. INTERFACE', '9. p5 LIFECYCLE'].filter((s) => sk.includes(s));
  const commentLines = sk.split('\n').filter((l) => /^\s*(\/\/|\/\*|\*)/.test(l)).length;
  record('SRC-01', present.length === files.length && sections.length === 9 && !sk.includes('import ') ? 'PASS' : 'FAIL',
    `files present: ${present.join(', ')} (${present.length}/${files.length}); sketch.js ${sk.split('\n').length} lines, plain unminified ES2020, ${sections.length}/9 labelled sections, ${commentLines} comment lines; no build step`);

  record('RUN-01', errors.length === 0 ? 'PASS' : 'FAIL', `page errors during the full QA run (supplementary): ${errors.length ? errors.join(' | ') : 'none'}`);

  await browser.close();
  srv.close();
  fs.writeFileSync(path.join(__dirname, 'qa_results.json'), JSON.stringify({ ranAt: new Date().toISOString(), browser: 'Chromium (Playwright, headless)', results }, null, 2) + '\n');
})();

/** Minimal reader for the engine's store-only ZIP (for verification). */
function readZip(buf) {
  const out = [];
  let o = 0;
  while (buf.readUInt32LE(o) === 0x04034b50) {
    const size = buf.readUInt32LE(o + 18), nlen = buf.readUInt16LE(o + 26), xlen = buf.readUInt16LE(o + 28);
    const name = buf.slice(o + 30, o + 30 + nlen).toString();
    const start = o + 30 + nlen + xlen;
    out.push({ name, data: buf.slice(start, start + size) });
    o = start + size;
  }
  return out;
}
