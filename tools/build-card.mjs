#!/usr/bin/env node
// Renders docs/images/json-to-circuit.png for the README / social posts: the ops in
// docs/hello-ops.json on the left, the circuit they make on the right. Needs Playwright.
//   node tools/build-card.mjs
import { readFileSync } from "node:fs";
import { resolveCircuit } from "../src/circuit.js";
import { emptyCircuit } from "../src/io.js";
import { applyOps } from "../src/ops.js";
import { renderSvg } from "../src/render.js";
import { launchBrowser } from "./capture.mjs";

const root = new URL("..", import.meta.url);
const ops = readFileSync(new URL("docs/hello-ops.json", root), "utf8").trim();
const { circuit } = applyOps({ ...emptyCircuit(), board: "half" }, JSON.parse(ops));
const svg = renderSvg(resolveCircuit(circuit), { time: 0 });

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const STR = /"(?:[^"\\]|\\.)*"/g;
// light JSON colouring: keys, string values, numbers / booleans
const code = esc(ops)
  .replace(STR, (s) => `\u0001${s}\u0002`)
  .replace(/\u0001("(?:[^"\\]|\\.)*")\u0002(\s*:)/g, '<b class="k">$1</b>$2')
  .replace(/\u0001("(?:[^"\\]|\\.)*")\u0002/g, '<b class="s">$1</b>')
  .replace(/(:\s*)(-?\d+(?:\.\d+)?|true|false)\b/g, '$1<b class="n">$2</b>');

const html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{width:1600px;height:900px;font-family:"Noto Sans CJK JP","Hiragino Sans",sans-serif;background:#f4f1ea;display:grid;grid-template-columns:690px 1fr}
.l{background:#1e2430;color:#d8dee9;padding:56px 44px 40px;display:flex;flex-direction:column}
.r{padding:56px 48px 40px;display:flex;flex-direction:column}
h2{font-size:30px;font-weight:700;margin-bottom:26px}.l h2{color:#fff}.r h2{color:#263238}
h2 small{display:block;font-size:18px;font-weight:400;opacity:.65;margin-top:8px}
pre{font:17px/1.7 "DejaVu Sans Mono",ui-monospace,monospace;white-space:pre;flex:1;padding-top:6px}
b{font-weight:400}.k{color:#88c0d0}.s{color:#a3be8c}.n{color:#d08770}
.cmd{font:16px/1.7 "DejaVu Sans Mono",ui-monospace,monospace;color:#a7b0bf;border-top:1px solid #3b4252;padding-top:18px}.cmd i{font-style:normal;color:#ebcb8b}
.board{flex:1;display:flex;align-items:center;justify-content:center}.board svg{width:100%;height:auto;max-height:620px}
.url{font-size:17px;color:#7a7368;text-align:right;margin-top:14px}
.arrow{position:absolute;left:662px;top:420px;width:56px;height:56px;border-radius:50%;background:#ff9800;color:#fff;font-size:32px;display:grid;place-items:center;box-shadow:0 4px 12px rgba(0,0,0,.25)}
</style>
<div class="l"><h2>AI が書くのは、この JSON だけ<small>部品を置いて、どのピンをつなぐかを書く</small></h2><pre>${code}</pre>
<div class="cmd"><i>$</i> node bb.mjs apply hello.json ops.json<br><i>$</i> node bb.mjs render hello.json -o hello.png</div></div>
<div class="r"><h2>Breadboard Viewer が描く<small>配線は自動。交差なし・GND は黒・電源は赤</small></h2><div class="board">${svg}</div>
<div class="url">github.com/monoradio102/breadboard-viewer</div></div>
<div class="arrow">→</div>`;

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.setContent(html);
await page.waitForTimeout(200);
await page.screenshot({ path: new URL("docs/images/json-to-circuit.png", root).pathname });
await browser.close();
console.log("docs/images/json-to-circuit.png");
