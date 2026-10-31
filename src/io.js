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
