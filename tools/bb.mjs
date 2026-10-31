#!/usr/bin/env node
// CLI for humans and AI agents. Run without arguments for usage. Unknown options are errors.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { planAssembly } from "../src/assembly.js";
import { describe, resolveCircuit } from "../src/circuit.js";
import { bodyBox, coordsOf, layoutIssues, partSpec, previewPlacement } from "../src/inspect.js";
import { emptyCircuit, mergeDefs, parseCircuitText, parseLibrary, stringifyCircuit, stringifyLibrary } from "../src/io.js";
import { OpError, applyOps } from "../src/ops.js";
import { createRegistry, fromJson } from "../src/parts/registry.js";
import { renderSvg } from "../src/render.js";
import { launchBrowser, openCapture } from "./capture.mjs";

const VIEW = {
  "--viewbox": "value",
  "--focus": "value",
  "--margin": "value",
  "--chrome": "flag",
  "--browser-path": "value",
  "--transparent": "flag",
  "--scale": "value",
  "--no-captions": "flag",
  "--assembly": "flag",
};

// command: [usage, positional min, positional max, options]
const COMMANDS = {
  check: ["check  <circuit.json> [--json] [--layout]", 1, 1, { "--json": "flag", "--layout": "flag" }],
  render: [
    "render <circuit.json> [-o out.svg|out.png] [--time ms | --step k] [--assembly] [--transparent] [--scale n]\n" +
      "              [--no-captions] [--viewbox \"x y w h\" | --focus ID,ID [--margin n]] [--chrome | --browser-path path]",
    1,
    1,
    { "-o": "value", "--time": "value", "--step": "value", ...VIEW },
  ],
  frames: [
    "frames <circuit.json> -o <dir> [--fps 30] [--from ms] [--to ms] [--jobs n] [--assembly] [--transparent] [--scale 1]\n" +
      "              [--no-captions] [--viewbox \"x y w h\" | --focus ID,ID [--margin n]] [--chrome | --browser-path path]",
    1,
    1,
    { "-o": "value", "--fps": "value", "--from": "value", "--to": "value", "--jobs": "value", ...VIEW },
  ],
  apply: ["apply  <circuit.json> <ops.json | '<ops json>'> [-o out.json] [--lib lib.json]", 2, 2, { "-o": "value", "--lib": "multi" }],
  parts: ["parts  [circuit.json] [--lib lib.json] [--json] [--type t1,t2]", 0, 1, { "--lib": "multi", "--json": "flag", "--type": "value" }],
  place: [
    "place  <type> (--at hole | --pos x,y) [--rot 0|90|180|270] [--param k=v ...] [--in circuit.json] [--lib lib.json]",
    1,
    1,
    { "--at": "value", "--pos": "value", "--rot": "value", "--param": "multi", "--in": "value", "--lib": "multi" },
  ],
  coords: ["coords <hole | PartId.Pin | x,y ...> [--in circuit.json] [--board full|half|mini]", 1, Infinity, { "--in": "value", "--board": "value" }],
  lib: ["lib    <out.json> <circuit.json|library.json ...>", 2, Infinity, {}],
  plan: ["plan   <circuit.json>", 1, 1, {}],
  new: ["new    <circuit.json> [full|half|mini]", 1, 2, {}],
};

const USAGE = `usage:\n${Object.values(COMMANDS)
  .map(([u]) => `  bb.mjs ${u}`)
  .join("\n")}`;

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const spec = COMMANDS[cmd];
  if (!spec) fail(cmd ? `unknown command: ${cmd}\n${USAGE}` : USAGE);
  const [usage, min, max, options] = spec;
  const opts = {};
  const pos = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    // "-3,2" or "-1.5" are values, not options
    if (!a.startsWith("-") || /^-[\d.]/.test(a)) {
      pos.push(a);
      continue;
    }
    const kind = options[a];
    if (!kind) fail(`unknown option for ${cmd}: ${a}\nusage: bb.mjs ${usage}`);
    if (kind === "flag") opts[a] = true;
    else {
      if (i + 1 >= rest.length) fail(`${a} needs a value\nusage: bb.mjs ${usage}`);
      const v = rest[++i];
      if (kind === "multi") (opts[a] ??= []).push(v);
      else opts[a] = v;
    }
  }
  if (pos.length < min || pos.length > max) fail(`usage: bb.mjs ${usage}`);
  return { cmd, pos, opts };
}

const { cmd, pos, opts } = parseArgs(process.argv.slice(2));
const readCircuit = (f) => parseCircuitText(readFileSync(f, "utf8"));
const readLibrary = (f) => {
  const lib = parseLibrary(readFileSync(f, "utf8"), fromJson);
  for (const e of lib.errors) console.error(`WARN:  ${f}: ${e}`);
  return lib.defs;
};
const libDefs = () => mergeDefs(...(opts["--lib"] ?? []).map(readLibrary));
const num = (name, fallback) => {
  if (opts[name] === undefined) return fallback;
  const v = Number(opts[name]);
  if (!Number.isFinite(v)) fail(`${name} must be a number`);
  return v;
};

try {
  await main();
} catch (e) {
  if (e?.code !== "NO_PLAYWRIGHT") throw e;
  fail(e.message, 1);
}

async function main() {
  switch (cmd) {
    case "check": {
      const result = resolveCircuit(readCircuit(pos[0]));
      const layout = opts["--layout"] ? layoutIssues(result) : null;
      if (opts["--json"]) {
        console.log(JSON.stringify(checkJson(result, layout), null, 2));
      } else {
        console.log(describe(result));
        if (layout) {
          for (const l of layout) console.log(`LAYOUT: ${l}`);
          if (!layout.length) console.log("LAYOUT: 見た目の重なりは見つかりません");
        }
      }
      process.exit(result.errors.length ? 1 : 0);
      break;
    }
    case "render": {
      const circuit = readCircuit(pos[0]);
      const result = resolveCircuit(circuit);
      const out = opts["-o"];
      if (opts["--step"] !== undefined && opts["--time"] !== undefined) fail("--time と --step はどちらか一方です");
      // --step k: the assembly after step k (implies --assembly)
      const assembly = Boolean(opts["--assembly"]) || opts["--step"] !== undefined;
      const time = opts["--step"] !== undefined ? planAssembly(result).timeOfStep(num("--step")) : num("--time");
      const mode = { captions: !opts["--no-captions"], assembly, viewBox: viewBoxOf(result) };
      if (out?.endsWith(".png")) {
        // a PNG is one frame: the animated SVG paused at --time (default 0)
        const cap = await openCapture(renderSvg(result, mode), captureOptions(2));
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
      const out = opts["-o"] ?? fail("frames には -o <dir> が必要です");
      const result = resolveCircuit(readCircuit(pos[0]));
      const assembly = Boolean(opts["--assembly"]);
      const duration = assembly ? planAssembly(result).duration : result.timeline.duration;
      const fps = num("--fps", 30);
      const start = num("--from", 0);
      const end = num("--to", duration);
      const count = Math.max(1, Math.round(((end - start) / 1000) * fps));
      const jobs = Math.max(1, Math.min(count, num("--jobs", Math.min(4, cpus().length))));
      mkdirSync(out, { recursive: true });
      const svg = renderSvg(result, { captions: !opts["--no-captions"], assembly, viewBox: viewBoxOf(result) });
      // one browser, several capture pages in parallel, each taking every jobs-th frame
      const browser = await launchBrowser(captureOptions(1));
      const caps = await Promise.all(Array.from({ length: jobs }, () => openCapture(svg, { ...captureOptions(1), browser })));
      await Promise.all(
        caps.map(async (cap, j) => {
          for (let i = j; i < count; i += jobs) await cap.frame(start + (i * 1000) / fps, join(out, `frame_${String(i).padStart(5, "0")}.png`));
        }),
      );
      await Promise.all(caps.map((c) => c.close()));
      await browser.close();
      console.log(`${count} frames (${fps} fps, ${start}–${end} ms, ${jobs} jobs) -> ${out}/frame_%05d.png`);
      console.log(`mp4: ffmpeg -framerate ${fps} -i ${out}/frame_%05d.png -pix_fmt yuv420p -vf "pad=ceil(iw/2)*2:ceil(ih/2)*2" out.mp4`);
      console.log(`gif: ffmpeg -framerate ${fps} -i ${out}/frame_%05d.png -vf "split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse" out.gif`);
      break;
    }
    case "apply": {
      const [file, extra] = pos;
      let ops = JSON.parse(existsSync(extra) ? readFileSync(extra, "utf8") : extra);
      ops = withLibraryParts(readCircuit(file), Array.isArray(ops) ? ops : [ops], libDefs());
      try {
        const { circuit, ids } = applyOps(readCircuit(file), ops);
        writeFileSync(opts["-o"] ?? file, stringifyCircuit(circuit));
        console.log(`applied ${ids.length} op(s): ${ids.filter(Boolean).join(", ")}`);
        const result = resolveCircuit(circuit);
        for (const e of result.errors) console.log(`ERROR: ${e}`);
        for (const w of result.warnings) console.log(`WARN:  ${w}`);
      } catch (e) {
        if (!(e instanceof OpError)) throw e;
        fail(`failed (nothing written): ${e.message}`, 1);
      }
      break;
    }
    case "parts": {
      const registry = createRegistry(mergeDefs(libDefs(), pos[0] ? readCircuit(pos[0]).partDefs : []));
      const only = opts["--type"]?.split(",").map((s) => s.trim());
      const defs = [...registry.parts.values()].filter((d) => !only || only.includes(d.type));
      if (only) for (const t of only) if (!registry.get(t)) fail(`unknown part type: ${t}`);
      if (opts["--json"]) {
        console.log(JSON.stringify(defs.map(partSpec), null, 2));
        break;
      }
      for (const def of defs) {
        const spec = partSpec(def);
        const params = Object.entries(spec.params).map(([k, s]) => `${k}=${JSON.stringify(s.default)}`).join(" ");
        const layout = spec.pins.map((p) => `${p.name}(${p.x},${p.y}${p.insert === false ? ",端子" : ""})`).join(" ");
        console.log(`${def.type}  [${def.mount}]  ${def.name}\n    pins: ${layout}${params ? `\n    params: ${params}` : ""}${spec.extent ? `\n    extent: [${spec.extent.join(", ")}]` : ""}`);
      }
      break;
    }
    case "place": {
      const circuit = opts["--in"] ? readCircuit(opts["--in"]) : emptyCircuit();
      circuit.partDefs = mergeDefs(libDefs(), circuit.partDefs);
      const inst = { type: pos[0], ...(opts["--rot"] !== undefined ? { rot: num("--rot") } : {}) };
      if (opts["--at"]) inst.at = opts["--at"];
      else if (opts["--pos"]) inst.pos = opts["--pos"].split(",").map(Number);
      else fail("place には --at <穴> か --pos x,y が必要です");
      for (const kv of opts["--param"] ?? []) {
        const [k, ...v] = kv.split("=");
        const value = v.join("=");
        inst[k] = value !== "" && Number.isFinite(Number(value)) ? Number(value) : value;
      }
      if (!createRegistry(circuit.partDefs ?? []).get(inst.type)) fail(`unknown part type: ${inst.type}`);
      const preview = previewPlacement(circuit, inst);
      console.log(JSON.stringify(preview, null, 2));
      process.exit(preview.ok ? 0 : 1);
      break;
    }
    case "coords": {
      const circuit = opts["--in"] ? readCircuit(opts["--in"]) : { ...emptyCircuit(), board: opts["--board"] ?? "full" };
      const result = resolveCircuit(circuit);
      for (const ref of pos) console.log(JSON.stringify(coordsOf(result, ref)));
      break;
    }
    case "plan": {
      const result = resolveCircuit(readCircuit(pos[0]));
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
      const [file, ...inputs] = pos;
      const defs = mergeDefs(...inputs.map(readLibrary));
      writeFileSync(file, stringifyLibrary(file.replace(/^.*\//, "").replace(/\.json$/, ""), defs));
      console.log(`${defs.length} part(s): ${defs.map((d) => d.type).join(", ")} -> ${file}`);
      break;
    }
    case "new": {
      writeFileSync(pos[0], stringifyCircuit({ ...emptyCircuit(), board: pos[1] ?? "half" }));
      break;
    }
  }
}

function checkJson(result, layout) {
  return {
    ok: result.errors.length === 0,
    errors: result.errors,
    warnings: result.warnings,
    advice: result.advice,
    ...(layout ? { layout } : {}),
    parts: result.parts.map((p) => ({ id: p.id, type: p.type, pins: Object.fromEntries(p.pins.map((q) => [q.name, q.hole ?? (p.offboard ? "offboard" : q.terminal ? "terminal" : null)])) })),
    nets: result.nets.filter((n) => n.pins.length > 1 || /[+-]/.test(n.name)).map((n) => ({ name: n.name, pins: n.pins.map((p) => p.ref) })),
    unconnected: result.nets.filter((n) => n.pins.length < 2 && !/[+-]/.test(n.name)).map((n) => n.pins[0].ref),
  };
}

// --viewbox "x y w h", or --focus ID,ID: the box around those parts / wires / holes plus --margin
function viewBoxOf(result) {
  if (opts["--viewbox"] && opts["--focus"]) fail("--viewbox と --focus はどちらか一方です");
  if (opts["--viewbox"]) {
    const v = opts["--viewbox"].split(/[\s,]+/).map(Number);
    if (v.length !== 4 || !v.every(Number.isFinite) || v[2] <= 0 || v[3] <= 0) fail('--viewbox は "x y w h" です (ピッチ単位)');
    return v;
  }
  if (!opts["--focus"]) return undefined;
  const margin = num("--margin", 2);
  let box = null;
  const add = (b) => {
    box = box ? { x0: Math.min(box.x0, b.x), y0: Math.min(box.y0, b.y), x1: Math.max(box.x1, b.x + b.w), y1: Math.max(box.y1, b.y + b.h) } : { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
  };
  for (const id of opts["--focus"].split(",").map((s) => s.trim())) {
    const part = result.parts.find((p) => p.id === id);
    const wire = result.wires.find((w) => w.id === id);
    const hole = result.board.pos(id);
    if (part) add(bodyBox(part));
    else if (wire) for (const p of [wire.a, wire.b, ...wire.via]) add({ x: p.x, y: p.y, w: 0, h: 0 });
    else if (hole) add({ x: hole.x, y: hole.y, w: 0, h: 0 });
    else fail(`--focus: "${id}" という部品・配線・穴はありません`);
  }
  return [box.x0 - margin, box.y0 - margin, box.x1 - box.x0 + 2 * margin, box.y1 - box.y0 + 2 * margin];
}

function captureOptions(defaultScale) {
  if (opts["--chrome"] && opts["--browser-path"]) fail("--chrome と --browser-path はどちらか一方です");
  return {
    scale: num("--scale", defaultScale),
    transparent: Boolean(opts["--transparent"]),
    channel: opts["--chrome"] ? "chrome" : undefined,
    executablePath: opts["--browser-path"],
  };
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
