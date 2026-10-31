import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolveCircuit } from "../src/circuit.js";
import { OpError, applyOps, normalize } from "../src/ops.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), "utf8"));
const part = (c, id) => c.parts.find((p) => p.id === id);

test("normalize gives wires ids", () => {
  const c = normalize(load("blink-nano"));
  assert.deepEqual(c.wires.map((w) => w.id), ["W1", "W2"]);
});

test("addPart picks an id and a free spot when no position is given", () => {
  const { circuit, ids } = applyOps(load("blink-nano"), [{ op: "addPart", type: "resistor", value: "1k" }, { op: "addPart", type: "ne555" }]);
  assert.deepEqual(ids, ["R2", "U2"]);
  assert.equal(part(circuit, "R2").value, "1k");
  assert.ok(part(circuit, "R2").pins);
  assert.ok(part(circuit, "U2").at);
  assert.deepEqual(resolveCircuit(circuit).errors, []);
});

test("addPart with at turns leads parts into explicit pins", () => {
  const { circuit } = applyOps({ board: "half" }, [{ op: "addPart", type: "led", at: "a10", rot: 90 }]);
  assert.deepEqual(part(circuit, "LED1").pins, ["a10", "b10"]);
  assert.equal(part(circuit, "LED1").at, undefined);
});

test("move shifts leads parts and keeps the pins style", () => {
  const { circuit } = applyOps(load("blink-nano"), [{ op: "move", id: "D1", to: "c21" }]);
  assert.deepEqual(part(circuit, "D1").pins, { A: "c21", K: "c22" });
  const moved = applyOps(load("blink-nano"), [{ op: "move", id: "U1", to: "h4" }]).circuit;
  assert.equal(part(moved, "U1").at, "h4");
});

test("move fails when a pin would leave the board", () => {
  assert.throws(() => applyOps(load("blink-nano"), [{ op: "move", id: "R1", to: "a28" }]), OpError);
});

test("rotate: rigid parts change rot, leads parts rotate their holes around pin 1", () => {
  const c = { board: "full", parts: [{ id: "U1", type: "ne555", at: "f10" }, { id: "R1", type: "resistor", pins: ["a20", "a24"] }] };
  const { circuit } = applyOps(c, [{ op: "rotate", id: "U1" }, { op: "rotate", id: "R1" }]);
  assert.equal(part(circuit, "U1").rot, 90);
  assert.deepEqual(part(circuit, "R1").pins, ["a20", "e20"]);
  // counter-clockwise would put pin 2 above the board
  assert.throws(() => applyOps(c, [{ op: "rotate", id: "R1", by: 270 }]), /穴から外れます/);
  const back = applyOps(circuit, [{ op: "rotate", id: "U1", by: 270 }]).circuit;
  assert.equal(part(back, "U1").rot, undefined);
});

test("setPin moves one leg", () => {
  const { circuit } = applyOps(load("blink-nano"), [{ op: "setPin", id: "R1", pin: "2", to: "a24" }]);
  assert.deepEqual(part(circuit, "R1").pins, ["a17", "a24"]);
  assert.throws(() => applyOps(load("blink-nano"), [{ op: "setPin", id: "U1", pin: "D13", to: "a1" }]), /足を曲げられない/);
});

test("update renames, sets params, and null removes a key", () => {
  const { circuit, ids } = applyOps(load("blink-nano"), [
    { op: "update", id: "R1", set: { value: "1k", id: "R9" } },
    { op: "update", id: "W1", set: { color: "blue", note: "gnd" } },
    { op: "update", id: "W1", set: { note: null } },
  ]);
  assert.deepEqual(ids, ["R9", "W1", "W1"]);
  assert.equal(part(circuit, "R9").value, "1k");
  assert.deepEqual(circuit.wires[0], { id: "W1", from: "a22", to: "T-22", color: "blue" });
});

test("wires: add, update ends, remove", () => {
  const { circuit, ids } = applyOps(load("blink-nano"), [
    { op: "addWire", from: "j3", to: "B-3", color: "black" },
    { op: "update", id: "W3", set: { to: "B-4" } },
    { op: "remove", id: "W1" },
  ]);
  assert.equal(ids[0], "W3");
  assert.deepEqual(circuit.wires.map((w) => `${w.id}:${w.from}-${w.to}`), ["W2:a4-T-4", "W3:j3-B-4"]);
  assert.throws(() => applyOps(circuit, [{ op: "addWire", from: "a1", to: "zz" }]), /"zz" はこのボードの穴でも/);
});

test("a failing op aborts the whole batch and reports its index", () => {
  const before = load("blink-nano");
  assert.throws(() => applyOps(before, [{ op: "remove", id: "R1" }, { op: "remove", id: "NOPE" }]), /#2 remove/);
  assert.equal(before.parts.length, 3);
});

test("off-board parts: pos placement, pin-reference wires, nets", () => {
  const { circuit } = applyOps({ board: "half" }, [
    { op: "addPart", type: "nano", at: "h3" },
    { op: "addPart", type: "servo", pos: [40, -6] },
    { op: "addWire", from: "j14", to: "SV1.SIG", color: "orange" },
    { op: "addWire", from: "SV1.GND", to: "B-3", color: "black" },
    { op: "addWire", from: "j6", to: "B-4", color: "black" },
  ]);
  const r = resolveCircuit(circuit);
  assert.deepEqual(r.errors, []);
  const sig = r.nets.find((n) => n.pins.some((p) => p.ref === "SV1.SIG"));
  assert.deepEqual(sig.pins.map((p) => p.ref).sort(), ["SV1.SIG", "U1.D9"]);
  const gnd = r.nets.find((n) => n.pins.some((p) => p.ref === "SV1.GND"));
  assert.ok(gnd.pins.some((p) => p.ref === "U1.GND"));
  assert.deepEqual(r.wires[0].b, { x: 42, y: -6 }); // SIG is the third pin
  assert.throws(() => applyOps(circuit, [{ op: "addWire", from: "a1", to: "SV1.NOPE" }]), /ピン "NOPE" はありません/);
});

test("off-board parts move back onto the board and take their wires along on rename / remove", () => {
  let { circuit } = applyOps({ board: "half" }, [
    { op: "addPart", type: "led", pos: [3, -5] },
    { op: "addWire", from: "LED1.A", to: "a5" },
    { op: "animate", target: "W1", keys: [{ t: 0, flow: true }] },
  ]);
  circuit = applyOps(circuit, [{ op: "update", id: "LED1", set: { id: "LED" } }]).circuit;
  assert.equal(circuit.wires[0].from, "LED.A");
  const onBoard = applyOps(circuit, [{ op: "move", id: "LED", to: "c10" }]).circuit;
  assert.deepEqual(onBoard.parts[0].pins, ["c10", "c11"]);
  assert.equal(onBoard.parts[0].pos, undefined);
  const back = applyOps(onBoard, [{ op: "move", id: "LED", pos: [1, 1] }]).circuit;
  assert.deepEqual(back.parts[0], { id: "LED", type: "led", pos: [1, 1] });
  const removed = applyOps(circuit, [{ op: "remove", id: "LED" }]).circuit;
  assert.deepEqual(removed.wires, []);
  assert.deepEqual(removed.animation.tracks, []);
});

const pinGroups = (c) =>
  resolveCircuit(c)
    .nets.map((n) => [...n.pins.map((p) => p.ref)].sort().join(" "))
    .filter((g) => g.includes(" "))
    .sort();

test("move with keepConnections keeps the netlist; without it the wires stay put", () => {
  const c = load("blink-nano");
  const plain = applyOps(c, [{ op: "move", id: "D1", to: "b25" }]).circuit;
  assert.notDeepEqual(pinGroups(plain), pinGroups(c)); // the LED lost R1 and ground
  const kept = applyOps(c, [{ op: "move", id: "D1", to: "b25", keepConnections: true }]).circuit;
  assert.deepEqual(pinGroups(kept), pinGroups(c));
  // the ground wire keeps its id and colour, moved to the LED's new column
  const w1 = kept.wires.find((w) => w.id === "W1");
  assert.equal(w1.color, "black");
  assert.ok([w1.from, w1.to].some((e) => /26$/.test(e)));
  assert.equal(resolveCircuit(kept).errors.length, 0);
});

test("keepConnections refuses a place that joins other nets, and works for rotate", () => {
  const c = load("blink-nano");
  assert.throws(() => applyOps(c, [{ op: "move", id: "D1", to: "b16", keepConnections: true }]), /がつながってしまいます/);
  const flasher = load("flasher-kit");
  const turned = applyOps(flasher, [{ op: "move", id: "C2", to: "h18", keepConnections: true }]).circuit;
  assert.deepEqual(pinGroups(turned), pinGroups(flasher));
  // animation targets of re-laid wires survive
  const xiao = load("xiao-voice");
  const moved = applyOps(xiao, [{ op: "move", id: "DISP1", to: "j44", keepConnections: true }]).circuit;
  assert.deepEqual(pinGroups(moved), pinGroups(xiao));
  assert.deepEqual(resolveCircuit(moved).warnings, []);
});

test("keepConnections gives every wire its own id and spends none on a part's insides", () => {
  // LED1.A shares R1's column (no wire), LED1.K has W1: moving LED1 needs two wires, one is W1 again
  const c = {
    version: 1,
    board: "half",
    parts: [
      { id: "R1", type: "resistor", pins: ["c10", "c14"] },
      { id: "LED1", type: "led", pins: { A: "b14", K: "b16" } },
    ],
    wires: [{ id: "W1", from: "a16", to: "T-16", color: "black" }],
  };
  const { circuit } = applyOps(c, [{ op: "move", id: "LED1", to: "g20", keepConnections: true }]);
  const ids = circuit.wires.map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length, ids.join(", "));
  assert.ok(ids.includes("W1"));
  // a switch wired on its lower leg: the upper leg (joined inside) needs no wire of its own
  const sw = {
    version: 1,
    board: "half",
    parts: [
      { id: "SW1", type: "button", at: "e17" },
      { id: "R1", type: "resistor", pins: ["j10", "j14"] },
    ],
    wires: [{ id: "W1", from: "j17", to: "i14" }],
  };
  const moved = applyOps(sw, [{ op: "setPin", id: "R1", pin: "1", to: "j8", keepConnections: true }]).circuit;
  assert.deepEqual(moved.wires.map((w) => [w.from, w.to]), [["j17", "i14"]]);
});

test("ops that leave a new error change nothing (strict), unless the editor asks otherwise", () => {
  const c = { version: 1, board: "half", parts: [{ id: "R1", type: "resistor", pins: ["c10", "c14"] }], wires: [{ id: "W1", from: "c8", to: "T-8" }] };
  assert.throws(() => applyOps(c, [{ op: "setPin", id: "R1", pin: "1", to: "c8" }]), /適用すると回路がエラーになります: 穴 c8 に R1\.1 と W1\.from/);
  const loose = applyOps(c, [{ op: "setPin", id: "R1", pin: "1", to: "c8" }], { strict: false }).circuit;
  assert.deepEqual(loose.parts[0].pins, ["c8", "c14"]);
  // errors that were there before do not block other edits
  assert.doesNotThrow(() => applyOps(loose, [{ op: "setTitle", title: "x" }]));
});

test("a removed id is not handed out again", () => {
  const c = { version: 1, board: "half", parts: [], wires: [{ id: "W5", from: "a1", to: "a3" }, { id: "W6", from: "b1", to: "b3" }] };
  const { circuit, ids } = applyOps(c, [{ op: "remove", id: "W6" }, { op: "addWire", from: "c1", to: "c3" }]);
  assert.deepEqual(ids, ["W6", "W7"]);
  assert.deepEqual(circuit.wires.map((w) => w.id), ["W5", "W7"]);
  // a name an animation still uses counts too
  const anim = { ...c, wires: [], animation: { duration: 1000, tracks: [{ target: "W9", keys: [{ t: 0, flow: true }] }] } };
  assert.deepEqual(applyOps(anim, [{ op: "addWire", from: "c1", to: "c3" }]).ids, ["W10"]);
});
