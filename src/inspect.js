// Read-only helpers for agents: what happens if a part is placed (previewPlacement), where a
// hole is (coordsOf), the shape of a part type (partSpec), and layout problems that are only
// visible in the drawing (layoutIssues). Used by tools/bb.mjs and window.bb.
import { partBox } from "./assembly.js";
import { resolveCircuit, stripOf } from "./circuit.js";
import { labelBox, wirePoints } from "./render.js";

const PREVIEW_ID = "__PREVIEW__";
const r2 = (v) => Math.round(v * 100) / 100;
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const inside = (p, b, m = 0) => p.x > b.x + m && p.x < b.x + b.w - m && p.y > b.y + m && p.y < b.y + b.h - m;

// Body box of a part for layout purposes: rigid / off-board parts use their outline, parts with
// bendable leads the strip between their pins plus the drawn body (bodyCore).
export function bodyBox(part) {
  if (part.def.mount !== "leads" || part.offboard) return partBox(part, 0.6);
  const legs = partBox(part, 0.45);
  const core = bodyCore(part);
  const [x0, y0] = [Math.min(legs.x, core.x), Math.min(legs.y, core.y)];
  const [x1, y1] = [Math.max(legs.x + legs.w, core.x + core.w), Math.max(legs.y + legs.h, core.y + core.h)];
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// What is drawn as the part's body: for parts with leads, the body at the pins' centre without
// the legs (def.body: a radius, or (span) => [half length along the leads, half width]).
export function bodyCore(part) {
  if (part.def.mount !== "leads" || part.offboard) return bodyBox(part);
  const pins = part.pins;
  const cx = pins.reduce((s, p) => s + p.x, 0) / pins.length;
  const cy = pins.reduce((s, p) => s + p.y, 0) / pins.length;
  const [a, b] = [pins[0], pins[pins.length - 1]];
  const span = Math.hypot(b.x - a.x, b.y - a.y);
  const body = typeof part.def.body === "function" ? part.def.body(span) : part.def.body;
  const [hl, hw] = Array.isArray(body) ? body : [Number(body) || 0.45, Number(body) || 0.45];
  const t = Math.atan2(b.y - a.y, b.x - a.x);
  const [c, s] = [Math.abs(Math.cos(t)), Math.abs(Math.sin(t))];
  const [rx, ry] = [hl * c + hw * s, hl * s + hw * c];
  return { x: cx - rx, y: cy - ry, w: 2 * rx, h: 2 * ry };
}

// The drawn body as a shape, for exact checks between parts with leads: { circle: {x, y, r} }
// for round ones (def.body a radius: LED, CdS, capacitor), else { box }.
function bodyShape(part) {
  const leads = part.def.mount === "leads" && !part.offboard;
  const box = bodyCore(part);
  if (leads && typeof part.def.body === "number") return { leads, circle: { x: box.x + box.w / 2, y: box.y + box.h / 2, r: part.def.body } };
  return { leads, box };
}
const distToBox = (p, b) => Math.hypot(Math.max(b.x - p.x, 0, p.x - b.x - b.w), Math.max(b.y - p.y, 0, p.y - b.y - b.h));
// how far a point is from the shape's outline (negative inside)
const distTo = (p, sh) => (sh.circle ? Math.hypot(p.x - sh.circle.x, p.y - sh.circle.y) - sh.circle.r : distToBox(p, sh.box) || -1);
// two bodies of parts with leads drawn on top of each other (touching does not count)
function shapesOverlap(a, b) {
  if (a.circle && b.circle) return Math.hypot(a.circle.x - b.circle.x, a.circle.y - b.circle.y) < a.circle.r + b.circle.r - 0.05;
  if (a.circle || b.circle) {
    const [c, r] = a.circle ? [a.circle, b.box] : [b.circle, a.box];
    return distToBox(c, r) < c.r - 0.05;
  }
  const w = Math.min(a.box.x + a.box.w, b.box.x + b.box.w) - Math.max(a.box.x, b.box.x);
  const h = Math.min(a.box.y + a.box.h, b.box.y + b.box.h) - Math.max(a.box.y, b.box.y);
  return w > 0.05 && h > 0.05;
}

// Holes hidden under part bodies: hole -> part id (its own pins excluded). For parts with leads,
// under the drawn body (a resistor's barrel, an LED's dome), not under the thin legs.
export function coveredBy(result) {
  const map = new Map();
  for (const part of result.parts) {
    const leads = part.def.mount === "leads" && !part.offboard;
    const box = leads ? bodyCore(part) : bodyBox(part);
    const own = new Set(part.pins.map((p) => p.hole));
    for (const [hole, p] of result.board.holes) if (!own.has(hole) && inside(p, box, leads ? 0.1 : 0.25)) map.set(hole, part.id);
  }
  return map;
}

// What happens if `inst` ({ type, at / pins / pos, rot, params... }) is added to `circuit`:
// the hole of each pin, the area its body covers, and clashes with what is already there.
export function previewPlacement(circuit, inst) {
  const base = resolveCircuit(circuit);
  const id = inst.id ?? PREVIEW_ID;
  const trial = resolveCircuit({ ...circuit, parts: [...(circuit.parts ?? []).filter((p) => p.id !== id), { ...inst, id }] });
  const part = trial.parts.find((p) => p.id === id);
  const errors = trial.errors.filter((e) => e.includes(id) && !base.errors.includes(e)).map((e) => e.replaceAll(PREVIEW_ID, "(この部品)"));
  if (!part) return { ok: false, errors };
  const covered = coveredBy(base);
  const pins = part.pins.map((p) => ({
    name: p.name,
    hole: p.hole,
    ...(p.terminal ? { terminal: true } : {}),
    x: r2(p.x),
    y: r2(p.y),
    strip: p.hole ? stripOf(p.hole) : null,
  }));
  const conflicts = [];
  for (const p of pins) {
    if (!p.hole) continue;
    const who = base.occupied.get(p.hole);
    if (who && !who.startsWith(`${id}.`)) conflicts.push(`${p.name}: 穴 ${p.hole} は ${who} が使っています`);
    if (covered.has(p.hole) && covered.get(p.hole) !== id) conflicts.push(`${p.name}: 穴 ${p.hole} は ${covered.get(p.hole)} の本体の下です`);
  }
  // pins of this part that share a strip (and are not meant to be connected inside the part)
  const internal = part.internal.map((group) => new Set(group));
  const shorts = [];
  for (let i = 0; i < pins.length; i++) {
    for (let j = i + 1; j < pins.length; j++) {
      const [a, b] = [pins[i], pins[j]];
      if (!a.strip || a.strip !== b.strip || internal.some((g) => g.has(a.name) && g.has(b.name))) continue;
      shorts.push(`${a.name} と ${b.name} が同じ列 (${a.strip}) でつながってしまいます`);
    }
  }
  const box = bodyBox(part);
  const under = [...trial.board.holes].filter(([h, p]) => inside(p, box, 0.25) && !part.pins.some((q) => q.hole === h));
  const hidden = under.filter(([h]) => base.occupied.has(h)).map(([h]) => `${h} (${base.occupied.get(h)})`);
  const cols = under.map(([h]) => Number(/\d+$/.exec(h)[0]));
  const rows = [...new Set(under.map(([h]) => /^[a-j]|^[TB][+-]/.exec(h)[0]))];
  return {
    ok: !errors.length && !conflicts.length && !shorts.length,
    pins,
    body: { x: r2(box.x), y: r2(box.y), w: r2(box.w), h: r2(box.h), cols: cols.length ? [Math.min(...cols), Math.max(...cols)] : null, rows },
    conflicts,
    hidden: hidden.length ? hidden : undefined,
    shorts,
    errors,
  };
}

// Board coordinates (pitch units) of a hole ("h3", "T-5"), a pin ("U1.D3"), or the nearest hole
// of "x,y".
export function coordsOf(result, ref) {
  const m = /^(-?[\d.]+)\s*,\s*(-?[\d.]+)$/.exec(String(ref));
  if (m) {
    const [x, y] = [Number(m[1]), Number(m[2])];
    let best = null;
    for (const [hole, p] of result.board.holes) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (!best || d < best.d) best = { hole, d, p };
    }
    return { ref, x, y, nearest: best?.hole ?? null, distance: best ? r2(best.d) : null };
  }
  const pos = result.board.pos(ref);
  if (pos) return { ref, x: pos.x, y: pos.y };
  const dot = String(ref).indexOf(".");
  const part = dot > 0 ? result.parts.find((p) => p.id === ref.slice(0, dot)) : null;
  const pin = part?.pins.find((p) => p.name === ref.slice(dot + 1));
  if (pin) return { ref, x: r2(pin.x), y: r2(pin.y), hole: pin.hole };
  const hint = result.board.missingHint(ref);
  return { ref, error: hint ? `このボードに穴 ${ref} はありません。${hint}` : "穴でも部品のピンでも x,y でもありません" };
}

// Shape and settings of a part type with default params (for `parts --json`).
export function partSpec(def) {
  const params = Object.fromEntries(Object.entries(def.params ?? {}).map(([k, s]) => [k, s.default]));
  return {
    type: def.type,
    name: def.name,
    category: def.category,
    description: def.description,
    mount: def.mount,
    params: def.params ?? {},
    pins: def.pins(params).map((p) => ({ name: p.name, x: r2(p.x), y: r2(p.y), ...(p.insert === false ? { insert: false } : {}) })),
    internal: def.internal?.(params) ?? [],
    extent: def.extent,
    states: def.states ?? {},
    roles: def.roles?.(params) ?? {},
  };
}

// Problems only visible in the drawing. Heuristic: boxes are approximate.
export function layoutIssues(result) {
  const out = [];
  // what is drawn as each body (an LED's dome, a resistor's barrel; not the thin legs)
  const bodies = result.parts.map((p) => ({ part: p, box: bodyCore(p), shape: bodyShape(p) }));
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const [a, b] = [bodies[i], bodies[j]];
      // a resistor's barrel against a CdS cell: exact shapes; a module's outline is only approximate
      const hit = a.shape.leads && b.shape.leads ? shapesOverlap(a.shape, b.shape) : overlap(a.box, b.box) > 0.4;
      if (hit) out.push(`${a.part.id} と ${b.part.id} の本体が重なっています`);
    }
  }
  const covered = coveredBy(result);
  for (const w of result.wires) {
    for (const key of ["from", "to"]) {
      const under = covered.get(w[key]);
      if (under) out.push(`${w.id} の端 ${w[key]} が ${under} の本体の下に隠れています`);
    }
  }
  // wires passing right over a hole used by something else
  const used = [...result.occupied].map(([hole, who]) => ({ hole, who, p: result.board.pos(hole) }));
  for (const w of result.wires) {
    const pts = wirePoints(w);
    const ends = [w.a, w.b];
    for (const u of used) {
      if (u.who.startsWith(`${w.id}.`)) continue;
      if (ends.some((e) => Math.hypot(e.x - u.p.x, e.y - u.p.y) < 0.5)) continue;
      if (pts.some((q) => Math.hypot(q.x - u.p.x, q.y - u.p.y) < 0.18)) out.push(`${w.id} が穴 ${u.hole} (${u.who}) の真上を通っています`);
    }
  }
  // bend is a fraction of the wire's length, not a number of holes: 1 bows out as far as the wire is long
  const b = result.board.bounds;
  for (const w of result.wires) {
    const bend = Number(w.bend) || 0;
    if (Math.abs(bend) > 0.5 && !w.kit) out.push(`${w.id} の bend ${bend} が大きすぎます (線の長さに対する割合です。0.1〜0.3 くらいが目安)`);
    if (!result.board.has(w.from) || !result.board.has(w.to)) continue;
    const off = wirePoints(w).some((q) => q.x < b.x - 0.3 || q.x > b.x + b.w + 0.3 || q.y < b.y - 0.3 || q.y > b.y + b.h + 0.3);
    if (off) out.push(`${w.id} がボードの外にはみ出しています (bend / via を確かめてください)`);
  }
  // flexible wires running over a part's body (away from their own ends; a wire to the part's own pin
  // may touch it). An LED's dome or a resistor's barrel counts even when the wire only grazes
  // it (the wire is about 0.23 wide each side); a module's outline is approximate, so only
  // its inner part counts.
  const traces = result.wires.map((w) => ({ w, pts: wirePoints(w, 0.2) }));
  for (const { w, pts } of traces) {
    if (w.kit) continue; // a kit wire lies flat on the board, under the parts (drawn below them)
    for (const { part, box, shape } of bodies) {
      if ([w.from, w.to].some((r) => String(r).startsWith(`${part.id}.`))) continue;
      const away = pts.filter((q) => [w.a, w.b].every((e) => Math.hypot(q.x - e.x, q.y - e.y) > 0.6));
      let over;
      if (shape.leads) over = away.some((q) => distTo(q, shape) < 0.12);
      else {
        const [mx, my] = [Math.min(0.6, box.w * 0.2), Math.min(0.6, box.h * 0.2)];
        over = away.some((q) => inside(q, { x: box.x + mx, y: box.y + my, w: box.w - 2 * mx, h: box.h - 2 * my }));
      }
      if (over) out.push(`${w.id} が ${part.id} の本体の上を通っています (via で避けられます)`);
    }
  }
  // id labels on top of other parts, labels or wires
  const labels = result.parts.map((p) => ({ part: p, box: labelBox(p) })).filter((l) => l.box);
  for (const l of labels) {
    for (const b of bodies) {
      if (b.part !== l.part && overlap(l.box, b.box) > 0.1) out.push(`${l.part.id} のラベルが ${b.part.id} に重なっています (idLabel でずらせます)`);
    }
    for (const m of labels) {
      if (m.part.id > l.part.id && overlap(l.box, m.box) > 0.05) out.push(`${l.part.id} と ${m.part.id} のラベルが重なっています`);
    }
    for (const { w, pts } of traces) {
      if (pts.some((q) => inside(q, l.box, -0.1))) out.push(`${l.part.id} のラベルに ${w.id} が重なっています (idLabel でずらせます)`);
    }
  }
  return [...new Set(out)];
}
