#!/usr/bin/env node
// CLI for humans and AI agents.
//   node tools/bb.mjs check  <circuit.json>                      validate and print the netlist
//   node tools/bb.mjs render <circuit.json> [-o out.svg|out.png] [--time ms] [--transparent] [--scale n]
//                                                                render (PNG needs Playwright); --time draws a
//                                                                still frame of the animation
//   node tools/bb.mjs frames <circuit.json> -o <dir> [--fps n] [--from ms] [--to ms] [--transparent] [--scale n]
//                                                                PNG sequence of the animation (for ffmpeg)
//   node tools/bb.mjs apply  <circuit.json> <ops.json | '<json>'> [-o out.json]
//                                                                apply edit ops (docs/OPS.md);
//                                                                writes back to circuit.json unless -o
//   node tools/bb.mjs parts  [circuit.json]                      list part types, pins and params
//   node tools/bb.mjs new    <circuit.json> [board]               create an empty circuit
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, resolveCircuit } from "../src/circuit.js";
import { emptyCircuit, parseCircuitText, stringifyCircuit } from "../src/io.js";
import { OpError, applyOps } from "../src/ops.js";
import { createRegistry } from "../src/parts/registry.js";
import { renderSvg } from "../src/render.js";
import { openCapture } from "./capture.mjs";

const USAGE = `usage:
  bb.mjs check  <circuit.json>
  bb.mjs render <circuit.json> [-o out.svg|out.png] [--time ms] [--transparent] [--scale n] [--no-captions]
  bb.mjs frames <circuit.json> -o <dir> [--fps 30] [--from ms] [--to ms] [--transparent] [--scale 1] [--no-captions]
  bb.mjs apply  <circuit.json> <ops.json | '<ops json>'> [-o out.json]
  bb.mjs parts  [circuit.json]
  bb.mjs new    <circuit.json> [full|half|mini]`;

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && Boolean(args.splice(i, 1));
};
const timeArg = option("--time");
const time = timeArg === undefined ? undefined : Number(timeArg);
const out = option("-o");
const transparent = flag("--transparent");
const captions = !flag("--no-captions");
const scale = option("--scale");
const fps = Number(option("--fps") ?? 30);
const from = option("--from");
const to = option("--to");
const [cmd, file, extra] = args;
const readCircuit = (f) => parseCircuitText(readFileSync(f, "utf8"));

try {
  await main();
} catch (e) {
  if (e?.code !== "NO_PLAYWRIGHT") throw e;
  console.error(e.message);
  process.exit(1);
}

async function main() {
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
      if (out?.endsWith(".png")) {
        // a PNG is one frame: the animated SVG paused at --time (default 0)
        const cap = await openCapture(renderSvg(result, { captions }), { scale: Number(scale ?? 2), transparent });
        await cap.frame(time ?? 0, out);
        await cap.close();
      } else {
        const svg = renderSvg(result, { embed: circuit, captions, ...(time !== undefined ? { time } : {}) });
        if (out) writeFileSync(out, svg);
        else process.stdout.write(svg);
      }
      for (const e of result.errors) console.error(`ERROR: ${e}`);
      break;
    }
    case "frames": {
      need(file && out);
      const result = resolveCircuit(readCircuit(file));
      const duration = result.timeline.duration;
      const start = Number(from ?? 0);
      const end = Number(to ?? duration);
      const count = Math.max(1, Math.round(((end - start) / 1000) * fps));
      mkdirSync(out, { recursive: true });
      const cap = await openCapture(renderSvg(result, { captions }), { scale: Number(scale ?? 1), transparent });
      for (let i = 0; i < count; i++) {
        await cap.frame(start + (i * 1000) / fps, join(out, `frame_${String(i).padStart(5, "0")}.png`));
      }
      await cap.close();
      console.log(`${count} frames (${fps} fps, ${start}–${end} ms) -> ${out}/frame_%05d.png`);
      console.log(`mp4: ffmpeg -framerate ${fps} -i ${out}/frame_%05d.png -pix_fmt yuv420p -vf "pad=ceil(iw/2)*2:ceil(ih/2)*2" out.mp4`);
      console.log(`gif: ffmpeg -framerate ${fps} -i ${out}/frame_%05d.png -vf "split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse" out.gif`);
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
    default:
      console.error(USAGE);
      process.exit(2);
  }
}

function need(ok) {
  if (ok) return;
  console.error(USAGE);
  process.exit(2);
}
