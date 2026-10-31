// Import / export of circuit files. A circuit travels as plain JSON, or embedded in an
// SVG exported by this app (<metadata id="breadboard-circuit">), like ComfyUI workflows in PNGs.

const META_RE = /<metadata id="breadboard-circuit"[^>]*>([\s\S]*?)<\/metadata>/;

export function parseCircuitText(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("<")) {
    const m = META_RE.exec(trimmed);
    if (!m) throw new Error("このSVGには回路データが入っていません");
    return JSON.parse(unescapeXml(m[1]));
  }
  return JSON.parse(trimmed);
}

// Pretty JSON with one line per part / wire, so circuits stay easy to read and diff.
export function stringifyCircuit(circuit) {
  const keys = Object.keys(circuit);
  const body = keys.map((k, i) => {
    const v = circuit[k];
    const comma = i < keys.length - 1 ? "," : "";
    if ((k === "parts" || k === "wires") && Array.isArray(v) && v.length) {
      const items = v.map((item, j) => `    ${inline(item)}${j < v.length - 1 ? "," : ""}`);
      return `  "${k}": [\n${items.join("\n")}\n  ]${comma}`;
    }
    return `  "${k}": ${JSON.stringify(v, null, 2).replace(/\n/g, "\n  ")}${comma}`;
  });
  return `{\n${body.join("\n")}\n}\n`;
}

function inline(v) {
  if (Array.isArray(v)) return `[${v.map(inline).join(", ")}]`;
  if (v && typeof v === "object") {
    const entries = Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`);
    return `{ ${entries.join(", ")} }`;
  }
  return JSON.stringify(v);
}

function unescapeXml(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export function emptyCircuit() {
  return { version: 1, title: "", board: "half", parts: [], wires: [] };
}


// ---- part libraries ----
// A library is { "name": "...", "partDefs": [...] }, a bare array of definitions, or any
// circuit file (its partDefs are taken). Returns { name, defs, errors }.
export function parseLibrary(text, fromJson) {
  const data = parseCircuitText(text);
  const list = Array.isArray(data) ? data : data?.partDefs;
  if (!Array.isArray(list)) throw new Error("部品定義 (partDefs) が見つかりません");
  const defs = [];
  const errors = [];
  for (const def of list) {
    try {
      fromJson(def);
      defs.push(def);
    } catch (e) {
      errors.push(e.message);
    }
  }
  return { name: Array.isArray(data) ? "" : (data.name ?? data.title ?? ""), defs, errors };
}

// Merges definitions by type; later ones win.
export function mergeDefs(...lists) {
  const byType = new Map();
  for (const list of lists) for (const def of list ?? []) byType.set(def.type, def);
  return [...byType.values()];
}

export function stringifyLibrary(name, defs) {
  return `${JSON.stringify({ name, partDefs: defs }, null, 2)}\n`;
}

// ---- links: the whole circuit in the URL fragment ----
// https://…/breadboard-viewer/#data=<base64url of the circuit JSON (UTF-8)>
// The fragment never reaches the server. A link is data like a dropped file: it is drawn by
// the same renderer, which escapes everything it puts into the page.

export const LINK_LIMIT = 512 * 1024; // decoded bytes

export function circuitLink(circuit, base = "https://monoradio102.github.io/breadboard-viewer/") {
  const bytes = new TextEncoder().encode(JSON.stringify(circuit));
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${base.replace(/#.*$/, "")}#data=${b64}`;
}

// The circuit in a "#data=…" fragment (or a whole URL), or null when there is none.
// Throws when the data is there but is not a circuit.
export function circuitFromLink(hashOrUrl) {
  const m = /#data=([A-Za-z0-9_-]*={0,2})$/.exec(String(hashOrUrl).trim());
  if (!m) {
    if (/#data=/.test(hashOrUrl)) throw new Error("#data= の中身が Base64URL ではありません");
    return null;
  }
  if (m[1].length > (LINK_LIMIT * 4) / 3 + 4) throw new Error("リンクの回路データが大きすぎます");
  const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
  let bin;
  try {
    bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  } catch {
    throw new Error("#data= の中身が Base64URL ではありません");
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  const circuit = JSON.parse(text);
  if (!circuit || typeof circuit !== "object" || Array.isArray(circuit)) throw new Error("リンクの中身が回路の JSON ではありません");
  return circuit;
}
