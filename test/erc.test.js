import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCircuit } from "../src/circuit.js";

const advice = (c) => resolveCircuit({ board: "half", ...c }).advice.join("\n");
// XIAO at h5: D0..D6 = h5..h11, D7..D10 = d11..d8, 3V3 = d7, GND = d6, 5V = d5
const xiao = { id: "U1", type: "xiao", at: "h5" };

test("3V3 and 5V on the same rail", () => {
  const a = advice({ parts: [xiao], wires: [{ from: "a7", to: "T+7" }, { from: "a5", to: "T+5" }] });
  assert.match(a, /電圧の違う電源どうし.*U1\.3V3 \(3\.3V\).*U1\.5V \(5V\)/);
});

test("supply shorted to GND", () => {
  assert.match(advice({ parts: [xiao], wires: [{ from: "a5", to: "a6" }] }), /電源と GND がつながっています/);
});

test("LED without a resistor, from a supply or a GPIO", () => {
  const fromSupply = advice({ parts: [xiao, { id: "LED1", type: "led", pins: { A: "c7", K: "c6" } }] });
  assert.match(fromSupply, /LED1 が抵抗なしで U1\.3V3 と GND/);
  const fromGpio = advice({ parts: [xiao, { id: "LED1", type: "led", pins: { A: "j5", K: "B-5" } }], wires: [{ from: "a6", to: "B-3" }] });
  assert.match(fromGpio, /LED1 が抵抗なしで U1\.D0 と GND/);
  const withResistor = advice({
    parts: [xiao, { id: "R1", type: "resistor", pins: ["j5", "j15"] }, { id: "LED1", type: "led", pins: { A: "i15", K: "B-15" } }],
    wires: [{ from: "a6", to: "B-3" }],
  });
  assert.doesNotMatch(withResistor, /LED1/);
});

test("GND of a wired-up part left unconnected", () => {
  const a = advice({ parts: [xiao, { id: "R1", type: "resistor", pins: ["j5", "j15"] }, { id: "LED1", type: "led", pins: { A: "i15", K: "B-15" } }] });
  assert.match(a, /U1 の GND がどこにもつながっていません/);
  // a part with nothing attached at all is left alone
  assert.doesNotMatch(advice({ parts: [xiao] }), /GND/);
});

test("supply voltage out of range, and a 5 V signal into a 3.3 V GPIO", () => {
  const a = advice({
    board: "full",
    parts: [xiao, { id: "MIC1", type: "inmp441", at: "f30" }, { id: "US1", type: "hcsr04", at: "a50" }],
    wires: [
      { from: "a5", to: "T+5" },
      { from: "MIC1.VDD", to: "T+31" },
      { from: "b50", to: "T+49" },
      { from: "a6", to: "T-3" },
      { from: "MIC1.GND", to: "T-33" },
      { from: "b53", to: "T-51" },
      { from: "b52", to: "j11" },
    ],
  });
  assert.match(a, /MIC1\.VDD は 3\.6V までですが、U1\.5V \(5V\)/);
  assert.match(a, /U1\.D6 \(3\.6V まで\) に US1\.ECHO の 5V/);
});

test("JSON parts can declare roles", () => {
  const def = { type: "sensor", pins: [{ name: "VCC", x: 0, y: 0, role: "vin", vmax: 3.6 }, { name: "GND", x: 1, y: 0, role: "gnd" }] };
  const a = advice({ partDefs: [def], parts: [{ id: "U1", type: "nano", at: "h3" }, { id: "S1", type: "sensor", at: "a20" }], wires: [{ from: "a6", to: "b20" }, { from: "a4", to: "b21" }] });
  assert.match(a, /S1\.VCC は 3\.6V までですが、U1\.5V \(5V\)/);
});

test("examples only warn where intended", () => {
  for (const name of ["blink-nano", "pico-button", "motor-servo", "distance-alarm", "tone-speaker", "oled-custom-part", "xiao-voice"]) {
    assert.deepEqual(resolveCircuit(JSON.parse(readExample(name))).advice, [], name);
  }
});

import { readFileSync } from "node:fs";
function readExample(name) {
  return readFileSync(new URL(`../examples/${name}.json`, import.meta.url), "utf8");
}
