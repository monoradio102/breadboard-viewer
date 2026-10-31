#!/usr/bin/env node
// Records the editor demo for the README (docs/images/editor-demo.gif).
// Needs Playwright (with Chromium) and ffmpeg. Not part of the published CLI.
//   node tools/record-demo.mjs [--video <copy of the recording.webm>]
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./capture.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "docs/images/editor-demo.gif");
const W = 1280;
const H = 760;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
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
const base = `http://127.0.0.1:${server.address().port}/`;

// a visible cursor (headless recordings have none), with a ring on press
const CURSOR = `
addEventListener("DOMContentLoaded", () => {
  const c = document.createElement("div");
  c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M2 2 L2 18 L6.5 13.8 L9.6 20.5 L12.4 19.3 L9.4 12.8 L15.5 12.8 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: 99999, pointerEvents: "none", transform: "translate(-200px,-200px)" });
  const ring = document.createElement("div");
  Object.assign(ring.style, { position: "fixed", width: "28px", height: "28px", margin: "-14px 0 0 -14px", borderRadius: "50%", border: "3px solid #ff9800", zIndex: 99998, pointerEvents: "none", opacity: "0", transition: "opacity .25s, transform .25s" });
  document.body.append(ring, c);
  addEventListener("mousemove", (e) => { c.style.transform = "translate(" + (e.clientX - 2) + "px," + (e.clientY - 2) + "px)"; ring.style.left = e.clientX + "px"; ring.style.top = e.clientY + "px"; }, true);
  addEventListener("mousedown", () => { ring.style.opacity = "1"; ring.style.transform = "scale(.7)"; }, true);
  addEventListener("mouseup", () => { ring.style.opacity = "0"; ring.style.transform = "scale(1)"; }, true);
});`;

const videoDir = mkdtempSync(join(tmpdir(), "bb-demo-"));
const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: videoDir, size: { width: W, height: H } } });
await context.addInitScript(CURSOR);
// the right panel off, so the board gets the room
await context.addInitScript(() => localStorage.setItem("breadboard-viewer:panels", JSON.stringify({ left: true, right: false })));
const page = await context.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const center = async (selector) => {
  const b = await page.locator(selector).first().boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const glide = async (selector, steps = 15) => {
  const p = await center(selector);
  await page.mouse.move(p.x, p.y, { steps });
  return p;
};

const t0 = Date.now();
await page.goto(`${base}?example=flasher-kit`);
await page.mouse.move(W / 2, H - 40);
await wait(2400); // the LEDs blink

// hover a hole: the holes it connects to light up
await glide('#stage [data-hole="c14"]');
await wait(1400);

// draw a jumper wire from a free hole to the rail; a kit wire takes its color from its length
await glide('#stage [data-hole="j27"]');
await wait(300);
await page.mouse.down();
const to = await center('#stage [data-hole="B-27"]');
await page.mouse.move(to.x, to.y, { steps: 15 });
await page.mouse.up();
await wait(1400);
await page.keyboard.press("Control+z");
await wait(500);

// flexible wires arc above the parts; kit wires lie flat
await glide("#wire-style");
await page.selectOption("#wire-style", "flex");
await page.mouse.move(W / 2, H - 40, { steps: 15 });
await wait(2200);
await glide("#wire-style");
await page.selectOption("#wire-style", "kit");
await wait(1200);

// assembly mode: from the parts tray, step by step
await glide("#btn-assembly");
await page.mouse.down();
await page.mouse.up();
await page.mouse.move(W / 2, H - 40, { steps: 15 });
await wait(8500);
console.log(`recorded ${((Date.now() - t0) / 1000).toFixed(1)}s (start of the video is trimmed)`);

const video = page.video();
await context.close();
await browser.close();
server.close();
const webm = await video.path();

// skip the blank page load, then a 2-pass palette GIF
const skip = 0.6;
const filters = `fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(skip), "-i", webm, "-filter_complex", filters, "-loop", "0", out], { stdio: "inherit" });
console.log(`${out} (${(statSync(out).size / 1e6).toFixed(2)} MB)`);
const keep = process.argv.indexOf("--video");
if (keep > 0) copyFileSync(webm, process.argv[keep + 1]);
rmSync(videoDir, { recursive: true, force: true });
