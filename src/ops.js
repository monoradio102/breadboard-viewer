// Editing operations on circuit JSON. Pure functions (no DOM): the browser UI, the
// window.bb API and `tools/bb.mjs apply` all go through these, so humans and AI agents
// edit circuits the same way.
//
// An op is a JSON object, e.g.
//   { "op": "addPart", "type": "led", "pins": ["a1", "a2"], "color": "green" }
//   { "op": "move", "id": "R1", "to": "a10" }
//   { "op": "move", "id": "SV1", "pos": [40, -8] }            (off the board)
//   { "op": "addWire", "from": "j14", "to": "SV1.SIG" }       (wire to a pin of an off-board part)
//   { "op": "rotate", "id": "U1" }
//   { "op": "setPin", "id": "R1", "pin": "2", "to": "a14" }
//   { "op": "update", "id": "R1", "set": { "value": "1k" } }
//   { "op": "remove", "id": "R1" }
//   { "op": "addWire", "from": "a1", "to": "T-1", "color": "black" }
//   { "op": "setBoard", "board": "full" }
//   { "op": "setWireStyle", "style": "kit" }
//   { "op": "animate", "target": "D1", "keys": [{ "t": 0, "on": true }, { "t": 500, "on": false }] }
//   { "op": "setAnimation", "duration": 1000, "captions": [{ "t": 0, "text": "..." }] }
//   { "op": "addOverlay", "svg": "<svg ...>...</svg>", "x": 10, "y": -4, "w": 6, "h": 6 }
//   { "op": "definePart", "def": { "type": "my-sensor", "pins": [...], "shapes": [...] } }
//   { "op": "setSteps", "steps": [{ "text": "Nano を挿す", "items": ["U1"] }] }  /  { "op": "autoSteps" }
//   { "op": "setAssembly", "tray": { "U1": [5, 24] }, "timing": { "step": 3000 } }
// See docs/OPS.md for the full list.
import { autoSteps } from "./assembly.js";
import { createBoard } from "./board.js";
import { findFreeSpot, resolveCircuit, rotate } from "./circuit.js";
import { BUILTIN_PARTS } from "./parts/builtin.js";
import { createRegistry, fromJson } from "./parts/registry.js";
import { spriteError } from "./svg.js";

export class OpError extends Error {}

const fail = (msg) => {
  throw new OpError(msg);
};

const ID_PREFIX = {
  resistor: "R", led: "LED", diode: "D", capacitor: "C", electrolytic: "C", cds: "CDS", transistor: "Q",
  regulator: "U", button: "SW", trimmer: "VR", buzzer: "BZ", header: "J", motor: "M", servo: "SV", seg7: "DS",
  dht11: "U", hcsr04: "U", relay: "K", rgbled: "LED", pot: "VR", lcd1602: "LCD",
  speaker: "SP", battery: "BT", inmp441: "MIC", max98357a: "AMP", ws2812b: "LED", ssd1306: "DISP", qwiic: "J",
};

// Gives every wire an id, so wires can be addressed by ops.
export function normalize(circuit) {
  const c = structuredClone(circuit);
  c.parts ??= [];
  c.wires ??= [];
  if (c.overlays && !c.overlays.length) delete c.overlays;
  const used = new Set(c.wires.map((w) => w.id).filter(Boolean));
  let i = 1;
  c.wires = c.wires.map((w) => {
    if (w.id) return w;
    while (used.has(`W${i}`)) i++;
    used.add(`W${i}`);
    return { id: `W${i}`, ...w };
  });
  return c;
}

// Applies ops in order. Throws OpError (and changes nothing) if any op fails.
// Returns { circuit, ids } where ids[i] is the id created/affected by ops[i].
export function applyOps(circuit, ops) {
  let c = normalize(circuit);
  const ids = [];
  (Array.isArray(ops) ? ops : [ops]).forEach((op, i) => {
    const fn = OPS[op?.op];
    if (!fn) fail(`#${i + 1}: 未知の操作 "${op?.op}" (使えるもの: ${Object.keys(OPS).join(", ")})`);
    try {
      const out = fn(c, op);
      c = out.circuit;
      ids.push(out.id ?? op.id ?? null);
    } catch (e) {
      if (e instanceof OpError) fail(`#${i + 1} ${op.op}: ${e.message}`);
      throw e;
    }
  });
  return { circuit: c, ids };
}

const OPS = {
  addPart(c, { op, id, ...rest }) {
    const def = registryFor(c).get(rest.type) ?? fail(`未知の部品タイプ "${rest.type}"`);
    const inst = { id: id ?? nextId(c, ID_PREFIX[def.type] ?? def.json?.prefix ?? defaultPrefix(def)), ...rest };
    if (usedIds(c).has(inst.id)) fail(`ID "${inst.id}" は既に使われています`);
    if (inst.pos !== undefined) {
      checkPos(inst.pos);
    } else if (inst.at === undefined && inst.pins === undefined) {
      const spot = findFreeSpot(resolveCircuit(c), def, rest) ?? fail(`${def.name} を置ける空きが見つかりません`);
      if (def.mount === "leads") inst.pins = spot.pins;
      else inst.at = spot.at;
    } else if (inst.at !== undefined && def.mount === "leads" && inst.pins === undefined) {
      // leads parts placed by hole get explicit pins, so each leg can be moved later
      inst.pins = layoutHoles(c, def, inst, inst.at, inst.rot ?? 0);
      delete inst.at;
      delete inst.rot;
    }
    return { circuit: { ...c, parts: [...c.parts, inst] }, id: inst.id };
  },

  // to: a hole (on the board), or pos: [x, y] (free placement off the board / overlay position)
  move(c, { id, to, pos }) {
    const oi = overlayIndex(c, id);
    if (oi >= 0) {
      checkPos(pos);
      return { circuit: { ...c, overlays: c.overlays.map((o, i) => (i === oi ? { ...o, x: pos[0], y: pos[1] } : o)) } };
    }
    const { inst, index, def } = partInfo(c, id);
    if (pos !== undefined) {
      checkPos(pos);
      const { at, pins, ...rest } = inst;
      return { circuit: replacePart(c, index, { ...rest, pos }) };
    }
    const board = boardOf(c);
    if (!board.has(to)) fail(`"${to}" はこのボードにない穴です`);
    let next;
    if (inst.pos !== undefined) {
      const { pos: _, ...rest } = inst;
      next = def.mount === "leads" ? { ...withoutRot(rest), pins: layoutHoles(c, def, inst, to, inst.rot ?? 0) } : { ...rest, at: to };
    } else if (inst.pins !== undefined) {
      const holes = pinHoles(inst, def);
      const from = board.pos(holes[0]) ?? fail(`${id} のピンの位置が不正です`);
      const target = board.pos(to);
      const moved = holes.map((h) => {
        const p = board.pos(h) ?? fail(`${id} のピン "${h}" が不正です`);
        return board.holeAt(p.x + target.x - from.x, p.y + target.y - from.y) ?? fail(`${id} を ${to} に動かすとピンが穴から外れます`);
      });
      next = withPinHoles(inst, def, moved);
    } else {
      next = { ...inst, at: to };
    }
    return { circuit: replacePart(c, index, next) };
  },

  rotate(c, { id, by = 90 }) {
    const { inst, index, def } = partInfo(c, id);
    const step = ((Number(by) % 360) + 360) % 360;
    if (step % 90 !== 0) fail("by は 90 の倍数です");
    if (inst.pins === undefined) {
      const rot = (((Number(inst.rot ?? 0) + step) % 360) + 360) % 360;
      const next = { ...inst, rot };
      if (rot === 0) delete next.rot;
      return { circuit: replacePart(c, index, next) };
    }
    const board = boardOf(c);
    const holes = pinHoles(inst, def);
    const o = board.pos(holes[0]);
    const rotated = holes.map((h) => {
      const p = board.pos(h);
      const [dx, dy] = rotate(p.x - o.x, p.y - o.y, step);
      return board.holeAt(o.x + dx, o.y + dy) ?? fail(`${id} を回転するとピンが穴から外れます`);
    });
    return { circuit: replacePart(c, index, withPinHoles(inst, def, rotated)) };
  },

  setPin(c, { id, pin, to }) {
    const { inst, index, def } = partInfo(c, id);
    if (def.mount !== "leads") fail(`${id} は足を曲げられない部品です (move を使ってください)`);
    if (inst.pos !== undefined) fail(`${id} はボード外に置いた部品です (move の to で穴に挿してから動かしてください)`);
    if (!boardOf(c).has(to)) fail(`"${to}" はこのボードにない穴です`);
    const names = def.pins(paramsOf(def, inst)).map((p) => p.name);
    const i = names.indexOf(String(pin));
    if (i < 0) fail(`${id} にピン "${pin}" はありません (${names.join(", ")})`);
    const holes = inst.pins !== undefined ? pinHoles(inst, def) : layoutHoles(c, def, inst, inst.at, inst.rot ?? 0);
    holes[i] = to;
    const next = withPinHoles({ ...inst }, def, holes);
    delete next.at;
    delete next.rot;
    return { circuit: replacePart(c, index, next) };
  },

  update(c, { id, set = {} }) {
    const oi = overlayIndex(c, id);
    if (oi >= 0) {
      const o = clean({ ...c.overlays[oi], ...set });
      if (o.id !== id && usedIds(c).has(o.id)) fail(`ID "${o.id}" は既に使われています`);
      return { circuit: retarget({ ...c, overlays: c.overlays.map((x, i) => (i === oi ? o : x)) }, id, o.id), id: o.id };
    }
    const wireIndex = c.wires.findIndex((w) => w.id === id);
    if (wireIndex >= 0) {
      const wire = clean({ ...c.wires[wireIndex], ...set });
      if (wire.id !== id && c.wires.some((w) => w.id === wire.id)) fail(`ID "${wire.id}" は既に使われています`);
      return { circuit: retarget({ ...c, wires: c.wires.map((w, i) => (i === wireIndex ? wire : w)) }, id, wire.id), id: wire.id };
    }
    const { inst, index } = partInfo(c, id);
    if ("type" in set) fail("type は変更できません (remove して addPart してください)");
    const next = clean({ ...inst, ...set });
    if (next.id !== id && findPart(c, next.id, false)) fail(`ID "${next.id}" は既に使われています`);
    let out = retarget(replacePart(c, index, next), id, next.id);
    if (next.id !== id) {
      // wires attached to the renamed part's pins follow it
      const rename = (ref) => (isPinOf(ref, id) ? `${next.id}${String(ref).slice(id.length)}` : ref);
      out = { ...out, wires: out.wires.map((w) => ({ ...w, from: rename(w.from), to: rename(w.to) })) };
    }
    return { circuit: out, id: next.id };
  },

  // Removing a part also removes the wires attached to its pins ("R1.2").
  remove(c, { id }) {
    if (overlayIndex(c, id) >= 0) {
      const { overlays, ...rest } = c;
      const left = overlays.filter((o) => o.id !== id);
      return { circuit: retarget(left.length ? { ...rest, overlays: left } : rest, id, null) };
    }
    if (c.wires.some((w) => w.id === id)) return { circuit: retarget({ ...c, wires: c.wires.filter((w) => w.id !== id) }, id, null) };
    partInfo(c, id);
    let next = { ...c, parts: c.parts.filter((p) => p.id !== id) };
    for (const w of c.wires.filter((w) => isPinOf(w.from, id) || isPinOf(w.to, id))) next = retarget(next, w.id, null);
    next.wires = c.wires.filter((w) => !isPinOf(w.from, id) && !isPinOf(w.to, id));
    return { circuit: retarget(next, id, null) };
  },

  addWire(c, { op, id, from, to, ...rest }) {
    for (const h of [from, to]) checkEnd(c, h);
    if (from === to) fail("from と to が同じです");
    const wid = id ?? nextId(c, "W");
    if (usedIds(c).has(wid)) fail(`ID "${wid}" は既に使われています`);
    return { circuit: { ...c, wires: [...c.wires, { id: wid, from, to, ...rest }] }, id: wid };
  },

  // Adds user SVG (an effect, arrow, note...) drawn above the circuit; x, y, w, h in pitch units.
  addOverlay(c, { op, id, svg, x, y, w, h, ...rest }) {
    const err = spriteError(svg);
    if (err) fail(err);
    if (![x, y, w, h].every(Number.isFinite)) fail("x, y, w, h (ピッチ単位) が必要です");
    const oid = id ?? nextId(c, "FX");
    if (usedIds(c).has(oid)) fail(`ID "${oid}" は既に使われています`);
    return { circuit: { ...c, overlays: [...(c.overlays ?? []), { id: oid, x, y, w, h, svg, ...rest }] }, id: oid };
  },

  // Sets the keys of one target's track (replace: false appends to the existing keys).
  // target: an id, an array of ids, or a group name from animation.groups.
  animate(c, { target, keys = [], replace = true }) {
    const groups = c.animation?.groups ?? {};
    const ids = Array.isArray(target) ? target : Array.isArray(groups[target]) ? groups[target] : [target];
    if (!ids.length) fail("target が空です");
    for (const id of ids) if (!usedIds(c).has(id)) fail(`target "${id}" の部品・配線が見つかりません`);
    if (!Array.isArray(keys) || keys.some((k) => !Number.isFinite(Number(k?.t)))) fail("keys は {t, ...状態} の配列です");
    const anim = { duration: 2000, loop: true, ...(c.animation ?? {}) };
    const tracks = [...(anim.tracks ?? [])];
    const i = tracks.findIndex((t) => JSON.stringify(t.target) === JSON.stringify(target));
    const merged = replace || i < 0 ? keys : [...tracks[i].keys, ...keys];
    const track = { target, keys: [...merged].sort((a, b) => a.t - b.t) };
    if (i < 0) tracks.push(track);
    else tracks[i] = track;
    return { circuit: { ...c, animation: { ...anim, tracks } }, id: Array.isArray(target) ? target.join(",") : target };
  },

  // Merges duration / loop / captions / tracks into the animation; clear: true removes it.
  setAnimation(c, { clear, op, ...fields }) {
    if (clear) {
      const { animation, ...rest } = c;
      return { circuit: rest };
    }
    return { circuit: { ...c, animation: { duration: 2000, loop: true, tracks: [], ...(c.animation ?? {}), ...fields } } };
  },

  setBoard(c, { board }) {
    createBoard(board);
    return { circuit: { ...c, board } };
  },

  // "flex": bendable jumper wires that arc above the board (default); "kit": wires from a
  // jumper wire kit, flat on the board with right-angle bends and colored by length
  setWireStyle(c, { style }) {
    if (!["flex", "kit"].includes(style)) fail(`style は "flex" か "kit" です`);
    if (style === "flex") {
      const { wireStyle: _, ...rest } = c;
      return { circuit: rest };
    }
    return { circuit: { ...c, wireStyle: style } };
  },

  setTitle(c, { title }) {
    return { circuit: { ...c, title: String(title ?? "") } };
  },

  // Assembly steps: [{ text, items: [ids] }] (see assembly.js); [] or null removes them.
  setSteps(c, { steps }) {
    if (steps == null || (Array.isArray(steps) && !steps.length)) {
      const { steps: _, ...rest } = c;
      return { circuit: rest };
    }
    if (!Array.isArray(steps) || steps.some((s) => !s || !Array.isArray(s.items))) fail("steps は { text, items: [ID...] } の配列です");
    const ids = usedIds(c);
    for (const s of steps) for (const id of s.items) if (!ids.has(id)) fail(`"${id}" という部品・配線はありません`);
    return { circuit: { ...c, steps } };
  },

  // Merges assembly settings (tray, trayOrigin, trayWidth, timing, introText, outroText,
  // numbering). tray and timing merge per key; null removes a key; clear: true removes all.
  setAssembly(c, { op, clear, ...fields }) {
    if (clear) {
      const { assembly, ...rest } = c;
      return { circuit: rest };
    }
    const cur = c.assembly ?? {};
    const next = { ...cur };
    for (const [k, v] of Object.entries(fields)) {
      if (v === null) delete next[k];
      else if ((k === "tray" || k === "timing") && typeof v === "object") next[k] = clean({ ...(cur[k] ?? {}), ...v });
      else next[k] = v;
    }
    for (const id of Object.keys(next.tray ?? {})) if (!c.parts.some((p) => p.id === id)) fail(`tray: "${id}" という部品はありません`);
    for (const [id, pos] of Object.entries(next.tray ?? {})) if (!Array.isArray(pos) || pos.length !== 2 || !pos.every(Number.isFinite)) fail(`tray.${id} は [x, y] です`);
    return { circuit: { ...c, assembly: next } };
  },

  // Generates steps: modules / ICs first, then the other parts, then wires a few at a time.
  autoSteps(c) {
    return { circuit: { ...c, steps: autoSteps(resolveCircuit(c)) } };
  },

  // Adds a JSON part definition to the circuit (replaces one with the same type).
  definePart(c, { def }) {
    try {
      fromJson(def);
    } catch (e) {
      fail(e.message);
    }
    if (BUILTIN_TYPES.has(def.type)) fail(`"${def.type}" は組み込み部品と同じ名前です`);
    const others = (c.partDefs ?? []).filter((d) => d.type !== def.type);
    return { circuit: { ...c, partDefs: [...others, def] }, id: def.type };
  },
};

const BUILTIN_TYPES = new Set(BUILTIN_PARTS.map((p) => p.type));

export const OP_NAMES = Object.keys(OPS);

// ---- helpers ----

function registryFor(c) {
  return createRegistry(c.partDefs ?? []);
}

function boardOf(c) {
  try {
    return createBoard(c.board ?? "half");
  } catch (e) {
    return fail(e.message);
  }
}

function findPart(c, id, required = true) {
  const index = c.parts.findIndex((p) => p.id === id);
  if (index < 0 && required) fail(`ID "${id}" の部品・配線が見つかりません`);
  return index < 0 ? null : { inst: c.parts[index], index };
}

function partInfo(c, id) {
  const { inst, index } = findPart(c, id);
  const def = registryFor(c).get(inst.type) ?? fail(`${id}: 未知の部品タイプ "${inst.type}"`);
  return { inst, index, def };
}

function replacePart(c, index, inst) {
  return { ...c, parts: c.parts.map((p, i) => (i === index ? inst : p)) };
}

function paramsOf(def, inst) {
  const params = {};
  for (const [k, spec] of Object.entries(def.params ?? {})) params[k] = inst[k] ?? spec.default;
  return params;
}

function pinHoles(inst, def) {
  if (Array.isArray(inst.pins)) return [...inst.pins];
  return def.pins(paramsOf(def, inst)).map((p) => inst.pins[p.name]);
}

// Keeps the instance's style: pins as an array or as a {name: hole} object.
function withPinHoles(inst, def, holes) {
  if (Array.isArray(inst.pins) || inst.pins === undefined) return { ...inst, pins: holes };
  const names = def.pins(paramsOf(def, inst)).map((p) => p.name);
  return { ...inst, pins: Object.fromEntries(names.map((n, i) => [n, holes[i]])) };
}

function layoutHoles(c, def, inst, at, rot) {
  const board = boardOf(c);
  const o = board.pos(at) ?? fail(`"${at}" はこのボードにない穴です`);
  return def.pins(paramsOf(def, inst)).map((p) => {
    const [dx, dy] = rotate(p.x, p.y, Number(rot));
    return board.holeAt(o.x + dx, o.y + dy) ?? fail(`${def.name} を ${at} に置くとピンが穴から外れます`);
  });
}

function overlayIndex(c, id) {
  return (c.overlays ?? []).findIndex((o) => o.id === id);
}

function usedIds(c) {
  return new Set([...c.parts.map((p) => p.id), ...c.wires.map((w) => w.id), ...(c.overlays ?? []).map((o) => o.id)]);
}

function nextId(c, prefix) {
  const used = usedIds(c);
  let i = 1;
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

function defaultPrefix(def) {
  return def.category === "IC" || def.category === "マイコンボード" ? "U" : "X";
}

const isPinOf = (ref, id) => String(ref).startsWith(`${id}.`);

function checkPos(pos) {
  if (!Array.isArray(pos) || pos.length !== 2 || !pos.every(Number.isFinite)) fail("pos は [x, y] (ピッチ単位) です");
}

function withoutRot({ rot, ...rest }) {
  return rest;
}

// A wire end is a hole of the board or "PartId.PinName".
function checkEnd(c, ref) {
  const board = boardOf(c);
  if (board.has(ref)) return;
  const hint = board.missingHint(ref);
  if (hint) fail(`穴 ${ref} はこのボードにありません。${hint}`);
  const dot = String(ref).indexOf(".");
  const inst = dot > 0 ? c.parts.find((p) => p.id === String(ref).slice(0, dot)) : null;
  if (!inst) fail(`"${ref}" はこのボードの穴でも、部品のピン (例: "SV1.SIG") でもありません`);
  const def = registryFor(c).get(inst.type) ?? fail(`未知の部品タイプ "${inst.type}"`);
  const names = def.pins(paramsOf(def, inst)).map((p) => p.name);
  if (!names.includes(String(ref).slice(dot + 1))) fail(`${inst.id} にピン "${String(ref).slice(dot + 1)}" はありません (${names.join(", ")})`);
}

// Keeps animation tracks pointing at renamed targets; to = null drops the target's track.
// Also keeps assembly steps pointing at renamed items (to = null drops the item).
function retarget(c, from, to) {
  if (from === to) return c;
  let out = c;
  if (c.animation) {
    const swap = (ids) => ids.flatMap((id) => (id !== from ? [id] : to === null ? [] : [to]));
    const tracks = (c.animation.tracks ?? []).flatMap((t) => {
      if (Array.isArray(t.target)) {
        const target = swap(t.target);
        return target.length ? [{ ...t, target }] : [];
      }
      return t.target !== from ? [t] : to === null ? [] : [{ ...t, target: to }];
    });
    const groups = c.animation.groups ? Object.fromEntries(Object.entries(c.animation.groups).map(([k, ids]) => [k, swap(ids)])) : undefined;
    out = { ...out, animation: { ...c.animation, ...(c.animation.tracks ? { tracks } : {}), ...(groups ? { groups } : {}) } };
  }
  if (Array.isArray(c.steps)) {
    const steps = c.steps.map((s) => ({ ...s, items: (s.items ?? []).flatMap((id) => (id !== from ? [id] : to === null ? [] : [to])) }));
    out = { ...out, steps };
  }
  if (c.assembly?.tray && from in c.assembly.tray) {
    const { [from]: pos, ...tray } = c.assembly.tray;
    out = { ...out, assembly: { ...c.assembly, tray: to === null ? tray : { ...tray, [to]: pos } } };
  }
  return out;
}

// `null` in an update means "remove this key".
function clean(obj) {
  for (const k of Object.keys(obj)) if (obj[k] === null) delete obj[k];
  return obj;
}
