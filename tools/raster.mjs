// PNG without Playwright, for sandboxes such as ChatGPT's code container or CI: still SVG frames
// drawn by an installed Chromium / Chrome in headless mode (same look as the editor), or by
// rsvg-convert or Python's cairosvg (no shadows). Playwright stays the first choice where it is
// installed: only it plays the CSS / SMIL inside overlay SVGs at the right moment.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const has = (cmd, args) => {
  try {
    return spawnSync(cmd, args, { stdio: "ignore", timeout: 20000 }).status === 0;
  } catch {
    return false;
  }
};
const PYTHON = ["python3", "python"];
const CHROMES = ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "chrome"];

// "chrome:<path>" | "rsvg" | "cairosvg:<python>" | null. browserPath: a Chromium-based browser to use.
export function findRasterizer(want = "auto", browserPath = null) {
  if (want === "auto" || want === "chrome") {
    if (browserPath) return `chrome:${browserPath}`;
    for (const c of CHROMES) if (has(c, ["--version"])) return `chrome:${c}`;
  }
  if ((want === "auto" || want === "rsvg") && has("rsvg-convert", ["--version"])) return "rsvg";
  if (want === "auto" || want === "cairosvg") {
    for (const py of PYTHON) if (has(py, ["-c", "import cairosvg"])) return `cairosvg:${py}`;
  }
  return null;
}

export const NO_RASTERIZER =
  "PNG を作れるものが見つかりません。次のどれかを用意してください:\n" +
  "  - Playwright (Chromium): npm i playwright && npx playwright install chromium\n" +
  "  - Chromium / Google Chrome (PATH にあるか、--browser-path で指定)\n" +
  "  - Python の cairosvg: pip install cairosvg\n" +
  "  - rsvg-convert (librsvg)\n" +
  "SVG (-o out.svg) は Node.js だけで書き出せます。";

// jobs: [{ svg, out }] — still SVGs (rendered with a time) to PNG files.
export function rasterize(engine, jobs, { scale = 2, transparent = false } = {}) {
  if (engine.startsWith("chrome:")) return chromeShots(engine.slice("chrome:".length), jobs, { scale, transparent });
  if (engine === "rsvg") {
    for (const { svg, out } of jobs) {
      const args = ["-z", String(scale), "-o", out, ...(transparent ? [] : ["-b", "white"])];
      const r = spawnSync("rsvg-convert", args, { input: svg, maxBuffer: 1 << 28 });
      if (r.status !== 0) throw new Error(`rsvg-convert: ${r.stderr}`);
    }
    return;
  }
  // cairosvg: one Python process for all frames
  const py = engine.split(":")[1];
  const dir = mkdtempSync(join(tmpdir(), "bb-raster-"));
  try {
    const list = jobs.map(({ svg, out }, i) => {
      const file = join(dir, `${i}.svg`);
      writeFileSync(file, svg);
      return [file, out];
    });
    writeFileSync(join(dir, "jobs.json"), JSON.stringify(list));
    const code = [
      "import json, sys, cairosvg",
      "jobs, scale, bg = json.load(open(sys.argv[1])), float(sys.argv[2]), sys.argv[3] or None",
      "for src, out in jobs: cairosvg.svg2png(url=src, write_to=out, scale=scale, background_color=bg)",
    ].join("\n");
    const r = spawnSync(py, ["-c", code, join(dir, "jobs.json"), String(scale), transparent ? "" : "white"], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`cairosvg: ${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Each frame: the SVG in a page of exactly its size, captured by `chrome --headless --screenshot`.
function chromeShots(chrome, jobs, { scale, transparent }) {
  const dir = mkdtempSync(join(tmpdir(), "bb-chrome-"));
  try {
    for (const [i, { svg, out }] of jobs.entries()) {
      const w = Math.ceil(Number(/<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? 800));
      const h = Math.ceil(Number(/<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] ?? 600));
      const page = join(dir, `${i}.html`);
      writeFileSync(page, `<!doctype html><meta charset="utf-8"><body style="margin:0;overflow:hidden;background:${transparent ? "transparent" : "#fff"}">${svg}</body>`);
      // keep the flags minimal: some builds hang with --headless=new or a fresh --user-data-dir
      const args = [
        "--headless",
        "--no-sandbox",
        "--disable-gpu",
        "--hide-scrollbars",
        `--window-size=${w},${h}`,
        `--force-device-scale-factor=${scale}`,
        ...(transparent ? ["--default-background-color=00000000"] : []),
        `--screenshot=${resolve(out)}`,
        pathToFileURL(page).href,
      ];
      const r = spawnSync(chrome, args, { encoding: "utf8", timeout: 60000 });
      if (r.status !== 0 || !existsSync(out)) throw new Error(`${chrome}: ${r.stderr || r.error?.message || "スクリーンショットに失敗しました"}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
