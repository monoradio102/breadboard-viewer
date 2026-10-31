// Browser UI. Every edit goes through ops.js (the same operations AI agents use via window.bb).
import { BOARD_TYPES } from "./board.js";
import { describe, resolveCircuit, stripOf } from "./circuit.js";
import { emptyCircuit, mergeDefs, parseCircuitText, parseLibrary, stringifyCircuit, stringifyLibrary } from "./io.js";
import { fromJson } from "./parts/registry.js";
import { OP_NAMES, OpError, applyOps, normalize } from "./ops.js";
import { planAssembly } from "./assembly.js";
import { WIRE_COLORS, renderBounds, renderSvg } from "./render.js";

const STORAGE_KEY = "breadboard-viewer:last";
const CAPTIONS_KEY = "breadboard-viewer:captions";
const LIBRARY_KEY = "breadboard-viewer:library";
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
  libFile: $("lib-file"),
  wireColor: $("wire-color"),
  undo: $("btn-undo"),
  redo: $("btn-redo"),
  player: $("player"),
  play: $("btn-play"),
  animTime: $("anim-time"),
  animLabel: $("anim-label"),
  animDuration: $("anim-duration"),
  animLoop: $("anim-loop"),
  captionsToggle: $("anim-captions"),
  assembly: $("btn-assembly"),
  stepPrev: $("btn-step-prev"),
  stepNext: $("btn-step-next"),
  caption: $("caption"),
  exportMenu: $("export"),
};

let circuit = normalize(emptyCircuit());
let result = resolveCircuit(circuit);
let selection = null; // id of the selected part or wire
let drag = null;
let view = null; // visible area {x, y, w, h} in pitch units (pan / zoom); null = fit on next draw
let showCaptions = readCaptionsSetting();
let library = readLibrarySetting(); // "my parts": JSON part definitions kept in this browser
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
  asmPlan = null;
  const exists = (id) => result.parts.some((p) => p.id === id) || result.wires.some((w) => w.id === id) || result.overlays?.some((o) => o.id === id);
  if (selection && !exists(selection)) {
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

// The whole stage is one canvas; `view` decides which part of the (unbounded) plane is shown.
// Captions are not drawn into the editor's SVG but shown in an HTML layer over the stage.
function draw(previewResult = result, extra = {}) {
  if (!view) fitView();
  el.stage.innerHTML = renderSvg(previewResult, {
    selection: assemblyMode ? null : selection,
    viewBox: viewBoxText(),
    captions: false,
    assembly: assemblyMode,
    ...extra,
  });
  syncPlayer();
}

const viewBoxText = () => `${view.x} ${view.y} ${view.w} ${view.h}`;

function stageSize() {
  const r = el.stage.getBoundingClientRect();
  return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
}

// Shows the whole circuit, keeping the stage's aspect ratio.
function fitView() {
  const r = renderBounds(result, { assembly: assemblyMode });
  const b = { x: r.x - 1.5, y: r.y - 1.5, w: r.w + 3, h: r.h + 3 };
  const { w: sw, h: sh } = stageSize();
  const k = Math.min(sw / b.w, sh / b.h); // px per pitch unit
  const w = sw / k;
  const h = sh / k;
  view = { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h };
}

// Updates the view without re-rendering (pan / zoom must stay smooth).
function applyView() {
  el.stage.querySelector("svg")?.setAttribute("viewBox", viewBoxText());
}

function zoomAt(factor, cx, cy) {
  const w = Math.min(600, Math.max(4, view.w * factor));
  const f = w / view.w;
  view = { x: cx - (cx - view.x) * f, y: cy - (cy - view.y) * f, w, h: view.h * f };
  applyView();
}

function zoomCenter(factor) {
  zoomAt(factor, view.x + view.w / 2, view.y + view.h / 2);
}

// keep the scale when the stage changes size
new ResizeObserver(() => {
  if (!view) return;
  const svg = el.stage.querySelector("svg");
  const { w: sw, h: sh } = stageSize();
  const k = svg ? svg.getBoundingClientRect().width / view.w || sw / view.w : sw / view.w;
  const cx = view.x + view.w / 2;
  const cy = view.y + view.h / 2;
  view = { x: cx - sw / k / 2, y: cy - sh / k / 2, w: sw / k, h: sh / k };
  applyView();
}).observe(el.stage);

function readLibrarySetting() {
  try {
    const defs = JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? "[]");
    return Array.isArray(defs) ? defs : [];
  } catch {
    return [];
  }
}

function readCaptionsSetting() {
  try {
    return localStorage.getItem(CAPTIONS_KEY) !== "off";
  } catch {
    return true;
  }
}

// ---- animation player ----
// Re-rendering creates new CSS animations; they are re-synced to one clock here.

const player = { playing: true, start: performance.now(), time: 0 };

function playerTime() {
  return player.playing ? performance.now() - player.start : player.time;
}

function syncPlayer() {
  const tl = activeTimeline();
  el.player.hidden = !tl?.animated;
  if (!tl?.animated) return;
  const t = playerTime();
  for (const a of el.stage.querySelector("svg")?.getAnimations({ subtree: true }) ?? []) {
    a.currentTime = t;
    if (!player.playing) a.pause();
  }
  el.play.textContent = player.playing ? "⏸" : "▶";
  // length / loop belong to the circuit's animation; step buttons to assembly mode
  for (const n of [el.animDuration.parentElement, el.animLoop.parentElement]) n.hidden = assemblyMode;
  for (const n of [el.stepPrev, el.stepNext]) n.hidden = !assemblyMode;
  if (assemblyMode) return;
  if (document.activeElement !== el.animDuration) el.animDuration.value = String(tl.duration / 1000);
  el.animLoop.checked = tl.loop;
}

// ---- assembly mode ----
// Parts start in a tray and move into place step by step (assembly.js). View only.

let assemblyMode = false;
let asmPlan = null; // computed lazily for the current circuit

function activeTimeline() {
  if (!assemblyMode) return result.timeline;
  asmPlan ??= planAssembly(result);
  return { duration: asmPlan.duration, loop: true, animated: true, captions: asmPlan.captions };
}

function setAssemblyMode(on) {
  assemblyMode = on;
  asmPlan = null;
  el.assembly.classList.toggle("active", on);
  el.assembly.setAttribute("aria-pressed", String(on));
  selection = null;
  view = null;
  seek(0);
  setPlaying(true);
  draw();
  renderInspector();
}

function goToStep(k) {
  activeTimeline();
  setPlaying(false);
  seek(asmPlan.timeOfStep(Math.max(0, Math.min(asmPlan.steps.length, k))));
}

el.assembly.addEventListener("click", () => setAssemblyMode(!assemblyMode));
function currentStep() {
  activeTimeline(); // makes sure asmPlan exists
  return asmPlan.stepAt(localTime());
}

el.stepPrev.addEventListener("click", () => goToStep(currentStep() - 1));
el.stepNext.addEventListener("click", () => goToStep(currentStep() + 1));

function renderStepsEditor(box) {
  const steps = circuit.steps ?? [];
  const setSteps = (next) => tryApply([{ op: "setSteps", steps: next }]);
  box.append(node("h3", "組み立て手順"));
  if (!steps.length) {
    box.append(node("p", "手順が未設定なので、自動の手順で表示しています。「自動で作る」で編集できる手順になります。", "hint"));
  }
  steps.forEach((step, i) => {
    const row = node("div", undefined, "step-row");
    const textInput = Object.assign(document.createElement("input"), { value: step.text ?? "", placeholder: "説明" });
    textInput.addEventListener("change", () => setSteps(steps.map((s, j) => (j === i ? { ...s, text: textInput.value } : s))));
    const itemsInput = Object.assign(document.createElement("input"), { value: (step.items ?? []).join(", "), placeholder: "部品・配線のID", className: "step-items" });
    itemsInput.addEventListener("change", () => {
      const items = itemsInput.value.split(/[\s,、]+/).filter(Boolean);
      setSteps(steps.map((s, j) => (j === i ? { ...s, items } : s)));
    });
    const moveUp = button("↑", () => i > 0 && setSteps(steps.map((s, j) => (j === i - 1 ? steps[i] : j === i ? steps[i - 1] : s))));
    moveUp.title = "前へ";
    const remove = button("×", () => setSteps(steps.filter((_, j) => j !== i)), "danger");
    remove.title = "この手順を消す";
    const show = button(`${i + 1}`, () => goToStep(i + 1));
    show.title = "この手順を表示";
    row.append(show, textInput, moveUp, remove, itemsInput);
    box.append(row);
  });
  const actions = node("div", undefined, "row");
  actions.append(
    button("自動で作る", () => tryApply([{ op: "autoSteps" }])),
    button("手順を追加", () => setSteps([...steps, { text: "", items: [] }])),
  );
  if (steps.length) actions.append(button("すべて消す", () => setSteps(null), "danger"));
  box.append(actions);
  box.append(node("p", "まだ置いていない部品はボードの下に並び、手順ごとに移動します。手順にない部品・配線は最初から置かれています。", "hint"));
}

// Current position within one loop of the animation (ms).
function localTime() {
  const tl = activeTimeline();
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
  const tl = activeTimeline();
  if (tl?.animated) {
    const local = localTime();
    el.animTime.max = String(tl.duration);
    if (document.activeElement !== el.animTime) el.animTime.value = String(local);
    el.animLabel.textContent = assemblyMode
      ? `手順 ${asmPlan.stepAt(local)} / ${asmPlan.steps.length}`
      : `${(local / 1000).toFixed(1)}s / ${(tl.duration / 1000).toFixed(1)}s`;
  }
  updateCaption();
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
  if (!el.stage.querySelector("svg")) return;
  if (ev.button === 1) {
    // middle button pans from anywhere
    drag = { kind: "pan", x: ev.clientX, y: ev.clientY, view: { ...view } };
    el.stage.setPointerCapture(ev.pointerId);
    ev.preventDefault();
    return;
  }
  if (ev.button !== 0) return;
  if (assemblyMode) {
    drag = { kind: "pan", x: ev.clientX, y: ev.clientY, view: { ...view } };
    el.stage.setPointerCapture(ev.pointerId);
    ev.preventDefault();
    return;
  }
  const pt = svgPoint(ev);
  const handleEl = ev.target.closest("[data-handle]");
  const pinEl = ev.target.closest("[data-pin]");
  const overlayEl = ev.target.closest(".overlay");
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
  } else if (overlayEl) {
    select(overlayEl.dataset.id);
    const o = circuit.overlays.find((x) => x.id === overlayEl.dataset.id);
    drag = { kind: "overlay", id: o.id, startPt: pt, origin: { x: o.x, y: o.y } };
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
    // empty space: drag the whole view
    drag = hole ? { kind: "wire", from: hole, fromPos: result.board.pos(hole) } : { kind: "pan", x: ev.clientX, y: ev.clientY, view: { ...view } };
  }
  drag.preview = null;
  el.stage.setPointerCapture(ev.pointerId);
  ev.preventDefault();
});

el.stage.addEventListener("pointermove", (ev) => {
  if (!el.stage.querySelector("svg") || !result.board) return;
  if (drag?.kind === "pan") {
    const k = el.stage.querySelector("svg").getBoundingClientRect().width / view.w;
    view = { ...view, x: drag.view.x - (ev.clientX - drag.x) / k, y: drag.view.y - (ev.clientY - drag.y) / k };
    el.stage.classList.add("panning");
    return applyView();
  }
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
  if (drag.kind === "overlay") {
    const pos = [half(drag.origin.x + pt.x - drag.startPt.x), half(drag.origin.y + pt.y - drag.startPt.y)];
    if (JSON.stringify(pos) === drag.lastTo) return;
    drag.lastTo = JSON.stringify(pos);
    ops = [{ op: "move", id: drag.id, pos }];
  } else if (drag.kind === "move") {
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
  el.stage.classList.remove("panning");
  if (d.kind === "pan") return;
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
  } else if (ev.key === " " && activeTimeline()?.animated) {
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
  if (assemblyMode) return renderStepsEditor(box);
  const part = result.parts.find((p) => p.id === selection);
  const wire = circuit.wires.find((w) => w.id === selection);
  const overlay = circuit.overlays?.find((o) => o.id === selection);
  if (overlay) {
    const id = overlay.id;
    box.append(node("h3", `${id} · 演出 (SVG)`));
    box.append(field("ID", id, (v) => v && v !== id && selectAfter(tryApply([{ op: "update", id, set: { id: v } }]))));
    for (const key of ["x", "y", "w", "h"]) {
      box.append(field(key, overlay[key], (v) => Number.isFinite(Number(v)) && tryApply([{ op: "update", id, set: { [key]: Number(v) } }])));
    }
    box.append(node("p", "SVGの中身は右の回路データ (overlays) で編集できます。アニメーションでは show / opacity を切り替えられます。", "hint"));
    const row = node("div", undefined, "row");
    row.append(button("削除", () => tryApply([{ op: "remove", id }]), "danger"));
    box.append(row);
    return;
  }
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
    box.append(node("p", part.pins.map((p) => `${p.name}=${p.hole ?? (part.offboard ? "ボード外" : "?")}`).join("  "), "pins"));
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
  const byCat = new Map([["マイ部品", []]]);
  const add = (cat, def) => {
    const hay = `${def.type} ${def.name} ${def.category} ${def.description}`.toLowerCase();
    if (q && !hay.includes(q)) return;
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(def);
  };
  // library parts first; a type the circuit already defines is shown from the circuit
  for (const json of library) {
    if (result.registry?.get(json.type)) continue;
    try {
      add("マイ部品", fromJson(json));
    } catch {
      // invalid entries are skipped (they were validated on import)
    }
  }
  for (const def of result.registry?.parts.values() ?? []) add(def.category, def);
  if (!byCat.get("マイ部品").length) byCat.delete("マイ部品");
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
  const row = node("div", undefined, "row");
  row.append(button("回路に追加", () => selectAfter(tryApply([...libraryOps(def.type), { op: "addPart", type: def.type }])), "primary"));
  if (!def.builtin && def.json) {
    const inLibrary = library.some((x) => x.type === def.type);
    if (inLibrary) row.append(button("マイ部品から削除", () => removeFromLibrary(def.type), "danger"));
    else row.append(button("マイ部品に保存", () => addToLibrary([def.json])));
  }
  d.append(row);
}

// ---- my parts library ----

// definePart op for a library part the circuit does not define yet
function libraryOps(type) {
  if (result.registry?.get(type)) return [];
  const def = library.find((d) => d.type === type);
  return def ? [{ op: "definePart", def }] : [];
}

function saveLibrary() {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
  } catch {
    flash("ブラウザに保存できませんでした (プライベートモードなど)");
  }
  renderPartList();
  el.partDetail.hidden = true;
}

function addToLibrary(defs) {
  library = mergeDefs(library, defs);
  saveLibrary();
  el.status.textContent = `マイ部品に保存しました: ${defs.map((d) => d.type).join(", ")}`;
}

function removeFromLibrary(type) {
  library = library.filter((d) => d.type !== type);
  saveLibrary();
}

function importLibrary(text) {
  try {
    const lib = parseLibrary(text, fromJson);
    if (!lib.defs.length) return showMessages([`部品定義が見つかりませんでした`, ...lib.errors], []);
    addToLibrary(lib.defs);
    if (lib.errors.length) showMessages(lib.errors, []);
  } catch (e) {
    showMessages([`部品を読み込めませんでした: ${e.message}`], []);
  }
}

$("btn-lib-import").addEventListener("click", () => el.libFile.click());
el.libFile.addEventListener("change", async () => {
  for (const f of el.libFile.files ?? []) importLibrary(await f.text());
  el.libFile.value = "";
});
$("btn-lib-save").addEventListener("click", () => {
  if (!circuit.partDefs?.length) return flash("この回路には独自部品がありません");
  addToLibrary(circuit.partDefs);
});
$("btn-lib-export").addEventListener("click", () => {
  if (!library.length) return flash("マイ部品は空です");
  download("my-parts.json", stringifyLibrary("my-parts", library), "application/json");
});

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
  if (hole) return selectAfter(tryApply([...libraryOps(type), { op: "addPart", type, at: hole }]));
  if (!onBoard(pt.x, pt.y)) return selectAfter(tryApply([...libraryOps(type), { op: "addPart", type, pos: [half(pt.x), half(pt.y)] }]));
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

$("btn-zoom-in").addEventListener("click", () => zoomCenter(1 / 1.25));
$("btn-zoom-out").addEventListener("click", () => zoomCenter(1.25));
$("btn-zoom-fit").addEventListener("click", () => {
  fitView();
  applyView();
});

// wheel / trackpad pinch zooms around the pointer
el.stage.addEventListener(
  "wheel",
  (ev) => {
    if (!view || !el.stage.querySelector("svg")) return;
    ev.preventDefault();
    const pt = svgPoint(ev);
    const delta = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
    zoomAt(Math.exp(delta * (ev.ctrlKey ? 0.01 : 0.0015)), pt.x, pt.y);
  },
  { passive: false },
);

el.captionsToggle.checked = showCaptions;
el.captionsToggle.addEventListener("change", () => {
  showCaptions = el.captionsToggle.checked;
  try {
    localStorage.setItem(CAPTIONS_KEY, showCaptions ? "on" : "off");
  } catch {
    // storage unavailable
  }
  updateCaption();
});

// HTML caption layer over the stage, following the animation clock
function updateCaption() {
  const tl = activeTimeline();
  const t = localTime();
  const current = tl?.animated ? [...tl.captions].reverse().find((c) => c.t <= t) : null;
  el.caption.hidden = !showCaptions || !current;
  if (current && el.caption.textContent !== current.text) el.caption.textContent = current.text;
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
  const mode = { captions: showCaptions, assembly: assemblyMode };
  if (kind === "svg-anim") return download(`${baseName()}.svg`, renderSvg(result, { embed: circuit, ...mode }), "image/svg+xml");
  // still frames show the animation (or assembly) at the moment currently on screen
  const svg = renderSvg(result, { embed: circuit, time: localTime(), ...mode });
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
$("btn-new").addEventListener("click", () => {
  view = null;
  commit(emptyCircuit());
});
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
    view = null;
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
  if (!f) return;
  const text = await f.text();
  // a plain SVG (not exported by this app) dropped on the board becomes an overlay
  if (text.trimStart().startsWith("<") && !text.includes('id="breadboard-circuit"') && el.stage.contains(ev.target)) {
    return addOverlayFromSvg(text, svgPoint(ev));
  }
  if (isLibraryFile(text)) return importLibrary(text);
  loadText(text);
});

// a JSON with part definitions but no parts is a library, not a circuit
function isLibraryFile(text) {
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) || (Array.isArray(data?.partDefs) && !Array.isArray(data?.parts));
  } catch {
    return false;
  }
}

function addOverlayFromSvg(svg, at) {
  const ratio = svgAspect(svg);
  const w = 6;
  const h = Math.round((w / ratio) * 2) / 2 || 6;
  selectAfter(tryApply([{ op: "addOverlay", svg, x: half(at.x - w / 2), y: half(at.y - h / 2), w, h }]));
}

// width / height of an SVG from its viewBox (or width / height attributes)
function svgAspect(svg) {
  const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(svg);
  const w = Number(vb?.[1] ?? /\swidth\s*=\s*["']([\d.]+)/.exec(svg)?.[1]);
  const h = Number(vb?.[2] ?? /\sheight\s*=\s*["']([\d.]+)/.exec(svg)?.[1]);
  return w > 0 && h > 0 ? w / h : 1;
}

// ---- scripting API for AI agents (devtools / Playwright) ----

window.bb = {
  /** Current circuit JSON (a copy). */
  get: () => structuredClone(circuit),
  /** Replace the circuit (object, JSON text, or exported SVG text). */
  load: (c) => commit(typeof c === "string" ? parseCircuitText(c) : c),
  /** My parts library: list / add definitions (kept in this browser). */
  library: () => structuredClone(library),
  addToLibrary: (defs) => addToLibrary(Array.isArray(defs) ? defs : [defs]),
  /** Add user SVG drawn above the circuit (x, y, w, h in pitch units). */
  addOverlay: (svg, box) => apply([{ op: "addOverlay", svg, ...box }])[0],
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
  svg: (opts = {}) => renderSvg(result, { embed: circuit, captions: showCaptions, assembly: assemblyMode, ...opts }),
  /** PNG (Blob) of the frame at { time } (default: now); background null = transparent. */
  png: (opts = {}) =>
    svgToPng(renderSvg(result, { time: opts.time ?? localTime(), captions: opts.captions ?? showCaptions, assembly: opts.assembly ?? assemblyMode }), opts),
  /** Assembly mode on / off; step(k) shows step k (0 = all parts in the tray). */
  assembly: (on = true) => setAssemblyMode(Boolean(on)),
  step: (k) => goToStep(k),
  /** Show the whole circuit / zoom (factor < 1 zooms in). */
  fit: () => {
    fitView();
    applyView();
  },
  zoom: (factor) => zoomCenter(factor),
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
