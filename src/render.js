// Renders a resolved circuit (see circuit.js) to an SVG string.
import { circle, esc, g, line, n, rect, tag, text } from "./svg.js";

export const SCALE = 24; // px per pitch unit for the default SVG size

export const WIRE_COLORS = {
  red: "#e53935",
  black: "#263238",
  blue: "#1e88e5",
  green: "#43a047",
  yellow: "#fdd835",
  orange: "#fb8c00",
  white: "#f5f5f5",
  purple: "#8e24aa",
  gray: "#9e9e9e",
  brown: "#795548",
};

// options: { labels = true, embed = circuit object to store in <metadata> }
export function renderSvg(result, options = {}) {
  const { board } = result;
  const labels = options.labels ?? true;
  const pad = 1;
  const b = board.bounds;
  const vb = [b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2];
  const body = [
    g(drawBoard(board), { class: "board" }),
    g(result.parts.map((p) => drawPart(p)).join(""), { class: "parts" }),
    g(result.wires.map(drawWire).join(""), { class: "wires" }),
    labels ? g(result.parts.map(drawLabel).join(""), { class: "labels" }) : "",
    g(drawProblems(result), { class: "problems" }),
  ].join("");
  const meta = options.embed
    ? `<metadata id="breadboard-circuit" data-format="breadboard-viewer/v1">${esc(JSON.stringify(options.embed))}</metadata>`
    : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map(n).join(" ")}" ` +
    `width="${n(vb[2] * SCALE)}" height="${n(vb[3] * SCALE)}">` +
    meta +
    body +
    `</svg>`
  );
}

function drawBoard(board) {
  const b = board.bounds;
  const out = [rect(b.x, b.y, b.w, b.h, { rx: 0.4, fill: "#f3efe6", stroke: "#d3ccbc", "stroke-width": 0.06 })];
  const left = 1.2;
  const right = board.cols + 1.8;
  if (board.rails) {
    const first = board.railCols[0] + 1 - 0.6;
    const last = board.railCols[board.railCols.length - 1] + 1 + 0.6;
    const stripe = (y, c) => line(first, y, last, y, { stroke: c, "stroke-width": 0.08 });
    out.push(stripe(0.45, "#e53935"), stripe(2.55, "#1e88e5"), stripe(16.45, "#e53935"), stripe(18.55, "#1e88e5"));
    const sign = (x, y, s, c) => text(x, y, s, { "font-size": 0.6, fill: c, "text-anchor": "middle", "dominant-baseline": "central", "font-weight": "bold" });
    for (const x of [first - 0.5, last + 0.5]) {
      out.push(sign(x, 1, "+", "#e53935"), sign(x, 2, "−", "#1e88e5"), sign(x, 17, "+", "#e53935"), sign(x, 18, "−", "#1e88e5"));
    }
  }
  out.push(rect(left, 9.15, right - left, 0.7, { fill: "#e4ded0", rx: 0.2 }));
  const small = { "font-size": 0.42, fill: "#9a9384", "text-anchor": "middle", "dominant-baseline": "central" };
  for (let col = 1; col <= board.cols; col++) {
    if (col === 1 || col % 5 === 0) {
      out.push(text(col + 1, 3.1, String(col), small), text(col + 1, 15.9, String(col), small));
    }
  }
  for (const [row, y] of Object.entries(board.rowY)) {
    out.push(text(0.85, y, row, small), text(board.cols + 2.15, y, row, small));
  }
  for (const [id, p] of board.holes) {
    out.push(rect(p.x - 0.22, p.y - 0.22, 0.44, 0.44, { rx: 0.07, fill: "#5d5a52", "data-hole": id }));
  }
  return out.join("");
}

function drawPart(part) {
  const attrs = { class: "part", "data-id": part.id, "data-type": part.type };
  if (part.def.mount === "leads") {
    return g(part.def.render({ pins: part.pins, params: part.params, inst: part.inst }), attrs);
  }
  const t = part.transform;
  const local = part.def.pins(part.params);
  return g(part.def.render({ pins: local, params: part.params, inst: part.inst }), {
    ...attrs,
    transform: `translate(${n(t.x)} ${n(t.y)}) rotate(${t.rot})`,
  });
}

function drawWire(w) {
  const color = WIRE_COLORS[w.color] ?? w.color ?? WIRE_COLORS.blue;
  const pts = [w.a, ...w.via, w.b].map((p) => `${n(p.x)},${n(p.y)}`).join(" ");
  const common = { points: pts, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" };
  return g(
    tag("polyline", { ...common, stroke: "rgba(0,0,0,.35)", "stroke-width": 0.36 }) +
      tag("polyline", { ...common, stroke: color, "stroke-width": 0.26 }) +
      circle(w.a.x, w.a.y, 0.13, { fill: "#a7adb3" }) +
      circle(w.b.x, w.b.y, 0.13, { fill: "#a7adb3" }),
    { class: "wire", "data-id": w.id, "data-from": w.from, "data-to": w.to },
  );
}

function drawLabel(part) {
  const xs = part.pins.map((p) => p.x);
  const ys = part.pins.map((p) => p.y);
  const x = part.def.mount === "leads" ? xs.reduce((a, b) => a + b, 0) / xs.length : Math.min(...xs);
  const y = part.def.mount === "leads" ? ys.reduce((a, b) => a + b, 0) / ys.length - 1.25 : Math.min(...ys) - 0.95;
  return text(x, y, part.id, {
    "font-size": 0.5,
    "font-weight": "bold",
    fill: "#263238",
    stroke: "#fff",
    "stroke-width": 0.14,
    "paint-order": "stroke",
    "text-anchor": part.def.mount === "leads" ? "middle" : "start",
    "dominant-baseline": "central",
  });
}

function drawProblems(result) {
  const out = [];
  for (const part of result.parts) {
    for (const p of part.pins) {
      if (!p.hole) out.push(circle(p.x, p.y, 0.35, { fill: "none", stroke: "#d50000", "stroke-width": 0.1 }));
    }
  }
  return out.join("");
}
