// The editor in a real browser: links (#data=), autosave, and the page's script policy.
// Skipped when Playwright (with Chromium) is not installed.
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { circuitLink } from "../src/io.js";

let chromium = null;
try {
  ({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {
  // not installed
}
const skip = chromium ? false : "Playwright がないので省略";
const root = fileURLToPath(new URL("..", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
let server, base, browser;

before(async () => {
  if (skip) return;
  server = createServer((req, res) => {
    const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    try {
      const file = statSync(path).isDirectory() ? join(path, "index.html") : path;
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(readFileSync(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

async function open(url) {
  const page = await browser.newPage();
  const problems = [];
  page.on("dialog", (d) => {
    problems.push(`dialog: ${d.message()}`);
    d.dismiss();
  });
  page.on("pageerror", (e) => problems.push(`error: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  // something saved from an earlier session
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("breadboard-viewer:last", JSON.stringify({ version: 1, title: "earlier work", board: "half", parts: [], wires: [] }));
      sessionStorage.setItem("seeded", "1");
    }
  });
  await page.goto(url);
  await page.waitForFunction(() => window.bb && document.querySelector("#stage svg"));
  return { page, problems };
}
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("breadboard-viewer:last") ?? "null")?.title);

test("a #data= link opens the circuit and is saved only once edited", { skip }, async () => {
  const circuit = JSON.parse(readFileSync(new URL("../examples/oled-hello.json", import.meta.url), "utf8"));
  const { page, problems } = await open(circuitLink(circuit, base));
  assert.equal(await page.evaluate(() => bb.get().title), circuit.title);
  assert.equal(await saved(page), "earlier work");
  await page.evaluate(() => bb.apply([{ op: "setTitle", title: "edited" }]));
  assert.equal(await saved(page), "edited");
  assert.equal(await page.evaluate(() => location.hash), "");
  await page.reload();
  await page.waitForFunction(() => window.bb && document.querySelector("#stage svg"));
  assert.equal(await page.evaluate(() => bb.get().title), "edited");
  assert.deepEqual(problems, []);
  await page.close();
});

test("a link full of markup runs nothing and adds no elements", { skip }, async () => {
  const P = `"'><img src=x onerror="alert(1)"></style><img src=x onerror=alert(2)><x-inj>`;
  const circuit = {
    title: P,
    board: "half",
    parts: [{ id: `D1${P}`, type: "led", color: P, pins: { A: "a10", K: "a11" }, note: P }],
    wires: [{ id: `W${P}`, from: "b11", to: "T-11", color: P, note: P }],
    overlays: [{ id: "FX", svg: `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(3)"><script>alert(4)</script></svg>`, x: 1, y: 1, w: 2, h: 2 }],
    animation: { duration: 1000, tracks: [{ target: [`D1${P}`, `W${P}`], keys: [{ t: 0, on: true, flow: true }] }], captions: [{ t: 0, text: P }] },
    steps: [{ text: P, items: [`D1${P}`] }],
  };
  const { page, problems } = await open(circuitLink(circuit, base));
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.querySelectorAll("x-inj, #stage img, #stage script").length), 0);
  await page.evaluate(() => bb.assembly?.(true));
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.querySelectorAll("x-inj").length), 0);
  assert.deepEqual(problems.filter((p) => p.startsWith("dialog")), []);
  await page.close();
});

test("the page refuses inline scripts (Content-Security-Policy)", { skip }, async () => {
  const { page } = await open(`${base}?example=blink-nano`);
  const ran = await page.evaluate(async () => {
    const s = document.createElement("script");
    s.textContent = "window.__ran = true";
    document.body.append(s);
    const img = document.createElement("img");
    img.setAttribute("onerror", "window.__ran = true");
    img.src = "data:,x";
    document.body.append(img);
    await new Promise((r) => setTimeout(r, 200));
    return window.__ran === true;
  });
  assert.equal(ran, false);
  // still allowed: PNG export draws the SVG through a blob: image
  assert.ok((await page.evaluate(async () => (await bb.png()).size)) > 1000);
  // examples open without being saved either
  assert.equal(await saved(page), "earlier work");
  await page.close();
});
