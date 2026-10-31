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
// extra(shape) may return additional attributes for a shape (used for animated shapes).
export function shapesToSvg(shapes = [], extra = () => ({})) {
  return shapes.map((s) => shapeToSvg(s, extra(s) ?? {})).join("");
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

function shapeToSvg(s, extra) {
  switch (s.type) {
    case "rect":
      return rect(s.x, s.y, s.w, s.h, { ...style(s, { fill: "#333" }), rx: s.r, ...extra });
    case "circle":
      return circle(s.cx, s.cy, s.r, { ...style(s, { fill: "#333" }), ...extra });
    case "line":
      return line(s.x1, s.y1, s.x2, s.y2, {
        ...style(s, { stroke: "#333" }),
        "stroke-width": s.strokeWidth ?? 0.1,
        "stroke-linecap": "round",
        ...extra,
      });
    case "polygon":
      return tag("polygon", {
        points: (s.points ?? []).map(([x, y]) => `${n(x)},${n(y)}`).join(" "),
        ...style(s, { fill: "#333" }),
        ...extra,
      });
    case "path":
      return tag("path", { d: s.d, ...style(s, { fill: "none", stroke: "#333" }), ...extra });
    case "text":
      return text(s.x, s.y, s.text ?? "", {
        "font-size": s.size ?? 0.6,
        "text-anchor": s.anchor ?? "middle",
        "dominant-baseline": "central",
        fill: s.fill ?? "#fff",
        "font-weight": s.bold ? "bold" : undefined,
        ...extra,
      });
    default:
      return "";
  }
}

// ---- user-supplied SVG ("sprites" / overlays) ----
// Arbitrary SVG from a circuit file (possibly from a share URL) is never inlined: it is drawn
// through <image href="data:..."> so the browser treats it as an image — scripts do not run
// and nothing external is loaded — while its own CSS / SMIL animations still play.

export const MAX_SPRITE_SVG = 200_000;

export function spriteError(svg) {
  if (typeof svg !== "string" || !/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/.test(svg)) return "svg は <svg ...> で始まる文字列です";
  if (svg.length > MAX_SPRITE_SVG) return `svg が大きすぎます (${MAX_SPRITE_SVG} 文字まで)`;
  return null;
}

export function svgDataUri(svg) {
  const withNs = /<svg[^>]*\sxmlns=/.test(svg) ? svg : svg.replace(/<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withNs)}`;
}

// <image> showing user SVG in the box x, y, w, h (in the current user units).
export function spriteImage({ svg, x, y, w, h, fit }, extra = {}) {
  return tag("image", {
    href: svgDataUri(svg),
    x,
    y,
    width: w,
    height: h,
    preserveAspectRatio: fit === "stretch" ? "none" : "xMidYMid meet",
    ...extra,
  });
}
