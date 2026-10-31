// Shared drawing helpers for built-in parts.
import { g, line, n, rect, text } from "../svg.js";

export const LEAD = "#9aa3ab";
export const PIN_METAL = "#c9a74a";

export function leg(a, b, w = 0.12) {
  return line(a.x, a.y, b.x, b.y, { stroke: LEAD, "stroke-width": w, "stroke-linecap": "round" });
}

export function centroid(pts) {
  const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return { x, y };
}

// Places `inner` (drawn around the origin, along +x) on the axis from a to b.
export function onAxis(a, b, inner) {
  return place({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, angle(a, b), inner);
}

export function place(c, deg, inner) {
  return g(inner, { transform: `translate(${n(c.x)} ${n(c.y)}) rotate(${n(deg)})` });
}

export const angle = (a, b) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Pins of a dual-row package (DIP, module), counter-clockwise from pin 1 at the origin.
// Row 1 runs along y = 0 toward +x, row 2 runs back along y = -width.
export function dualRow(count, width, names) {
  const half = count / 2;
  const pins = [];
  for (let i = 0; i < count; i++) {
    const x = i < half ? i : count - 1 - i;
    const y = i < half ? 0 : -width;
    pins.push({ name: names?.[i] ?? String(i + 1), x, y });
  }
  return pins;
}

export function inline(names) {
  return names.map((name, i) => ({ name, x: i, y: 0 }));
}

// Pin name labels for modules (rotated so they fit a 2.54 mm pitch).
export function pinLabels(pins, width, color = "#fff") {
  return pins
    .map((p) => {
      const bottom = p.y === 0;
      const y = bottom ? -0.62 : -width + 0.62;
      return text(p.x, y, p.name, {
        "font-size": 0.36,
        fill: color,
        "text-anchor": bottom ? "start" : "end",
        "dominant-baseline": "central",
        transform: `rotate(-90 ${n(p.x)} ${n(y)})`,
      });
    })
    .join("");
}

export function headerPins(pins) {
  return pins.map((p) => rect(p.x - 0.18, p.y - 0.18, 0.36, 0.36, { fill: PIN_METAL, rx: 0.05 })).join("");
}

// ---- resistor color code ----
const COLORS = ["#111", "#7b4a24", "#d32f2f", "#f57c00", "#fbc02d", "#388e3c", "#1565c0", "#7b1fa2", "#9e9e9e", "#fafafa"];
const GOLD = "#c9a227";
const SILVER = "#b0b0b0";

export function parseOhms(value) {
  const s = String(value).trim().replace(/[ΩΩ]|ohms?$/gi, "").trim();
  let m = /^(\d+)([RKkMm])(\d+)$/.exec(s); // 4k7, 2R2
  if (m) return Number(`${m[1]}.${m[3]}`) * mult(m[2]);
  m = /^(\d+(?:\.\d+)?)\s*([RKkMm]?)$/.exec(s);
  if (m) return Number(m[1]) * mult(m[2]);
  return null;
}

function mult(c) {
  return { "": 1, R: 1, k: 1e3, K: 1e3, m: 1e6, M: 1e6 }[c] ?? 1;
}

export function bandColors(ohms) {
  if (!ohms || ohms <= 0) return null;
  let exp = Math.floor(Math.log10(ohms)) - 1;
  let digits = Math.round(ohms / 10 ** exp);
  if (digits >= 100) {
    digits = Math.round(digits / 10);
    exp += 1;
  }
  const d1 = Math.floor(digits / 10);
  const d2 = digits % 10;
  const m = exp === -1 ? GOLD : exp === -2 ? SILVER : COLORS[exp];
  if (m === undefined) return null;
  return [COLORS[d1], COLORS[d2], m, GOLD];
}
