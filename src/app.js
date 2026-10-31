// Browser UI: parts list, live SVG view, JSON editor, import/export.
import { describe, findFreeSpot, resolveCircuit } from "./circuit.js";
import { emptyCircuit, parseCircuitText, stringifyCircuit } from "./io.js";
import { renderSvg } from "./render.js";

const STORAGE_KEY = "breadboard-viewer:last";
const ID_PREFIX = {
  resistor: "R", led: "D", diode: "D", capacitor: "C", electrolytic: "C", cds: "CDS", transistor: "Q",
  regulator: "U", button: "SW", trimmer: "VR", buzzer: "BZ", header: "J",
};

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
  file: $("file"),
};

let circuit = emptyCircuit();
let result = resolveCircuit(circuit);

// ---- rendering ----

function setCircuit(next, { updateEditor = true } = {}) {
  circuit = next;
  result = resolveCircuit(circuit);
  el.stage.innerHTML = renderSvg(result);
  if (updateEditor) el.editor.value = stringifyCircuit(circuit);
  if (document.activeElement !== el.title) el.title.value = circuit.title ?? "";
  showMessages(result.errors, result.warnings);
  el.nets.textContent = describe({ ...result, errors: [], warnings: [] });
  renderPartList();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(circuit));
  } catch {
    // storage unavailable (private mode etc.) — nothing to do
  }
}

function showMessages(errors, warnings, syntax) {
  const items = [
    ...(syntax ? [["error", syntax]] : []),
    ...errors.map((m) => ["error", m]),
    ...warnings.map((m) => ["warn", m]),
  ];
  el.messages.replaceChildren(
    ...(items.length
      ? items.map(([kind, m]) => Object.assign(document.createElement("div"), { className: `msg ${kind}`, textContent: m }))
      : [Object.assign(document.createElement("div"), { className: "msg ok", textContent: "問題は見つかりません" })]),
  );
}

// ---- editor ----

let editTimer;
el.editor.addEventListener("input", () => {
  clearTimeout(editTimer);
  editTimer = setTimeout(() => {
    try {
      setCircuit(JSON.parse(el.editor.value), { updateEditor: false });
    } catch (e) {
      showMessages([], [], `JSON構文エラー: ${e.message}`);
    }
  }, 250);
});

el.title.addEventListener("input", () => setCircuit({ ...circuit, title: el.title.value }));

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
    const h = document.createElement("h3");
    h.textContent = cat;
    frag.append(h);
    for (const def of defs) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "part-item";
      b.innerHTML = `<span class="part-name"></span><code></code>`;
      b.querySelector(".part-name").textContent = def.name;
      b.querySelector("code").textContent = def.type;
      b.addEventListener("click", () => showPartDetail(def));
      frag.append(b);
    }
  }
  el.partList.replaceChildren(frag);
}

el.partFilter.addEventListener("input", renderPartList);

function showPartDetail(def) {
  const params = {};
  for (const [k, spec] of Object.entries(def.params ?? {})) params[k] = spec.default;
  const pins = def.pins(params);
  const d = el.partDetail;
  d.hidden = false;
  d.innerHTML = "";
  const add = (tagName, text, cls) => {
    const node = document.createElement(tagName);
    node.textContent = text;
    if (cls) node.className = cls;
    d.append(node);
    return node;
  };
  add("h3", def.name);
  add("p", def.description);
  add("p", `type: ${def.type} / ${def.mount === "leads" ? "足を曲げられる (pins で穴を個別指定可)" : "固定形状 (at + rot で配置)"}`, "meta");
  add("p", `ピン: ${pins.map((p) => p.name).join(", ")}`, "meta");
  const paramText = Object.entries(def.params ?? {})
    .map(([k, s]) => `${k} = ${JSON.stringify(s.default)}  … ${s.description ?? ""}`)
    .join("\n");
  if (paramText) add("pre", paramText);
  const btn = add("button", "回路に追加", "primary");
  btn.type = "button";
  btn.addEventListener("click", () => addPart(def));
}

function addPart(def) {
  const spot = findFreeSpot(result, def);
  if (!spot) {
    showMessages([`${def.name} を置ける空きが見つかりません`], []);
    return;
  }
  const prefix = ID_PREFIX[def.type] ?? def.json?.prefix ?? (def.category === "IC" || def.category === "マイコンボード" ? "U" : "X");
  const used = new Set((circuit.parts ?? []).map((p) => p.id));
  let i = 1;
  while (used.has(`${prefix}${i}`)) i++;
  const inst = { id: `${prefix}${i}`, type: def.type };
  if (def.mount === "leads") inst.pins = spot.pins;
  else inst.at = spot.at;
  setCircuit({ ...circuit, parts: [...(circuit.parts ?? []), inst] });
}

// ---- hover info ----

el.stage.addEventListener("mousemove", (ev) => {
  const svg = el.stage.querySelector("svg");
  if (!svg || !result.board) return;
  const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(svg.getScreenCTM().inverse());
  const x = Math.round(pt.x);
  const y = Math.round(pt.y);
  const hole = Math.hypot(pt.x - x, pt.y - y) < 0.45 ? result.board.holeAt(x, y) : null;
  if (!hole) return;
  const who = result.occupied.get(hole);
  const net = result.netOfHole(hole);
  el.status.textContent = `${hole}${who ? `  ·  ${who}` : ""}${net ? `  ·  ネット ${net}` : ""}`;
});

// ---- import / export ----

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const baseName = () => (circuit.title || "circuit").replace(/[\\/:*?"<>|\s]+/g, "_");

$("btn-save").addEventListener("click", () => download(`${baseName()}.json`, stringifyCircuit(circuit), "application/json"));
$("btn-svg").addEventListener("click", () =>
  download(`${baseName()}.svg`, renderSvg(result, { embed: circuit }), "image/svg+xml"),
);
$("btn-new").addEventListener("click", () => setCircuit(emptyCircuit()));
$("btn-open").addEventListener("click", () => el.file.click());
el.file.addEventListener("change", async () => {
  const f = el.file.files?.[0];
  if (f) await loadText(await f.text());
  el.file.value = "";
});

$("examples").addEventListener("change", async (ev) => {
  const name = ev.target.value;
  ev.target.value = "";
  if (name) await loadExample(name);
});

async function loadExample(name) {
  const res = await fetch(`examples/${name}.json`);
  await loadText(await res.text());
}

async function loadText(text) {
  try {
    setCircuit(parseCircuitText(text));
  } catch (e) {
    showMessages([`読み込めませんでした: ${e.message}`], []);
  }
}

// drag & drop (JSON, or an SVG exported by this app)
const hint = $("drop-hint");
window.addEventListener("dragover", (ev) => {
  ev.preventDefault();
  hint.hidden = false;
});
window.addEventListener("dragleave", (ev) => {
  if (!ev.relatedTarget) hint.hidden = true;
});
window.addEventListener("drop", async (ev) => {
  ev.preventDefault();
  hint.hidden = true;
  const f = ev.dataTransfer?.files?.[0];
  if (f) await loadText(await f.text());
  else {
    const text = ev.dataTransfer?.getData("text/plain");
    if (text) await loadText(text);
  }
});

// ---- scripting API for AI agents / devtools ----

window.bb = {
  get: () => structuredClone(circuit),
  load: (c) => setCircuit(typeof c === "string" ? parseCircuitText(c) : c),
  check: () => describe(result),
  svg: () => renderSvg(result, { embed: circuit }),
};

// ---- start ----

(async () => {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    saved = null;
  }
  if (saved) setCircuit(saved);
  else await loadExample("blink-nano");
})();
