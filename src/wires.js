// Wire geometry, shared by the renderer and the checks. No DOM, no imports.
import { n } from "./svg.js";

// Jumper wire kits color their wires by length, in the resistor color code order of the
// length in pitches (2 red, 3 orange, … 10 brown, 20 red …); a 1-pitch wire is bare.
// Kits differ, so this is only the usual scheme.
export const KIT_COLORS = ["bare", "brown", "red", "orange", "yellow", "green", "blue", "purple", "gray", "white"];
export const KIT_COLOR_NAMES = { bare: "裸線", brown: "茶", red: "赤", orange: "橙", yellow: "黄", green: "緑", blue: "青", purple: "紫", gray: "灰", white: "白" };
export const KIT_LENGTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50];

export function kitColor(length) {
  if (length <= 1) return "bare";
  return KIT_COLORS[Number(String(Math.round(length))[0])];
}

// Route of a kit wire: flat on the board, through the via points, turning at right angles.
// A diagonal step turns once: across first (elbow "h", the default) or down first ("v").
export function kitRoute(w) {
  const pts = [w.a];
  const eq = (u, v) => Math.abs(u - v) < 1e-6;
  for (const q of [...w.via, w.b]) {
    const p = pts.at(-1);
    if (!eq(p.x, q.x) && !eq(p.y, q.y)) pts.push(w.elbow === "v" ? { x: p.x, y: q.y } : { x: q.x, y: p.y });
    pts.push(q);
  }
  // drop repeated points and the middle of straight runs
  const out = [];
  for (const p of pts) {
    if (out.length && eq(out.at(-1).x, p.x) && eq(out.at(-1).y, p.y)) continue;
    const [a, b] = out.slice(-2);
    if (b && ((eq(a.x, b.x) && eq(b.x, p.x)) || (eq(a.y, b.y) && eq(b.y, p.y)))) out.pop();
    out.push(p);
  }
  return out.length > 1 ? out : [w.a, w.b];
}

const segLength = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);

// Kit wire facts for the parts list: length in pitches, color, number of bends.
export function kitInfo(w) {
  const route = kitRoute(w);
  const length = Math.round(segLength(route) * 2) / 2;
  const color = kitColor(length);
  return { id: w.id, length, color, colorName: KIT_COLOR_NAMES[color], bends: route.length - 2, inKit: KIT_LENGTHS.includes(length) };
}

// Polyline with its ends cut back by d0 / d1 (for the insulation of a kit wire); null if nothing is left.
export function trimRoute(pts, d0, d1) {
  const total = segLength(pts);
  if (total - d0 - d1 <= 0.05) return null;
  const at = (d) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      if (d <= len || i === pts.length - 2) {
        const t = len ? Math.min(1, d / len) : 0;
        return { i, p: { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t } };
      }
      d -= len;
    }
  };
  const s = at(d0);
  const e = at(total - d1);
  return [s.p, ...pts.slice(s.i + 1, e.i + 1), e.p];
}

// Path through right-angle points with the corners rounded (radius r, smaller on short runs).
export function roundedPath(pts, r = 0.3) {
  let d = `M ${n(pts[0].x)} ${n(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [p, c, q] = [pts[i - 1], pts[i], pts[i + 1]];
    const l1 = Math.hypot(c.x - p.x, c.y - p.y);
    const l2 = Math.hypot(q.x - c.x, q.y - c.y);
    const k = Math.min(r, l1 / 2, l2 / 2);
    const a = { x: c.x - ((c.x - p.x) / l1) * k, y: c.y - ((c.y - p.y) / l1) * k };
    const b = { x: c.x + ((q.x - c.x) / l2) * k, y: c.y + ((q.y - c.y) / l2) * k };
    d += ` L ${n(a.x)} ${n(a.y)} Q ${n(c.x)} ${n(c.y)} ${n(b.x)} ${n(b.y)}`;
  }
  return `${d} L ${n(pts.at(-1).x)} ${n(pts.at(-1).y)}`;
}

// Shape of a wire: straight segments through the via points, or (shape: "curve") a
// Catmull-Rom spline through them. `bend` bows a plain wire sideways by that fraction of its
// length: positive values bow to the right of the from → to direction (as seen on screen).
// Kit wires (w.kit) follow kitRoute.
function wireGeometry(w) {
  if (w.kit) return { lines: kitRoute(w), kit: true };
  let pts = [w.a, ...w.via, w.b];
  const bend = Number(w.bend) || 0;
  const curve = w.shape === "curve" || (bend && pts.length === 2);
  if (bend && pts.length === 2) {
    const dx = w.b.x - w.a.x;
    const dy = w.b.y - w.a.y;
    pts = [w.a, { x: (w.a.x + w.b.x) / 2 - dy * bend, y: (w.a.y + w.b.y) / 2 + dx * bend }, w.b];
  }
  if (!curve || pts.length < 3) return { lines: pts };
  const beziers = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    beziers.push([p1, c1, c2, p2]);
  }
  return { beziers };
}

export function wirePath(w) {
  const geo = wireGeometry(w);
  if (geo.kit) return roundedPath(geo.lines);
  if (geo.lines) return `M ${geo.lines.map((p) => `${n(p.x)} ${n(p.y)}`).join(" L ")}`;
  const [first] = geo.beziers[0];
  return `M ${n(first.x)} ${n(first.y)}${geo.beziers.map(([, c1, c2, p2]) => ` C ${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(p2.x)} ${n(p2.y)}`).join("")}`;
}

// Points along a wire (for layout checks), about `step` pitch units apart.
export function wirePoints(w, step = 0.2) {
  const geo = wireGeometry(w);
  const out = [];
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  if (geo.lines) {
    for (let i = 0; i < geo.lines.length - 1; i++) {
      const [a, b] = [geo.lines[i], geo.lines[i + 1]];
      const k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
      for (let j = 0; j < k; j++) out.push(lerp(a, b, j / k));
    }
    out.push(geo.lines.at(-1));
    return out;
  }
  for (const [p1, c1, c2, p2] of geo.beziers) {
    const k = Math.max(4, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / step) * 2);
    for (let j = 0; j < k; j++) {
      const t = j / k;
      const u = 1 - t;
      out.push({
        x: u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x,
        y: u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y,
      });
    }
  }
  out.push(geo.beziers.at(-1)[3]);
  return out;
}
