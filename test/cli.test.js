import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolveCircuit } from "../src/circuit.js";
import { coordsOf, layoutIssues, previewPlacement } from "../src/inspect.js";
import { labelBox } from "../src/render.js";

const bb = (...args) => spawnSync(process.execPath, ["tools/bb.mjs", ...args], { encoding: "utf8", cwd: new URL("..", import.meta.url) });

test("unknown options and commands are errors", () => {
  const r = bb("check", "examples/blink-nano.json", "--jsonx");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown option for check: --jsonx/);
  assert.equal(bb("nope").status, 2);
  assert.equal(bb("render", "examples/blink-nano.json", "--focus", "NOPE").status, 2);
});

test("check --json and --layout", () => {
  const r = bb("check", "examples/xiao-voice.json", "--json", "--layout");
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.ok(out.nets.some((n) => n.pins.includes("U1.D2") && n.pins.includes("LED1.DIN")));
  assert.ok(Array.isArray(out.layout));
  assert.ok(out.unconnected.includes("AMP1.GAIN"));
});

test("place and coords print JSON", () => {
  const p = JSON.parse(bb("place", "inmp441", "--at", "f20").stdout);
  assert.deepEqual(p.pins.map((x) => x.hole), ["f20", "f21", "f22", "d22", "d21", "d20"]);
  const c = bb("coords", "h3", "T-5").stdout.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(c.map((x) => [x.x, x.y]), [[4, 13], [6, 2]]);
});

test("previewPlacement reports conflicts, hidden holes and self-shorts", () => {
  const circuit = JSON.parse(spawnSync("cat", ["examples/blink-nano.json"], { encoding: "utf8" }).stdout);
  const clash = previewPlacement(circuit, { type: "led", pins: ["a17", "a30"] });
  assert.match(clash.conflicts.join(), /a17 は R1\.1 が使っています/);
  const short = previewPlacement({ board: "half" }, { type: "dip", at: "a5", rot: 90 });
  assert.ok(short.shorts.length > 0);
  const under = previewPlacement(circuit, { type: "resistor", pins: ["f5", "f9"] });
  assert.match(under.conflicts.join(), /U1 の本体の下/);
  assert.equal(previewPlacement({ board: "half" }, { type: "xiao", at: "h3", rot: 180 }).ok, false);
});

test("layout issues: overlapping bodies, hidden wire ends, wires over holes, labels", () => {
  const r = resolveCircuit({
    board: "full",
    parts: [
      { id: "U1", type: "xiao", at: "h5" },
      { id: "MIC1", type: "inmp441", at: "f12" },
      { id: "R1", type: "resistor", pins: ["a30", "a34"] },
    ],
    wires: [
      { id: "W1", from: "g8", to: "j40" },
      { id: "W2", from: "a28", to: "a36" },
    ],
  });
  const issues = layoutIssues(r).join("\n");
  assert.match(issues, /U1 と MIC1 の本体が重なっています/);
  assert.match(issues, /W1 の端 g8 が U1 の本体の下に隠れています/);
  assert.match(issues, /W2 が穴 a30 \(R1\.1\) の真上を通っています/);
  assert.deepEqual(coordsOf(r, "MIC1.SD"), { ref: "MIC1.SD", x: 15, y: 7, hole: "d14" });
});

test("coords says which board it assumed, and points to the nearest rail hole", () => {
  const [t30] = bb("coords", "T-30").stdout.trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(t30.board, "full");
  assert.match(t30.note, /half \/ mini にはこの穴はありません/);
  const half = JSON.parse(bb("coords", "T-30", "--board", "half").stdout);
  // place takes --board too
  assert.equal(JSON.parse(bb("place", "led", "--at", "a40", "--board", "full").stdout).ok, true);
  assert.match(JSON.parse(bb("place", "led", "--at", "a40", "--board", "half").stdout).errors[0], /a40/);
  assert.match(bb("place", "led", "--at", "a10", "--board", "huge").stderr, /--board は full \/ half \/ mini/);
  assert.match(half.error, /近い穴: T-29/);
  const r = resolveCircuit({ board: "half", wires: [{ from: "a29", to: "T-30" }] });
  assert.match(r.errors[0], /穴 T-30 はこのボードにありません。.*近い穴: T-29/);
});

test("layout flags a bend that is too large and wires that leave the board", () => {
  const r = resolveCircuit({
    board: "half",
    wires: [
      { id: "W1", from: "c5", to: "c15", bend: 1 },
      { id: "W2", from: "a5", to: "a15", bend: -0.5 },
      { id: "W3", from: "e5", to: "e15", bend: 0.2 },
    ],
  });
  const issues = layoutIssues(r);
  assert.ok(issues.some((l) => l.startsWith("W1 の bend 1 が大きすぎます")));
  assert.ok(issues.some((l) => l.startsWith("W2 がボードの外にはみ出しています")));
  assert.ok(!issues.some((l) => l.startsWith("W3")));
});

test("url makes a #data= link that decodes back to the circuit", async () => {
  const { circuitFromLink } = await import("../src/io.js");
  const out = bb("url", "examples/oled-hello.json").stdout.trim();
  assert.match(out, /^https:\/\/monoradio102\.github\.io\/breadboard-viewer\/#data=[A-Za-z0-9_-]+$/);
  const original = JSON.parse(readFileSync(new URL("../examples/oled-hello.json", import.meta.url), "utf8"));
  assert.deepEqual(circuitFromLink(out), original);
  assert.throws(() => circuitFromLink("#data=!!"), /Base64URL/);
  assert.equal(circuitFromLink("#other"), null);
});

test("still SVGs avoid what plain SVG renderers miss", async () => {
  const { renderSvg } = await import("../src/render.js");
  const r = resolveCircuit(JSON.parse(readFileSync(new URL("../examples/motor-servo.json", import.meta.url), "utf8")));
  const still = renderSvg(r, { time: 1000 });
  assert.ok(!/paint-order/.test(still));
  assert.ok(!/transform:rotate/.test(still)); // states are SVG transform attributes
  assert.match(still, /data-anim="S1:horn" transform="rotate\(/);
  const flasher = resolveCircuit(JSON.parse(readFileSync(new URL("../examples/flasher-kit.json", import.meta.url), "utf8")));
  const { planAssembly } = await import("../src/assembly.js");
  const done = renderSvg(flasher, { assembly: true, time: planAssembly(flasher).duration - 1 }); // all steps done
  assert.ok(!/pathLength/.test(done.replace(/<style>[\s\S]*?<\/style>/, ""))); // drawn wires: no dashes
});

const hasCairo = spawnSync("python3", ["-c", "import cairosvg"]).status === 0;
test("PNG without a browser (--raster cairosvg)", { skip: hasCairo ? false : "cairosvg がないので省略" }, () => {
  const out = new URL(`../.test-raster-${process.pid}.png`, import.meta.url);
  try {
    const r = bb("render", "examples/oled-hello.json", "-o", fileURLToPath(out), "--time", "5000", "--raster", "cairosvg", "--scale", "1");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /cairosvg/);
    const png = readFileSync(out);
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.ok(png.length > 10000);
  } finally {
    rmSync(out, { force: true });
  }
});

const chromeBin = (() => {
  try {
    const { chromium } = createRequire(import.meta.url)("playwright");
    return existsSync(chromium.executablePath()) ? chromium.executablePath() : null;
  } catch {
    return null;
  }
})();
test("PNG from an installed Chromium run headless (--raster chrome)", { skip: chromeBin ? false : "Chromium がないので省略" }, () => {
  const out = new URL(`../.test-chrome-${process.pid}.png`, import.meta.url);
  try {
    const r = bb("render", "examples/blink-nano.json", "-o", fileURLToPath(out), "--raster", "chrome", "--browser-path", chromeBin, "--scale", "1");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /ヘッドレス/);
    assert.equal(readFileSync(out).subarray(1, 4).toString(), "PNG");
  } finally {
    rmSync(out, { force: true });
  }
});

test("layout flags wires over LED / resistor bodies and labels under wires", () => {
  const r = resolveCircuit({
    board: "half",
    parts: [
      { id: "R1", type: "resistor", pins: ["c10", "c14"] },
      { id: "LED1", type: "led", pins: ["b16", "b18"] },
      { id: "TH1", type: "dht11", at: "a24" },
    ],
    wires: [
      { id: "W1", from: "c8", to: "c16" }, // along R1's barrel
      { id: "W4", from: "a15", to: "c20" }, // across LED1's dome
      { id: "W2", from: "a17", to: "T-17" }, // through LED1's label
      { id: "W3", from: "e8", to: "e20" }, // clear of both
      { id: "W5", from: "a12", to: "T-12" }, // ends next to R1, not under it
      { id: "W6", from: "c12", to: "T-11" }, // ends under R1's barrel
    ],
  });
  const issues = layoutIssues(r);
  assert.ok(issues.includes("W1 が R1 の本体の上を通っています (via で避けられます)"), issues.join("\n"));
  assert.ok(issues.includes("W6 の端 c12 が R1 の本体の下に隠れています"), issues.join("\n"));
  assert.ok(!issues.some((l) => l.startsWith("W5")), issues.join("\n"));
  assert.ok(issues.includes("W4 が LED1 の本体の上を通っています (via で避けられます)"), issues.join("\n"));
  assert.ok(issues.some((l) => l.startsWith("LED1 のラベルに W2 が重なっています")), issues.join("\n"));
  assert.ok(!issues.some((l) => l.includes("W3")), issues.join("\n"));
  // a sensor standing up from its pins gets its label beside the body, not on its face
  assert.ok(!issues.some((l) => l.startsWith("TH1")), issues.join("\n"));
  const th1 = labelBox(r.parts.find((p) => p.id === "TH1"));
  assert.ok(th1.x > 28.5, JSON.stringify(th1));
});

test("Chrome / Edge are found where macOS and Windows install them", () => {
  const home = mkdtempSync(join(tmpdir(), "bb-home-"));
  try {
    const app = join(home, "Applications", "Google Chrome.app", "Contents", "MacOS");
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, "Google Chrome"), "");
    const code = `Object.defineProperty(process, "platform", { value: "darwin" });
      const { findChrome, findRasterizer } = await import(${JSON.stringify(new URL("../tools/raster.mjs", import.meta.url).href)});
      console.log(JSON.stringify([findChrome(), findChrome({ chromeOnly: true }), findRasterizer("chrome")]));`;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", env: { HOME: home, PATH: "" } });
    assert.equal(r.status, 0, r.stderr);
    const bin = join(app, "Google Chrome");
    assert.deepEqual(JSON.parse(r.stdout), [bin, bin, `chrome:${bin}`]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

const playwrightDir = (() => {
  try {
    return createRequire(import.meta.url).resolve("playwright");
  } catch {
    return null;
  }
})();

test("PNG says why Playwright's own Chromium was not used", { skip: playwrightDir ? false : "Playwright がないので省略" }, () => {
  const out = join(tmpdir(), `bb-why-${process.pid}.png`);
  try {
    const r = spawnSync(process.execPath, ["tools/bb.mjs", "render", "examples/blink-nano.json", "-o", out, "--scale", "1"], {
      encoding: "utf8",
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(tmpdir(), "no-browsers-here") },
    });
    assert.match(r.stderr, /Playwright \(.+\) は見つかりましたが、Chromium を起動できません/);
    assert.match(r.stderr, /npx playwright install chromium/);
  } finally {
    rmSync(out, { force: true });
  }
});

test("a copy of the CLI elsewhere finds Playwright in the folder it is run from", { skip: playwrightDir ? false : "Playwright がないので省略" }, () => {
  // tools/ and src/ copied away from any node_modules (like a skill folder), run from the project
  const copy = mkdtempSync(join(tmpdir(), "bb-copy-"));
  const out = join(copy, "out.png");
  try {
    for (const dir of ["tools", "src"]) cpSync(fileURLToPath(new URL(`../${dir}`, import.meta.url)), join(copy, dir), { recursive: true });
    const project = playwrightDir.slice(0, playwrightDir.lastIndexOf(`node_modules`));
    const env = { ...process.env };
    delete env.NODE_PATH;
    const r = spawnSync(process.execPath, [join(copy, "tools", "bb.mjs"), "render", fileURLToPath(new URL("../examples/blink-nano.json", import.meta.url)), "-o", out, "--scale", "1"], {
      encoding: "utf8",
      cwd: project,
      env,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /PNG: Playwright \(.+\) /);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});

test("layout: round bodies are checked as circles (a CdS cell on a resistor, a wire grazing an LED)", () => {
  const r = resolveCircuit({
    board: "half",
    parts: [
      { id: "D1", type: "led", pins: { A: "a21", K: "a20" } },
      { id: "CDS1", type: "cds", pins: ["i6", "i7"] },
      { id: "R2", type: "resistor", pins: ["j6", "j10"] },
      { id: "R3", type: "resistor", pins: ["f20", "f24"] },
      { id: "CDS2", type: "cds", pins: ["h14", "h15"] },
    ],
    wires: [
      { id: "W7", from: "c20", to: "T-19" }, // grazes D1's dome
      { id: "W8", from: "c25", to: "T-26" }, // well clear of it
    ],
  });
  const issues = layoutIssues(r);
  assert.ok(issues.includes("CDS1 と R2 の本体が重なっています"), issues.join("\n"));
  assert.ok(issues.includes("W7 が D1 の本体の上を通っています (via で避けられます)"), issues.join("\n"));
  assert.ok(!issues.some((l) => /CDS2|R3|W8/.test(l)), issues.join("\n"));
});
