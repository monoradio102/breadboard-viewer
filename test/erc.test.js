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
  for (const name of ["blink-nano", "pico-button", "motor-servo", "distance-alarm", "tone-speaker", "oled-custom-part", "xiao-voice", "flasher-kit", "oled-hello"]) {
    assert.deepEqual(resolveCircuit(JSON.parse(readExample(name))).advice, [], name);
  }
});

import { readFileSync } from "node:fs";
function readExample(name) {
  return readFileSync(new URL(`../examples/${name}.json`, import.meta.url), "utf8");
}

test("electrolytic capacitors: rating from the value, reversed polarity", () => {
  const nano = { id: "U1", type: "nano", at: "h3" }; // 5V = d6, GND2 = d4
  const wires = [{ from: "a6", to: "T+6" }, { from: "a4", to: "T-4" }];
  const over = advice({ parts: [nano, { id: "C1", type: "electrolytic", value: "100uF 4V", pins: { "+": "T+10", "-": "T-10" } }], wires });
  assert.match(over, /C1 の耐圧 4V を超える 5V/);
  assert.doesNotMatch(over, /向きが逆/);
  const reversed = advice({ parts: [nano, { id: "C1", type: "electrolytic", value: "100uF 16V", pins: { "+": "T-10", "-": "T+10" } }], wires });
  assert.match(reversed, /C1 \(電解コンデンサ\) の向きが逆です/);
  assert.doesNotMatch(reversed, /耐圧/);
  const fine = advice({ parts: [nano, { id: "C1", type: "electrolytic", value: "100uF 16V", pins: { "+": "T+10", "-": "T-10" } }], wires });
  assert.doesNotMatch(fine, /C1/);
});

test("an input needing a higher HIGH than its driver (WS2812B at 5 V from a 3.3 V GPIO)", () => {
  const parts = [xiao, { id: "LED1", type: "ws2812b", at: "a20" }];
  // XIAO 5V (d5) -> T+, GND (d6) -> T-, D0 (h5) -> LED1.DIN (a20)
  const wires = [{ from: "a5", to: "T+5" }, { from: "a6", to: "T-7" }, { from: "b21", to: "T+21" }, { from: "b22", to: "T-23" }, { from: "j5", to: "b20" }];
  assert.match(advice({ parts, wires }), /LED1\.DIN は HIGH に 3\.5V 以上が必要ですが、U1\.D0 の出力は 3\.3V です/);
  // powered from 3.3 V the threshold is 2.31 V: no level warning (but VCC below 3.5 V is reported)
  const at3v3 = advice({ parts, wires: [{ from: "a7", to: "T+7" }, ...wires.slice(1)] });
  assert.doesNotMatch(at3v3, /HIGH に/);
  assert.match(at3v3, /LED1\.VCC は 3\.5V 以上が必要/);
});
