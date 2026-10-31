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

// ---- share URLs ----
// The circuit travels in the URL fragment (#c=...), so it never reaches a server:
// minified JSON -> deflate-raw -> base64url. Works in browsers and Node 18+.

export async function encodeShare(circuit) {
  const bytes = new TextEncoder().encode(JSON.stringify(circuit));
  const packed = await pipe(bytes, new CompressionStream("deflate-raw"));
  return toBase64Url(packed);
}

export async function decodeShare(code) {
  const bytes = await pipe(fromBase64Url(code), new DecompressionStream("deflate-raw"));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function shareUrl(circuit, base) {
  const url = new URL(base);
  url.hash = `c=${await encodeShare(circuit)}`;
  return url.toString();
}

// Returns the encoded circuit from a location hash like "#c=...", or null.
export function shareCodeFromHash(hash) {
  const m = /(?:^#|&)c=([A-Za-z0-9_-]+)/.exec(hash ?? "");
  return m ? m[1] : null;
}

async function pipe(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64Url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
