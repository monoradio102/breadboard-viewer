// Resolves a circuit JSON into placed parts, validates it and computes the netlist.
import { boardStrips, createBoard, parseHole } from "./board.js";
import { buildTimeline } from "./animation.js";
import { electricalAdvice } from "./erc.js";
import { spriteError } from "./svg.js";
import { createRegistry } from "./parts/registry.js";

export const FORMAT_VERSION = 1;
const RESERVED = new Set(["id", "type", "at", "pos", "rot", "pins", "note", "state", "idLabel"]);
const ROTATIONS = [0, 90, 180, 270];

// Returns { board, registry, parts, wires, errors, warnings, nets }.
// Never throws for bad circuit content: problems are reported in errors / warnings.
export function resolveCircuit(circuit) {
  const errors = [];
  const warnings = [];
  if (!circuit || typeof circuit !== "object") {
    return { errors: ["回路データがオブジェクトではありません"], warnings, advice: [], parts: [], wires: [], overlays: [], nets: [], netOf: () => null, netOfHole: () => null };
  }
  let board;
  try {
    board = createBoard(circuit.board ?? "half");
  } catch (e) {
    errors.push(e.message);
    board = createBoard("half");
  }
  const registry = createRegistry(circuit.partDefs ?? []);
  errors.push(...registry.errors);

  const occupied = new Map(); // hole -> "R1.1" / "wire#3"
  const occupy = (hole, who) => {
    if (!hole) return;
    if (occupied.has(hole)) errors.push(`穴 ${hole} に ${occupied.get(hole)} と ${who} が重なっています`);
    else occupied.set(hole, who);
  };

  const ids = new Set();
  const parts = [];
  (circuit.parts ?? []).forEach((inst, index) => {
    const id = inst.id ?? `#${index + 1}`;
    if (ids.has(id)) errors.push(`部品ID "${id}" が重複しています`);
    ids.add(id);
    const def = registry.get(inst.type);
    if (!def) {
      errors.push(`${id}: 未知の部品タイプ "${inst.type}"`);
      return;
    }
    const part = placePart(board, def, inst, id, errors, warnings);
    if (!part) return;
    part.pins.forEach((p) => occupy(p.hole, `${id}.${p.name}`));
    parts.push(part);
  });

  // A wire end is a hole ("a10") or a part pin ("SV1.SIG"); pins of off-board parts are
  // terminals that any number of wires may share.
  const byId = new Map(parts.map((p) => [p.id, p]));
  const endpoint = (ref, who) => {
    if (board.has(ref)) {
      occupy(ref, who);
      return { node: ref, pos: board.pos(ref) };
    }
    const dot = String(ref).indexOf(".");
    const part = dot > 0 ? byId.get(String(ref).slice(0, dot)) : null;
    const pin = part?.pins.find((p) => p.name === String(ref).slice(dot + 1));
    if (!pin) {
      errors.push(`${who}: "${ref}" はこのボードの穴でも、部品のピン (例: "SV1.SIG") でもありません`);
      return null;
    }
    return { node: pin.node, pos: { x: pin.x, y: pin.y } };
  };

  const wires = [];
  (circuit.wires ?? []).forEach((w, index) => {
    const id = w.id ?? `W${index + 1}`;
    const ends = ["from", "to"].map((key) => endpoint(w[key], `${id}.${key}`));
    // via points: hole names or [x, y] in pitch units (they only shape the drawing)
    const via = (w.via ?? []).map((v) => {
      if (Array.isArray(v) && v.length === 2 && v.every(Number.isFinite)) return { x: v[0], y: v[1] };
      if (!board.has(v)) warnings.push(`${id}: via ${JSON.stringify(v)} は穴の名前でも [x, y] でもありません`);
      return board.pos(v);
    });
    if (w.shape !== undefined && !["straight", "curve"].includes(w.shape)) warnings.push(`${id}: shape は "straight" か "curve" です`);
    if (ends[0] && ends[1]) {
      wires.push({ ...w, id, a: ends[0].pos, b: ends[1].pos, nodes: [ends[0].node, ends[1].node], via: via.filter(Boolean) });
    }
  });

  const { nets, netOf } = computeNets(board, parts, wires);
  for (const part of parts) {
    const placed = part.pins.filter((p) => p.node);
    if (placed.length >= 2 && part.pins.length === placed.length) {
      const netIds = new Set(placed.map((p) => p.net));
      if (netIds.size === 1) warnings.push(`${part.id}: 全てのピンが同じネット(${placed[0].net})につながっています (ショート)`);
    }
  }
  // overlays: free-standing user SVG (effects, arrows, notes) drawn above the circuit
  const overlays = [];
  (circuit.overlays ?? []).forEach((o, index) => {
    const id = o?.id ?? `FX${index + 1}`;
    if (ids.has(id) || wires.some((w) => w.id === id)) errors.push(`ID "${id}" が重複しています`);
    ids.add(id);
    const err = spriteError(o?.svg) ?? (["x", "y", "w", "h"].every((k) => Number.isFinite(o[k])) ? null : "x, y, w, h (ピッチ単位) が必要です");
    if (err) errors.push(`overlays ${id}: ${err}`);
    else overlays.push({ ...o, id });
  });

  const timeline = buildTimeline(parts, wires, circuit.animation, warnings, overlays);

  // assembly steps (see assembly.js)
  const known = new Set([...parts.map((p) => p.id), ...wires.map((w) => w.id), ...overlays.map((o) => o.id)]);
  const steps = Array.isArray(circuit.steps) ? circuit.steps : [];
  steps.forEach((s, i) => {
    for (const id of s?.items ?? []) if (!known.has(id)) warnings.push(`steps[${i}]: "${id}" という部品・配線はありません`);
  });
  const assembly = circuit.assembly && typeof circuit.assembly === "object" ? circuit.assembly : {};
  for (const id of Object.keys(assembly.tray ?? {})) {
    if (!parts.some((p) => p.id === id)) warnings.push(`assembly.tray: "${id}" という部品はありません`);
    else if (!Array.isArray(assembly.tray[id]) || assembly.tray[id].length !== 2) warnings.push(`assembly.tray.${id} は [x, y] です`);
  }
  // the same problem can be found more than once (e.g. one per animation key): report it once
  const unique = (list) => [...new Set(list)];
  return {
    board,
    registry,
    parts,
    wires,
    overlays,
    steps,
    assembly,
    nets,
    netOf,
    netOfHole: netOf,
    occupied,
    timeline,
    errors: unique(errors),
    warnings: unique(warnings),
    // advisory electrical checks (参考): common mistakes, not a guarantee
    advice: electricalAdvice(parts),
  };
}

function placePart(board, def, inst, id, errors, warnings) {
  const params = {};
  for (const [k, spec] of Object.entries(def.params ?? {})) params[k] = inst[k] ?? spec.default;
  for (const k of Object.keys(inst)) {
    if (!RESERVED.has(k) && !(k in (def.params ?? {}))) warnings.push(`${id}: 未知のパラメータ "${k}"`);
  }
  const layout = def.pins(params);
  const internal = def.internal?.(params) ?? [];
  let pins;
  let transform = null;

  if (inst.pos !== undefined) {
    // free placement off the board: the first pin sits at pos, pins are wire terminals
    const ok = Array.isArray(inst.pos) && inst.pos.length === 2 && inst.pos.every(Number.isFinite);
    if (!ok) {
      errors.push(`${id}: pos は [x, y] (ピッチ単位) です`);
      return null;
    }
    const rot = Number(inst.rot ?? 0);
    if (!ROTATIONS.includes(rot)) errors.push(`${id}: rot は 0, 90, 180, 270 のいずれかです`);
    const [ox, oy] = inst.pos;
    transform = { x: ox, y: oy, rot };
    pins = layout.map((p) => {
      const [dx, dy] = rotate(p.x, p.y, rot);
      return { name: p.name, hole: null, node: `${id}.${p.name}`, x: ox + dx, y: oy + dy };
    });
    return { id, type: def.type, def, inst, params, pins, internal, transform, offboard: true };
  } else if (inst.pins !== undefined) {
    if (def.mount !== "leads") {
      errors.push(`${id}: ${def.type} は足を曲げられない部品なので pins ではなく at/rot で置いてください`);
      return null;
    }
    const list = Array.isArray(inst.pins) ? inst.pins : layout.map((p) => inst.pins[p.name]);
    if (list.length !== layout.length || list.some((h) => h === undefined)) {
      errors.push(`${id}: pins は ${layout.length} 個必要です (${layout.map((p) => p.name).join(", ")})`);
      return null;
    }
    pins = layout.map((p, i) => {
      const hole = list[i];
      if (!board.has(hole)) errors.push(`${id}.${p.name}: "${hole}" はこのボードにない穴です`);
      const pos = board.pos(hole);
      return { name: p.name, hole: pos ? hole : null, node: pos ? hole : null, x: pos?.x ?? 0, y: pos?.y ?? 0 };
    });
  } else if (inst.at !== undefined) {
    const origin = board.pos(inst.at);
    if (!origin) {
      errors.push(`${id}: at "${inst.at}" はこのボードにない穴です`);
      return null;
    }
    const rot = Number(inst.rot ?? 0);
    if (!ROTATIONS.includes(rot)) errors.push(`${id}: rot は 0, 90, 180, 270 のいずれかです`);
    transform = { x: origin.x, y: origin.y, rot };
    pins = layout.map((p) => {
      const [dx, dy] = rotate(p.x, p.y, rot);
      const x = origin.x + dx;
      const y = origin.y + dy;
      // a terminal is wired by "PartId.PinName", not inserted into a hole
      if (p.insert === false) return { name: p.name, hole: null, node: `${id}.${p.name}`, x, y, terminal: true };
      const hole = board.holeAt(x, y);
      if (!hole) errors.push(`${id}.${p.name}: ピンが穴の位置に来ません (ボード外か溝の上)`);
      return { name: p.name, hole, node: hole, x, y };
    });
  } else {
    errors.push(`${id}: at, pins, pos のどれかで位置を指定してください`);
    return null;
  }
  return { id, type: def.type, def, inst, params, pins, internal, transform };
}

// Rotation is clockwise on screen (y grows downward).
export function rotate(x, y, rot) {
  switch (rot) {
    case 90:
      return [-y, x];
    case 180:
      return [-x, -y];
    case 270:
      return [y, -x];
    default:
      return [x, y];
  }
}

function computeNets(board, parts, wires) {
  const parent = new Map();
  const find = (a) => {
    if (!parent.has(a)) parent.set(a, a);
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r);
    parent.set(a, r);
    return r;
  };
  const union = (a, b) => parent.set(find(a), find(b));

  for (const strip of boardStrips(board)) strip.slice(1).forEach((h) => union(strip[0], h));
  for (const w of wires) union(w.nodes[0], w.nodes[1]);
  for (const part of parts) {
    for (const group of part.internal) {
      const nodes = group.map((name) => part.pins.find((p) => p.name === name)?.node).filter(Boolean);
      nodes.slice(1).forEach((h) => union(nodes[0], h));
    }
  }

  const groups = new Map();
  for (const part of parts) {
    for (const pin of part.pins) {
      if (!pin.node) continue;
      const root = find(pin.node);
      if (!groups.has(root)) groups.set(root, { pins: [], rails: new Set() });
      groups.get(root).pins.push({ ref: `${part.id}.${pin.name}`, hole: pin.hole, pin });
    }
  }
  // name nets after the power rails they touch, otherwise N1, N2, ...
  for (const rail of ["T+", "T-", "B+", "B-"]) {
    for (const col of board.railCols.slice(0, 1)) {
      const root = find(`${rail}${col}`);
      groups.get(root)?.rails.add(rail);
    }
  }
  const nets = [];
  let i = 1;
  for (const grp of groups.values()) {
    const name = grp.rails.size ? [...grp.rails].join("/") : `N${i++}`;
    for (const p of grp.pins) p.pin.net = name;
    grp.name = name;
    nets.push({ name, pins: grp.pins.map(({ ref, hole }) => ({ ref, hole })) });
  }
  // net name for any hole or off-board pin node; null when no part pin is on it
  const netOf = (node) => (parent.has(node) ? groups.get(find(node))?.name ?? null : null);
  return { nets, netOf };
}

// Plain-text summary for humans and AI agents.
export function describe(result) {
  const lines = [];
  for (const e of result.errors) lines.push(`ERROR: ${e}`);
  for (const w of result.warnings) lines.push(`WARN:  ${w}`);
  for (const a of result.advice ?? []) lines.push(`NOTE:  (参考) ${a}`);
  if (result.advice?.length) lines.push("       NOTE は電気的なよくあるミスの参考です。出ないことは回路が正しいことを意味しません");
  lines.push(`部品 ${result.parts.length} 個, 配線 ${result.wires.length} 本`);
  for (const p of result.parts) {
    const where = (pin) => pin.hole ?? (p.offboard ? "ボード外" : pin.terminal ? "端子" : "?");
    lines.push(`  ${p.id} (${p.type}): ${p.pins.map((pin) => `${pin.name}=${where(pin)}`).join(" ")}`);
  }
  lines.push("ネット (2ピン以上がつながっているもの):");
  const alone = [];
  for (const net of result.nets) {
    if (net.pins.length < 2 && !/[+-]/.test(net.name)) alone.push(net.pins[0].ref);
    else lines.push(`  ${net.name}: ${net.pins.map((p) => p.ref).join(", ")}`);
  }
  if (alone.length) lines.push(`未接続のピン: ${alone.join(", ")}`);
  return lines.join("\n");
}


// Strip (electrically connected group) a hole belongs to, e.g. "12:top", "12:bottom", "T+".
export function stripOf(hole) {
  const h = parseHole(hole);
  if (!h) return null;
  if (h.kind === "rail") return h.rail;
  return `${h.col}:${"abcde".includes(h.row) ? "top" : "bottom"}`;
}

// Finds the first spot where `def` fits on free holes without shorting its own pins.
// Returns { at, pins } (pins = hole per layout pin) or null.
export function findFreeSpot(result, def, params = {}) {
  const full = {};
  for (const [k, spec] of Object.entries(def.params ?? {})) full[k] = params[k] ?? spec.default;
  const layout = def.pins(full);
  const internal = new Set((def.internal?.(full) ?? []).flat());
  const covered = coveredHoles(result);
  for (const [hole, origin] of result.board.holes) {
    if (!/^[a-j]/.test(hole)) continue;
    // terminals (insert: false) need no hole
    const holes = layout.map((p) => (p.insert === false ? undefined : result.board.holeAt(origin.x + p.x, origin.y + p.y)));
    if (holes.some((h) => h === null || (h && (result.occupied.has(h) || covered.has(h))))) continue;
    const strips = holes.filter((h, i) => h && !internal.has(layout[i].name)).map(stripOf);
    if (new Set(strips).size !== strips.length) continue;
    return { at: hole, pins: holes };
  }
  return null;
}

// Holes hidden under the body of rigid parts (approximated by the bounding box of their pins).
function coveredHoles(result) {
  const covered = new Set();
  for (const part of result.parts) {
    const inserted = part.pins.filter((p) => !p.terminal);
    if (part.def.mount !== "rigid" || inserted.length < 2 || part.offboard) continue;
    const xs = inserted.map((p) => p.x);
    const ys = inserted.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    for (const [hole, p] of result.board.holes) {
      if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) covered.add(hole);
    }
  }
  return covered;
}
