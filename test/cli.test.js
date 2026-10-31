import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { resolveCircuit } from "../src/circuit.js";
import { coordsOf, layoutIssues, previewPlacement } from "../src/inspect.js";

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
