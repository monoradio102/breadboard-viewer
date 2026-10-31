// Assembly steps: parts start laid out in a tray below the board and move into place step by
// step; wires are drawn in. Everything is a function of time, so the same plan drives the
// animated SVG (CSS keyframes), still frames, the editor's player and PNG sequences.
//
// circuit.steps = [ { "text": "Arduino Nano を挿す", "items": ["U1"] }, { "text": "...", "items": ["R1", "W1"] } ]
// Items are part, wire or overlay ids. Anything not listed is in place from the start.
import { rotate } from "./circuit.js";

export const TIMING = { intro: 1500, step: 2400, lead: 200, move: 900, draw: 800, outro: 2500 };

// Default steps: modules / ICs first, then the other parts, then wires a few at a time.
export function autoSteps(result) {
  const steps = [];
  const where = (p) => {
    if (p.offboard) return "ボードの外";
    const holes = p.pins.map((x) => x.hole).filter(Boolean);
    if (p.def.mount === "rigid") return `${holes[0]} (1番ピン)`;
    return holes.length > 2 ? holes.join(", ") : holes.join(" 〜 ");
  };
  const big = result.parts.filter((p) => p.def.mount === "rigid" && p.pins.length >= 6);
  const rest = result.parts.filter((p) => !big.includes(p));
  for (const p of [...big, ...rest]) steps.push({ text: `${p.def.name} (${p.id}) を ${where(p)} に置く`, items: [p.id] });
  for (let i = 0; i < result.wires.length; i += 3) {
    const group = result.wires.slice(i, i + 3);
    steps.push({ text: `配線: ${group.map((w) => `${w.from} → ${w.to}`).join(", ")}`, items: group.map((w) => w.id) });
  }
  for (const o of result.overlays ?? []) steps.push({ text: o.note ?? `${o.id} を表示`, items: [o.id] });
  return steps;
}

// settings = circuit.assembly (all optional):
//   tray:        { "<partId>": [x, y] }   tray position of the part's first pin (like `pos`)
//   trayOrigin:  [x, y]                   where automatic tray layout starts (default: below everything)
//   trayWidth:   number                   row width of the automatic layout
//   timing:      { intro, step, lead, move, draw, outro }   ms (see TIMING)
//   introText / outroText / numbering
// A step may set its own `duration` (ms).
export function planAssembly(result, steps = result.steps?.length ? result.steps : autoSteps(result)) {
  const settings = result.assembly ?? {};
  const T = { ...TIMING, ...pickNumbers(settings.timing) };
  const stepOf = new Map();
  steps.forEach((s, i) => (s.items ?? []).forEach((id) => stepOf.has(id) || stepOf.set(id, i + 1)));
  const lengths = steps.map((s) => (Number(s.duration) > 0 ? Number(s.duration) : T.step));
  const starts = [T.intro];
  for (const len of lengths) starts.push(starts[starts.length - 1] + len);
  const start = (i) => starts[Math.max(0, Math.min(steps.length, i - 1))]; // i is 1-based; steps.length + 1 = the end
  const length = (i) => lengths[i - 1] ?? T.step;
  const duration = starts[steps.length] + T.outro;

  // final bounding box of each part's drawing (approximate: pins, extent, label room)
  const boxes = new Map();
  for (const p of result.parts) {
    const pad = p.def.mount === "leads" ? 1.3 : 0.9;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    const add = (x, y) => {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    };
    for (const pin of p.pins) {
      add(pin.x - pad, pin.y - pad);
      add(pin.x + pad, pin.y + pad);
    }
    const e = p.def.extent;
    if (e && p.transform) {
      for (const [cx, cy] of [[e[0], e[1]], [e[2], e[3]], [e[0], e[3]], [e[2], e[1]]]) {
        const [dx, dy] = rotate(cx, cy, p.transform.rot);
        add(p.transform.x + dx, p.transform.y + dy);
      }
    }
    boxes.set(p.id, { x: x0, y: y0 - 1, w: x1 - x0, h: y1 - y0 + 1 });
  }

  // tray: parts placed in a step start here. Fixed positions from settings.tray (first pin),
  // the rest in rows below everything else, in step order.
  const b = result.board.bounds;
  let bottom = b.y + b.h;
  for (const box of boxes.values()) bottom = Math.max(bottom, box.y + box.h);
  const fixed = settings.tray && typeof settings.tray === "object" ? settings.tray : {};
  const [ox, oy] = isPoint(settings.trayOrigin) ? settings.trayOrigin : [b.x, bottom + 2.5];
  const rowWidth = Number(settings.trayWidth) > 0 ? Number(settings.trayWidth) : Math.max(b.w, 40);
  const offsets = new Map();
  const trayPos = new Map(); // tray position of each part's first pin
  const trayBoxes = new Map(); // approximate drawing box of each part in the tray
  let x = ox;
  let y = oy;
  let rowH = 0;
  let trayBounds = null;
  const trayParts = result.parts.filter((p) => stepOf.has(p.id)).sort((p, q) => stepOf.get(p.id) - stepOf.get(q.id));
  for (const p of trayParts) {
    const box = boxes.get(p.id);
    let dx;
    let dy;
    if (isPoint(fixed[p.id])) {
      dx = fixed[p.id][0] - p.pins[0].x;
      dy = fixed[p.id][1] - p.pins[0].y;
    } else {
      if (x > ox && x + box.w > ox + rowWidth) {
        x = ox;
        y += rowH + 1.5;
        rowH = 0;
      }
      dx = x - box.x;
      dy = y - box.y;
      x += box.w + 1.5;
      rowH = Math.max(rowH, box.h);
    }
    offsets.set(p.id, { dx, dy });
    trayPos.set(p.id, [round(p.pins[0].x + dx), round(p.pins[0].y + dy)]);
    trayBoxes.set(p.id, { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h });
    trayBounds = union(trayBounds, trayBoxes.get(p.id));
  }

  const number = (i) => (settings.numbering === false ? "" : `${i}. `);
  const captions = [
    { t: 0, text: settings.introText ?? "部品を並べる" },
    ...steps.map((s, i) => ({ t: start(i + 1), text: `${number(i + 1)}${s.text ?? ""}` })),
    { t: start(steps.length + 1), text: settings.outroText ?? "完成" },
  ];
  return {
    T,
    steps,
    stepOf,
    boxes,
    offsets,
    trayPos,
    trayBoxes,
    trayBounds,
    duration,
    captions,
    start,
    length,
    // a moment that shows step k done, its parts still highlighted (0 = everything in the tray)
    timeOfStep: (k) =>
      k <= 0 ? Math.max(0, T.intro - 100) : start(Math.min(k, steps.length)) + Math.min(length(Math.min(k, steps.length)) - 150, T.lead + Math.max(T.move, T.draw) + 300),
    stepAt: (t) => {
      let k = 0;
      while (k < steps.length && t >= starts[k]) k++;
      return k;
    },
  };
}

const ease = (f) => (f <= 0 ? 0 : f >= 1 ? 1 : f * f * (3 - 2 * f));
const round = (v) => Math.round(v * 1000) / 1000;
const isPoint = (v) => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);

function pickNumbers(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) if (k in TIMING && Number(v) >= 0) out[k] = Number(v);
  return out;
}

// Placement of a part at time t: offset from its final position (0 once placed).
export function offsetAt(plan, id, t) {
  const o = plan.offsets.get(id);
  if (!o) return { dx: 0, dy: 0 };
  const s = plan.start(plan.stepOf.get(id)) + plan.T.lead;
  const k = 1 - ease((t - s) / plan.T.move);
  return { dx: o.dx * k, dy: o.dy * k };
}

// How much of a wire (or overlay) is drawn at time t (0..1); items without a step are drawn.
export function drawnAt(plan, id, t) {
  if (!plan.stepOf.has(id)) return 1;
  const s = plan.start(plan.stepOf.get(id)) + plan.T.lead;
  return ease((t - s) / plan.T.draw);
}

// Highlight of an item during its own step (0..1).
export function highlightAt(plan, id, t) {
  if (!plan.stepOf.has(id)) return 0;
  const i = plan.stepOf.get(id);
  const end = plan.length(i) - 150;
  const local = t - plan.start(i);
  if (local < 0 || local > end) return 0;
  return Math.min(1, local / 200, (end - local) / 300);
}

// CSS keyframes for one element: `css(t)` is sampled at the given times (ms).
export function keyframesCss(name, selector, times, css, duration) {
  const frames = [...new Set(times.map((t) => Math.max(0, Math.min(duration, Math.round(t)))))].sort((a, b) => a - b);
  const body = frames.map((t) => `${Math.round((t / duration) * 100000) / 1000}%{${css(t)}}`).join("");
  return `@keyframes ${name}{${body}}${selector}{animation:${name} ${duration}ms linear infinite both}`;
}

// sample times for a transition starting at s and lasting d (eased motion needs several samples)
export function rampTimes(s, d, n = 8) {
  return [0, s - 1, ...Array.from({ length: n + 1 }, (_, i) => s + (d * i) / n)];
}

function union(a, b) {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
