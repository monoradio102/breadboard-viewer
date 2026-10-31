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
// bendable leads only the strip between their pins.
export function bodyBox(part) {
  return part.def.mount === "leads" && !part.offboard ? partBox(part, 0.45) : partBox(part, 0.6);
}

// Holes hidden under rigid / off-board part bodies: hole -> part id (its own pins excluded).
function coveredBy(result) {
  const map = new Map();
  for (const part of result.parts) {
    if (part.def.mount === "leads" && !part.offboard) continue;
    const box = bodyBox(part);
    const own = new Set(part.pins.map((p) => p.hole));
    for (const [hole, p] of result.board.holes) if (!own.has(hole) && inside(p, box, 0.25)) map.set(hole, part.id);
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
  return { ref, error: "穴でも部品のピンでも x,y でもありません" };
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
  const bodies = result.parts.map((p) => ({ part: p, box: bodyBox(p) }));
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const [a, b] = [bodies[i], bodies[j]];
      if (overlap(a.box, b.box) > 0.4) out.push(`${a.part.id} と ${b.part.id} の本体が重なっています`);
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
  // id labels on top of other parts or labels
  const labels = result.parts.map((p) => ({ part: p, box: labelBox(p) })).filter((l) => l.box);
  for (const l of labels) {
    for (const b of bodies) {
      if (b.part !== l.part && overlap(l.box, b.box) > 0.1) out.push(`${l.part.id} のラベルが ${b.part.id} に重なっています (idLabel でずらせます)`);
    }
    for (const m of labels) {
      if (m.part.id > l.part.id && overlap(l.box, m.box) > 0.05) out.push(`${l.part.id} と ${m.part.id} のラベルが重なっています`);
    }
  }
  return [...new Set(out)];
}
