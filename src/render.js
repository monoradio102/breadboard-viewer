// Renders a resolved circuit (see circuit.js) to an SVG string.
import { EFFECT_CSS, captionTrack, compileCss, cssDecl, initialState, stateAtTime, stillEffectCss, valuesOf } from "./animation.js";
import { drawnAt, highlightAt, keyframesCss, offsetAt, planAssembly, rampTimes } from "./assembly.js";
import { rotate } from "./circuit.js";
import { attrs, circle, esc, g, line, n, rect, spriteImage, tag, text } from "./svg.js";
import { kitInfo, kitRoute, roundedPath, trimRoute, wirePath, wirePoints } from "./wires.js";

export { wirePath, wirePoints };

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
//   margin    = 0          extra space around the content
//   viewBox   = "x y w h"  view to show (the editor's pan / zoom); default fits the content
//   time      = ms         draw a still frame at this time of the animation (no CSS animation)
//   captions  = true       draw animation captions as a band over the bottom of the view
//   assembly  = false      draw the assembly steps (see assembly.js) instead of the animation
export function renderSvg(result, options = {}) {
  if (options.assembly) return renderAssemblySvg(result, options);
  const { board } = result;
  const labels = options.labels ?? true;
  const tl = result.timeline;
  const still = options.time !== undefined;
  const time = still && tl ? (tl.loop ? Number(options.time) % tl.duration : Math.min(Number(options.time), tl.duration)) : 0;
  const animate = (options.animate ?? true) && !still && tl?.animated;
  const stateOf = (track) => (still ? stateAtTime(track, time) : initialState(track));
  const svgId = `bb-${hash(JSON.stringify([result.parts.map((p) => p.inst), result.wires.map((w) => [w.id, w.from, w.to]), tl?.duration]))}`;
  const animEls = [];
  // Per-target drawing context: initial state, and anim(name) -> attributes for an animated element.
  const ctxFor = (id, animateDef, params) => {
    const track = tl.tracks.get(id);
    const values = (name) => valuesOf(track, name);
    const maps = animateDef?.({ params, values }) ?? {};
    const state = stateOf(track);
    return {
      state,
      values,
      anim(name) {
        const map = maps[name];
        if (!map) return {};
        if (animate && track.keys.length) animEls.push({ selector: `#${svgId} [data-anim="${cssString(`${id}:${name}`)}"]`, track, map });
        return { "data-anim": `${id}:${name}`, ...stateAttrs(map(state), !animate) };
      },
    };
  };

  const pad = 1;
  const b = contentBounds(result, options.margin ?? 0);
  const captions = (options.captions ?? true) && tl?.captions.length > 0;
  const capRoom = captions ? 2.4 : 0; // the caption band sits below the content, not on it
  const vb = options.viewBox ? String(options.viewBox).split(/[\s,]+/).map(Number) : [b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2 + capRoom];
  const body = [
    shadowDefs(svgId, vb),
    g(drawBoard(board, svgId), { class: "board" }),
    // kit wires lie flat on the board, under the parts; flexible wires arc above them
    g(result.wires.filter((w) => w.kit).map((w) => drawWire(w, ctxFor(w.id, wireAnimate))).join(""), { class: "wires flat" }),
    g(result.parts.map((p) => drawPart(p, ctxFor(p.id, p.def.animate, p.params), svgId)).join(""), { class: "parts" }),
    g(result.wires.filter((w) => !w.kit).map((w) => drawWire(w, ctxFor(w.id, wireAnimate))).join(""), { class: "wires" }),
    g(result.parts.map(drawTerminals).join(""), { class: "terminals" }),
    g(result.overlays.map((o) => drawOverlay(o, ctxFor(o.id, overlayAnimate), tl)).join(""), { class: "overlays" }),
    labels ? g(result.parts.map(drawLabel).join(""), { class: "labels", "pointer-events": "none" }) : "",
    captions ? drawCaptions(tl, vb, animEls, svgId, animate, stateOf) : "",
    g(drawProblems(result), { class: "problems" }),
    options.selection ? g(drawSelection(result, options.selection), { class: "selection" }) : "",
    options.tempWire ? g(drawTempWire(options.tempWire), { class: "temp-wire", "pointer-events": "none" }) : "",
  ].join("");
  const meta = options.embed
    ? `<metadata id="breadboard-circuit" data-format="breadboard-viewer/v1">${esc(JSON.stringify(options.embed))}</metadata>`
    : "";
  const style = styleTag(still ? stillEffectCss(Number(options.time) || 0) : `${EFFECT_CSS}${animate ? compileCss(animEls, tl, svgId) : ""}`);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" id="${svgId}" viewBox="${vb.map(n).join(" ")}" ` +
    `width="${n(vb[2] * SCALE)}" height="${n(vb[3] * SCALE)}">` +
    meta +
    style +
    body +
    `</svg>`
  );
}

// Board bounds, grown to include off-board parts, parts that declare an `extent` reaching
// off the board, and wires; then `margin` on every side.
export function contentBounds(result, margin = 0) {
  const b = result.board.bounds;
  let [x0, y0, x1, y1] = [b.x, b.y, b.x + b.w, b.y + b.h];
  const add = (x, y, pad = 0) => {
    x0 = Math.min(x0, x - pad);
    y0 = Math.min(y0, y - pad);
    x1 = Math.max(x1, x + pad);
    y1 = Math.max(y1, y + pad);
  };
  for (const part of result.parts) {
    if (part.offboard) for (const p of part.pins) add(p.x, p.y, 2);
    const e = part.def.extent;
    if (!e || !part.transform) continue;
    const { x, y, rot } = part.transform;
    for (const [cx, cy] of [[e[0], e[1]], [e[2], e[1]], [e[0], e[3]], [e[2], e[3]]]) {
      const [dx, dy] = rotate(cx, cy, rot);
      add(x + dx, y + dy);
    }
  }
  for (const w of result.wires) for (const p of [w.a, w.b, ...w.via]) add(p.x, p.y, 0.5);
  for (const o of result.overlays ?? []) {
    add(o.x, o.y);
    add(o.x + o.w, o.y + o.h);
  }
  return { x: x0 - margin, y: y0 - margin, w: x1 - x0 + 2 * margin, h: y1 - y0 + 2 * margin };
}

// Connector marks on the pins of off-board parts and on terminals (insert: false);
// wires can be dragged from / to them.
function drawTerminals(part) {
  return part.pins
    .filter((p) => part.offboard || p.terminal)
    .map((p) =>
      circle(p.x, p.y, 0.26, {
        fill: "#e0c060",
        stroke: "#7a6420",
        "stroke-width": 0.06,
        "data-pin": `${part.id}.${p.name}`,
        style: "cursor:crosshair",
      }),
    )
    .join("");
}

const wireAnimate = () => ({ flow: (s) => ({ opacity: s.flow ? 1 : 0 }) });
const overlayAnimate = () => ({ fx: (s) => ({ opacity: Math.round(Math.max(0, Math.min(1, Number(s.opacity))) * Number(s.vis ?? 1) * 1000) / 1000 }) });

// restart: true -> data-restart lists the times (ms within a loop) the overlay becomes visible,
// so players (the editor, bb.mjs frames) can restart the SVG's own clock there.
function drawOverlay(o, ctx, tl) {
  const restart = o.restart ? { "data-restart": (tl?.showStarts?.get(o.id) ?? [0]).join(","), "data-cycle": tl?.loop ? tl.duration : 0 } : {};
  return g(spriteImage(o, restart), { class: "overlay", "data-id": o.id, ...ctx.anim("fx") });
}

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// A state's CSS for an element. When it does not animate, a transform goes in the SVG
// transform attribute instead: rasterizers without CSS transforms (cairosvg, rsvg) draw it too.
function stateAttrs(props, still) {
  if (!still || props.transform === undefined) return { style: cssDecl(props) };
  const { transform, ...rest } = props;
  return { transform: svgTransform(transform), ...(Object.keys(rest).length ? { style: cssDecl(rest) } : {}) };
}
// CSS transform functions -> SVG transform list: rotate(30deg) -> rotate(30), translate(1px,2px) -> translate(1 2)
const svgTransform = (css) => String(css).replace(/(-?[\d.]+)(deg|px)/g, "$1").replace(/,\s*/g, " ");

// ids and values from the circuit end up in the CSS (selectors, declarations); escape them so
// they stay strings, and newlines so they cannot end one.
const cssString = (s) => String(s).replace(/["\\]/g, "\\$&").replace(/[\n\r\f]/g, " ");
// The SVG goes into the page with innerHTML, so nothing in the CSS may close the <style>:
// "<" becomes the CSS escape \3c (still "<" inside a CSS string, an error anywhere else).
const styleTag = (css) => `<style>${css.replace(/</g, "\\3c ")}</style>`;

// Captions are a layer over the bottom of the view: a dark band with the current line.
function drawCaptions(tl, vb, animEls, svgId, animate, stateOf) {
  const track = captionTrack(tl.captions);
  const state = stateOf(track);
  const [x, y, w, h] = vb;
  const bandH = Math.min(2.2, h * 0.12);
  return g(
    tl.captions
      .map((c, i) => {
        const map = (s) => ({ opacity: Number(s.caption) === i ? 1 : 0 });
        if (animate) animEls.push({ selector: `#${svgId} [data-anim="caption:${i}"]`, track, map });
        const size = Math.min(bandH * 0.42, (w * 0.92) / Math.max(1, [...c.text].length));
        return g(
          rect(x, y + h - bandH, w, bandH, { fill: "rgba(20,24,28,.72)" }) +
            text(x + w / 2, y + h - bandH / 2, c.text, { "font-size": size, fill: "#fff", "text-anchor": "middle", "dominant-baseline": "central" }),
          { "data-anim": `caption:${i}`, style: cssDecl(map(state)) },
        );
      })
      .join(""),
    { class: "captions", "pointer-events": "none" },
  );
}

// Soft drop shadows for the board and the parts. The region is in user space (not the
// element's box) so thin parts don't clip the blur; renderers only filter what's drawn.
function shadowDefs(svgId, vb) {
  const [x, y, w, h] = vb;
  const region = { filterUnits: "userSpaceOnUse", x: x - 50, y: y - 50, width: w + 100, height: h + 100, "color-interpolation-filters": "sRGB" };
  const shadow = (id, dx, dy, blur, opacity) =>
    `<filter id="${svgId}-${id}"${attrs(region)}>${tag("feDropShadow", { dx, dy, stdDeviation: blur, "flood-color": "#000", "flood-opacity": opacity })}</filter>`;
  return `<defs>${shadow("board-shadow", 0, 0.18, 0.22, 0.22)}${shadow("part-shadow", 0.05, 0.12, 0.07, 0.3)}</defs>`;
}

function drawBoard(board, svgId) {
  const b = board.bounds;
  const out = [rect(b.x, b.y, b.w, b.h, { rx: 0.4, fill: BOARD_COLOR, stroke: "#d3ccbc", "stroke-width": 0.06, filter: `url(#${svgId}-board-shadow)` })];
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

// The shadow filter sits on an untransformed wrapper, so it falls the same way on rotated parts.
function drawPart(part, ctx, svgId) {
  const attrs = { class: "part", "data-id": part.id, "data-type": part.type };
  const shadow = { filter: `url(#${svgId}-part-shadow)` };
  if (part.def.mount === "leads") {
    return g(part.def.render({ ...ctx, pins: part.pins, params: part.params, inst: part.inst }), { ...attrs, ...shadow });
  }
  const t = part.transform;
  const local = part.def.pins(part.params);
  const body = g(part.def.render({ ...ctx, rot: t.rot, pins: local, params: part.params, inst: part.inst }), {
    transform: `translate(${n(t.x)} ${n(t.y)}) rotate(${t.rot})`,
  });
  return g(body, { ...attrs, ...shadow });
}

// drawIn: { offset } makes the wire paths drawable from 0 (offset 1) to fully drawn (offset 0).
// With still: true a fully drawn wire gets no dashes (pathLength is not understood everywhere).
function drawWire(w, ctx, drawIn = null) {
  const kit = w.kit ? kitInfo(w) : null;
  const color = kit ? KIT_WIRE_COLORS[kit.color] : WIRE_COLORS[w.color] ?? w.color ?? WIRE_COLORS.blue;
  const common = { d: wirePath(w), fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" };
  const drawable = drawIn && !(drawIn.still && drawIn.offset <= 0)
    ? { pathLength: 1, class: "asm-path", style: `stroke-dasharray:1 1;stroke-dashoffset:${n(drawIn.offset)}` }
    : {};
  const path = (stroke, width, extra = {}) => tag("path", { ...common, stroke, "stroke-width": width, ...extra, ...drawable });
  const flows = ctx.state.flow || ctx.values("flow").includes("true");
  // the timeline toggles the group; the dashes inside run their own endless animation
  const flow = flows
    ? g(tag("path", { ...common, stroke: "#fff", "stroke-width": 0.14, "stroke-dasharray": "0.3 0.5", class: "bb-flow" }), {
        "pointer-events": "none",
        ...ctx.anim("flow"),
      })
    : "";
  let body;
  if (kit) {
    // flat on the board: a short shadow, bare metal at the ends, the insulation in between
    const sleeve = kit.color === "bare" ? null : trimRoute(kitRoute(w), 0.32, 0.32);
    const ins = (stroke, width, extra = {}) => (sleeve ? path(stroke, width, { d: roundedPath(sleeve), ...extra }) : "");
    body =
      path(BOARD_COLOR, 0.42) +
      ins("rgba(0,0,0,.22)", 0.32, { transform: "translate(0.02 0.06)" }) +
      path("rgba(0,0,0,.4)", 0.15) +
      path("#c3c8cc", 0.09) +
      ins("rgba(0,0,0,.35)", 0.32) +
      ins(color, 0.24) +
      ins("rgba(255,255,255,.4)", 0.06);
  } else {
    // board-colored edge (cuts a gap where this wire crosses an earlier one), offset shadow,
    // dark outline, the wire, and a thin highlight along its middle
    body =
      path(BOARD_COLOR, 0.46) +
      path("rgba(0,0,0,.2)", 0.34, { transform: "translate(0.04 0.1)" }) +
      path("rgba(0,0,0,.35)", 0.34) +
      path(color, 0.25) +
      path("rgba(255,255,255,.4)", 0.06);
  }
  const end = kit ? 0.09 : 0.13;
  return g(body + flow + circle(w.a.x, w.a.y, end, { fill: "#a7adb3" }) + circle(w.b.x, w.b.y, end, { fill: "#a7adb3" }), {
    class: "wire",
    "data-id": w.id,
    "data-from": w.from,
    "data-to": w.to,
  });
}

// Where the part id label goes: { x, y, anchor } (null when hidden).
// inst.idLabel: false hides it, { dx, dy } moves it (pitch units).
function labelSpot(part) {
  const opt = part.inst.idLabel;
  if (opt === false) return null;
  const xs = part.pins.map((p) => p.x);
  const ys = part.pins.map((p) => p.y);
  const leads = part.def.mount === "leads";
  const x = (leads ? xs.reduce((a, b) => a + b, 0) / xs.length : Math.min(...xs)) + (Number(opt?.dx) || 0);
  const y = (leads ? ys.reduce((a, b) => a + b, 0) / ys.length - 1.25 : Math.min(...ys) - 0.95) + (Number(opt?.dy) || 0);
  return { x, y, anchor: leads ? "middle" : "start" };
}

// Approximate box of the id label (for layout checks).
export function labelBox(part) {
  const spot = labelSpot(part);
  if (!spot) return null;
  const w = [...part.id].length * 0.32 + 0.1;
  return { x: spot.anchor === "middle" ? spot.x - w / 2 : spot.x, y: spot.y - 0.3, w, h: 0.6 };
}

function drawLabel(part) {
  const spot = labelSpot(part);
  if (!spot) return "";
  const { x, y } = spot;
  const a = { "font-size": 0.5, "font-weight": "bold", "text-anchor": part.def.mount === "leads" ? "middle" : "start", "dominant-baseline": "central" };
  // a white outline drawn under the text (paint-order is not understood by every renderer)
  return text(x, y, part.id, { ...a, fill: "#fff", stroke: "#fff", "stroke-width": 0.14, "stroke-linejoin": "round" }) + text(x, y, part.id, { ...a, fill: "#263238" });
}

function drawProblems(result) {
  const out = [];
  for (const part of result.parts) {
    if (part.offboard) continue;
    for (const p of part.pins) {
      if (!p.hole && !p.terminal) out.push(circle(p.x, p.y, 0.35, { fill: "none", stroke: "#d50000", "stroke-width": 0.1 }));
    }
  }
  return out.join("");
}

const ACCENT = "#1e6fd9";
const BOARD_COLOR = "#f3efe6";
const KIT_WIRE_COLORS = { ...WIRE_COLORS, bare: "#c3c8cc", white: "#fafafa", gray: "#90a4ae" };

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
    const handles = part.def.mount === "leads" && !part.offboard ? part.pins.map((p) => handle(p.x, p.y, part.id, `pin:${p.name}`)).join("") : "";
    return box + handles;
  }
  const overlay = result.overlays?.find((o) => o.id === id);
  if (overlay) {
    return rect(overlay.x, overlay.y, overlay.w, overlay.h, {
      fill: "none",
      stroke: ACCENT,
      "stroke-width": 0.08,
      "stroke-dasharray": "0.3 0.2",
      "pointer-events": "none",
    });
  }
  const wire = result.wires.find((w) => w.id === id);
  if (wire) {
    const pts = [wire.a, ...wire.via, wire.b];
    // "+" handles in the middle of each segment add a via point when dragged
    const inserts = pts.slice(1).map((p, i) => {
      const q = pts[i];
      const mx = (p.x + q.x) / 2;
      const my = (p.y + q.y) / 2;
      return g(
        circle(mx, my, 0.24, { fill: ACCENT, opacity: 0.85 }) +
          line(mx - 0.13, my, mx + 0.13, my, { stroke: "#fff", "stroke-width": 0.06 }) +
          line(mx, my - 0.13, mx, my + 0.13, { stroke: "#fff", "stroke-width": 0.06 }),
        { "data-handle": `insert:${i}`, "data-owner": wire.id, style: "cursor:copy" },
      );
    });
    return (
      tag("path", { d: wirePath(wire), fill: "none", stroke: ACCENT, "stroke-width": 0.12, "stroke-dasharray": "0.3 0.2", "pointer-events": "none" }) +
      inserts.join("") +
      wire.via.map((p, i) => handle(p.x, p.y, wire.id, `via:${i}`)).join("") +
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

// ---- assembly steps ----

// Bounds of everything drawn, including the parts tray in assembly mode.
export function renderBounds(result, { assembly = false } = {}) {
  const b = contentBounds(result);
  const tray = assembly ? planAssembly(result).trayBounds : null;
  if (!tray) return b;
  const x = Math.min(b.x, tray.x);
  const y = Math.min(b.y, tray.y);
  return { x, y, w: Math.max(b.x + b.w, tray.x + tray.w) - x, h: Math.max(b.y + b.h, tray.y + tray.h) - y };
}

// Parts start in a tray below the board and move into place step by step; wires are drawn in.
// Same options as renderSvg (time = still frame of the assembly). Parts show their t=0 state.
function renderAssemblySvg(result, options) {
  const plan = planAssembly(result);
  const still = options.time !== undefined;
  const t = still ? ((Number(options.time) % plan.duration) + plan.duration) % plan.duration : 0;
  const tl = result.timeline;
  const svgId = `bb-${hash(JSON.stringify(["asm", result.parts.map((p) => p.inst), result.wires.map((w) => w.id), plan.steps]))}`;
  const labels = options.labels ?? true;
  const r = (v) => Math.round(v * 1000) / 1000;
  let k = 0;
  const css = [];
  const animated = (id, times, decl, selector = `#${svgId} [data-asm="${cssString(id)}"]`) => {
    if (!still && plan.stepOf.has(id)) css.push(keyframesCss(`${svgId}-a${k++}`, selector, [...times, plan.duration], decl, plan.duration));
  };
  const ctxStatic = (id, animateDef, params) => {
    const track = tl.tracks.get(id);
    const values = (name) => valuesOf(track, name);
    const maps = animateDef?.({ params, values }) ?? {};
    // parts being assembled show their default state, not the animation's
    const state = { ...track.defaults, ...Object.fromEntries(track.rates.map((name) => [`${name}Angle`, 0])) };
    return { state, values, anim: (name) => (maps[name] ? { "data-anim": `${id}:${name}`, ...stateAttrs(maps[name](state), true) } : {}) };
  };

  const parts = result.parts.map((p) => {
    const move = (tt) => {
      const o = offsetAt(plan, p.id, tt);
      return `transform:translate(${r(o.dx)}px,${r(o.dy)}px)`;
    };
    const s = plan.stepOf.has(p.id) ? plan.start(plan.stepOf.get(p.id)) + plan.T.lead : 0;
    animated(p.id, rampTimes(s, plan.T.move), move);
    const inner = drawPart(p, ctxStatic(p.id, p.def.animate, p.params), svgId) + (labels ? drawLabel(p) : "") + drawTerminals(p);
    // a still frame places the part with an attribute, which every SVG renderer understands
    return g(inner, still ? { "data-asm": p.id, transform: svgTransform(move(t).slice("transform:".length)) } : { "data-asm": p.id, style: move(t) });
  });

  const wires = (kit) => result.wires.filter((w) => !!w.kit === kit).map((w) => {
    const shown = (tt) => `opacity:${drawnAt(plan, w.id, tt) > 0 ? 1 : 0}`;
    const s = plan.stepOf.has(w.id) ? plan.start(plan.stepOf.get(w.id)) + plan.T.lead : 0;
    animated(w.id, [0, s, s + 1], shown);
    animated(w.id, rampTimes(s, plan.T.draw), (tt) => `stroke-dashoffset:${r(1 - drawnAt(plan, w.id, tt))}`, `#${svgId} [data-asm="${cssString(w.id)}"] .asm-path`);
    return g(drawWire(w, ctxStatic(w.id, wireAnimate), { offset: 1 - drawnAt(plan, w.id, t), still }), { "data-asm": w.id, style: shown(t) });
  });

  const overlays = result.overlays.map((o) => {
    const fade = (tt) => `opacity:${r(drawnAt(plan, o.id, tt))}`;
    const s = plan.stepOf.has(o.id) ? plan.start(plan.stepOf.get(o.id)) + plan.T.lead : 0;
    animated(o.id, rampTimes(s, plan.T.draw, 4), fade);
    return g(spriteImage(o), { "data-asm": o.id, style: fade(t) });
  });

  // a frame around the parts of the current step, at their final place
  const highlights = result.parts
    .filter((p) => plan.stepOf.has(p.id))
    .map((p) => {
      const box = plan.boxes.get(p.id);
      const glow = (tt) => `opacity:${r(highlightAt(plan, p.id, tt))}`;
      return rect(box.x - 0.3, box.y - 0.3, box.w + 0.6, box.h + 0.6, {
        rx: 0.4,
        fill: "rgba(255,152,0,.10)",
        stroke: "#ff9800",
        "stroke-width": 0.14,
        "data-asm-hl": p.id,
        style: glow(t),
      });
    });
  for (const p of still ? [] : result.parts.filter((x) => plan.stepOf.has(x.id))) {
    const i = plan.stepOf.get(p.id);
    const s = plan.start(i);
    const end = s + plan.length(i) - 150;
    css.push(
      keyframesCss(
        `${svgId}-h${k++}`,
        `#${svgId} [data-asm-hl="${cssString(p.id)}"]`,
        [0, s - 1, s, s + 200, end - 300, end, plan.duration],
        (tt) => `opacity:${r(highlightAt(plan, p.id, tt))}`,
        plan.duration,
      ),
    );
  }

  const pad = 1;
  const b = renderBounds(result, { assembly: true });
  const withCaptions = options.captions ?? true;
  const capRoom = withCaptions ? 2.4 : 0; // keep the caption band off the tray
  const vb = options.viewBox ? String(options.viewBox).split(/[\s,]+/).map(Number) : [b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2 + capRoom];
  const capTl = { captions: plan.captions, duration: plan.duration, loop: true };
  const animEls = [];
  const capState = (track) => (still ? stateAtTime(track, t) : initialState(track));
  const captions = withCaptions ? drawCaptions(capTl, vb, animEls, svgId, !still, capState) : "";
  const body = [
    shadowDefs(svgId, vb),
    g(drawBoard(result.board, svgId), { class: "board" }),
    g(wires(true).join(""), { class: "wires flat" }),
    g(parts.join(""), { class: "parts" }),
    g(wires(false).join(""), { class: "wires" }),
    g(overlays.join(""), { class: "overlays" }),
    g(highlights.join(""), { class: "highlights", "pointer-events": "none" }),
    captions,
  ].join("");
  const meta = options.embed
    ? `<metadata id="breadboard-circuit" data-format="breadboard-viewer/v1">${esc(JSON.stringify(options.embed))}</metadata>`
    : "";
  const style = styleTag(still ? stillEffectCss(0) : `${EFFECT_CSS}${css.join("")}${compileCss(animEls, capTl, svgId)}`);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" id="${svgId}" viewBox="${vb.map(n).join(" ")}" ` +
    `width="${n(vb[2] * SCALE)}" height="${n(vb[3] * SCALE)}">` +
    meta +
    style +
    body +
    `</svg>`
  );
}
