#!/usr/bin/env node
// Renders the examples to docs/images/*.svg (animated, with the circuit embedded) for the README.
//   node tools/build-images.mjs
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolveCircuit } from "../src/circuit.js";
import { renderSvg } from "../src/render.js";

const root = new URL("..", import.meta.url);
const outDir = new URL("docs/images/", root);
mkdirSync(outDir, { recursive: true });
const FLEX_TOO = ["flasher-kit"];

for (const file of readdirSync(new URL("examples/", root)).filter((f) => f.endsWith(".json")).sort()) {
  const circuit = JSON.parse(readFileSync(new URL(`examples/${file}`, root), "utf8"));
  const result = resolveCircuit(circuit);
  if (result.errors.length) throw new Error(`${file}: ${result.errors.join("; ")}`);
  const name = file.replace(/\.json$/, "");
  writeFileSync(new URL(`${name}.svg`, outDir), renderSvg(result, { embed: circuit }));
  console.log(`docs/images/${name}.svg`);
  // the same circuit with flexible wires, for the side-by-side in the README
  if (FLEX_TOO.includes(name)) {
    const { wireStyle, ...flex } = circuit;
    writeFileSync(new URL(`${name}-flex.svg`, outDir), renderSvg(resolveCircuit(flex), { embed: flex }));
    console.log(`docs/images/${name}-flex.svg`);
  }
  if (circuit.steps?.length) {
    writeFileSync(new URL(`${name}-assembly.svg`, outDir), renderSvg(result, { embed: circuit, assembly: true }));
    console.log(`docs/images/${name}-assembly.svg`);
  }
}
