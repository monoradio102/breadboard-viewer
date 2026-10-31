// Renders a resolved circuit (see circuit.js) to an SVG string.
import { EFFECT_CSS, captionTrack, compileCss, cssDecl, initialState, valuesOf } from "./animation.js";
import { rotate } from "./circuit.js";
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

// options:
//   labels    = true       draw part ids
//   embed     = circuit    store the circuit JSON in <metadata> (so the SVG can be re-imported)
//   selection = id         highlight a part or wire and draw its drag handles (editor only)
//   tempWire  = {a, b, color}  a wire being drawn (editor only)
//   animate   = true       include the animation (CSS keyframes); false draws the t=0 state only
export function renderSvg(result, options = {}) {
  const { board } = result;
  const labels = options.labels ?? true;
  const tl = result.timeline;
  const animate = (options.animate ?? true) && tl?.animated;
  const svgId = `bb-${hash(JSON.stringify([result.parts.map((p) => p.inst), result.wires.map((w) => [w.id, w.from, w.to]), tl?.duration]))}`;
  const animEls = [];
  // Per-target drawing context: initial state, and anim(name) -> attributes for an animated element.
  const ctxFor = (id, animateDef, params) => {
    const track = tl.tracks.get(id);
    const values = (name) => valuesOf(track, name);
    const maps = animateDef?.({ params, values }) ?? {};
    const state = initialState(track);
    return {
      state,
      values,
      anim(name) {
        const map = maps[name];
        if (!map) return {};
        if (animate && track.keys.length) animEls.push({ selector: `#${svgId} [data-anim="${cssString(`${id}:${name}`)}"]`, track, map });
        return { "data-anim": `${id}:${name}`, style: cssDecl(map(state)) };
      },
    };
  };

  const pad = 1;
  const b = contentBounds(result);
  const captionH = tl?.captions.length ? 2.2 : 0;
  const vb = [b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2 + captionH];
  const body = [
    g(drawBoard(board), { class: "board" }),
    g(result.parts.map((p) => drawPart(p, ctxFor(p.id, p.def.animate, p.params))).join(""), { class: "parts" }),
    g(result.wires.map((w) => drawWire(w, ctxFor(w.id, wireAnimate))).join(""), { class: "wires" }),
    captionH ? drawCaptions(tl, b, animEls, svgId, animate) : "",
    labels ? g(result.parts.map(drawLabel).join(""), { class: "labels", "pointer-events": "none" }) : "",
    g(drawProblems(result), { class: "problems" }),
    options.selection ? g(drawSelection(result, options.selection), { class: "selection" }) : "",
    options.tempWire ? g(drawTempWire(options.tempWire), { class: "temp-wire", "pointer-events": "none" }) : "",
  ].join("");
  const meta = options.embed
    ? `<metadata id="breadboard-circuit" data-format="breadboard-viewer/v1">${esc(JSON.stringify(options.embed))}</metadata>`
    : "";
  const style = `<style>${EFFECT_CSS}${animate ? compileCss(animEls, tl, svgId) : ""}</style>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" id="${svgId}" viewBox="${vb.map(n).join(" ")}" ` +
    `width="${n(vb[2] * SCALE)}" height="${n(vb[3] * SCALE)}">` +
    meta +
    style +
    body +
    `</svg>`
  );
}

// Board bounds, grown to include parts that declare an `extent` reaching off the board.
function contentBounds(result) {
  const b = result.board.bounds;
  let [x0, y0, x1, y1] = [b.x, b.y, b.x + b.w, b.y + b.h];
  for (const part of result.parts) {
    const e = part.def.extent;
    if (!e || !part.transform) continue;
    const { x, y, rot } = part.transform;
    for (const [cx, cy] of [[e[0], e[1]], [e[2], e[1]], [e[0], e[3]], [e[2], e[3]]]) {
      const [dx, dy] = rotate(cx, cy, rot);
      x0 = Math.min(x0, x + dx);
      y0 = Math.min(y0, y + dy);
      x1 = Math.max(x1, x + dx);
      y1 = Math.max(y1, y + dy);
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const wireAnimate = () => ({ flow: (s) => ({ opacity: s.flow ? 1 : 0 }) });

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const cssString = (s) => String(s).replace(/["\\]/g, "\\$&");

function drawCaptions(tl, b, animEls, svgId, animate) {
  const track = captionTrack(tl.captions);
  const state = initialState(track);
  const y = b.y + b.h + 1.6;
  return g(
    tl.captions
      .map((c, i) => {
        const map = (s) => ({ opacity: Number(s.caption) === i ? 1 : 0 });
        if (animate) animEls.push({ selector: `#${svgId} [data-anim="caption:${i}"]`, track, map });
        return text(b.x + b.w / 2, y, c.text, {
          "font-size": 0.8,
          fill: "#263238",
          "text-anchor": "middle",
          "dominant-baseline": "central",
          "data-anim": `caption:${i}`,
          style: cssDecl(map(state)),
        });
      })
      .join(""),
    { class: "captions", "pointer-events": "none" },
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

function drawPart(part, ctx) {
  const attrs = { class: "part", "data-id": part.id, "data-type": part.type };
  if (part.def.mount === "leads") {
    return g(part.def.render({ ...ctx, pins: part.pins, params: part.params, inst: part.inst }), attrs);
  }
  const t = part.transform;
  const local = part.def.pins(part.params);
  return g(part.def.render({ ...ctx, pins: local, params: part.params, inst: part.inst }), {
    ...attrs,
    transform: `translate(${n(t.x)} ${n(t.y)}) rotate(${t.rot})`,
  });
}

function drawWire(w, ctx) {
  const color = WIRE_COLORS[w.color] ?? w.color ?? WIRE_COLORS.blue;
  const pts = [w.a, ...w.via, w.b].map((p) => `${n(p.x)},${n(p.y)}`).join(" ");
  const common = { points: pts, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" };
  const flows = ctx.state.flow || ctx.values("flow").includes("true");
  // the timeline toggles the group; the dashes inside run their own endless animation
  const flow = flows
    ? g(tag("polyline", { ...common, stroke: "#fff", "stroke-width": 0.14, "stroke-dasharray": "0.3 0.5", class: "bb-flow" }), {
        "pointer-events": "none",
        ...ctx.anim("flow"),
      })
    : "";
  return g(
    tag("polyline", { ...common, stroke: "rgba(0,0,0,.35)", "stroke-width": 0.36 }) +
      tag("polyline", { ...common, stroke: color, "stroke-width": 0.26 }) +
      flow +
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

const ACCENT = "#1e6fd9";

function handle(x, y, owner, name) {
  return circle(x, y, 0.32, {
    fill: "rgba(255,255,255,.85)",
    stroke: ACCENT,
    "stroke-width": 0.08,
    "data-handle": name,
    "data-owner": owner,
    style: "cursor:grab",
  });
}

function drawSelection(result, id) {
  const part = result.parts.find((p) => p.id === id);
  if (part) {
    const xs = part.pins.map((p) => p.x);
    const ys = part.pins.map((p) => p.y);
    const m = 0.75;
    const box = rect(Math.min(...xs) - m, Math.min(...ys) - m, Math.max(...xs) - Math.min(...xs) + 2 * m, Math.max(...ys) - Math.min(...ys) + 2 * m, {
      fill: "none",
      stroke: ACCENT,
      "stroke-width": 0.08,
      "stroke-dasharray": "0.3 0.2",
      rx: 0.2,
      "pointer-events": "none",
    });
    const handles = part.def.mount === "leads" ? part.pins.map((p) => handle(p.x, p.y, part.id, `pin:${p.name}`)).join("") : "";
    return box + handles;
  }
  const wire = result.wires.find((w) => w.id === id);
  if (wire) {
    const pts = [wire.a, ...wire.via, wire.b].map((p) => `${n(p.x)},${n(p.y)}`).join(" ");
    return (
      tag("polyline", { points: pts, fill: "none", stroke: ACCENT, "stroke-width": 0.12, "stroke-dasharray": "0.3 0.2", "pointer-events": "none" }) +
      handle(wire.a.x, wire.a.y, wire.id, "from") +
      handle(wire.b.x, wire.b.y, wire.id, "to")
    );
  }
  return "";
}

function drawTempWire({ a, b, color }) {
  const c = WIRE_COLORS[color] ?? color ?? WIRE_COLORS.blue;
  return (
    line(a.x, a.y, b.x, b.y, { stroke: c, "stroke-width": 0.26, "stroke-linecap": "round", opacity: 0.8 }) +
    circle(a.x, a.y, 0.18, { fill: c }) +
    circle(b.x, b.y, 0.18, { fill: c })
  );
}
