import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createBoard, parseHole } from "../src/board.js";
import { findFreeSpot, resolveCircuit } from "../src/circuit.js";
import { parseCircuitText, stringifyCircuit } from "../src/io.js";
import { bandColors, parseOhms } from "../src/parts/common.js";
import { renderSvg } from "../src/render.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), "utf8"));
const netOf = (result, ref) => result.nets.find((n) => n.pins.some((p) => p.ref === ref));

test("hole ids", () => {
  assert.deepEqual(parseHole("a10"), { kind: "main", row: "a", col: 10 });
  assert.deepEqual(parseHole("T-5"), { kind: "rail", rail: "T-", col: 5 });
  assert.equal(parseHole("k1"), null);
  assert.equal(createBoard("full").holes.size, 830);
  assert.equal(createBoard("mini").holes.size, 170);
});

test("examples resolve without problems", () => {
  for (const name of ["blink-nano", "pico-button", "oled-custom-part"]) {
    const r = resolveCircuit(load(name));
    assert.deepEqual(r.errors, [], name);
    assert.deepEqual(r.warnings, [], name);
  }
});

test("netlist follows board strips, wires and rails", () => {
  const r = resolveCircuit(load("blink-nano"));
  assert.ok(netOf(r, "U1.D13").pins.some((p) => p.ref === "R1.1"));
  assert.ok(netOf(r, "R1.2").pins.some((p) => p.ref === "D1.A"));
  const gnd = netOf(r, "D1.K");
  assert.equal(gnd.name, "T-");
  assert.ok(gnd.pins.some((p) => p.ref === "U1.GND2"));
});

test("button internal connections join both sides of the channel", () => {
  const r = resolveCircuit(load("pico-button"));
  const net = netOf(r, "U1.GP15");
  assert.deepEqual(net.pins.map((p) => p.ref).sort(), ["SW1.1", "SW1.2", "U1.GP15"]);
});

test("rigid parts rotate clockwise around pin 1", () => {
  const c = { board: "full", parts: [{ id: "U1", type: "ne555", at: "a10", rot: 90 }] };
  const r = resolveCircuit(c);
  // rot 90: +x (pins 1..4) turns downward, the second row (originally above) moves 3 columns right
  assert.deepEqual(r.parts[0].pins.map((p) => p.hole), ["a10", "b10", "c10", "d10", "d13", "c13", "b13", "a13"]);
});

test("problems are reported, not thrown", () => {
  const r = resolveCircuit({
    board: "half",
    parts: [
      { id: "R1", type: "resistor", pins: ["a1", "a5"] },
      { id: "R2", type: "resistor", pins: ["a5", "z9"] },
      { id: "X1", type: "nope", at: "a1" },
      { id: "U1", type: "ne555", at: "a1" },
      { id: "R3", type: "resistor", pins: ["b1", "b1"], colour: "x" },
    ],
    wires: [{ from: "a1", to: "j99" }],
  });
  const all = r.errors.join("\n");
  assert.match(all, /a5 に R1.2 と R2.1/);
  assert.match(all, /"z9"/);
  assert.match(all, /未知の部品タイプ "nope"/);
  assert.match(all, /U1\..*穴の位置に来ません/);
  assert.match(all, /"j99"/);
  assert.match(r.warnings.join("\n"), /未知のパラメータ "colour"/);
});

test("short circuit warning", () => {
  const r = resolveCircuit({ board: "half", parts: [{ id: "R1", type: "resistor", pins: ["a1", "b1"] }] });
  assert.match(r.warnings.join(), /R1: 全てのピンが同じネット/);
});

test("free spot avoids occupied holes, module bodies and self-shorts", () => {
  const r = resolveCircuit(load("blink-nano"));
  const spot = findFreeSpot(r, r.registry.get("ne555"));
  assert.ok(spot);
  const placed = resolveCircuit({ ...load("blink-nano"), parts: [...load("blink-nano").parts, { id: "U2", type: "ne555", at: spot.at }] });
  assert.deepEqual(placed.errors, []);
  assert.deepEqual(netOf(placed, "U2.VCC").pins.map((p) => p.ref), ["U2.VCC"]);
});

test("custom JSON parts in mm are converted to pitch units", () => {
  const r = resolveCircuit(load("oled-custom-part"));
  assert.deepEqual(r.parts[1].pins.map((p) => p.hole), ["d24", "d25", "d26", "d27"]);
  assert.equal(netOf(r, "DISP1.SDA").pins[0].ref, "U1.A4");
});

test("resistor color code", () => {
  const names = { "#111": "黒", "#7b4a24": "茶", "#d32f2f": "赤", "#fbc02d": "黄", "#7b1fa2": "紫", "#c9a227": "金" };
  const code = (v) => bandColors(parseOhms(v)).slice(0, 3).map((c) => names[c]).join("");
  assert.equal(code("220"), "赤赤茶");
  assert.equal(code("4k7"), "黄紫赤");
  assert.equal(code("4.7k"), "黄紫赤");
  assert.equal(code("10"), "茶黒黒");
  assert.equal(code("4.7"), "黄紫金");
});

test("SVG export embeds the circuit and can be imported again", () => {
  const c = load("oled-custom-part");
  const svg = renderSvg(resolveCircuit(c), { embed: c });
  assert.deepEqual(parseCircuitText(svg), c);
  assert.deepEqual(parseCircuitText(stringifyCircuit(c)), c);
});

test("wires: via points as holes or [x, y], curves and bend", async () => {
  const { wirePath } = await import("../src/render.js");
  const r = resolveCircuit({
    board: "half",
    wires: [
      { id: "W1", from: "a1", to: "a10", via: ["c5", [6.5, 2.5]], shape: "curve" },
      { id: "W2", from: "j1", to: "j10", bend: 0.2 },
      { id: "W3", from: "j11", to: "j20", via: ["zz"], shape: "wavy" },
    ],
  });
  assert.deepEqual(r.wires[0].via, [{ x: 6, y: 6 }, { x: 6.5, y: 2.5 }]);
  assert.match(wirePath(r.wires[0]), /^M 2 4 C /);
  assert.match(wirePath(r.wires[1]), / C /);
  assert.equal(wirePath({ ...r.wires[1], bend: 0 }), "M 2 15 L 11 15");
  assert.match(r.warnings.join("\n"), /W3: via "zz"/);
  assert.match(r.warnings.join("\n"), /W3: shape は/);
});

test("every built-in part can be auto-placed, validated and rendered", async () => {
  const { BUILTIN_PARTS } = await import("../src/parts/builtin.js");
  const { applyOps } = await import("../src/ops.js");
  for (const def of BUILTIN_PARTS) {
    const { circuit } = applyOps({ board: "full" }, [{ op: "addPart", type: def.type }]);
    const r = resolveCircuit(circuit);
    assert.deepEqual(r.errors, [], def.type);
    const names = r.parts[0].pins.map((p) => p.name);
    assert.equal(new Set(names).size, names.length, `${def.type}: pin names must be unique`);
    assert.match(renderSvg(r), /<\/svg>$/, def.type);
  }
});
