// Part registry: built-in parts plus declarative JSON part definitions
// (the ones embedded in a circuit's "partDefs" — see docs/FORMAT.md).
import { g, n, rect, shapesToSvg, text } from "../svg.js";
import { BUILTIN_PARTS } from "./builtin.js";
import { centroid, leg } from "./common.js";

const MM = 1 / 2.54;

export function createRegistry(partDefs = []) {
  const parts = new Map(BUILTIN_PARTS.map((p) => [p.type, { ...p, builtin: true }]));
  const errors = [];
  for (const def of partDefs) {
    try {
      const part = fromJson(def);
      if (parts.get(part.type)?.builtin) throw new Error(`"${part.type}" は組み込み部品と同じ名前です`);
      parts.set(part.type, part);
    } catch (e) {
      errors.push(`partDefs: ${e.message}`);
    }
  }
  return { parts, errors, get: (type) => parts.get(type) ?? null };
}

// Turns a JSON part definition into the same shape as a built-in part.
export function fromJson(def) {
  if (!def || typeof def !== "object") throw new Error("部品定義がオブジェクトではありません");
  if (!def.type || typeof def.type !== "string") throw new Error("部品定義に type がありません");
  if (!Array.isArray(def.pins) || def.pins.length === 0) throw new Error(`${def.type}: pins が空です`);
  const names = new Set();
  for (const p of def.pins) {
    if (p.name === undefined || !Number.isFinite(p.x) || !Number.isFinite(p.y))
      throw new Error(`${def.type}: ピンには name, x, y が必要です`);
    if (names.has(String(p.name))) throw new Error(`${def.type}: ピン名 "${p.name}" が重複しています`);
    names.add(String(p.name));
  }
  const scale = def.units === "mm" ? MM : 1;
  const o = def.pins[0];
  const pins = def.pins.map((p) => ({ name: String(p.name), x: (p.x - o.x) * scale, y: (p.y - o.y) * scale }));
  const mount = def.mount === "leads" ? "leads" : "rigid";
  const shapes = def.shapes ?? [];
  const label = def.label ?? def.name ?? def.type;
  return {
    type: def.type,
    name: def.name ?? def.type,
    category: def.category ?? "カスタム",
    description: def.description ?? "",
    mount,
    params: def.params ?? {},
    pins: () => pins,
    internal: () => def.internal ?? [],
    source: def.source,
    json: def,
    render:
      mount === "rigid"
        ? () =>
            shapes.length
              ? g(shapesToSvg(shapes), { transform: `scale(${n(scale)}) translate(${n(-o.x)} ${n(-o.y)})` })
              : fallbackBox(pins, label)
        : ({ pins: placed }) => genericLeads(placed, label),
    builtin: false,
  };
}

function fallbackBox(pins, label) {
  const xs = pins.map((p) => p.x);
  const ys = pins.map((p) => p.y);
  const x0 = Math.min(...xs) - 0.5;
  const y0 = Math.min(...ys) - 0.5;
  const w = Math.max(...xs) + 0.5 - x0;
  const h = Math.max(...ys) + 0.5 - y0;
  return (
    rect(x0, y0, w, h, { rx: 0.1, fill: "#37474f", opacity: 0.92 }) +
    text(x0 + w / 2, y0 + h / 2, label, { "font-size": 0.45, fill: "#fff", "text-anchor": "middle", "dominant-baseline": "central" })
  );
}

function genericLeads(pins, label) {
  const c = centroid(pins);
  return (
    pins.map((p) => leg(p, c)).join("") +
    rect(c.x - 0.8, c.y - 0.45, 1.6, 0.9, { rx: 0.15, fill: "#455a64" }) +
    text(c.x, c.y, label, { "font-size": 0.35, fill: "#fff", "text-anchor": "middle", "dominant-baseline": "central" })
  );
}
