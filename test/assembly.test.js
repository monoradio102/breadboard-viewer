import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { TIMING, autoSteps, drawnAt, offsetAt, planAssembly } from "../src/assembly.js";
import { resolveCircuit } from "../src/circuit.js";
import { applyOps } from "../src/ops.js";
import { renderSvg } from "../src/render.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), "utf8"));

test("auto steps: modules first, then parts, then wires in groups", () => {
  const steps = autoSteps(resolveCircuit(load("motor-servo")));
  assert.deepEqual(steps[0].items, ["U1"]);
  assert.match(steps[0].text, /h3 \(1番ピン\)/);
  const wireSteps = steps.filter((s) => s.items[0].startsWith("W"));
  assert.ok(wireSteps.every((s) => s.items.length <= 3));
  assert.equal(steps.flatMap((s) => s.items).length, 6 + 9);
});

test("parts start in the tray below the board and end in place", () => {
  const r = resolveCircuit(load("blink-nano"));
  const plan = planAssembly(r);
  const tray = plan.trayBounds;
  assert.ok(tray.y > r.board.bounds.y + r.board.bounds.h, "tray is below the board");
  const s = plan.start(plan.stepOf.get("R1")) + TIMING.lead;
  assert.notDeepEqual(offsetAt(plan, "R1", 0), { dx: 0, dy: 0 });
  assert.deepEqual(offsetAt(plan, "R1", s + TIMING.move), { dx: 0, dy: 0 });
  assert.equal(drawnAt(plan, "W1", 0), 0);
  assert.equal(drawnAt(plan, "W1", plan.duration - 1), 1);
  assert.equal(plan.stepAt(plan.timeOfStep(2)), 2);
});

test("assembly SVG: animated keyframes, still frames per step, step captions", () => {
  const r = resolveCircuit(load("blink-nano"));
  const svg = renderSvg(r, { assembly: true });
  assert.match(svg, /data-asm="U1"/);
  assert.match(svg, /@keyframes bb-[a-z0-9]+-a0/);
  const plan = planAssembly(r);
  const step0 = renderSvg(r, { assembly: true, time: plan.timeOfStep(0) });
  assert.doesNotMatch(step0, /@keyframes bb-[a-z0-9]+-a/);
  assert.match(step0, /data-asm="R1" style="transform:translate\((?!0px,0px)/);
  const last = renderSvg(r, { assembly: true, time: plan.timeOfStep(plan.steps.length) });
  assert.match(last, /data-asm="R1" style="transform:translate\(0px,0px\)"/);
  assert.match(last, /5\. c22 から − レールへ/);
});

test("setSteps validates ids; steps follow renames and removals", () => {
  assert.throws(() => applyOps(load("blink-nano"), [{ op: "setSteps", steps: [{ text: "x", items: ["NOPE"] }] }]), /NOPE/);
  let { circuit } = applyOps(load("blink-nano"), [{ op: "setSteps", steps: [{ text: "a", items: ["U1", "R1"] }, { text: "b", items: ["W1"] }] }]);
  circuit = applyOps(circuit, [{ op: "update", id: "R1", set: { id: "R2" } }, { op: "remove", id: "W1" }]).circuit;
  assert.deepEqual(circuit.steps.map((s) => s.items), [["U1", "R2"], []]);
  const r = resolveCircuit({ ...circuit, steps: [{ text: "x", items: ["GHOST"] }] });
  assert.match(r.warnings.join(), /GHOST/);
  assert.equal(applyOps(circuit, [{ op: "setSteps", steps: null }]).circuit.steps, undefined);
});

test("assembly settings: fixed tray positions, timing, per-step duration, captions", () => {
  const c = {
    ...load("blink-nano"),
    assembly: { tray: { U1: [3, -9] }, timing: { step: 3000, intro: 1000 }, introText: "用意するもの", numbering: false },
  };
  c.steps = c.steps.map((s, i) => (i === 1 ? { ...s, duration: 5000 } : s));
  const plan = planAssembly(resolveCircuit(c));
  assert.deepEqual(plan.trayPos.get("U1"), [3, -9]);
  assert.equal(plan.start(1), 1000);
  assert.equal(plan.start(2), 4000);
  assert.equal(plan.start(3), 9000); // step 2 lasts 5000
  assert.equal(plan.stepAt(8999), 2);
  assert.equal(plan.captions[0].text, "用意するもの");
  assert.doesNotMatch(plan.captions[1].text, /^1\./);
  assert.equal(plan.duration, 1000 + 3000 * 4 + 5000 + TIMING.outro);
});

test("setAssembly merges, validates, and follows renames", () => {
  let { circuit } = applyOps(load("blink-nano"), [
    { op: "setAssembly", tray: { U1: [3, -9] }, timing: { step: 3000 } },
    { op: "setAssembly", tray: { R1: [24, -5] }, introText: "用意" },
  ]);
  assert.deepEqual(circuit.assembly, { tray: { U1: [3, -9], R1: [24, -5] }, timing: { step: 3000 }, introText: "用意" });
  circuit = applyOps(circuit, [{ op: "update", id: "R1", set: { id: "R7" } }, { op: "setAssembly", tray: { U1: null } }]).circuit;
  assert.deepEqual(circuit.assembly.tray, { R7: [24, -5] });
  assert.throws(() => applyOps(circuit, [{ op: "setAssembly", tray: { NOPE: [0, 0] } }]), /NOPE/);
  assert.throws(() => applyOps(circuit, [{ op: "setAssembly", tray: { R7: [0] } }]), /\[x, y\]/);
  assert.equal(applyOps(circuit, [{ op: "setAssembly", clear: true }]).circuit.assembly, undefined);
});
