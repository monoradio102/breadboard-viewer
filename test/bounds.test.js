// Every built-in part's drawing stays inside the body the layout checks use (bodyBox): else
// autoWire ends wires under it and check --layout does not see it (a trimmer without extent).
// Measured in a real browser; skipped when Playwright (with Chromium) is not installed.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import { resolveCircuit } from "../src/circuit.js";
import { bodyBox } from "../src/inspect.js";
import { BUILTIN_PARTS } from "../src/parts/builtin.js";
import { renderSvg } from "../src/render.js";

let chromium = null;
try {
  ({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {
  // not installed
}
const skip = chromium ? false : "Playwright がないので省略";
// drawn on purpose beyond the body: the motor's propeller (it spins over what is next to it)
const ALLOWED = { motor: 0.7 };
let browser;
before(async () => {
  if (!skip) browser = await chromium.launch();
});
after(async () => browser?.close());

test("built-in parts are drawn inside their body box", { skip }, async () => {
  const page = await browser.newPage();
  const bad = [];
  for (const def of BUILTIN_PARTS) {
    const inst = def.mount === "leads" ? { id: "X1", type: def.type, at: "b30" } : { id: "X1", type: def.type, pos: [30, 9] };
    const r = resolveCircuit({ board: "full", parts: [inst], wires: [] });
    assert.deepEqual(r.errors, [], def.type);
    const box = bodyBox(r.parts[0]);
    await page.setContent(`<body style="margin:0">${renderSvg(r, { captions: false })}</body>`);
    // what is drawn for the part: its shapes, without effects (pointer-events: none) such as glows
    const d = await page.evaluate(() => {
      const svg = document.querySelector("svg");
      const inv = svg.getScreenCTM().inverse();
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const el of document.querySelector('[data-id="X1"]').querySelectorAll("rect,circle,ellipse,path,polygon,polyline,line,text,image")) {
        if (el.closest('[pointer-events="none"]')) continue;
        const b = el.getBBox();
        const m = inv.multiply(el.getScreenCTM());
        for (const [x, y] of [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]) {
          const q = new DOMPoint(x, y).matrixTransform(m);
          [x0, y0, x1, y1] = [Math.min(x0, q.x), Math.min(y0, q.y), Math.max(x1, q.x), Math.max(y1, q.y)];
        }
      }
      return { x0, y0, x1, y1 };
    });
    const out = Math.max(box.x - d.x0, box.y - d.y0, d.x1 - box.x - box.w, d.y1 - box.y - box.h);
    if (out > (ALLOWED[def.type] ?? 0.15)) bad.push(`${def.type}: ${out.toFixed(2)} はみ出し (extent / body を見直す)`);
  }
  await page.close();
  assert.deepEqual(bad, []);
});
