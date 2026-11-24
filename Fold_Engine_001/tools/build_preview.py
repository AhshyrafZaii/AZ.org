# Builds the single-file hosted preview (private claude.ai artifact) from the repo sources.
# Usage: python3 tools/build_preview.py . out/fold-engine-001.html
import re, sys, pathlib
root = pathlib.Path(sys.argv[1]); out = pathlib.Path(sys.argv[2])
html = (root/'index.html').read_text()
main = re.search(r'<main class="app">.*?</main>', html, re.S).group(0)
main = main.replace('<button type="button" id="exportFrames" class="wide">Export 240 frames (PNG · ZIP)</button>',
  '<button type="button" id="exportFrames" class="wide" hidden>Export 240 frames (PNG · ZIP)</button>\n        <p class="readout">The 240-frame export runs in the Mac version, which can download files.</p>')
css = (root/'styles.css').read_text()
extra = """
/* Hosted preview only: export overlay (downloads are blocked here). */
[hidden] { display: none !important; }
@media (max-width: 820px) { body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--ui-bg); } }
.deliver { position: fixed; inset: 0; z-index: 20; background: var(--ui-bg);
  display: flex; flex-direction: column; align-items: center; gap: 10px; overflow-y: auto;
  padding-block: calc(env(safe-area-inset-top, 0px) + 16px) calc(env(safe-area-inset-bottom, 0px) + 16px);
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.deliver-bar { width: 100%; max-width: 720px; display: flex; gap: 8px; align-items: center; justify-content: space-between; }
.deliver-bar p { margin: 0; min-width: 0; overflow-wrap: anywhere; color: var(--ui-muted); }
.deliver img { max-width: min(100%, 720px); height: auto; box-shadow: 0 0 0 1px var(--ui-line); }
.deliver img.alpha { background: repeating-conic-gradient(var(--ui-check-a) 0% 25%, var(--ui-check-b) 0% 50%) 0 0 / 20px 20px; }
.deliver pre { width: 100%; max-width: 720px; margin: 0; padding: 12px; overflow-x: auto; background: var(--ui-panel); border: 1px solid var(--ui-line); border-radius: 6px; font-size: 12px; }
.deliver-hint { margin: 0; color: var(--ui-muted); text-align: center; max-width: 720px; }
"""
overlay = """
<div id="deliver" class="deliver" hidden role="dialog" aria-modal="true" aria-labelledby="deliverName">
  <div class="deliver-bar"><p id="deliverName"></p><div class="seg" style="margin:0"><button type="button" id="deliverCopy" hidden>Copy</button><button type="button" id="deliverClose">Close</button></div></div>
  <p id="deliverHint" class="deliver-hint"></p>
  <img id="deliverImg" alt="Exported artwork" hidden>
  <pre id="deliverText" hidden></pre>
</div>
"""
hook = r"""
(function () {
  let url = null;
  const $ = (s) => document.getElementById(s);
  window.FoldEngineDeliver = async function (blob, name) {
    if (url) URL.revokeObjectURL(url);
    $('deliverName').textContent = name;
    const isPng = blob.type === 'image/png';
    $('deliverImg').hidden = !isPng; $('deliverText').hidden = isPng; $('deliverCopy').hidden = isPng;
    if (isPng) {
      url = URL.createObjectURL(blob);
      $('deliverImg').src = url;
      $('deliverImg').classList.toggle('alpha', name.includes('_alpha'));
      $('deliverHint').textContent = 'Press and hold the image, then choose Save to Photos. The saved file is full size, with transparency if you selected it.';
    } else {
      $('deliverText').textContent = await blob.text();
      $('deliverHint').textContent = 'Copy this configuration and keep it in Notes. On the Mac, save it as a .json file and use Load config.';
    }
    $('deliver').hidden = false;
  };
  document.addEventListener('DOMContentLoaded', () => {
    $('deliverClose').addEventListener('click', () => { $('deliver').hidden = true; });
    $('deliverCopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('deliverText').textContent); $('deliverCopy').textContent = 'Copied'; }
      catch (e) { const r = document.createRange(); r.selectNodeContents($('deliverText')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      setTimeout(() => { $('deliverCopy').textContent = 'Copy'; }, 1500);
    });
  });
})();
"""
p5 = (root/'lib/p5.min.js').read_text()
sketch = (root/'sketch.js').read_text()
for name, src in [('p5', p5), ('sketch', sketch)]:
    assert '</script' not in src.lower(), name
page = f"""<title>Fold Engine 001</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
{css}{extra}</style>
{main}
{overlay}
<script>{hook}</script>
<script>
{p5}
</script>
<script>
{sketch}
</script>
"""
out.write_text(page)
print(out, len(page.encode())/1048576, 'MB')
