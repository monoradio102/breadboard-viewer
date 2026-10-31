#!/usr/bin/env node
// CLI for humans and AI agents.
//   node tools/bb.mjs check  <circuit.json>                      validate and print the netlist
//   node tools/bb.mjs render <circuit.json> [-o out.svg|out.png] [--time ms] [--transparent] [--scale n]
//                                                                render (PNG needs Playwright); --time draws a
//                                                                still frame of the animation
//   node tools/bb.mjs frames <circuit.json> -o <dir> [--fps n] [--from ms] [--to ms] [--transparent] [--scale n]
//                                                                PNG sequence of the animation (for ffmpeg)
//   node tools/bb.mjs apply  <circuit.json> <ops.json | '<json>'> [-o out.json] [--lib lib.json]
//                                                                apply edit ops (docs/OPS.md);
//                                                                writes back to circuit.json unless -o;
//                                                                parts from --lib are copied in when used
//   node tools/bb.mjs parts  [circuit.json] [--lib lib.json]     list part types, pins and params
//   node tools/bb.mjs lib    <out.json> <circuit|library.json...> collect custom part definitions
//   node tools/bb.mjs plan   <circuit.json>                      assembly plan as JSON (steps, times, tray positions)
//   node tools/bb.mjs new    <circuit.json> [board]               create an empty circuit
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, resolveCircuit } from "../src/circuit.js";
import { emptyCircuit, mergeDefs, parseCircuitText, parseLibrary, stringifyCircuit, stringifyLibrary } from "../src/io.js";
import { OpError, applyOps } from "../src/ops.js";
import { createRegistry, fromJson } from "../src/parts/registry.js";
import { planAssembly } from "../src/assembly.js";
import { renderSvg } from "../src/render.js";
import { openCapture } from "./capture.mjs";

const USAGE = `usage:
  bb.mjs check  <circuit.json>
  bb.mjs render <circuit.json> [-o out.svg|out.png] [--time ms] [--transparent] [--scale n] [--no-captions]
                [--assembly] [--step k]
  bb.mjs frames <circuit.json> -o <dir> [--fps 30] [--from ms] [--to ms] [--transparent] [--scale 1] [--no-captions]
                [--assembly]
  bb.mjs apply  <circuit.json> <ops.json | '<ops json>'> [-o out.json] [--lib lib.json]
  bb.mjs parts  [circuit.json] [--lib lib.json]
  bb.mjs lib    <out.json> <circuit.json|library.json ...>
  bb.mjs plan   <circuit.json>
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
const timeArgValue = timeArg === undefined ? undefined : Number(timeArg);
const out = option("-o");
const transparent = flag("--transparent");
const captions = !flag("--no-captions");
const assembly = flag("--assembly");
const stepArg = option("--step");
const scale = option("--scale");
const fps = Number(option("--fps") ?? 30);
const libFiles = [];
for (let f = option("--lib"); f !== undefined; f = option("--lib")) libFiles.push(f);
const from = option("--from");
const to = option("--to");
const [cmd, file, extra] = args;
const readCircuit = (f) => parseCircuitText(readFileSync(f, "utf8"));
const readLibrary = (f) => {
  const lib = parseLibrary(readFileSync(f, "utf8"), fromJson);
  for (const e of lib.errors) console.error(`WARN:  ${f}: ${e}`);
  return lib.defs;
};
const libDefs = () => mergeDefs(...libFiles.map(readLibrary));

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
      // --step k: the assembly after step k (implies --assembly)
      const time = stepArg !== undefined ? planAssembly(result).timeOfStep(Number(stepArg)) : timeArgValue;
      const mode = { captions, assembly: assembly || stepArg !== undefined };
      if (out?.endsWith(".png")) {
        // a PNG is one frame: the animated SVG paused at --time (default 0)
        const cap = await openCapture(renderSvg(result, mode), { scale: Number(scale ?? 2), transparent });
        await cap.frame(time ?? 0, out);
        await cap.close();
      } else {
        const svg = renderSvg(result, { embed: circuit, ...mode, ...(time !== undefined ? { time } : {}) });
        if (out) writeFileSync(out, svg);
        else process.stdout.write(svg);
      }
      for (const e of result.errors) console.error(`ERROR: ${e}`);
      break;
    }
    case "frames": {
      need(file && out);
      const result = resolveCircuit(readCircuit(file));
      const duration = assembly ? planAssembly(result).duration : result.timeline.duration;
      const start = Number(from ?? 0);
      const end = Number(to ?? duration);
      const count = Math.max(1, Math.round(((end - start) / 1000) * fps));
      mkdirSync(out, { recursive: true });
      const cap = await openCapture(renderSvg(result, { captions, assembly }), { scale: Number(scale ?? 1), transparent });
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
      let ops = JSON.parse(existsSync(extra) ? readFileSync(extra, "utf8") : extra);
      ops = withLibraryParts(readCircuit(file), Array.isArray(ops) ? ops : [ops], libDefs());
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
      const registry = createRegistry(mergeDefs(libDefs(), file ? readCircuit(file).partDefs : []));
      for (const def of registry.parts.values()) {
        const params = Object.fromEntries(Object.entries(def.params ?? {}).map(([k, s]) => [k, s.default]));
        const pins = def.pins(params).map((p) => p.name);
        const paramText = Object.entries(params).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
        console.log(`${def.type}  [${def.mount}]  ${def.name}\n    pins: ${pins.join(", ")}${paramText ? `\n    params: ${paramText}` : ""}`);
      }
      break;
    }
    case "plan": {
      need(file);
      const result = resolveCircuit(readCircuit(file));
      const plan = planAssembly(result);
      const box = (b) => b && Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Math.round(v * 100) / 100]));
      const out = {
        duration: plan.duration,
        timing: plan.T,
        steps: plan.steps.map((s, i) => ({
          step: i + 1,
          text: s.text,
          items: s.items,
          start: plan.start(i + 1),
          end: plan.start(i + 1) + plan.length(i + 1),
          snapshot: plan.timeOfStep(i + 1),
        })),
        auto: !result.steps.length,
        tray: Object.fromEntries(plan.trayPos),
        trayBoxes: Object.fromEntries([...plan.trayBoxes].map(([id, b]) => [id, box(b)])),
        trayBounds: box(plan.trayBounds),
        board: box(result.board.bounds),
      };
      console.log(JSON.stringify(out, null, 2));
      // parts that would overlap while waiting in the tray
      const entries = [...plan.trayBoxes];
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const [a, p] = entries[i];
          const [b, q] = entries[j];
          if (p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h) console.error(`WARN:  トレイで ${a} と ${b} が重なっています`);
        }
      }
      for (const w of result.warnings.filter((w) => /steps|assembly/.test(w))) console.error(`WARN:  ${w}`);
      break;
    }
    case "lib": {
      need(file && args.length > 2);
      const defs = mergeDefs(...args.slice(2).map(readLibrary));
      writeFileSync(file, stringifyLibrary(file.replace(/^.*\//, "").replace(/\.json$/, ""), defs));
      console.log(`${defs.length} part(s): ${defs.map((d) => d.type).join(", ")} -> ${file}`);
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

// Before each addPart whose type the circuit does not know yet, insert a definePart op
// with the definition from the libraries.
function withLibraryParts(circuit, ops, defs) {
  if (!defs.length) return ops;
  const known = new Set([...createRegistry(circuit.partDefs ?? []).parts.keys()]);
  const out = [];
  for (const op of ops) {
    if (op?.op === "definePart" && op.def?.type) known.add(op.def.type);
    if (op?.op === "addPart" && !known.has(op.type)) {
      const def = defs.find((d) => d.type === op.type);
      if (def) {
        out.push({ op: "definePart", def });
        known.add(def.type);
      }
    }
    out.push(op);
  }
  return out;
}

function need(ok) {
  if (ok) return;
  console.error(USAGE);
  process.exit(2);
}
