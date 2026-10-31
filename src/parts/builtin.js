// Built-in parts: common hobby components (the kind found at Akizuki Denshi).
//
// mount: "leads" -> legs can be bent, so the circuit may give each pin's hole explicitly
//                   (`pins`), or place the default `layout` with `at` + `rot`.
// mount: "rigid" -> fixed footprint, placed with `at` (hole of the first pin) + `rot`.
//
// Leads parts draw in board coordinates (ctx.pins are absolute positions).
// Rigid parts draw in local coordinates (first pin at the origin); the renderer applies at/rot.
import { circle, line, n, rect, tag, text } from "../svg.js";
import {
  bandColors,
  centroid,
  clamp,
  angle,
  dist,
  dualRow,
  headerPins,
  inline,
  leg,
  onAxis,
  parseOhms,
  place,
  pinLabels,
} from "./common.js";

const LED_COLORS = {
  red: "#e53935",
  green: "#43a047",
  blue: "#1e88e5",
  yellow: "#fdd835",
  orange: "#fb8c00",
  white: "#f5f5f5",
};

const resistor = {
  type: "resistor",
  name: "抵抗",
  category: "受動部品",
  description: "カーボン抵抗 1/4W。valueからカラーコードを描画。",
  mount: "leads",
  params: { value: { default: "220", description: "抵抗値 (例: 220, 4.7k, 4k7, 1M)" } },
  pins: () => inline(["1", "2"]).map((p, i) => ({ ...p, x: i * 4 })),
  render({ pins: [a, b], params }) {
    const L = clamp(dist(a, b) - 0.7, 0.9, 2.6);
    const bands = bandColors(parseOhms(params.value)) ?? [];
    const pos = [-0.3, -0.13, 0.04, 0.3];
    const body =
      rect(-L / 2, -0.36, L, 0.72, { rx: 0.3, fill: "#d9c49a", stroke: "#a8916a", "stroke-width": 0.04 }) +
      bands.map((c, i) => rect(pos[i] * L - 0.045 * L, -0.36, 0.09 * L, 0.72, { fill: c })).join("");
    return leg(a, b) + onAxis(a, b, body);
  },
};

const led = {
  type: "led",
  name: "LED",
  category: "半導体",
  description: "5mm砲弾型LED。ピンAがアノード(+, 長い足)、Kがカソード(-)。",
  mount: "leads",
  params: { color: { default: "red", options: Object.keys(LED_COLORS), description: "発光色" } },
  pins: () => inline(["A", "K"]),
  render({ pins: [a, b], params }) {
    const c = LED_COLORS[params.color] ?? params.color;
    const body =
      circle(0, 0, 0.95, { fill: c, stroke: "rgba(0,0,0,.35)", "stroke-width": 0.06, opacity: 0.92 }) +
      // flat edge marks the cathode side
      line(0.78, -0.55, 0.78, 0.55, { stroke: "rgba(0,0,0,.45)", "stroke-width": 0.08 }) +
      circle(-0.3, -0.3, 0.22, { fill: "#fff", opacity: 0.55 });
    return leg(a, b) + onAxis(a, b, body);
  },
};

const diode = {
  type: "diode",
  name: "ダイオード",
  category: "半導体",
  description: "整流/小信号ダイオード。ピンAがアノード、Kがカソード(帯の側)。",
  mount: "leads",
  params: { model: { default: "1N4148", description: "型番 (1N4148はガラス, それ以外は黒モールド)" } },
  pins: () => [
    { name: "A", x: 0, y: 0 },
    { name: "K", x: 4, y: 0 },
  ],
  render({ pins: [a, b], params }) {
    const glass = /4148/.test(params.model);
    const L = clamp(dist(a, b) - 0.7, 0.9, glass ? 1.6 : 2.0);
    const body =
      rect(-L / 2, -0.3, L, 0.6, { rx: 0.2, fill: glass ? "#e8873a" : "#222", opacity: glass ? 0.85 : 1 }) +
      rect(L / 2 - 0.32, -0.3, 0.16, 0.6, { fill: glass ? "#222" : "#ccc" });
    return leg(a, b) + onAxis(a, b, body);
  },
};

const capacitor = {
  type: "capacitor",
  name: "セラミックコンデンサ",
  category: "受動部品",
  description: "積層セラミックコンデンサ。極性なし。",
  mount: "leads",
  params: { value: { default: "0.1uF", description: "容量 (例: 0.1uF, 22pF)" } },
  pins: () => [
    { name: "1", x: 0, y: 0 },
    { name: "2", x: 2, y: 0 },
  ],
  render({ pins: [a, b], params }) {
    const body =
      rect(-0.75, -0.5, 1.5, 1.0, { rx: 0.4, fill: "#3f7fbf", stroke: "#2d5f91", "stroke-width": 0.05 }) +
      text(0, 0.02, params.value, { "font-size": 0.34, fill: "#fff", "text-anchor": "middle", "dominant-baseline": "central" });
    return leg(a, b) + onAxis(a, b, body);
  },
};

const electrolytic = {
  type: "electrolytic",
  name: "電解コンデンサ",
  category: "受動部品",
  description: "アルミ電解コンデンサ。ピン+が長い足、-が帯の側。",
  mount: "leads",
  params: { value: { default: "10uF", description: "容量 (例: 10uF, 100uF)" } },
  pins: () => inline(["+", "-"]),
  render({ pins: [a, b], params }) {
    const r = 1.05;
    const h = Math.sqrt(r * r - 0.45 * 0.45);
    const body =
      circle(0, 0, r, { fill: "#24364f", stroke: "#111", "stroke-width": 0.05 }) +
      tag("path", { d: `M 0.45 ${n(-h)} A ${r} ${r} 0 0 1 0.45 ${n(h)} Z`, fill: "#c6ced6" }) +
      circle(0, 0, 0.55, { fill: "none", stroke: "#8a9bb0", "stroke-width": 0.05 }) +
      text(-0.2, 0, params.value, { "font-size": 0.3, fill: "#fff", "text-anchor": "middle", "dominant-baseline": "central" });
    return leg(a, b) + onAxis(a, b, body);
  },
};

const cds = {
  type: "cds",
  name: "CdSセル(光センサ)",
  category: "センサ",
  description: "明るいほど抵抗値が下がるフォトレジスタ。極性なし。",
  mount: "leads",
  params: {},
  pins: () => inline(["1", "2"]),
  render({ pins: [a, b] }) {
    const body =
      circle(0, 0, 0.8, { fill: "#e9c46a", stroke: "#b08a2e", "stroke-width": 0.05 }) +
      tag("path", {
        d: "M -0.45 -0.35 H 0.4 V -0.12 H -0.4 V 0.12 H 0.4 V 0.35 H -0.45",
        fill: "none",
        stroke: "#b5532a",
        "stroke-width": 0.08,
      });
    return leg(a, b) + onAxis(a, b, body);
  },
};

const transistor = {
  type: "transistor",
  name: "トランジスタ (TO-92)",
  category: "半導体",
  description: "TO-92パッケージ。pinoutは平らな面を手前にして左からの並び (2SC1815=ECB, 2N3904=EBC)。",
  mount: "leads",
  params: {
    model: { default: "2SC1815", description: "型番" },
    pinout: { default: "ECB", description: "平らな面から見た左→右のピン配置 (例: ECB, EBC)" },
  },
  pins: (p) => inline(String(p.pinout).toUpperCase().split("")),
  render({ pins, params }) {
    const c = centroid(pins);
    const first = pins[0];
    const last = pins[pins.length - 1];
    const legs = pins.map((p) => leg(p, c, 0.1)).join("");
    const body =
      tag("path", { d: "M -1.15 0.35 L 1.15 0.35 A 1.2 1.2 0 0 0 -1.15 0.35 Z", fill: "#222", stroke: "#000", "stroke-width": 0.04 }) +
      text(0, -0.05, params.model, { "font-size": 0.3, fill: "#ddd", "text-anchor": "middle", "dominant-baseline": "central" });
    return legs + place(c, angle(first, last), body);
  },
};

const regulator = {
  type: "regulator",
  name: "三端子レギュレータ (TO-220)",
  category: "電源",
  description: "78xx系。ピンは前から見て IN, GND, OUT。",
  mount: "rigid",
  params: { model: { default: "7805", description: "型番" } },
  pins: () => inline(["IN", "GND", "OUT"]),
  render({ params }) {
    return (
      rect(-0.9, -0.95, 3.8, 0.35, { fill: "#b8bec4", stroke: "#888", "stroke-width": 0.04 }) +
      rect(-0.9, -0.6, 3.8, 0.85, { fill: "#1d1d1d", rx: 0.05 }) +
      text(1, -0.17, params.model, { "font-size": 0.42, fill: "#eee", "text-anchor": "middle", "dominant-baseline": "central" })
    );
  },
};

const button = {
  type: "button",
  name: "タクトスイッチ (6mm)",
  category: "スイッチ",
  description: "中央の溝をまたいで置く。1-2と3-4が常時導通、押すと(1,2)-(3,4)が導通。",
  mount: "rigid",
  params: {},
  pins: () => [
    { name: "1", x: 0, y: 0 },
    { name: "2", x: 0, y: 3 },
    { name: "3", x: 2, y: 0 },
    { name: "4", x: 2, y: 3 },
  ],
  internal: () => [
    ["1", "2"],
    ["3", "4"],
  ],
  render() {
    return (
      rect(-0.35, 0.25, 2.7, 2.5, { rx: 0.15, fill: "#2b2b2b", stroke: "#111", "stroke-width": 0.05 }) +
      circle(1, 1.5, 0.75, { fill: "#555", stroke: "#111", "stroke-width": 0.05 }) +
      circle(1, 1.5, 0.55, { fill: "#6b6b6b" })
    );
  },
};

const trimmer = {
  type: "trimmer",
  name: "半固定抵抗",
  category: "受動部品",
  description: "3386型など。ピン2がワイパー(中点)。",
  mount: "rigid",
  params: { value: { default: "10k", description: "抵抗値" } },
  pins: () => inline(["1", "2", "3"]),
  render({ params }) {
    return (
      rect(-0.45, -2.75, 2.9, 3.2, { rx: 0.15, fill: "#1f5fa8", stroke: "#164477", "stroke-width": 0.05 }) +
      circle(1, -1.35, 0.85, { fill: "#d8c27a", stroke: "#a48d3f", "stroke-width": 0.05 }) +
      line(0.45, -1.35, 1.55, -1.35, { stroke: "#6b5a22", "stroke-width": 0.14 }) +
      text(1, -2.35, params.value, { "font-size": 0.32, fill: "#fff", "text-anchor": "middle", "dominant-baseline": "central" })
    );
  },
};

const buzzer = {
  type: "buzzer",
  name: "圧電ブザー (12mm)",
  category: "出力",
  description: "ピン間7.6mm (3ピッチ)。+側に印。",
  mount: "rigid",
  params: {},
  pins: () => [
    { name: "+", x: 0, y: 0 },
    { name: "-", x: 3, y: 0 },
  ],
  render() {
    return (
      circle(1.5, 0, 2.35, { fill: "#1b1b1b", stroke: "#000", "stroke-width": 0.05 }) +
      circle(1.5, 0, 0.35, { fill: "#000", stroke: "#444", "stroke-width": 0.05 }) +
      text(0, -1.1, "+", { "font-size": 0.7, fill: "#ddd", "text-anchor": "middle", "dominant-baseline": "central" })
    );
  },
};

const header = {
  type: "header",
  name: "ピンヘッダ (1列)",
  category: "コネクタ",
  description: "2.54mmピッチのオスピンヘッダ。",
  mount: "rigid",
  params: { count: { default: 4, description: "ピン数" } },
  pins: (p) => inline(Array.from({ length: Number(p.count) || 1 }, (_, i) => String(i + 1))),
  render({ pins }) {
    const last = pins[pins.length - 1].x;
    return rect(-0.5, -0.5, last + 1, 1, { fill: "#222", rx: 0.08 }) + headerPins(pins);
  },
};

function dipRender({ pins, params }, width) {
  const half = pins.length / 2;
  const x0 = -0.55;
  const x1 = half - 1 + 0.55;
  const mid = -width / 2;
  const legs = pins
    .map((p) => (p.y === 0 ? rect(p.x - 0.18, -0.5, 0.36, 0.5, { fill: "#b9c0c7" }) : rect(p.x - 0.18, -width, 0.36, 0.5, { fill: "#b9c0c7" })))
    .join("");
  return (
    legs +
    rect(x0, -width + 0.42, x1 - x0, width - 0.84, { rx: 0.08, fill: "#262626", stroke: "#111", "stroke-width": 0.04 }) +
    tag("path", { d: `M ${n(x0)} ${n(mid - 0.35)} A 0.35 0.35 0 0 1 ${n(x0)} ${n(mid + 0.35)} Z`, fill: "#111" }) +
    circle(0, -0.85, 0.14, { fill: "#555" }) +
    text((x0 + x1) / 2, mid, params.label, { "font-size": Math.min(0.6, (x1 - x0) / Math.max(3, String(params.label).length) * 1.6), fill: "#e6e6e6", "text-anchor": "middle", "dominant-baseline": "central" })
  );
}

const dip = {
  type: "dip",
  name: "DIP IC (汎用)",
  category: "IC",
  description: "中央の溝をまたいで置く。atはピン1の穴 (ピン1は左下)。pinNamesで各ピンに名前を付けられる。",
  mount: "rigid",
  params: {
    count: { default: 8, description: "ピン数 (偶数)" },
    width: { default: 3, description: "列間隔 (ピッチ単位, 300mil=3, 600mil=6)" },
    label: { default: "IC", description: "表示する型番" },
    pinNames: { default: null, description: "ピン名の配列 (ピン1から順)" },
  },
  pins: (p) => dualRow(Number(p.count) || 8, Number(p.width) || 3, p.pinNames),
  render: (ctx) => dipRender(ctx, Number(ctx.params.width) || 3),
};

function dipPreset(type, name, description, names) {
  return {
    type,
    name,
    category: "IC",
    description,
    mount: "rigid",
    params: { label: { default: name, description: "表示する型番" } },
    pins: () => dualRow(names.length, 3, names),
    render: (ctx) => dipRender(ctx, 3),
  };
}

const ne555 = dipPreset("ne555", "NE555", "タイマーIC (DIP-8)。", ["GND", "TRIG", "OUT", "RESET", "CTRL", "THR", "DIS", "VCC"]);
const lm358 = dipPreset("lm358", "LM358", "2回路オペアンプ (DIP-8)。", ["OUT1", "IN1-", "IN1+", "GND", "IN2+", "IN2-", "OUT2", "VCC"]);
const hc595 = dipPreset("74hc595", "74HC595", "8bitシフトレジスタ (DIP-16)。", [
  "QB", "QC", "QD", "QE", "QF", "QG", "QH", "GND", "QH'", "SRCLR", "SRCLK", "RCLK", "OE", "SER", "QA", "VCC",
]);

// prettier-ignore
const NANO_PINS = [
  "TX1", "RX0", "RST", "GND", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11", "D12",
  "D13", "3V3", "REF", "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "5V", "RST2", "GND2", "VIN",
];

const nano = {
  type: "nano",
  name: "Arduino Nano",
  category: "マイコンボード",
  description: "2x15ピン, 列間隔6ピッチ。atはピン1(TX1)の穴、USBはピン15側。同名ピンは RST2, GND2 と表記。",
  mount: "rigid",
  params: {},
  pins: () => dualRow(30, 6, NANO_PINS),
  render({ pins }) {
    return (
      rect(-1.2, -6.55, 17.7, 7.1, { rx: 0.2, fill: "#1a5fa6", stroke: "#0e3d6e", "stroke-width": 0.06 }) +
      rect(14.6, -4.4, 2.3, 2.8, { fill: "#c8ccd0", stroke: "#8a8f94", "stroke-width": 0.05 }) +
      rect(5.6, -4.1, 2.8, 2.2, { fill: "#222", transform: `rotate(45 7 -3)` }) +
      headerPins(pins) +
      pinLabels(pins, 6) +
      text(3, -3, "Arduino Nano", { "font-size": 0.55, fill: "#fff", "text-anchor": "middle", "dominant-baseline": "central" })
    );
  },
};

// prettier-ignore
const PICO_PINS = [
  "GP0", "GP1", "GND", "GP2", "GP3", "GP4", "GP5", "GND2", "GP6", "GP7",
  "GP8", "GP9", "GND3", "GP10", "GP11", "GP12", "GP13", "GND4", "GP14", "GP15",
  "GP16", "GP17", "GND5", "GP18", "GP19", "GP20", "GP21", "GND6", "GP22", "RUN",
  "GP26", "GP27", "AGND", "GP28", "ADC_VREF", "3V3", "3V3_EN", "GND7", "VSYS", "VBUS",
];

const pico = {
  type: "pico",
  name: "Raspberry Pi Pico",
  category: "マイコンボード",
  description: "2x20ピン, 列間隔7ピッチ。atはピン1(GP0)の穴、USBはピン1側。GNDは GND, GND2.. と番号付き。",
  mount: "rigid",
  params: {},
  pins: () => dualRow(40, 7, PICO_PINS),
  render({ pins }) {
    return (
      rect(-0.55, -7.64, 20.1, 8.28, { rx: 0.2, fill: "#2e8b3e", stroke: "#1d5e29", "stroke-width": 0.06 }) +
      rect(-1.0, -4.6, 1.9, 2.2, { fill: "#c8ccd0", stroke: "#8a8f94", "stroke-width": 0.05 }) +
      rect(7.6, -4.8, 2.8, 2.8, { fill: "#222", rx: 0.1 }) +
      rect(2.6, -2.3, 1.2, 0.8, { fill: "#eee", rx: 0.1 }) +
      headerPins(pins) +
      pinLabels(pins, 7) +
      text(14.5, -3.5, "Raspberry Pi Pico", { "font-size": 0.6, fill: "#fff", "text-anchor": "middle", "dominant-baseline": "central" })
    );
  },
};

export const BUILTIN_PARTS = [
  resistor,
  led,
  diode,
  capacitor,
  electrolytic,
  cds,
  transistor,
  regulator,
  button,
  trimmer,
  buzzer,
  header,
  dip,
  ne555,
  lm358,
  hc595,
  nano,
  pico,
];
