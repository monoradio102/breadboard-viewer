#!/usr/bin/env node
// CLI for humans and AI agents.
//   node tools/bb.mjs check  <circuit.json>                      validate and print the netlist
//   node tools/bb.mjs render <circuit.json> [-o out.svg|out.png] render (PNG needs Playwright)
//   node tools/bb.mjs apply  <circuit.json> <ops.json | '<json>'> [-o out.json]
//                                                                apply edit ops (docs/OPS.md);
//                                                                writes back to circuit.json unless -o
//   node tools/bb.mjs parts  [circuit.json]                      list part types, pins and params
//   node tools/bb.mjs new    <circuit.json> [board]               create an empty circuit
//   node tools/bb.mjs url    <circuit.json> [--base URL]          print a share URL
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, resolveCircuit } from "../src/circuit.js";
import { emptyCircuit, parseCircuitText, shareUrl, stringifyCircuit } from "../src/io.js";
import { OpError, applyOps } from "../src/ops.js";
import { createRegistry } from "../src/parts/registry.js";
import { renderSvg } from "../src/render.js";

const USAGE = `usage:
  bb.mjs check  <circuit.json>
  bb.mjs render <circuit.json> [-o out.svg|out.png]
  bb.mjs apply  <circuit.json> <ops.json | '<ops json>'> [-o out.json]
  bb.mjs parts  [circuit.json]
  bb.mjs new    <circuit.json> [full|half|mini]
  bb.mjs url    <circuit.json> [--base URL]`;

const DEFAULT_BASE = "https://monoradio102.github.io/breadboard-viewer/";

const args = process.argv.slice(2);
const baseIndex = args.indexOf("--base");
const base = baseIndex >= 0 ? args.splice(baseIndex, 2)[1] : DEFAULT_BASE;
const outIndex = args.indexOf("-o");
const out = outIndex >= 0 ? args.splice(outIndex, 2)[1] : null;
const [cmd, file, extra] = args;
const readCircuit = (f) => parseCircuitText(readFileSync(f, "utf8"));

switch (cmd) {
  case "check": {
    need(file);
    const result = resolveCircuit(readCircuit(file));
    console.log(describe(result));
    process.exit(result.errors.length ? 1 : 0);
    break;
  }
  case "render": {
    need(file);
    const circuit = readCircuit(file);
    const result = resolveCircuit(circuit);
    const svg = renderSvg(result, { embed: circuit });
    if (!out) process.stdout.write(svg);
    else if (out.endsWith(".png")) await toPng(svg, out);
    else writeFileSync(out, svg);
    for (const e of result.errors) console.error(`ERROR: ${e}`);
    break;
  }
  case "apply": {
    need(file && extra);
    const ops = JSON.parse(existsSync(extra) ? readFileSync(extra, "utf8") : extra);
    try {
      const { circuit, ids } = applyOps(readCircuit(file), ops);
      writeFileSync(out ?? file, stringifyCircuit(circuit));
      console.log(`applied ${ids.length} op(s): ${ids.filter(Boolean).join(", ")}`);
      const result = resolveCircuit(circuit);
      for (const e of result.errors) console.log(`ERROR: ${e}`);
      for (const w of result.warnings) console.log(`WARN:  ${w}`);
    } catch (e) {
      if (!(e instanceof OpError)) throw e;
      console.error(`failed (nothing written): ${e.message}`);
      process.exit(1);
    }
    break;
  }
  case "parts": {
    const registry = createRegistry(file ? (readCircuit(file).partDefs ?? []) : []);
    for (const def of registry.parts.values()) {
      const params = Object.fromEntries(Object.entries(def.params ?? {}).map(([k, s]) => [k, s.default]));
      const pins = def.pins(params).map((p) => p.name);
      const paramText = Object.entries(params).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
      console.log(`${def.type}  [${def.mount}]  ${def.name}\n    pins: ${pins.join(", ")}${paramText ? `\n    params: ${paramText}` : ""}`);
    }
    break;
  }
  case "new": {
    need(file);
    writeFileSync(file, stringifyCircuit({ ...emptyCircuit(), board: extra ?? "half" }));
    break;
  }
  case "url": {
    need(file);
    console.log(await shareUrl(readCircuit(file), base));
    break;
  }
  default:
    console.error(USAGE);
    process.exit(2);
}

function need(ok) {
  if (ok) return;
  console.error(USAGE);
  process.exit(2);
}

async function toPng(svg, path) {
  // require() also finds a globally installed Playwright (NODE_PATH), which import() does not.
  const { chromium } = createRequire(import.meta.url)("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.setContent(`<body style="margin:0;background:#fff">${svg}</body>`);
  await page.locator("svg").screenshot({ path });
  await browser.close();
}
