import assert from "node:assert/strict";
import { test } from "node:test";
import { describe, kitList, resolveCircuit } from "../src/circuit.js";
import { OpError, applyOps } from "../src/ops.js";
import { renderSvg } from "../src/render.js";
import { kitColor, kitInfo, kitRoute, trimRoute } from "../src/wires.js";

const circuit = (extra = {}) => ({
  version: 1,
  board: "half",
  parts: [{ id: "SV1", type: "servo", pos: [10, -8] }],
  wires: [
    { id: "W1", from: "a3", to: "a5" },
    { id: "W2", from: "c10", to: "T-15" },
    { id: "W3", from: "c10", to: "T-15", elbow: "v" },
    { id: "W4", from: "j20", to: "SV1.SIG" },
  ],
  ...extra,
});

test("kit wires: right-angle route, elbow picks which way to turn", () => {
  const r = resolveCircuit(circuit({ wireStyle: "kit" }));
  const w = (id) => r.wires.find((x) => x.id === id);
  assert.deepEqual(kitRoute(w("W1")), [w("W1").a, w("W1").b]);
  assert.deepEqual(kitRoute(w("W2"))[1], { x: w("W2").b.x, y: w("W2").a.y });
  assert.deepEqual(kitRoute(w("W3"))[1], { x: w("W3").a.x, y: w("W3").b.y });
  // via points: still square, straight runs merged
  const viaWire = { a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, via: [{ x: 2, y: 0 }] };
  assert.equal(kitRoute(viaWire).length, 2);
});

test("kit wires are colored by length (resistor color code), 1 pitch is bare", () => {
  assert.equal(kitColor(1), "bare");
  assert.equal(kitColor(2), "red");
  assert.equal(kitColor(5), "green");
  assert.equal(kitColor(10), "brown");
  assert.equal(kitColor(20), "red");
  const r = resolveCircuit(circuit({ wireStyle: "kit" }));
  const info = kitInfo(r.wires[1]);
  assert.equal(info.length, 9); // c10 -> T-15: 5 across, 4 up
  assert.equal(info.color, "white");
  assert.equal(info.bends, 1);
});

test("wireStyle applies to on-board wires; wires to off-board pins stay flexible", () => {
  const r = resolveCircuit(circuit({ wireStyle: "kit" }));
  assert.deepEqual(r.wires.map((w) => w.kit), [true, true, true, false]);
  assert.deepEqual(resolveCircuit(circuit()).wires.map((w) => w.kit), [false, false, false, false]);
  // per-wire style wins
  const c = circuit({ wireStyle: "kit" });
  c.wires[0].style = "flex";
  c.wires[3].style = "kit";
  assert.deepEqual(resolveCircuit(c).wires.map((w) => w.kit), [false, true, true, true]);
  assert.ok(resolveCircuit(circuit({ wireStyle: "flat" })).warnings.some((w) => w.includes("wireStyle")));
});

test("check lists the kit wires by length", () => {
  const r = resolveCircuit(circuit({ wireStyle: "kit" }));
  assert.equal(kitList(r).length, 3);
  const text = describe(r);
  assert.match(text, /ジャンパ線キット/);
  assert.match(text, /2 赤 ×1: W1/);
  assert.match(text, /9 白 ×2: W2, W3 曲げあり: W2, W3/);
});

test("setWireStyle op", () => {
  const { circuit: c } = applyOps(circuit(), [{ op: "setWireStyle", style: "kit" }]);
  assert.equal(c.wireStyle, "kit");
  const { circuit: back } = applyOps(c, [{ op: "setWireStyle", style: "flex" }]);
  assert.equal(back.wireStyle, undefined);
  assert.throws(() => applyOps(c, [{ op: "setWireStyle", style: "flat" }]), OpError);
});

test("kit wires render under the parts, flexible ones above", () => {
  const svg = renderSvg(resolveCircuit(circuit({ wireStyle: "kit" })));
  const flat = svg.indexOf('class="wires flat"');
  const parts = svg.indexOf('class="parts"');
  const raised = svg.indexOf('class="wires"');
  assert.ok(flat > 0 && flat < parts && parts < raised);
  assert.ok(svg.slice(flat, parts).includes('data-id="W1"'));
  assert.ok(svg.slice(raised).includes('data-id="W4"'));
  // still renders in assembly mode
  assert.match(renderSvg(resolveCircuit(circuit({ wireStyle: "kit" })), { assembly: true, time: 0 }), /wires flat/);
});

test("trimRoute cuts both ends back along the route", () => {
  const pts = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }];
  assert.deepEqual(trimRoute(pts, 0.5, 0.5), [{ x: 0.5, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1.5 }]);
  assert.equal(trimRoute([{ x: 0, y: 0 }, { x: 0.5, y: 0 }], 0.3, 0.3), null);
});
