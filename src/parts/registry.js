// Part registry: built-in parts plus declarative JSON part definitions
// (the ones embedded in a circuit's "partDefs" — see docs/FORMAT.md).
import { esc, g, n, rect, shapesToSvg, spriteError, spriteImage, tag, text } from "../svg.js";
import { BUILTIN_PARTS } from "./builtin.js";
import { centroid, leg } from "./common.js";
import { builtinRoles, jsonRole } from "./roles.js";

const MM = 1 / 2.54;

export function createRegistry(partDefs = []) {
  const parts = new Map(
    BUILTIN_PARTS.map((p) => [
      p.type,
      { ...p, builtin: true, roles: (params) => builtinRoles(p.type, params, p.pins(params).map((x) => x.name)) },
    ]),
  );
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
  // insert: false = a terminal (screw terminal, solder pad, lead) that is not pushed into a hole
  const pins = def.pins.map((p) => ({
    name: String(p.name),
    x: (p.x - o.x) * scale,
    y: (p.y - o.y) * scale,
    ...(p.insert === false ? { insert: false } : {}),
  }));
  const mount = def.mount === "leads" ? "leads" : "rigid";
  const shapes = def.shapes ?? [];
  const sprites = def.sprites ?? [];
  for (const [i, sp] of sprites.entries()) {
    const err = spriteError(sp?.svg) ?? (["x", "y", "w", "h"].every((k) => Number.isFinite(sp[k])) ? null : "x, y, w, h が必要です");
    if (err) throw new Error(`${def.type}: sprites[${i}]: ${err}`);
  }
  const label = def.label ?? def.name ?? def.type;
  const display = def.display ?? null;
  const conditions = [...new Set([...shapes, ...sprites].map((s) => s.when).filter(Boolean))];
  const states = { ...(def.states ?? {}) };
  // a display's text is a string state even when a shape's `when` names it ("!text": placeholder)
  if (display) states.text ??= { type: "string", default: display.text ?? "" };
  for (const cond of conditions) {
    const name = parseCondition(cond).name;
    states[name] ??= { type: "bool", default: false };
  }
  return {
    type: def.type,
    name: def.name ?? def.type,
    category: def.category ?? "カスタム",
    description: def.description ?? "",
    mount,
    params: def.params ?? {},
    states,
    // `when` shapes are shown only while their condition holds; a display draws one text per value
    animate: ({ values }) => ({
      ...Object.fromEntries(conditions.map((cond) => [`when:${cond}`, (s) => ({ opacity: testCondition(cond, s) ? 1 : 0 })])),
      ...(display ? Object.fromEntries(values("text").map((v, i) => [`text:${i}`, (s) => ({ opacity: String(s.text) === v ? 1 : 0 })])) : {}),
    }),
    pins: () => pins,
    // electrical roles for the advisory checks ("role" on JSON pins)
    roles: () => Object.fromEntries(def.pins.map((p) => [String(p.name), jsonRole(p)]).filter(([, r]) => r)),
    // drawing bounds relative to the first pin, in pitch units (only needed when it leaves the board)
    extent: def.extent ? [def.extent[0] - o.x, def.extent[1] - o.y, def.extent[2] - o.x, def.extent[3] - o.y].map((v) => v * scale) : undefined,
    internal: () => def.internal ?? [],
    source: def.source,
    json: def,
    render:
      mount === "rigid"
        ? ({ anim, values }) =>
            shapes.length || display || sprites.length
              ? g(
                  shapesToSvg(shapes, (s) => (s.when ? anim(`when:${s.when}`) : null)) +
                    sprites.map((sp) => spriteImage(sp, sp.when ? anim(`when:${sp.when}`) : {})).join("") +
                    (display ? displayText(display, values("text"), anim) : ""),
                  { transform: `scale(${n(scale)}) translate(${n(-o.x)} ${n(-o.y)})` },
                )
              : fallbackBox(pins, label)
        : ({ pins: placed }) => genericLeads(placed, label),
    builtin: false,
  };
}

// "on", "!on", "mode=run"
function parseCondition(cond) {
  const m = /^(!?)([\w-]+)(?:=(.*))?$/.exec(String(cond).trim());
  if (!m) throw new Error(`when "${cond}" の書き方が不正です ("on", "!on", "mode=run" の形)`);
  return { not: m[1] === "!", name: m[2], value: m[3] };
}

function testCondition(cond, s) {
  const c = parseCondition(cond);
  const v = s[c.name];
  const hit = c.value === undefined ? Boolean(v) && v !== "false" : String(v) === c.value;
  return c.not ? !hit : hit;
}

function displayText(d, values, anim) {
  const size = d.size ?? 1.6;
  const lineH = size * 1.25;
  return values
    .map((v, i) =>
      tag(
        "text",
        { x: d.x, y: d.y, "font-size": size, "font-family": "monospace", fill: d.color ?? "#7fd3ff", ...anim(`text:${i}`) },
        v
          .split("\n")
          .map((line, j) => tag("tspan", { x: d.x, dy: j === 0 ? size : lineH }, esc(line)))
          .join(""),
      ),
    )
    .join("");
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
