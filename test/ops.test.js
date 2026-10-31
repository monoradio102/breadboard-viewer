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
  assert.deepEqual(part(circuit, "D1").pins, ["a10", "b10"]);
  assert.equal(part(circuit, "D1").at, undefined);
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
  assert.deepEqual(circuit.wires[0], { id: "W1", from: "c22", to: "T-22", color: "blue" });
});

test("wires: add, update ends, remove", () => {
  const { circuit, ids } = applyOps(load("blink-nano"), [
    { op: "addWire", from: "j3", to: "B-3", color: "black" },
    { op: "update", id: "W3", set: { to: "B-4" } },
    { op: "remove", id: "W1" },
  ]);
  assert.equal(ids[0], "W3");
  assert.deepEqual(circuit.wires.map((w) => `${w.id}:${w.from}-${w.to}`), ["W2:a4-T-4", "W3:j3-B-4"]);
  assert.throws(() => applyOps(circuit, [{ op: "addWire", from: "a1", to: "zz" }]), /ボードにない穴/);
});

test("a failing op aborts the whole batch and reports its index", () => {
  const before = load("blink-nano");
  assert.throws(() => applyOps(before, [{ op: "remove", id: "R1" }, { op: "remove", id: "NOPE" }]), /#2 remove/);
  assert.equal(before.parts.length, 3);
});
