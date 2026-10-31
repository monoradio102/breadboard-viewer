import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { sampleTrack } from "../src/animation.js";
import { resolveCircuit } from "../src/circuit.js";
import { applyOps } from "../src/ops.js";
import { renderSvg } from "../src/render.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), "utf8"));

test("examples with animation resolve without warnings", () => {
  for (const name of ["blink-nano", "pico-button", "motor-servo", "oled-custom-part"]) {
    const r = resolveCircuit(load(name));
    assert.deepEqual(r.warnings, [], name);
    assert.ok(r.timeline.animated, name);
  }
});

test("bool states hold, number states interpolate", () => {
  const r = resolveCircuit({
    board: "full",
    parts: [
      { id: "D1", type: "led", pins: ["a1", "a2"] },
      { id: "S1", type: "servo", at: "a30" },
    ],
    animation: {
      duration: 1000,
      tracks: [
        { target: "D1", keys: [{ t: 0, on: true }, { t: 500, on: false }] },
        { target: "S1", keys: [{ t: 0, angle: 0 }, { t: 1000, angle: 180 }] },
      ],
    },
  });
  const d1 = r.timeline.tracks.get("D1");
  assert.equal(d1.stateAt(499).on, true);
  assert.equal(d1.stateAt(500).on, false);
  assert.equal(r.timeline.tracks.get("S1").stateAt(250).angle, 45);
});

test("rate states are integrated into an angle", () => {
  const r = resolveCircuit({
    board: "half",
    parts: [{ id: "M1", type: "motor", pins: ["a1", "a4"] }],
    animation: { duration: 2000, tracks: [{ target: "M1", keys: [{ t: 0, speed: 60 }, { t: 1000, speed: 60 }, { t: 1001, speed: 0 }] }] },
  });
  const samples = sampleTrack(r.timeline.tracks.get("M1"), 2000);
  const end = samples.at(-1).s.speedAngle;
  assert.ok(Math.abs(end - 360) < 1, `60 rpm for 1 s should be ~360°, got ${end}`);
});

test("unknown targets and states are warnings", () => {
  const r = resolveCircuit({
    board: "half",
    parts: [{ id: "D1", type: "led", pins: ["a1", "a2"] }],
    animation: { tracks: [{ target: "X9", keys: [{ t: 0 }] }, { target: "D1", keys: [{ t: 0, spin: 1 }] }] },
  });
  assert.match(r.warnings.join("\n"), /"X9" が見つかりません/);
  assert.match(r.warnings.join("\n"), /状態 "spin" はありません/);
});

test("SVG contains keyframes only when animated; static state comes from `state`", () => {
  const animated = renderSvg(resolveCircuit(load("blink-nano")));
  assert.match(animated, /@keyframes bb-[a-z0-9]+-k0/);
  assert.match(animated, /data-anim="D1:glow"/);
  const still = renderSvg(resolveCircuit({ board: "half", parts: [{ id: "D1", type: "led", pins: ["a1", "a2"], state: { on: true } }] }));
  assert.doesNotMatch(still, /@keyframes bb-[a-z0-9]+-k/);
  assert.match(still, /data-anim="D1:glow" style="opacity:1"/);
  const off = renderSvg(resolveCircuit(load("blink-nano")), { animate: false });
  assert.doesNotMatch(off, /@keyframes bb-[a-z0-9]+-k/);
});

test("custom parts: when-shapes and display text", () => {
  const r = resolveCircuit(load("oled-custom-part"));
  const svg = renderSvg(r);
  assert.match(svg, /data-anim="DISP1:when:!text"/);
  assert.match(svg, /data-anim="DISP1:text:1"/);
  assert.match(svg, /<tspan[^>]*>Hum : 41%<\/tspan>/);
});

test("animate / setAnimation ops, and tracks follow renames and removals", () => {
  let { circuit } = applyOps(load("blink-nano"), [
    { op: "animate", target: "R1", keys: [{ t: 0 }] },
    { op: "setAnimation", duration: 500 },
    { op: "update", id: "D1", set: { id: "LED1" } },
    { op: "remove", id: "R1" },
  ]);
  assert.equal(circuit.animation.duration, 500);
  assert.deepEqual(circuit.animation.tracks.map((t) => t.target), ["LED1"]);
  circuit = applyOps(circuit, [{ op: "animate", target: "LED1", keys: [{ t: 300, on: true }], replace: false }]).circuit;
  assert.deepEqual(circuit.animation.tracks[0].keys.map((k) => k.t), [0, 300, 1000]);
  circuit = applyOps(circuit, [{ op: "setAnimation", clear: true }]).circuit;
  assert.equal(circuit.animation, undefined);
  assert.throws(() => applyOps(circuit, [{ op: "animate", target: "NOPE", keys: [] }]), /NOPE/);
});

test("still frames: time draws the state at that moment without CSS animation", () => {
  const r = resolveCircuit(load("motor-servo"));
  const svg = renderSvg(r, { time: 1000 });
  assert.doesNotMatch(svg, /@keyframes bb-[a-z0-9]+-k/);
  assert.match(svg, /animation-delay:-1000ms/); // wire flow / waves frozen at the same moment
  // servo: 0° -> 180° over 2000 ms, so 90° at 1000 ms
  assert.match(svg, /data-anim="S1:horn" style="transform:rotate\(-90deg\)"/);
  // motor: ramps 0 -> 150 rpm over 600 ms, then holds; the angle is integrated
  const m = /data-anim="M1:rotor" style="transform:rotate\(([\d.]+)deg\)"/.exec(svg);
  assert.ok(m && Number(m[1]) > 500, `motor angle at 1 s: ${m?.[1]}`);
  assert.match(renderSvg(r, { time: 3500 }), /data-anim="caption:2" style="opacity:1"/);
});
