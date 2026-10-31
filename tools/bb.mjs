#!/usr/bin/env node
// CLI for humans and AI agents.
//   node tools/bb.mjs check  <circuit.json>               validate and print the netlist
//   node tools/bb.mjs render <circuit.json> [-o out.svg]  render to SVG (or .png via Playwright)
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, resolveCircuit } from "../src/circuit.js";
import { renderSvg } from "../src/render.js";

const [cmd, file, ...rest] = process.argv.slice(2);
if (!cmd || !file) {
  console.error("usage: bb.mjs check|render <circuit.json> [-o out.svg|out.png]");
  process.exit(2);
}
const circuit = JSON.parse(readFileSync(file, "utf8"));
const result = resolveCircuit(circuit);

if (cmd === "check") {
  console.log(describe(result));
  process.exit(result.errors.length ? 1 : 0);
} else if (cmd === "render") {
  const out = rest[rest.indexOf("-o") + 1];
  const svg = renderSvg(result, { embed: circuit });
  if (!rest.includes("-o")) process.stdout.write(svg);
  else if (out.endsWith(".png")) await toPng(svg, out);
  else writeFileSync(out, svg);
  for (const e of result.errors) console.error(`ERROR: ${e}`);
} else {
  console.error(`unknown command: ${cmd}`);
  process.exit(2);
}

async function toPng(svg, out) {
  // require() also finds a globally installed Playwright (NODE_PATH), which import() does not.
  const { chromium } = createRequire(import.meta.url)("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.setContent(`<body style="margin:0;background:#fff">${svg}</body>`);
  await page.locator("svg").screenshot({ path: out });
  await browser.close();
}
