// Editing operations on circuit JSON. Pure functions (no DOM): the browser UI, the
// window.bb API and `tools/bb.mjs apply` all go through these, so humans and AI agents
// edit circuits the same way.
//
// An op is a JSON object, e.g.
//   { "op": "addPart", "type": "led", "pins": ["a1", "a2"], "color": "green" }
//   { "op": "move", "id": "R1", "to": "a10" }
//   { "op": "rotate", "id": "U1" }
//   { "op": "setPin", "id": "R1", "pin": "2", "to": "a14" }
//   { "op": "update", "id": "R1", "set": { "value": "1k" } }
//   { "op": "remove", "id": "R1" }
//   { "op": "addWire", "from": "a1", "to": "T-1", "color": "black" }
//   { "op": "setBoard", "board": "full" }
// See docs/OPS.md for the full list.
import { createBoard } from "./board.js";
import { findFreeSpot, resolveCircuit, rotate } from "./circuit.js";
import { createRegistry } from "./parts/registry.js";

export class OpError extends Error {}

const fail = (msg) => {
  throw new OpError(msg);
};

const ID_PREFIX = {
  resistor: "R", led: "D", diode: "D", capacitor: "C", electrolytic: "C", cds: "CDS", transistor: "Q",
  regulator: "U", button: "SW", trimmer: "VR", buzzer: "BZ", header: "J",
};

// Gives every wire an id, so wires can be addressed by ops.
export function normalize(circuit) {
  const c = structuredClone(circuit);
  c.parts ??= [];
  c.wires ??= [];
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
    if (findPart(c, inst.id, false)) fail(`ID "${inst.id}" は既に使われています`);
    if (inst.at === undefined && inst.pins === undefined) {
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

  move(c, { id, to }) {
    const { inst, index, def } = partInfo(c, id);
    const board = boardOf(c);
    if (!board.has(to)) fail(`"${to}" はこのボードにない穴です`);
    let next;
    if (inst.pins !== undefined) {
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
    const wireIndex = c.wires.findIndex((w) => w.id === id);
    if (wireIndex >= 0) {
      const wire = clean({ ...c.wires[wireIndex], ...set });
      if (wire.id !== id && c.wires.some((w) => w.id === wire.id)) fail(`ID "${wire.id}" は既に使われています`);
      return { circuit: { ...c, wires: c.wires.map((w, i) => (i === wireIndex ? wire : w)) }, id: wire.id };
    }
    const { inst, index } = partInfo(c, id);
    if ("type" in set) fail("type は変更できません (remove して addPart してください)");
    const next = clean({ ...inst, ...set });
    if (next.id !== id && findPart(c, next.id, false)) fail(`ID "${next.id}" は既に使われています`);
    return { circuit: replacePart(c, index, next), id: next.id };
  },

  remove(c, { id }) {
    if (c.wires.some((w) => w.id === id)) return { circuit: { ...c, wires: c.wires.filter((w) => w.id !== id) } };
    partInfo(c, id);
    return { circuit: { ...c, parts: c.parts.filter((p) => p.id !== id) } };
  },

  addWire(c, { op, id, from, to, ...rest }) {
    const board = boardOf(c);
    for (const h of [from, to]) if (!board.has(h)) fail(`"${h}" はこのボードにない穴です`);
    if (from === to) fail("from と to が同じ穴です");
    const wid = id ?? nextId(c, "W");
    if (c.wires.some((w) => w.id === wid) || findPart(c, wid, false)) fail(`ID "${wid}" は既に使われています`);
    return { circuit: { ...c, wires: [...c.wires, { id: wid, from, to, ...rest }] }, id: wid };
  },

  setBoard(c, { board }) {
    createBoard(board);
    return { circuit: { ...c, board } };
  },

  setTitle(c, { title }) {
    return { circuit: { ...c, title: String(title ?? "") } };
  },
};

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

function nextId(c, prefix) {
  const used = new Set([...c.parts.map((p) => p.id), ...c.wires.map((w) => w.id)]);
  let i = 1;
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

function defaultPrefix(def) {
  return def.category === "IC" || def.category === "マイコンボード" ? "U" : "X";
}

// `null` in an update means "remove this key".
function clean(obj) {
  for (const k of Object.keys(obj)) if (obj[k] === null) delete obj[k];
  return obj;
}
