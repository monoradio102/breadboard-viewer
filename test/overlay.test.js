import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCircuit } from "../src/circuit.js";
import { applyOps } from "../src/ops.js";
import { renderSvg } from "../src/render.js";

const FX = '<svg viewBox="0 0 10 10"><style>.a{animation:x 1s infinite}</style><circle class="a" cx="5" cy="5" r="4"/></svg>';
const EVIL = '<svg viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10" onload="alert(2)"/></svg>';

test("overlays are drawn as images (never inlined), so their scripts cannot run", () => {
  const r = resolveCircuit({ board: "half", overlays: [{ id: "FX1", svg: EVIL, x: 1, y: 1, w: 4, h: 4 }] });
  assert.deepEqual(r.errors, []);
  const svg = renderSvg(r);
  assert.match(svg, /<image href="data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  assert.doesNotMatch(svg, /<script|onload=/);
});

test("overlay validation", () => {
  const r = resolveCircuit({ board: "half", overlays: [{ svg: "<div>", x: 0, y: 0, w: 1, h: 1 }, { svg: FX, x: 0 }] });
  assert.match(r.errors.join("\n"), /FX1: svg は <svg/);
  assert.match(r.errors.join("\n"), /FX2: x, y, w, h/);
});

test("overlays can be animated with show / opacity", () => {
  const r = resolveCircuit({
    board: "half",
    overlays: [{ id: "SMOKE", svg: FX, x: 1, y: 1, w: 4, h: 4 }],
    animation: { duration: 1000, tracks: [{ target: "SMOKE", keys: [{ t: 0, show: false }, { t: 500, show: true, opacity: 0.5 }] }] },
  });
  assert.deepEqual(r.warnings, []);
  assert.match(renderSvg(r), /\[data-anim="SMOKE:fx"\]\{animation:/);
  assert.match(renderSvg(r, { time: 700 }), /data-anim="SMOKE:fx" style="opacity:0.5"/);
});

test("overlay ops: add, move, update, animate, remove", () => {
  let { circuit, ids } = applyOps({ board: "half" }, [
    { op: "addOverlay", svg: FX, x: 1, y: 2, w: 3, h: 3 },
    { op: "move", id: "FX1", pos: [5, 6] },
    { op: "update", id: "FX1", set: { w: 6, id: "GLOW" } },
    { op: "animate", target: "GLOW", keys: [{ t: 0, opacity: 0.2 }] },
  ]);
  assert.equal(ids[0], "FX1");
  assert.deepEqual({ ...circuit.overlays[0], svg: undefined }, { id: "GLOW", x: 5, y: 6, w: 6, h: 3, svg: undefined });
  assert.throws(() => applyOps(circuit, [{ op: "addOverlay", svg: "nope", x: 0, y: 0, w: 1, h: 1 }]), /<svg/);
  circuit = applyOps(circuit, [{ op: "remove", id: "GLOW" }]).circuit;
  assert.equal(circuit.overlays, undefined);
  assert.deepEqual(circuit.animation.tracks, []);
});

test("JSON parts can embed sprites, shown by `when`", () => {
  const def = {
    type: "fan",
    pins: [{ name: "+", x: 0, y: 0 }, { name: "-", x: 1, y: 0 }],
    sprites: [
      { svg: FX, x: -1, y: -4, w: 3, h: 3, when: "on" },
      { svg: EVIL, x: -1, y: -4, w: 3, h: 3, when: "!on" },
    ],
  };
  const r = resolveCircuit({ board: "half", partDefs: [def], parts: [{ id: "F1", type: "fan", at: "a10", state: { on: true } }] });
  assert.deepEqual(r.errors, []);
  const svg = renderSvg(r);
  assert.match(svg, /<image[^>]*data-anim="F1:when:on" style="opacity:1"/);
  assert.match(svg, /<image[^>]*data-anim="F1:when:!on" style="opacity:0"/);
  assert.doesNotMatch(svg, /<script/);
  const bad = resolveCircuit({ board: "half", partDefs: [{ ...def, sprites: [{ svg: FX }] }] });
  assert.match(bad.errors.join(), /sprites\[0\]: x, y, w, h/);
});
