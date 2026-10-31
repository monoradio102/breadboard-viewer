import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { autoWire } from "../src/autowire.js";
import { resolveCircuit } from "../src/circuit.js";
import { layoutIssues } from "../src/inspect.js";
import { applyOps } from "../src/ops.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), "utf8"));
const bare = (name) => {
  const c = load(name);
  delete c.animation;
  delete c.steps;
  return { ...c, wires: [] };
};
// the example's own nets, rails included, as autoWire input
const netsOf = (circuit) => {
  const nets = {};
  for (const net of resolveCircuit(circuit).nets) {
    const rails = net.name.split("/").filter((s) => /^[TB][+-]$/.test(s));
    const members = [...net.pins.map((p) => p.ref), ...rails];
    if (members.length >= 2) nets[net.name] = members;
  }
  return nets;
};
const sameNets = (a, b) => {
  const group = (c) => {
    const r = resolveCircuit(c);
    return new Map(r.nets.flatMap((n) => n.pins.map((p) => [p.ref, n.name])));
  };
  const [ga, gb] = [group(a), group(b)];
  for (const [ref, net] of ga) {
    for (const [ref2, net2] of ga) if ((net === net2) !== (gb.get(ref) === gb.get(ref2))) return `${ref} / ${ref2}`;
  }
  return null;
};

const OLED_NETS = {
  GND: ["U1.GND", "DISP1.GND", "T-", "B-"],
  "3V3": ["U1.3V3", "DISP1.VCC", "T+", "B+"],
  SDA: ["U1.D4", "DISP1.SDA"],
  SCL: ["U1.D5", "DISP1.SCL"],
};

test("autoWire connects the nets with no crossings or covered holes", () => {
  const base = bare("oled-hello");
  const { wires, notes } = autoWire(base, OLED_NETS);
  assert.deepEqual(notes, []);
  const c = { ...base, wires };
  assert.equal(sameNets(c, load("oled-hello")), null);
  assert.deepEqual(layoutIssues(resolveCircuit(c)).filter((l) => /^W\d/.test(l)), []);
  // ground black, supply red
  for (const w of wires) {
    if (/GND/.test(w.note)) assert.equal(w.color, "black");
    if (/3V3/.test(w.note)) assert.equal(w.color, "red");
  }
  // the same input gives the same wires
  assert.deepEqual(autoWire(base, OLED_NETS).wires, wires);
});

test("autoWire adds nothing for members already connected, and reports bad members", () => {
  const c = load("blink-nano"); // R1.2 and D1.A share column 21
  assert.deepEqual(autoWire(c, { LED: ["R1.2", "D1.A"] }).wires, []);
  assert.throws(() => autoWire(c, { X: ["U1.NOPE", "D1.A"] }), /U1 にピン "NOPE" はありません/);
  assert.throws(() => autoWire(c, { X: ["Q9.1", "D1.A"] }), /部品のピン/);
  assert.throws(() => autoWire(c, { X: ["D1.A"] }), /2つ以上/);
  assert.throws(() => applyOps(c, [{ op: "autoWire", nets: { X: ["U1.NOPE", "D1.A"] } }]), /autoWire/);
});

test("the autoWire op adds the wires and returns their ids", () => {
  const { circuit, ids } = applyOps(bare("oled-hello"), [{ op: "autoWire", nets: OLED_NETS }]);
  assert.equal(ids[0].split(",").length, circuit.wires.length);
  assert.ok(circuit.wires.every((w) => /^自動配線: /.test(w.note)));
});

test("in kit style the wires turn at right angles", () => {
  const base = { ...bare("flasher-kit") };
  const nets = netsOf(load("flasher-kit"));
  const { wires } = autoWire(base, nets);
  const c = { ...base, wires };
  assert.equal(sameNets(c, load("flasher-kit")), null);
  assert.ok(wires.filter((w) => !w.from.includes(".") && !w.to.includes(".")).every((w) => w.bend === undefined));
});

test("examples rewired from their own netlists connect the same pins", () => {
  for (const name of ["blink-nano", "pico-button", "tone-speaker", "oled-custom-part"]) {
    const c = load(name);
    const base = bare(name);
    const { wires } = autoWire(base, netsOf(c));
    assert.equal(sameNets({ ...base, wires }, c), null, name);
  }
});
