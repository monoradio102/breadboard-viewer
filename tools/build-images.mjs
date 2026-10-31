#!/usr/bin/env node
// Renders the examples to docs/images/*.svg (animated, with the circuit embedded) for the
// README, and prints share URLs that open each example in the editor.
//   node tools/build-images.mjs [--base URL]
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolveCircuit } from "../src/circuit.js";
import { shareUrl } from "../src/io.js";
import { renderSvg } from "../src/render.js";

const args = process.argv.slice(2);
const base = args.includes("--base") ? args[args.indexOf("--base") + 1] : "https://monoradio102.github.io/breadboard-viewer/";
const root = new URL("..", import.meta.url);
const outDir = new URL("docs/images/", root);
mkdirSync(outDir, { recursive: true });

for (const file of readdirSync(new URL("examples/", root)).filter((f) => f.endsWith(".json")).sort()) {
  const circuit = JSON.parse(readFileSync(new URL(`examples/${file}`, root), "utf8"));
  const result = resolveCircuit(circuit);
  if (result.errors.length) throw new Error(`${file}: ${result.errors.join("; ")}`);
  const name = file.replace(/\.json$/, "");
  writeFileSync(new URL(`${name}.svg`, outDir), renderSvg(result, { embed: circuit }));
  console.log(`${name}\t${await shareUrl(circuit, base)}`);
}
