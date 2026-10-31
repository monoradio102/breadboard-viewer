import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolveCircuit } from "../src/circuit.js";
import { mergeDefs, parseLibrary, stringifyLibrary } from "../src/io.js";
import { applyOps } from "../src/ops.js";
import { fromJson } from "../src/parts/registry.js";

const oledCircuit = readFileSync(new URL("../examples/oled-custom-part.json", import.meta.url), "utf8");
const oled = JSON.parse(oledCircuit).partDefs[0];

test("definePart adds or replaces a JSON part definition", () => {
  let { circuit } = applyOps({ board: "full" }, [{ op: "definePart", def: oled }, { op: "addPart", type: oled.type, at: "d24" }]);
  assert.deepEqual(resolveCircuit(circuit).errors, []);
  circuit = applyOps(circuit, [{ op: "definePart", def: { ...oled, name: "renamed" } }]).circuit;
  assert.equal(circuit.partDefs.length, 1);
  assert.equal(circuit.partDefs[0].name, "renamed");
  assert.throws(() => applyOps(circuit, [{ op: "definePart", def: { ...oled, type: "led" } }]), /組み込み部品と同じ名前/);
  assert.throws(() => applyOps(circuit, [{ op: "definePart", def: { type: "x", pins: [] } }]), /pins が空/);
});

test("libraries: from a circuit, a library file or an array; invalid entries are reported", () => {
  assert.deepEqual(parseLibrary(oledCircuit, fromJson).defs.map((d) => d.type), [oled.type]);
  const text = stringifyLibrary("mine", [oled, { type: "broken" }]);
  const lib = parseLibrary(text, fromJson);
  assert.equal(lib.name, "mine");
  assert.deepEqual(lib.defs.map((d) => d.type), [oled.type]);
  assert.match(lib.errors.join(), /broken/);
  assert.equal(parseLibrary(JSON.stringify([oled]), fromJson).defs.length, 1);
  assert.throws(() => parseLibrary('{"parts": []}', fromJson), /partDefs/);
});

test("mergeDefs keeps one definition per type, later ones win", () => {
  const merged = mergeDefs([oled], [{ ...oled, name: "new" }], [{ ...oled, type: "other" }]);
  assert.deepEqual(merged.map((d) => [d.type, d.name ?? ""]), [[oled.type, "new"], ["other", oled.name]]);
});
