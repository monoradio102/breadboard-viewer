import assert from "node:assert/strict";
import { test } from "node:test";
import { findFreeSpot, resolveCircuit } from "../src/circuit.js";
import { renderSvg } from "../src/render.js";

// an amplifier board: 3 header pins go into the breadboard, the speaker terminal does not
const amp = {
  type: "amp-board",
  pins: [
    { name: "VIN", x: 0, y: 0 },
    { name: "GND", x: 1, y: 0 },
    { name: "IN", x: 2, y: 0 },
    { name: "SPK+", x: 0.5, y: -4, insert: false },
    { name: "SPK-", x: 1.5, y: -4, insert: false },
  ],
};

test("pins with insert: false are terminals: no hole needed, wired by PartId.PinName", () => {
  const r = resolveCircuit({
    board: "half",
    partDefs: [amp],
    parts: [
      { id: "AMP1", type: "amp-board", at: "e10" },
      { id: "SP1", type: "speaker", pos: [30, -6] },
    ],
    wires: [
      { from: "AMP1.SPK+", to: "SP1.+" },
      { from: "AMP1.SPK-", to: "SP1.-" },
    ],
  });
  assert.deepEqual(r.errors, []);
  const amp1 = r.parts[0];
  assert.deepEqual(amp1.pins.map((p) => p.hole), ["e10", "e11", "e12", null, null]);
  const net = r.nets.find((n) => n.pins.some((p) => p.ref === "SP1.+"));
  assert.deepEqual(net.pins.map((p) => p.ref).sort(), ["AMP1.SPK+", "SP1.+"]);
  const svg = renderSvg(r);
  assert.match(svg, /data-pin="AMP1\.SPK\+"/);
  assert.doesNotMatch(svg, /data-pin="AMP1\.VIN"/);
});

test("free spot search ignores terminal pins", () => {
  const r = resolveCircuit({ board: "half", partDefs: [amp] });
  const spot = findFreeSpot(r, r.registry.get("amp-board"));
  assert.ok(spot);
  assert.equal(spot.pins.filter(Boolean).length, 3);
});

test("idLabel hides or moves the part id", () => {
  const base = { board: "half", parts: [{ id: "R1", type: "resistor", pins: ["a1", "a5"] }] };
  assert.match(renderSvg(resolveCircuit(base)), />R1<\/text>/);
  assert.doesNotMatch(renderSvg(resolveCircuit({ ...base, parts: [{ ...base.parts[0], idLabel: false }] })), />R1<\/text>/);
  const moved = renderSvg(resolveCircuit({ ...base, parts: [{ ...base.parts[0], idLabel: { dx: 2, dy: -1 } }] }));
  assert.match(moved, /<text x="6" y="1\.75"[^>]*>R1<\/text>/);
  assert.deepEqual(resolveCircuit({ ...base, parts: [{ ...base.parts[0], idLabel: false }] }).warnings, []);
});

test("the same problem is reported once", () => {
  const r = resolveCircuit({
    board: "half",
    parts: [{ id: "D1", type: "led", pins: ["a1", "a2"] }],
    animation: { tracks: [{ target: "D1", keys: [{ t: 0, spin: 1 }, { t: 500, spin: 0 }] }] },
  });
  assert.equal(r.warnings.length, 1);
});
