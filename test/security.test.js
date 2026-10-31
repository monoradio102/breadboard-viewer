// Circuits can come from anyone (a dropped file, a #data= link). Whatever the strings in
// them are, the rendered SVG must not contain markup they brought in: the editor puts this
// SVG into the page with innerHTML.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { describe, resolveCircuit } from "../src/circuit.js";
import { BUILTIN_PARTS } from "../src/parts/builtin.js";
import { renderSvg } from "../src/render.js";

const P = `x"'><x-inj onload=alert(1)></style><x-inj>]}*/;}</x-inj`;
const LEAK = /<x-inj/; // escaped text (&lt;x-inj …) is harmless; a raw tag means the string broke out

// every string in a value replaced by the payload (keys too, where they are free-form)
function poison(v, keys = false) {
  if (typeof v === "string") return `${v}${P}`;
  if (Array.isArray(v)) return v.map((x) => poison(x, keys));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [keys ? `${k}${P}` : k, poison(x, keys)]));
  return v;
}

const renders = (result) => [
  renderSvg(result, { embed: result.circuit ?? {} }),
  renderSvg(result, { time: 500 }),
  renderSvg(result, { assembly: true }),
  renderSvg(result, { assembly: true, time: 1000 }),
  ...result.parts.slice(0, 3).map((p) => renderSvg(result, { selection: p.id })),
  ...result.wires.slice(0, 3).map((w) => renderSvg(result, { selection: w.id })),
];

function assertClean(circuit, label) {
  const result = resolveCircuit(circuit);
  for (const svg of renders(result)) {
    const m = LEAK.exec(svg);
    assert.equal(m, null, `${label}: markup leaked: …${m && svg.slice(Math.max(0, m.index - 80), m.index + 40)}…`);
  }
  describe(result); // must not throw either
}

test("examples with every string poisoned render no foreign markup", () => {
  for (const name of ["blink-nano", "xiao-voice", "flasher-kit", "led-burnout", "oled-custom-part", "oled-hello", "motor-servo", "tone-speaker", "pico-button", "xiao-pot-led"]) {
    const c = JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), "utf8"));
    assertClean(poison(c), name);
    // ids and pins stay valid, the rest is poisoned
    const keep = { ...poison(c), parts: c.parts.map((p) => ({ ...poison(p), id: p.id, type: p.type, at: p.at, pins: p.pins, pos: p.pos })), wires: c.wires.map((w) => ({ ...poison(w), id: w.id, from: w.from, to: w.to, via: w.via })) };
    assertClean(keep, `${name} (valid ids)`);
  }
});

test("every built-in part with poisoned parameters and state", () => {
  for (const def of BUILTIN_PARTS) {
    const params = Object.fromEntries(Object.keys(def.params ?? {}).map((k) => [k, `v${P}`]));
    const state = Object.fromEntries(Object.keys(def.states ?? {}).map((k) => [k, `v${P}`]));
    const circuit = {
      board: "full",
      parts: [{ id: `U1${P}`, type: def.type, pos: [10, -10], ...params, state, idLabel: { dx: P, dy: 1 } }],
      animation: { duration: 1000, tracks: [{ target: `U1${P}`, keys: [{ t: 0, ...state }, { t: 500, ...poison(state) }] }], captions: [{ t: 0, text: P }] },
    };
    assertClean(circuit, def.type);
  }
});

test("poisoned part definitions, overlays, assembly and keys", () => {
  const def = {
    type: `my${P}`,
    name: P,
    category: P,
    description: P,
    units: "mm",
    pins: [{ name: `A${P}`, x: 0, y: 0 }, { name: "B", x: 2.54, y: 0, insert: false }],
    shapes: [
      { type: "rect", x: -1, y: -1, w: 4, h: 2, fill: P, stroke: P, strokeWidth: P, r: P, when: { [P]: P } },
      { type: "text", x: 0, y: 0, text: P, fill: P, size: P, anchor: P },
      { type: "path", d: P, fill: P },
      { type: "polygon", points: [[0, 0], [1, P]], fill: P },
      { type: P, x: 0 },
    ],
    display: { x: 0, y: 0, w: 2, h: 1, lines: P, color: P },
    states: { [P]: { type: "string", default: P } },
    source: { lcsc: P, datasheet: `javascript:${P}` },
  };
  const circuit = poison({
    title: "t",
    board: "half",
    partDefs: [def],
    parts: [{ id: "X1", type: def.type, at: "a5", color: "c" }],
    wires: [{ id: "W1", from: "a10", to: "a12", color: "c", note: "n", state: { flow: "f" } }],
    overlays: [{ id: "FX1", svg: `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><x-inj/></svg>`, x: 1, y: 1, w: 2, h: 2, fit: "f" }],
    steps: [{ text: "s", items: ["X1", "W1"] }],
    assembly: { introText: "i", outroText: "o", tray: { X1: [5, 25] } },
    animation: { duration: 800, groups: { g: ["W1"] }, tracks: [{ target: "g", keys: [{ t: 0, flow: true, k: "v" }] }], captions: [{ t: 0, text: "c" }] },
  });
  circuit.partDefs[0].type = def.type;
  circuit.parts[0] = { id: "X1", type: def.type, at: "a5", color: P };
  circuit.wires[0] = { ...circuit.wires[0], id: "W1", from: "a10", to: "a12" };
  circuit.steps[0].items = ["X1", "W1"];
  circuit.animation.groups = { g: ["W1"] };
  circuit.animation.tracks[0].target = "g";
  assertClean(circuit, "partDefs");
  // the overlay's own markup only ever appears URI-encoded inside an <image href>
  const svg = renderSvg(resolveCircuit(circuit));
  assert.ok(!/<script/.test(svg));
});
