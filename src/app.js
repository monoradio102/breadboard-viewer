// Browser UI. Every edit goes through ops.js (the same operations AI agents use via window.bb).
import { BOARD_TYPES } from "./board.js";
import { describe, resolveCircuit, stripOf } from "./circuit.js";
import { emptyCircuit, parseCircuitText, stringifyCircuit } from "./io.js";
import { OP_NAMES, OpError, applyOps, normalize } from "./ops.js";
import { WIRE_COLORS, renderSvg } from "./render.js";

const STORAGE_KEY = "breadboard-viewer:last";
const WORKSPACE = 6; // free space around the board for off-board parts (pitch units)
const PART_MIME = "application/x-breadboard-part";

const $ = (id) => document.getElementById(id);
const el = {
  stage: $("stage"),
  editor: $("editor"),
  messages: $("messages"),
  nets: $("nets"),
  status: $("status"),
  title: $("title"),
  partList: $("part-list"),
  partDetail: $("part-detail"),
  partFilter: $("part-filter"),
  inspector: $("inspector"),
  file: $("file"),
  board: $("board-type"),
  wireColor: $("wire-color"),
  undo: $("btn-undo"),
  redo: $("btn-redo"),
  player: $("player"),
  play: $("btn-play"),
  animTime: $("anim-time"),
  animLabel: $("anim-label"),
  animDuration: $("anim-duration"),
  animLoop: $("anim-loop"),
  exportMenu: $("export"),
};

let circuit = normalize(emptyCircuit());
let result = resolveCircuit(circuit);
let selection = null; // id of the selected part or wire
let drag = null;
let zoom = null; // null = fit to width
const undoStack = { past: [], future: [] };

// ---- state ----

// Replaces the circuit. record=false is used for undo/redo and the initial load.
function commit(next, { record = true, updateEditor = true } = {}) {
  next = normalize(next);
  if (record && JSON.stringify(next) !== JSON.stringify(circuit)) {
    undoStack.past.push(circuit);
    if (undoStack.past.length > 200) undoStack.past.shift();
    undoStack.future = [];
  }
  circuit = next;
  result = resolveCircuit(circuit);
  if (selection && !result.parts.some((p) => p.id === selection) && !result.wires.some((w) => w.id === selection)) {
    selection = null;
  }
  draw();
  if (updateEditor) el.editor.value = stringifyCircuit(circuit);
  if (document.activeElement !== el.title) el.title.value = circuit.title ?? "";
  el.board.value = circuit.board ?? "half";
  showMessages(result.errors, result.warnings);
  el.nets.textContent = describe({ ...result, errors: [], warnings: [] });
  el.undo.disabled = !undoStack.past.length;
  el.redo.disabled = !undoStack.future.length;
  renderPartList();
  renderInspector();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(circuit));
  } catch {
    // storage unavailable (private mode etc.)
  }
}

// Applies ops and records one undo step. Returns the ids the ops created / touched.
function apply(ops) {
  const out = applyOps(circuit, ops);
  commit(out.circuit);
  return out.ids;
}

function tryApply(ops) {
  try {
    return apply(ops);
  } catch (e) {
    if (!(e instanceof OpError)) throw e;
    flash(e.message);
    return null;
  }
}

function undo() {
  if (!undoStack.past.length) return;
  undoStack.future.push(circuit);
  commit(undoStack.past.pop(), { record: false });
}

function redo() {
  if (!undoStack.future.length) return;
  undoStack.past.push(circuit);
  commit(undoStack.future.pop(), { record: false });
}

function select(id) {
  selection = id;
  draw();
  renderInspector();
}

// ---- drawing ----

function draw(previewResult = result, extra = {}) {
  // while dragging, the view keeps its size so the content does not shift under the pointer
  const viewBox = drag?.viewBox;
  el.stage.innerHTML = renderSvg(previewResult, { selection, margin: WORKSPACE, viewBox, ...extra });
  const svg = el.stage.querySelector("svg");
  if (zoom) {
    const w = Number(svg.getAttribute("width"));
    svg.style.width = `${w * zoom}px`;
    svg.style.maxWidth = "none";
  }
  syncPlayer();
}

// ---- animation player ----
// Re-rendering creates new CSS animations; they are re-synced to one clock here.

const player = { playing: true, start: performance.now(), time: 0 };

function playerTime() {
  return player.playing ? performance.now() - player.start : player.time;
}

function syncPlayer() {
  const tl = result.timeline;
  el.player.hidden = !tl?.animated;
  if (!tl?.animated) return;
  const t = playerTime();
  for (const a of el.stage.querySelector("svg")?.getAnimations({ subtree: true }) ?? []) {
    a.currentTime = t;
    if (!player.playing) a.pause();
  }
  el.play.textContent = player.playing ? "⏸" : "▶";
  if (document.activeElement !== el.animDuration) el.animDuration.value = String(tl.duration / 1000);
  el.animLoop.checked = tl.loop;
}

// Current position within one loop of the animation (ms).
function localTime() {
  const tl = result.timeline;
  if (!tl?.animated) return 0;
  const t = playerTime();
  return tl.loop ? t % tl.duration : Math.min(t, tl.duration);
}

function setPlaying(playing) {
  if (playing === player.playing) return;
  if (playing) player.start = performance.now() - player.time;
  else player.time = playerTime();
  player.playing = playing;
  syncPlayer();
}

function seek(t) {
  player.time = t;
  player.start = performance.now() - t;
  syncPlayer();
}

function tickPlayer() {
  const tl = result.timeline;
  if (tl?.animated) {
    const local = localTime();
    el.animTime.max = String(tl.duration);
    if (document.activeElement !== el.animTime) el.animTime.value = String(local);
    el.animLabel.textContent = `${(local / 1000).toFixed(1)}s / ${(tl.duration / 1000).toFixed(1)}s`;
  }
  requestAnimationFrame(tickPlayer);
}
requestAnimationFrame(tickPlayer);

function showMessages(errors, warnings, extra) {
  const items = [...(extra ? [["error", extra]] : []), ...errors.map((m) => ["error", m]), ...warnings.map((m) => ["warn", m])];
  el.messages.replaceChildren(
    ...(items.length
      ? items.map(([kind, m]) => node("div", m, `msg ${kind}`))
      : [node("div", "問題は見つかりません", "msg ok")]),
  );
}

function flash(message) {
  el.status.textContent = `⚠ ${message}`;
  el.status.classList.add("warn");
  setTimeout(() => el.status.classList.remove("warn"), 2500);
}

function node(tag, text, className) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
}

// ---- pointer editing ----

function svgPoint(ev) {
  const svg = el.stage.querySelector("svg");
  return new DOMPoint(ev.clientX, ev.clientY).matrixTransform(svg.getScreenCTM().inverse());
}

function holeNear(pt, radius = 0.5) {
  const x = Math.round(pt.x);
  const y = Math.round(pt.y);
  return Math.hypot(pt.x - x, pt.y - y) <= radius ? result.board.holeAt(x, y) : null;
}

// A wire end under the pointer: a hole, or a pin of an off-board part ("SV1.SIG").
function endNear(pt) {
  const hole = holeNear(pt);
  if (hole) return { ref: hole, pos: result.board.pos(hole) };
  for (const part of result.parts) {
    if (!part.offboard) continue;
    for (const p of part.pins) {
      if (Math.hypot(pt.x - p.x, pt.y - p.y) <= 0.45) return { ref: `${part.id}.${p.name}`, pos: { x: p.x, y: p.y } };
    }
  }
  return null;
}

function onBoard(x, y) {
  const b = result.board.bounds;
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

const half = (v) => Math.round(v * 2) / 2;

el.stage.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0 || !el.stage.querySelector("svg")) return;
  const pt = svgPoint(ev);
  const handleEl = ev.target.closest("[data-handle]");
  const pinEl = ev.target.closest("[data-pin]");
  const partEl = ev.target.closest(".part");
  const wireEl = ev.target.closest(".wire");
  if (pinEl && !handleEl) {
    // start a wire from a pin of an off-board part
    const end = endNear(pt);
    if (selection) select(null);
    if (!end) return;
    drag = { kind: "wire", from: end.ref, fromPos: end.pos };
  } else if (handleEl) {
    const { owner, handle } = handleEl.dataset;
    if (handle.startsWith("via:") && isDoubleClick(`${owner}/${handle}`)) {
      removeVia(owner, Number(handle.slice(4)));
      ev.preventDefault();
      return;
    }
    drag = { kind: "handle", id: owner, handle };
  } else if (partEl) {
    select(partEl.dataset.id);
    const part = result.parts.find((p) => p.id === partEl.dataset.id);
    drag = { kind: "move", id: part.id, startPt: pt, origin: { x: part.pins[0].x, y: part.pins[0].y } };
  } else if (wireEl) {
    select(wireEl.dataset.id);
    return;
  } else {
    const hole = holeNear(pt);
    if (selection) select(null);
    if (!hole) return;
    drag = { kind: "wire", from: hole, fromPos: result.board.pos(hole) };
  }
  drag.preview = null;
  drag.viewBox = el.stage.querySelector("svg").getAttribute("viewBox");
  el.stage.setPointerCapture(ev.pointerId);
  ev.preventDefault();
});

el.stage.addEventListener("pointermove", (ev) => {
  if (!el.stage.querySelector("svg") || !result.board) return;
  const pt = svgPoint(ev);
  if (!drag) return hover(pt);
  if (drag.kind === "wire") {
    const end = endNear(pt);
    drag.to = end?.ref ?? null;
    draw(result, { tempWire: { a: drag.fromPos, b: end?.pos ?? { x: pt.x, y: pt.y }, color: el.wireColor.value } });
    el.status.textContent = `${drag.from} → ${drag.to ?? "…"}`;
    return;
  }
  let ops;
  if (drag.kind === "move") {
    // over the board the first pin snaps to holes; outside it the part is placed freely
    const x = drag.origin.x + (pt.x - drag.startPt.x);
    const y = drag.origin.y + (pt.y - drag.startPt.y);
    if (onBoard(x, y)) {
      const to = result.board.holeAt(Math.round(x), Math.round(y));
      if (!to || to === drag.lastTo) return;
      drag.lastTo = to;
      ops = [{ op: "move", id: drag.id, to }];
    } else {
      const pos = [half(x), half(y)];
      if (JSON.stringify(pos) === drag.lastTo) return;
      drag.lastTo = JSON.stringify(pos);
      ops = [{ op: "move", id: drag.id, pos }];
    }
  } else if (/^(via|insert):/.test(drag.handle)) {
    const point = snapPoint(pt);
    const key = JSON.stringify(point);
    if (key === drag.lastTo) return;
    drag.lastTo = key;
    const wire = circuit.wires.find((w) => w.id === drag.id);
    const via = [...(wire.via ?? [])];
    const [kind, index] = drag.handle.split(":");
    if (kind === "insert") via.splice(Number(index), 0, point);
    else via[Number(index)] = point;
    // adding a bend point to a plain wire makes it a smooth curve
    const set = kind === "insert" && wire.shape === undefined ? { via, shape: "curve" } : { via };
    ops = [{ op: "update", id: drag.id, set }];
  } else {
    const to = drag.handle.startsWith("pin:") ? holeNear(pt) : endNear(pt)?.ref;
    if (!to || to === drag.lastTo) return;
    drag.lastTo = to;
    ops = drag.handle.startsWith("pin:")
      ? [{ op: "setPin", id: drag.id, pin: drag.handle.slice(4), to }]
      : [{ op: "update", id: drag.id, set: { [drag.handle]: to } }];
  }
  try {
    drag.preview = applyOps(circuit, ops).circuit;
    const r = resolveCircuit(drag.preview);
    draw(r);
    el.status.textContent = `${drag.id} → ${drag.lastTo}${r.errors.length ? `  ·  ⚠ ${r.errors[0]}` : ""}`;
  } catch (e) {
    if (!(e instanceof OpError)) throw e;
  }
});

function endDrag() {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.kind === "wire") {
    if (d.to && d.to !== d.from) {
      const [id] = tryApply([{ op: "addWire", from: d.from, to: d.to, color: el.wireColor.value }]) ?? [];
      if (id) select(id);
    } else draw();
  } else if (d.preview) {
    commit(d.preview);
  } else draw();
}

// Via points snap to a half-pitch grid; a point on a hole is stored as the hole name.
function snapPoint(pt) {
  const x = Math.round(pt.x * 2) / 2;
  const y = Math.round(pt.y * 2) / 2;
  return result.board.holeAt(x, y) ?? [x, y];
}

el.stage.addEventListener("pointerup", endDrag);

// Double-click on a via point removes it. Detected by hand: the SVG is re-rendered between
// the clicks, so the browser's dblclick event does not reach the handle.
let lastHandleDown = { key: null, time: 0 };

function isDoubleClick(key) {
  const now = performance.now();
  const hit = lastHandleDown.key === key && now - lastHandleDown.time < 400;
  lastHandleDown = { key: hit ? null : key, time: now };
  return hit;
}

function removeVia(wireId, index) {
  const wire = circuit.wires.find((w) => w.id === wireId);
  const via = (wire.via ?? []).filter((_, i) => i !== index);
  tryApply([{ op: "update", id: wire.id, set: { via: via.length ? via : null } }]);
}
el.stage.addEventListener("pointercancel", () => {
  drag = null;
  draw();
});

function hover(pt) {
  const end = endNear(pt);
  for (const h of el.stage.querySelectorAll(".hl")) h.classList.remove("hl");
  if (end && !result.board.has(end.ref)) {
    const net = result.netOf(end.ref);
    el.status.textContent = `${end.ref}${net ? `  ·  ネット ${net}` : "  ·  未接続"}`;
    return;
  }
  const hole = holeNear(pt, 0.45);
  if (!hole) return;
  const strip = stripOf(hole);
  for (const h of el.stage.querySelectorAll("[data-hole]")) {
    if (stripOf(h.dataset.hole) === strip) h.classList.add("hl");
  }
  el.status.textContent = describeHole(hole);
}

function describeHole(hole) {
  const who = result.occupied.get(hole);
  const net = result.netOfHole(hole);
  return `${hole}${who ? `  ·  ${who}` : ""}${net ? `  ·  ネット ${net}` : ""}`;
}

// ---- keyboard ----

window.addEventListener("keydown", (ev) => {
  if (ev.target.closest("input, textarea, select")) return;
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && ev.key.toLowerCase() === "z") {
    ev.preventDefault();
    ev.shiftKey ? redo() : undo();
  } else if (mod && ev.key.toLowerCase() === "y") {
    ev.preventDefault();
    redo();
  } else if (ev.key === " " && result.timeline?.animated) {
    ev.preventDefault();
    setPlaying(!player.playing);
  } else if (!selection) {
    return;
  } else if (ev.key === "Delete" || ev.key === "Backspace") {
    ev.preventDefault();
    tryApply([{ op: "remove", id: selection }]);
  } else if (ev.key.toLowerCase() === "r" && !mod) {
    tryApply([{ op: "rotate", id: selection, by: ev.shiftKey ? 270 : 90 }]);
  } else if (ev.key === "Escape") {
    select(null);
  } else if (ev.key.startsWith("Arrow")) {
    ev.preventDefault();
    nudge(ev.key);
  }
});

// Moves the selected part one hole in the arrow direction (skipping the channel / gaps).
function nudge(key) {
  const part = result.parts.find((p) => p.id === selection);
  if (!part) return;
  const [dx, dy] = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
  for (let k = 1; k <= 4; k++) {
    const to = result.board.holeAt(part.pins[0].x + dx * k, part.pins[0].y + dy * k);
    if (!to) continue;
    try {
      apply([{ op: "move", id: part.id, to }]);
      return;
    } catch (e) {
      if (!(e instanceof OpError)) throw e;
    }
  }
}

// ---- inspector ----

function renderInspector() {
  const box = el.inspector;
  box.replaceChildren();
  const part = result.parts.find((p) => p.id === selection);
  const wire = circuit.wires.find((w) => w.id === selection);
  if (!part && !wire) {
    box.append(
      node("p", "部品をクリックで選択・ドラッグで移動 (ボードの外にも置けます)。空いた穴や、ボード外の部品のピンからドラッグでジャンパ線。線を選んで「＋」をドラッグすると曲げられます (経由点はダブルクリックで削除)。R で回転、Delete で削除、矢印キーで1マス移動。", "hint"),
    );
    return;
  }
  const id = part?.id ?? wire.id;
  box.append(node("h3", part ? `${part.id} · ${part.def.name}` : `${wire.id} · ジャンパ線`));
  box.append(field("ID", id, (v) => v && v !== id && selectAfter(tryApply([{ op: "update", id, set: { id: v } }]))));
  if (part) {
    for (const [key, spec] of Object.entries(part.def.params ?? {})) {
      if (spec.default !== null && typeof spec.default === "object") continue;
      if (Array.isArray(part.params[key])) continue;
      const set = (v) => tryApply([{ op: "update", id, set: { [key]: typeof spec.default === "number" ? Number(v) : v } }]);
      box.append(field(key, part.params[key] ?? "", set, spec.options, spec.description));
    }
    box.append(node("p", part.pins.map((p) => `${p.name}=${p.hole ?? "?"}`).join("  "), "pins"));
  } else {
    const colors = Object.keys(WIRE_COLORS);
    box.append(field("color", wire.color ?? "blue", (v) => tryApply([{ op: "update", id, set: { color: v } }]), colors));
    box.append(field("shape", wire.shape ?? "straight", (v) => tryApply([{ op: "update", id, set: { shape: v === "straight" ? null : v } }]), ["straight", "curve"], "curve: 経由点をなめらかに通る"));
    box.append(
      field("bend", wire.bend ?? 0, (v) => tryApply([{ op: "update", id, set: { bend: Number(v) ? Number(v) : null } }]), undefined, "経由点がないときの弧の大きさ (例: 0.2, 負で逆向き)"),
    );
    box.append(field("from", wire.from, (v) => tryApply([{ op: "update", id, set: { from: v } }])));
    box.append(field("to", wire.to, (v) => tryApply([{ op: "update", id, set: { to: v } }])));
  }
  const row = node("div", undefined, "row");
  if (part) {
    row.append(button("⟲ 左回転", () => tryApply([{ op: "rotate", id, by: 270 }])));
    row.append(button("⟳ 右回転", () => tryApply([{ op: "rotate", id, by: 90 }])));
  }
  row.append(button("削除", () => tryApply([{ op: "remove", id }]), "danger"));
  box.append(row);
}

function selectAfter(ids) {
  if (ids?.[0]) select(ids[0]);
}

function field(label, value, onChange, options, title) {
  const wrap = node("label", undefined, "field");
  wrap.append(node("span", label));
  let input;
  if (options) {
    input = document.createElement("select");
    const list = options.includes(value) ? options : [value, ...options];
    for (const o of list) input.append(Object.assign(document.createElement("option"), { value: o, textContent: o }));
    input.value = value;
  } else {
    input = Object.assign(document.createElement("input"), { value: String(value) });
  }
  if (title) wrap.title = title;
  input.addEventListener("change", () => onChange(input.value.trim()));
  wrap.append(input);
  return wrap;
}

function button(text, onClick, className) {
  const b = node("button", text, className);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

// ---- JSON editor ----

let editTimer;
el.editor.addEventListener("input", () => {
  clearTimeout(editTimer);
  editTimer = setTimeout(() => {
    try {
      commit(JSON.parse(el.editor.value), { updateEditor: false });
    } catch (e) {
      showMessages([], [], `JSON構文エラー: ${e.message}`);
    }
  }, 300);
});

el.title.addEventListener("change", () => tryApply([{ op: "setTitle", title: el.title.value }]));

// ---- parts list ----

function renderPartList() {
  const q = el.partFilter.value.trim().toLowerCase();
  const byCat = new Map();
  for (const def of result.registry?.parts.values() ?? []) {
    const hay = `${def.type} ${def.name} ${def.category} ${def.description}`.toLowerCase();
    if (q && !hay.includes(q)) continue;
    if (!byCat.has(def.category)) byCat.set(def.category, []);
    byCat.get(def.category).push(def);
  }
  const frag = document.createDocumentFragment();
  for (const [cat, defs] of byCat) {
    frag.append(node("h3", cat));
    for (const def of defs) {
      const b = node("button", undefined, "part-item");
      b.type = "button";
      b.draggable = true;
      b.title = "ボードにドラッグして配置";
      b.append(node("span", def.name, "part-name"), node("code", def.type));
      b.addEventListener("click", () => showPartDetail(def));
      b.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData(PART_MIME, def.type);
        ev.dataTransfer.effectAllowed = "copy";
      });
      frag.append(b);
    }
  }
  el.partList.replaceChildren(frag);
}

el.partFilter.addEventListener("input", renderPartList);

function showPartDetail(def) {
  const params = {};
  for (const [k, spec] of Object.entries(def.params ?? {})) params[k] = spec.default;
  const d = el.partDetail;
  d.hidden = false;
  d.replaceChildren(
    node("h3", def.name),
    node("p", def.description),
    node("p", `type: ${def.type} / ${def.mount === "leads" ? "足を曲げられる (ピンごとに動かせる)" : "固定形状 (at + rot で配置)"}`, "meta"),
    node("p", `ピン: ${def.pins(params).map((p) => p.name).join(", ")}`, "meta"),
  );
  const paramText = Object.entries(def.params ?? {})
    .map(([k, s]) => `${k} = ${JSON.stringify(s.default)}  … ${s.description ?? ""}`)
    .join("\n");
  if (paramText) d.append(node("pre", paramText));
  d.append(
    button("回路に追加", () => selectAfter(tryApply([{ op: "addPart", type: def.type }])), "primary"),
  );
}

// drop a part from the list onto the board
el.stage.addEventListener("dragover", (ev) => {
  if (!ev.dataTransfer.types.includes(PART_MIME)) return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect = "copy";
});
el.stage.addEventListener("drop", (ev) => {
  const type = ev.dataTransfer.getData(PART_MIME);
  if (!type) return;
  ev.preventDefault();
  ev.stopPropagation();
  const pt = svgPoint(ev);
  const hole = holeNear(pt, 0.7);
  if (hole) return selectAfter(tryApply([{ op: "addPart", type, at: hole }]));
  if (!onBoard(pt.x, pt.y)) return selectAfter(tryApply([{ op: "addPart", type, pos: [half(pt.x), half(pt.y)] }]));
  flash("穴の上か、ボードの外にドロップしてください");
});

// ---- toolbar ----

for (const [type, spec] of Object.entries(BOARD_TYPES)) {
  el.board.append(Object.assign(document.createElement("option"), { value: type, textContent: spec.label }));
}
el.board.addEventListener("change", () => tryApply([{ op: "setBoard", board: el.board.value }]));
for (const c of Object.keys(WIRE_COLORS)) {
  el.wireColor.append(Object.assign(document.createElement("option"), { value: c, textContent: c }));
}
el.wireColor.value = "red";
el.play.addEventListener("click", () => setPlaying(!player.playing));
el.animDuration.addEventListener("change", () => {
  const sec = Number(el.animDuration.value);
  if (sec > 0) tryApply([{ op: "setAnimation", duration: Math.round(sec * 1000) }]);
});
el.animLoop.addEventListener("change", () => tryApply([{ op: "setAnimation", loop: el.animLoop.checked }]));
el.animTime.addEventListener("input", () => {
  setPlaying(false);
  seek(Number(el.animTime.value));
});
el.undo.addEventListener("click", undo);
el.redo.addEventListener("click", redo);

function setZoom(z) {
  zoom = z;
  draw();
}
$("btn-zoom-in").addEventListener("click", () => setZoom((zoom ?? currentFitZoom()) * 1.25));
$("btn-zoom-out").addEventListener("click", () => setZoom((zoom ?? currentFitZoom()) / 1.25));
$("btn-zoom-fit").addEventListener("click", () => setZoom(null));

function currentFitZoom() {
  const svg = el.stage.querySelector("svg");
  return svg.getBoundingClientRect().width / Number(svg.getAttribute("width"));
}

// ---- import / export ----

function download(name, data, type) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  // some browsers ignore the file name unless the link is in the document
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const baseName = () => (circuit.title || "circuit").replace(/[\\/:*?"<>|\s]+/g, "_");

$("btn-save").addEventListener("click", () => download(`${baseName()}.json`, stringifyCircuit(circuit), "application/json"));
el.exportMenu.addEventListener("change", async () => {
  const kind = el.exportMenu.value;
  el.exportMenu.value = "";
  if (kind === "svg-anim") return download(`${baseName()}.svg`, renderSvg(result, { embed: circuit }), "image/svg+xml");
  // still frames show the animation at the moment currently on screen
  const svg = renderSvg(result, { embed: circuit, time: localTime() });
  if (kind === "svg-still") return download(`${baseName()}.svg`, svg, "image/svg+xml");
  if (kind) download(`${baseName()}.png`, await svgToPng(svg, { background: kind === "png-white" ? "#fff" : null }), "image/png");
});

// Rasterizes an SVG string; background null keeps it transparent.
async function svgToPng(svg, { scale = 2, background = null } = {}) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}
$("btn-new").addEventListener("click", () => commit(emptyCircuit()));
$("btn-open").addEventListener("click", () => el.file.click());
el.file.addEventListener("change", async () => {
  const f = el.file.files?.[0];
  if (f) loadText(await f.text());
  el.file.value = "";
});

$("examples").addEventListener("change", async (ev) => {
  const name = ev.target.value;
  ev.target.value = "";
  if (name) await loadExample(name);
});

async function loadExample(name) {
  const res = await fetch(`examples/${name}.json`);
  if (!res.ok) return showMessages([`サンプル "${name}" が見つかりません`], []);
  loadText(await res.text());
}

function loadText(text) {
  try {
    selection = null;
    commit(parseCircuitText(text));
  } catch (e) {
    showMessages([`読み込めませんでした: ${e.message}`], []);
  }
}

// drag & drop a JSON file, or an SVG exported by this app
const hint = $("drop-hint");
const isFileDrag = (ev) => ev.dataTransfer?.types.includes("Files");
window.addEventListener("dragover", (ev) => {
  if (!isFileDrag(ev)) return;
  ev.preventDefault();
  hint.hidden = false;
});
window.addEventListener("dragleave", (ev) => {
  if (!ev.relatedTarget) hint.hidden = true;
});
window.addEventListener("drop", async (ev) => {
  hint.hidden = true;
  if (!isFileDrag(ev)) return;
  ev.preventDefault();
  const f = ev.dataTransfer.files[0];
  if (f) loadText(await f.text());
});

// ---- scripting API for AI agents (devtools / Playwright) ----

window.bb = {
  /** Current circuit JSON (a copy). */
  get: () => structuredClone(circuit),
  /** Replace the circuit (object, JSON text, or exported SVG text). */
  load: (c) => commit(typeof c === "string" ? parseCircuitText(c) : c),
  /** Apply edit ops (see docs/OPS.md) as one undo step. Throws on error. Returns affected ids. */
  apply: (ops) => apply(ops),
  addPart: (type, opts = {}) => apply([{ op: "addPart", type, ...opts }])[0],
  move: (id, to) => apply([{ op: "move", id, to }]),
  rotate: (id, by = 90) => apply([{ op: "rotate", id, by }]),
  setPin: (id, pin, to) => apply([{ op: "setPin", id, pin, to }]),
  update: (id, set) => apply([{ op: "update", id, set }]),
  remove: (id) => apply([{ op: "remove", id }]),
  addWire: (from, to, color = "red") => apply([{ op: "addWire", from, to, color }])[0],
  undo,
  redo,
  select,
  /** Animation playback: play(), pause(), seek(ms). */
  play: () => setPlaying(true),
  pause: () => setPlaying(false),
  seek: (ms) => {
    setPlaying(false);
    seek(ms);
  },
  /** Validation result and netlist as text. */
  check: () => describe(result),
  /** What is at a hole: { hole, occupant, net }. */
  inspect: (hole) => ({ hole, occupant: result.occupied.get(hole) ?? null, net: result.netOfHole(hole) }),
  /** Available part types with pins and params. */
  parts: () =>
    [...result.registry.parts.values()].map((d) => ({
      type: d.type,
      name: d.name,
      mount: d.mount,
      params: Object.fromEntries(Object.entries(d.params ?? {}).map(([k, s]) => [k, s.default])),
      pins: d.pins(Object.fromEntries(Object.entries(d.params ?? {}).map(([k, s]) => [k, s.default]))).map((p) => p.name),
    })),
  /** SVG with the circuit embedded; { time: ms } gives a still frame. */
  svg: (opts = {}) => renderSvg(result, { embed: circuit, ...opts }),
  /** PNG (Blob) of the frame at { time } (default: now); background null = transparent. */
  png: (opts = {}) => svgToPng(renderSvg(result, { time: opts.time ?? localTime() }), opts),
  ops: OP_NAMES,
  help: () =>
    "bb.get() / bb.load(json) / bb.apply([{op:'addPart',type:'led',at:'a10'}, ...]) / bb.check() / bb.inspect('a10') / bb.parts() / bb.undo() — 詳細は docs/OPS.md",
};

// ---- start ----

(async () => {
  // ?example=<name> opens a bundled example (used by the README links)
  const example = new URLSearchParams(location.search).get("example");
  if (example && /^[\w-]+$/.test(example)) {
    await loadExample(example);
    history.replaceState(null, "", location.pathname);
    return;
  }
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    saved = null;
  }
  if (saved) commit(saved, { record: false });
  else {
    const res = await fetch("examples/blink-nano.json");
    commit(parseCircuitText(await res.text()), { record: false });
  }
})();
