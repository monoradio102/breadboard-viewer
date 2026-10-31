// PNG without a browser, for sandboxes that have no Chromium (ChatGPT's code container, CI):
// still SVG frames rasterized by rsvg-convert or by Python's cairosvg, whichever is installed.
// The browser (Playwright) stays the default where it exists: it alone plays the CSS / SMIL
// inside overlay SVGs and draws the soft shadows.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const has = (cmd, args) => {
  try {
    return spawnSync(cmd, args, { stdio: "ignore", timeout: 20000 }).status === 0;
  } catch {
    return false;
  }
};
const PYTHON = ["python3", "python"];

// "rsvg" | "cairosvg" | null
export function findRasterizer(want = "auto") {
  if ((want === "auto" || want === "rsvg") && has("rsvg-convert", ["--version"])) return "rsvg";
  if (want === "auto" || want === "cairosvg") {
    for (const py of PYTHON) if (has(py, ["-c", "import cairosvg"])) return `cairosvg:${py}`;
  }
  return null;
}

export const NO_RASTERIZER =
  "PNG を作れるものが見つかりません。次のどれかを用意してください:\n" +
  "  - Playwright (Chromium): npm i playwright && npx playwright install chromium\n" +
  "  - Python の cairosvg: pip install cairosvg\n" +
  "  - rsvg-convert (librsvg)\n" +
  "SVG (-o out.svg) は Node.js だけで書き出せます。";

// jobs: [{ svg, out }] — still SVGs (rendered with a time) to PNG files.
export function rasterize(engine, jobs, { scale = 2, transparent = false } = {}) {
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
