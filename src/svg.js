// Small helpers for building SVG strings. Works the same in the browser and in Node.

export function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function n(v) {
  return Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : "0";
}

export function attrs(obj) {
  let out = "";
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === false) continue;
    out += ` ${k}="${typeof v === "number" ? n(v) : esc(v)}"`;
  }
  return out;
}

export const tag = (name, a, inner) =>
  inner === undefined ? `<${name}${attrs(a)}/>` : `<${name}${attrs(a)}>${inner}</${name}>`;

export const rect = (x, y, w, h, a = {}) => tag("rect", { x, y, width: w, height: h, ...a });
export const circle = (cx, cy, r, a = {}) => tag("circle", { cx, cy, r, ...a });
export const line = (x1, y1, x2, y2, a = {}) => tag("line", { x1, y1, x2, y2, ...a });
export const text = (x, y, s, a = {}) =>
  tag("text", { x, y, "font-family": "sans-serif", ...a }, esc(s));
export const g = (inner, a = {}) => tag("g", a, inner);

// Declarative shapes used by JSON part definitions (see docs/FORMAT.md).
// { "type": "rect" | "circle" | "line" | "polygon" | "path" | "text", ...geometry, fill, stroke, strokeWidth, opacity }
export function shapesToSvg(shapes = []) {
  return shapes.map(shapeToSvg).join("");
}

function style(s, defaults) {
  return {
    fill: s.fill ?? defaults.fill,
    stroke: s.stroke ?? defaults.stroke,
    "stroke-width": s.strokeWidth ?? (s.stroke ? 0.06 : undefined),
    opacity: s.opacity,
    rx: undefined,
  };
}

function shapeToSvg(s) {
  switch (s.type) {
    case "rect":
      return rect(s.x, s.y, s.w, s.h, { ...style(s, { fill: "#333" }), rx: s.r });
    case "circle":
      return circle(s.cx, s.cy, s.r, style(s, { fill: "#333" }));
    case "line":
      return line(s.x1, s.y1, s.x2, s.y2, {
        ...style(s, { stroke: "#333" }),
        "stroke-width": s.strokeWidth ?? 0.1,
        "stroke-linecap": "round",
      });
    case "polygon":
      return tag("polygon", {
        points: (s.points ?? []).map(([x, y]) => `${n(x)},${n(y)}`).join(" "),
        ...style(s, { fill: "#333" }),
      });
    case "path":
      return tag("path", { d: s.d, ...style(s, { fill: "none", stroke: "#333" }) });
    case "text":
      return text(s.x, s.y, s.text ?? "", {
        "font-size": s.size ?? 0.6,
        "text-anchor": s.anchor ?? "middle",
        "dominant-baseline": "central",
        fill: s.fill ?? "#fff",
        "font-weight": s.bold ? "bold" : undefined,
      });
    default:
      return "";
  }
}
