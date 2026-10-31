// Built-in parts: common hobby components (the kind found at Akizuki Denshi).
//
// mount: "leads" -> legs can be bent, so the circuit may give each pin's hole explicitly
//                   (`pins`), or place the default `layout` with `at` + `rot`.
// mount: "rigid" -> fixed footprint, placed with `at` (hole of the first pin) + `rot`.
//
// Leads parts draw in board coordinates (ctx.pins are absolute positions).
// Rigid parts draw in local coordinates (first pin at the origin); the renderer applies at/rot.
import { circle, esc, g, line, n, rect, tag, text } from "../svg.js";
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
  uprightText,
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
  states: {
    on: { type: "bool", default: false, description: "点灯" },
    brightness: { type: "number", default: 1, description: "明るさ 0〜1 (点灯中のみ)" },
  },
  animate: () => ({
    glow: (s) => ({ opacity: s.on ? clamp(Number(s.brightness), 0, 1) : 0 }),
  }),
  pins: () => inline(["A", "K"]),
  render({ pins: [a, b], params, anim }) {
    const c = LED_COLORS[params.color] ?? params.color;
    const body =
      circle(0, 0, 0.95, { fill: c, stroke: "rgba(0,0,0,.35)", "stroke-width": 0.06, opacity: 0.92 }) +
      // flat edge marks the cathode side
      line(0.78, -0.55, 0.78, 0.55, { stroke: "rgba(0,0,0,.45)", "stroke-width": 0.08 }) +
      circle(-0.3, -0.3, 0.22, { fill: "#fff", opacity: 0.55 }) +
      g(
        circle(0, 0, 1.9, { fill: c, opacity: 0.18 }) +
          circle(0, 0, 1.35, { fill: c, opacity: 0.35 }) +
          circle(0, 0, 0.95, { fill: c }) +
          circle(0, 0, 0.6, { fill: "#fff", opacity: 0.75 }),
        { ...anim("glow"), "pointer-events": "none" },
      );
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
  states: { pressed: { type: "bool", default: false, description: "押されている" } },
  animate: () => ({
    cap: (s) => ({ transform: s.pressed ? "scale(.82)" : "scale(1)" }),
    finger: (s) => ({ opacity: s.pressed ? 1 : 0 }),
  }),
  render({ anim }) {
    return (
      rect(-0.35, 0.25, 2.7, 2.5, { rx: 0.15, fill: "#2b2b2b", stroke: "#111", "stroke-width": 0.05 }) +
      g(
        g(circle(0, 0, 0.75, { fill: "#555", stroke: "#111", "stroke-width": 0.05 }) + circle(0, 0, 0.55, { fill: "#6b6b6b" }), anim("cap")) +
          g(
            circle(0, 0, 0.95, { fill: "#f2c19a", opacity: 0.55, stroke: "#c98b5e", "stroke-width": 0.06 }) +
              text(0, 0, "PUSH", { "font-size": 0.32, fill: "#7a3e12", "text-anchor": "middle", "dominant-baseline": "central", "font-weight": "bold" }),
            { ...anim("finger"), "pointer-events": "none" },
          ),
        { transform: "translate(1 1.5)" },
      )
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
  states: { on: { type: "bool", default: false, description: "鳴っている" } },
  animate: () => ({ waves: (s) => ({ opacity: s.on ? 1 : 0 }) }),
  render({ anim }) {
    const ring = (cls) => circle(0, 0, 3.2, { fill: "none", stroke: "#ffb300", "stroke-width": 0.14, class: cls });
    return (
      circle(1.5, 0, 2.35, { fill: "#1b1b1b", stroke: "#000", "stroke-width": 0.05 }) +
      circle(1.5, 0, 0.35, { fill: "#000", stroke: "#444", "stroke-width": 0.05 }) +
      text(0, -1.1, "+", { "font-size": 0.7, fill: "#ddd", "text-anchor": "middle", "dominant-baseline": "central" }) +
      g(g(ring("bb-wave") + ring("bb-wave bb-wave2"), anim("waves")), { transform: "translate(1.5 0)", "pointer-events": "none" })
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
  description: "2x15ピン, 列間隔6ピッチ。atはピン1(TX1)の穴、USBはピン15側。同名ピンは RST2, GND2 と表記 (基板内で導通)。",
  mount: "rigid",
  params: {},
  pins: () => dualRow(30, 6, NANO_PINS),
  internal: () => [
    ["GND", "GND2"],
    ["RST", "RST2"],
  ],
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
  description: "2x20ピン, 列間隔7ピッチ。atはピン1(GP0)の穴、USBはピン1側。GNDは GND, GND2.. と番号付き (基板内で導通)。",
  mount: "rigid",
  params: {},
  pins: () => dualRow(40, 7, PICO_PINS),
  internal: () => [["GND", "GND2", "GND3", "GND4", "GND5", "GND6", "GND7"]],
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

const motor = {
  type: "motor",
  name: "DCモーター",
  category: "出力",
  description: "FA-130型など。上から見た図にプロペラを付けて描く。speed (rpm) で回転アニメーション。",
  mount: "leads",
  params: {},
  states: { speed: { type: "rate", default: 0, description: "回転数 rpm (負で逆回転)。キー間は直線的に変化" } },
  animate: () => ({ rotor: (s) => ({ transform: `rotate(${Math.round(s.speedAngle * 10) / 10}deg)` }) }),
  pins: () => [
    { name: "+", x: 0, y: 0 },
    { name: "-", x: 3, y: 0 },
  ],
  render({ pins: [a, b], anim }) {
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const blade = "M 0 -0.25 C 1.2 -0.6 2.3 -0.45 2.6 0 C 2.3 0.45 1.2 0.6 0 0.25 Z";
    return (
      leg(a, c) +
      leg(b, c) +
      g(
        circle(0, 0, 1.6, { fill: "#cfd4d8", stroke: "#8b9399", "stroke-width": 0.08 }) +
          circle(0, 0, 1.1, { fill: "#b5bcc2" }) +
          text(-1.15, -1.15, "+", { "font-size": 0.55, fill: "#c62828", "text-anchor": "middle", "dominant-baseline": "central", "font-weight": "bold" }) +
          g(
            tag("path", { d: blade, fill: "#ff9800", opacity: 0.88, stroke: "#c66900", "stroke-width": 0.05 }) +
              tag("path", { d: blade, fill: "#ff9800", opacity: 0.88, stroke: "#c66900", "stroke-width": 0.05, transform: "rotate(180)" }) +
              circle(0, 0, 0.35, { fill: "#333" }),
            anim("rotor"),
          ),
        { transform: `translate(${n(c.x)} ${n(c.y)})` },
      )
    );
  },
};

const servo = {
  type: "servo",
  name: "サーボ (SG90)",
  category: "出力",
  description: "3ピンのコネクタをブレッドボードに挿した状態。ピン: GND(茶), VCC(赤), SIG(橙)。本体はコネクタの上側に描く。angle (0〜180°) でアニメーション。",
  mount: "rigid",
  params: {},
  states: { angle: { type: "number", default: 90, description: "ホーンの角度 0〜180°" } },
  animate: () => ({ horn: (s) => ({ transform: `rotate(${-Math.round(Number(s.angle) * 10) / 10}deg)` }) }),
  pins: () => inline(["GND", "VCC", "SIG"]),
  extent: [-4.7, -9.2, 7.1, 0.6],
  render({ anim, rot }) {
    const cable = ["#6d4c41", "#e53935", "#fb8c00"]
      .map((c, i) => tag("path", { d: `M ${i} 0 C ${i} -1.6 ${0.7 + i * 0.3} -2 ${0.7 + i * 0.3} -3.2`, fill: "none", stroke: c, "stroke-width": 0.18 }))
      .join("");
    const arm = "M -0.45 0 A 0.45 0.45 0 0 1 0.45 0 L 3 -0.12 A 0.2 0.2 0 0 1 3 0.12 L 0.45 0 A 0.45 0.45 0 0 1 -0.45 0 Z";
    return (
      rect(-0.5, -0.5, 3, 1, { fill: "#222", rx: 0.1 }) +
      cable +
      rect(-3.4, -8.1, 9.2, 4.8, { rx: 0.3, fill: "#2c6fbb", stroke: "#1d4f87", "stroke-width": 0.08 }) +
      rect(-4.6, -6.4, 11.6, 1.2, { rx: 0.2, fill: "#2c6fbb", stroke: "#1d4f87", "stroke-width": 0.06 }) +
      circle(-1.3, -5.7, 1.6, { fill: "#3a80cc", stroke: "#1d4f87", "stroke-width": 0.06 }) +
      uprightText(3.2, -5.7, "SG90", rot, { "font-size": 0.7, fill: "#fff", "text-anchor": "middle", "dominant-baseline": "central" }) +
      g(
        g(tag("path", { d: arm, fill: "#f5f5f5", stroke: "#9e9e9e", "stroke-width": 0.06 }) + circle(0, 0, 0.25, { fill: "#bbb" }), anim("horn")),
        { transform: "translate(-1.3 -5.7)" },
      )
    );
  },
};

// segments lit for each character (a..g)
const SEG_FONT = {
  0: "abcdef", 1: "bc", 2: "abdeg", 3: "abcdg", 4: "bcfg", 5: "acdfg", 6: "acdefg", 7: "abc", 8: "abcdefg", 9: "abcdfg",
  A: "abcefg", B: "cdefg", C: "adef", D: "bcdeg", E: "adefg", F: "aefg", H: "bcefg", L: "def", P: "abefg", U: "bcdef",
  "-": "g", "_": "d", " ": "",
};

// segment rectangles in the digit's local frame (center of the digit at 0,0)
const SEG_RECTS = {
  a: [-0.85, -2.45, 1.7, 0.4],
  b: [0.95, -2.2, 0.4, 2.0],
  c: [0.95, 0.2, 0.4, 2.0],
  d: [-0.85, 2.05, 1.7, 0.4],
  e: [-1.35, 0.2, 0.4, 2.0],
  f: [-1.35, -2.2, 0.4, 2.0],
  g: [-0.85, -0.2, 1.7, 0.4],
};

const seg7 = {
  type: "seg7",
  name: "7セグメントLED (1桁)",
  category: "表示",
  description: "0.56インチ1桁 (5161AS型, カソードコモン)。中央の溝をまたいで置く (列間隔6)。text の1文字を表示するアニメーション。",
  mount: "rigid",
  params: { color: { default: "red", options: Object.keys(LED_COLORS), description: "発光色" } },
  states: {
    text: { type: "string", default: "", description: "表示する1文字 (0-9, A-F, H, L, P, U, -)" },
    dp: { type: "bool", default: false, description: "小数点" },
  },
  animate: () => ({
    ...Object.fromEntries(
      Object.keys(SEG_RECTS).map((seg) => [seg, (s) => ({ opacity: (SEG_FONT[String(s.text ?? "").toUpperCase()[0] ?? " "] ?? "").includes(seg) ? 1 : 0 })]),
    ),
    dp: (s) => ({ opacity: s.dp ? 1 : 0 }),
  }),
  pins: () => dualRow(10, 6, ["E", "D", "COM", "C", "DP", "B", "A", "COM2", "F", "G"]),
  internal: () => [["COM", "COM2"]],
  render({ params, anim }) {
    const c = LED_COLORS[params.color] ?? params.color;
    const segs = Object.entries(SEG_RECTS)
      .map(([seg, [x, y, w, h]]) => rect(x, y, w, h, { rx: 0.15, fill: "#3a2626" }) + rect(x, y, w, h, { rx: 0.15, fill: c, ...anim(seg) }))
      .join("");
    return (
      rect(-0.75, -6.75, 5.5, 7.5, { rx: 0.15, fill: "#1a1a1a", stroke: "#000", "stroke-width": 0.05 }) +
      g(segs, { transform: "translate(2 -3) skewX(-6)" }) +
      circle(3.75, -0.6, 0.22, { fill: "#3a2626" }) +
      circle(3.75, -0.6, 0.22, { fill: c, ...anim("dp") })
    );
  },
};

const dht11 = {
  type: "dht11",
  name: "温湿度センサ DHT11",
  category: "センサ",
  description: "4ピン単体品。格子面を手前にして左から VCC, DATA, NC, GND。DATAは10kΩでVCCにプルアップ。",
  mount: "rigid",
  params: {},
  pins: () => inline(["VCC", "DATA", "NC", "GND"]),
  extent: [-0.9, -6.5, 3.9, 0.5],
  render() {
    let grid = "";
    for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) grid += rect(0.05 + c * 0.75, -5.6 + r * 0.8, 0.45, 0.5, { rx: 0.08, fill: "#1b5f9e" });
    return (
      inline(["", "", "", ""]).map((p) => rect(p.x - 0.12, -0.6, 0.24, 0.6, { fill: "#b9c0c7" })).join("") +
      rect(-0.86, -6.4, 4.72, 6.0, { rx: 0.2, fill: "#2b7bd0", stroke: "#1b5f9e", "stroke-width": 0.06 }) +
      grid +
      text(1.5, -1.3, "DHT11", { "font-size": 0.55, fill: "#fff", "text-anchor": "middle", "dominant-baseline": "central" })
    );
  },
};

const hcsr04 = {
  type: "hcsr04",
  name: "超音波距離センサ HC-SR04",
  category: "センサ",
  description: "ピン: VCC, TRIG, ECHO, GND。本体はピンの上側に描く。ping で超音波を出すアニメーション。",
  mount: "rigid",
  params: {},
  states: { ping: { type: "bool", default: false, description: "超音波を出している" } },
  animate: () => ({ waves: (s) => ({ opacity: s.ping ? 1 : 0 }) }),
  pins: () => inline(["VCC", "TRIG", "ECHO", "GND"]),
  extent: [-7.4, -13.5, 10.4, 0.6],
  render({ anim }) {
    const can = (x, label) =>
      circle(x, -3.9, 3.0, { fill: "#d7dbdf", stroke: "#8b9399", "stroke-width": 0.08 }) +
      circle(x, -3.9, 2.3, { fill: "#4a4f55" }) +
      circle(x, -3.9, 2.3, { fill: "none", stroke: "#6c737a", "stroke-width": 0.05, "stroke-dasharray": "0.15 0.15" }) +
      text(x, -0.6, label, { "font-size": 0.5, fill: "#fff", "text-anchor": "middle", "dominant-baseline": "central" });
    const arc = (cls) => tag("path", { d: "M -2.6 -3.6 A 4.2 4.2 0 0 1 2.6 -3.6", fill: "none", stroke: "#29b6f6", "stroke-width": 0.16, class: cls });
    return (
      headerPins(inline(["", "", "", ""])) +
      rect(-7.36, -7.6, 17.72, 7.9, { rx: 0.3, fill: "#1f5fa8", stroke: "#164477", "stroke-width": 0.06 }) +
      can(-3.6, "T") +
      can(6.6, "R") +
      rect(0.2, -6.9, 2.6, 1.2, { fill: "#c9ccd0", rx: 0.1 }) +
      text(1.5, -2.2, "HC-SR04", { "font-size": 0.55, fill: "#fff", "text-anchor": "middle", "dominant-baseline": "central" }) +
      g(g(arc("bb-wave") + arc("bb-wave bb-wave2"), anim("waves")), { transform: "translate(-3.6 -3.9)", "pointer-events": "none" })
    );
  },
};

const relay = {
  type: "relay",
  name: "リレーモジュール (1ch, 5V)",
  category: "出力",
  description: "ピン: VCC, GND, IN。本体はピンの上側に描く (端子台 NO / COM / NC は上端)。on で表示LEDと接点が切り替わる。",
  mount: "rigid",
  params: {},
  states: { on: { type: "bool", default: false, description: "リレーがオン (COM-NO 導通)" } },
  animate: () => ({
    led: (s) => ({ opacity: s.on ? 1 : 0 }),
    no: (s) => ({ opacity: s.on ? 1 : 0 }),
    nc: (s) => ({ opacity: s.on ? 0 : 1 }),
  }),
  pins: () => inline(["VCC", "GND", "IN"]),
  extent: [-4.2, -19.4, 6.2, 0.6],
  render({ anim }) {
    const screw = (x, label) =>
      circle(x, -17.6, 0.85, { fill: "#c9ccd0", stroke: "#888", "stroke-width": 0.05 }) +
      line(x - 0.55, -17.6, x + 0.55, -17.6, { stroke: "#666", "stroke-width": 0.12 }) +
      text(x, -15.7, label, { "font-size": 0.5, fill: "#fff", "text-anchor": "middle", "dominant-baseline": "central" });
    return (
      headerPins(inline(["", "", ""])) +
      rect(-4.1, -19.2, 10.2, 19.6, { rx: 0.3, fill: "#1f5fa8", stroke: "#164477", "stroke-width": 0.06 }) +
      rect(-3.4, -19.0, 8.8, 2.8, { rx: 0.15, fill: "#2e7d32" }) +
      screw(-2.0, "NO") +
      screw(1.0, "COM") +
      screw(4.0, "NC") +
      // contact symbol: COM swings to NO when on
      circle(1.0, -14.2, 0.15, { fill: "#fff" }) +
      line(1.0, -14.2, -1.6, -14.9, { stroke: "#ffeb3b", "stroke-width": 0.14, "stroke-linecap": "round", ...anim("no") }) +
      line(1.0, -14.2, 3.6, -14.9, { stroke: "#ffeb3b", "stroke-width": 0.14, "stroke-linecap": "round", ...anim("nc") }) +
      rect(-2.8, -12.6, 7.6, 6.2, { rx: 0.2, fill: "#2a64c8", stroke: "#173f86", "stroke-width": 0.06 }) +
      text(1.0, -10.2, "SRD-05VDC", { "font-size": 0.6, fill: "#fff", "text-anchor": "middle", "dominant-baseline": "central" }) +
      text(1.0, -9.1, "SL-C", { "font-size": 0.45, fill: "#d0dcff", "text-anchor": "middle", "dominant-baseline": "central" }) +
      circle(4.6, -3.0, 0.35, { fill: "#5a1a1a" }) +
      g(circle(0, 0, 0.9, { fill: "#ff3d00", opacity: 0.35 }) + circle(0, 0, 0.35, { fill: "#ff5252" }), {
        transform: "translate(4.6 -3)",
        ...anim("led"),
      }) +
      text(-2.0, -2.2, "VCC GND IN", { "font-size": 0.4, fill: "#fff", "text-anchor": "start", "dominant-baseline": "central" })
    );
  },
};

// r / g / b (0..1) -> fill colour and brightness of a glow group
function rgbGlow(s) {
  const [r, gg, b] = [s.r, s.g, s.b].map((v) => clamp(Number(v) || 0, 0, 1));
  const max = Math.max(r, gg, b);
  const c = (v) => Math.round((max ? v / max : 0) * 255);
  return { fill: `rgb(${c(r)},${c(gg)},${c(b)})`, opacity: Math.round(max * 1000) / 1000 };
}

const RGB_STATES = {
  r: { type: "number", default: 0, description: "赤の明るさ 0〜1" },
  g: { type: "number", default: 0, description: "緑の明るさ 0〜1" },
  b: { type: "number", default: 0, description: "青の明るさ 0〜1" },
};

const rgbled = {
  type: "rgbled",
  name: "フルカラーLED (カソードコモン)",
  category: "半導体",
  description: "5mm 4本足。ピンは R, K(共通カソード, 一番長い足), G, B。r / g / b (0〜1) で発光色をアニメーション。",
  mount: "leads",
  params: {},
  states: {
    r: { type: "number", default: 0, description: "赤の明るさ 0〜1" },
    g: { type: "number", default: 0, description: "緑の明るさ 0〜1" },
    b: { type: "number", default: 0, description: "青の明るさ 0〜1" },
  },
  animate: () => ({ glow: rgbGlow }),
  pins: () => inline(["R", "K", "G", "B"]),
  render({ pins, anim }) {
    const c = centroid(pins);
    return (
      pins.map((p) => leg(p, c, 0.1)).join("") +
      g(
        circle(0, 0, 1.05, { fill: "#eef1f3", stroke: "rgba(0,0,0,.3)", "stroke-width": 0.06, opacity: 0.95 }) +
          g(circle(0, 0, 2.0, { opacity: 0.2 }) + circle(0, 0, 1.4, { opacity: 0.4 }) + circle(0, 0, 1.0) + circle(0, 0, 0.5, { fill: "#fff", opacity: 0.7 }), {
            ...anim("glow"),
            "pointer-events": "none",
          }) +
          circle(-0.35, -0.35, 0.2, { fill: "#fff", opacity: 0.6 }),
        { transform: `translate(${n(c.x)} ${n(c.y)})` },
      )
    );
  },
};

const pot = {
  type: "pot",
  name: "可変抵抗 (16mm, Bカーブ)",
  category: "受動部品",
  description: "ピン間5mm (2ピッチ)。ピン2がワイパー。本体はピンの上側に描く。angle (0〜300°) でつまみの回転をアニメーション。",
  mount: "rigid",
  params: { value: { default: "10k", description: "抵抗値" } },
  states: { angle: { type: "number", default: 150, description: "つまみの角度 0〜300°" } },
  animate: () => ({ knob: (s) => ({ transform: `rotate(${Math.round((Number(s.angle) - 150) * 10) / 10}deg)` }) }),
  pins: () => [
    { name: "1", x: 0, y: 0 },
    { name: "2", x: 2, y: 0 },
    { name: "3", x: 4, y: 0 },
  ],
  extent: [-1.3, -6.6, 5.3, 0.5],
  render({ params, anim }) {
    return (
      [0, 2, 4].map((x) => rect(x - 0.15, -1.2, 0.3, 1.2, { fill: "#b9c0c7" })).join("") +
      circle(2, -3.3, 3.15, { fill: "#9ea7ad", stroke: "#6d767c", "stroke-width": 0.06 }) +
      g(
        g(circle(0, 0, 1.9, { fill: "#2b2b2b", stroke: "#111", "stroke-width": 0.06 }) + line(0, 0, 0, -1.6, { stroke: "#fff", "stroke-width": 0.22, "stroke-linecap": "round" }), anim("knob")),
        { transform: "translate(2 -3.3)" },
      ) +
      text(2, -0.4, params.value, { "font-size": 0.42, fill: "#222", "text-anchor": "middle", "dominant-baseline": "central" })
    );
  },
};

// prettier-ignore
const ESP32_PINS = [
  "3V3", "EN", "IO36", "IO39", "IO34", "IO35", "IO32", "IO33", "IO25", "IO26",
  "IO27", "IO14", "IO12", "GND", "IO13", "SD2", "SD3", "CMD", "5V",
  "CLK", "SD0", "SD1", "IO15", "IO2", "IO0", "IO4", "IO16", "IO17", "IO5",
  "IO18", "IO19", "GND2", "IO21", "IO3", "IO1", "IO22", "IO23", "GND3",
];

const esp32 = {
  type: "esp32",
  name: "ESP32-DevKitC",
  category: "マイコンボード",
  description:
    "2x19ピン。atはピン1(3V3)の穴、USBはピン19(5V)側。IO1=TX, IO3=RX。列間隔は既定で10ピッチ (フルサイズのブレッドボードで片側1列だけ空く)。製品により異なるので width で調整。",
  mount: "rigid",
  params: { width: { default: 10, description: "列間隔 (ピッチ単位)" } },
  pins: (p) => dualRow(38, Number(p.width) || 10, ESP32_PINS),
  internal: () => [["GND", "GND2", "GND3"]],
  render({ pins, params }) {
    const w = Number(params.width) || 10;
    const mid = -w / 2;
    return (
      rect(-2.7, -w - 0.55, 21.6, w + 1.1, { rx: 0.25, fill: "#1c1c1c", stroke: "#000", "stroke-width": 0.06 }) +
      rect(-2.5, mid - 3.55, 2.4, 7.1, { fill: "#20301f" }) +
      tag("path", { d: `M -2.2 ${n(mid - 2.8)} h 1.6 v 0.8 h -1.2 v 0.8 h 1.2 v 0.8 h -1.2 v 0.8 h 1.2`, fill: "none", stroke: "#c9a74a", "stroke-width": 0.12 }) +
      rect(-0.1, mid - 3.55, 7.6, 7.1, { rx: 0.1, fill: "#b9bec4", stroke: "#8b9399", "stroke-width": 0.06 }) +
      text(3.7, mid - 0.4, "ESP32-WROOM-32", { "font-size": 0.5, fill: "#333", "text-anchor": "middle", "dominant-baseline": "central" }) +
      rect(18.0, mid - 1.1, 1.6, 2.2, { fill: "#c8ccd0", stroke: "#8a8f94", "stroke-width": 0.05 }) +
      headerPins(pins) +
      pinLabels(pins, w) +
      text(12.5, mid, "ESP32-DevKitC", { "font-size": 0.6, fill: "#fff", "text-anchor": "middle", "dominant-baseline": "central" })
    );
  },
};

// Seeed Studio XIAO (ESP32C3 / ESP32S3 / ESP32C6 share the pinout and outline)
const XIAO_PINS = ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "3V3", "GND", "5V"];

const xiao = {
  type: "xiao",
  name: "XIAO ESP32 (C3 / S3 / C6)",
  category: "マイコンボード",
  description:
    "Seeed Studio XIAO。2x7ピン、列間隔6ピッチで中央の溝をまたぐ (例: at h10)。USBはピン1 (D0) 側。USBを上にして左列が D0〜D6、右列が上から 5V, GND, 3V3, D10, D9, D8, D7。D番号とGPIO番号の対応は種類ごとに違うので公式Wikiで確認。D4=SDA, D5=SCL, D6=TX, D7=RX, D8=SCK, D9=MISO, D10=MOSI。",
  mount: "rigid",
  params: {
    model: { default: "ESP32C3", options: ["ESP32C3", "ESP32S3", "ESP32C6"], description: "表示する型番" },
    width: { default: 6, description: "列間隔 (ピッチ単位)" },
  },
  pins: (p) => dualRow(14, Number(p.width) || 6, XIAO_PINS),
  render({ pins, params }) {
    const w = Number(params.width) || 6;
    const mid = -w / 2;
    return (
      rect(-1.15, -w - 0.45, 8.3, w + 0.9, { rx: 0.35, fill: "#1f2a44", stroke: "#0f1626", "stroke-width": 0.06 }) +
      rect(-1.75, mid - 1.15, 1.6, 2.3, { rx: 0.3, fill: "#c8ccd0", stroke: "#8a8f94", "stroke-width": 0.05 }) +
      rect(1.1, mid - 1.9, 3.6, 3.8, { rx: 0.15, fill: "#b9bec4", stroke: "#8b9399", "stroke-width": 0.05 }) +
      text(2.9, mid - 0.45, "XIAO", { "font-size": 0.62, fill: "#2b2f34", "text-anchor": "middle", "dominant-baseline": "central", "font-weight": "bold" }) +
      text(2.9, mid + 0.45, params.model, { "font-size": 0.42, fill: "#2b2f34", "text-anchor": "middle", "dominant-baseline": "central" }) +
      headerPins(pins) +
      pinLabels(pins, w)
    );
  },
};

// ---- modules often used with ESP32 ----
// Pin order differs between sellers for several of these: the descriptions say so, and
// pinOrder / width parameters let the circuit match the actual board.

const CHECK_BOARD = "販売元によってピンの並びや寸法が違う場合があります。購入した製品の表記を確認してください。";

// "GND,VCC,SCL,SDA" -> names, falling back to the default when it is not a permutation of it
function pinOrder(value, fallback) {
  const names = String(value ?? "").split(/\s*,\s*/).filter(Boolean);
  const ok = names.length === fallback.length && fallback.every((n) => names.includes(n));
  return ok ? names : fallback;
}

const inmp441 = {
  type: "inmp441",
  name: "I2Sマイク INMP441",
  category: "センサ",
  description: `I2S MEMSマイクの丸型モジュール。3本ずつ2列: SCK の向かいが SD、WS の向かいが VDD、L/R の向かいが GND。VDD は 3.3V。L/R は GND で左チャンネル。${CHECK_BOARD}`,
  mount: "rigid",
  params: { width: { default: 4, description: "列間隔 (ピッチ単位)" } },
  pins: (p) => dualRow(6, Number(p.width) || 4, ["L/R", "WS", "SCK", "SD", "VDD", "GND"]),
  extent: [-1.9, -5.9, 3.9, 1.9],
  render({ pins, params, rot }) {
    const w = Number(params.width) || 4;
    return (
      circle(1, -w / 2, Math.max(2.8, w / 2 + 0.9), { fill: "#5b2c86", stroke: "#3a1b58", "stroke-width": 0.08 }) +
      circle(1, -w / 2, 0.75, { fill: "#d0d4d8", stroke: "#8b9399", "stroke-width": 0.05 }) +
      circle(1, -w / 2, 0.2, { fill: "#222" }) +
      headerPins(pins) +
      // pin names inside the board (toward the centre), outlined so they stay readable
      pins
        .map((p) =>
          uprightText(p.x, p.y === 0 ? -0.55 : -w + 0.55, p.name, rot, {
            "font-size": 0.36,
            fill: "#fff",
            stroke: "#3a1b58",
            "stroke-width": 0.08,
            "paint-order": "stroke",
            "text-anchor": "middle",
            "dominant-baseline": "central",
          }),
        )
        .join("") +
      uprightText(1, -w / 2 + 0.95, "INMP441", rot, { "font-size": 0.3, fill: "#e0d0f0", "text-anchor": "middle", "dominant-baseline": "central" })
    );
  },
};

const max98357a = {
  type: "max98357a",
  name: "I2Sアンプ MAX98357A",
  category: "出力",
  description: `I2S D級アンプのモジュール。ヘッダー7本 (LRC, BCLK, DIN, GAIN, SD, GND, Vin) をボードに挿し、スピーカー端子 SPK+ / SPK- はボードに挿さない端子 (配線は "AMP1.SPK+" のように)。Vin は 2.5〜5.5V。${CHECK_BOARD}`,
  mount: "rigid",
  params: {},
  pins: () => [
    ...inline(["LRC", "BCLK", "DIN", "GAIN", "SD", "GND", "Vin"]),
    { name: "SPK+", x: 2.3, y: -6.6, insert: false },
    { name: "SPK-", x: 3.7, y: -6.6, insert: false },
  ],
  extent: [-0.9, -7.6, 6.9, 0.7],
  render({ pins, rot }) {
    const header = pins.filter((p) => p.y === 0);
    return (
      rect(-0.85, -7.5, 7.7, 8.15, { rx: 0.3, fill: "#1f5fa8", stroke: "#164477", "stroke-width": 0.06 }) +
      rect(1.2, -7.4, 3.6, 1.6, { rx: 0.15, fill: "#2e7d32", stroke: "#1b5e20", "stroke-width": 0.05 }) +
      rect(2.3, -4.3, 1.4, 1.4, { fill: "#1b1b1b" }) +
      headerPins(header) +
      header.map((p) => text(p.x, -0.85, p.name, { "font-size": 0.3, fill: "#fff", "text-anchor": "end", "dominant-baseline": "central", transform: `rotate(90 ${n(p.x)} -0.85)` })).join("") +
      uprightText(3, -1.9, "MAX98357A", rot, { "font-size": 0.5, fill: "#fff", "text-anchor": "middle", "dominant-baseline": "central" })
    );
  },
};

const WS2812_PINS = ["DIN", "VCC", "GND"];

const ws2812b = {
  type: "ws2812b",
  name: "フルカラーLED WS2812B (1灯基板)",
  category: "半導体",
  description: `アドレス指定できるフルカラーLED (NeoPixel) の1灯基板。入力側 (DIN, VCC, GND) をボードに挿し、出力側 (DOUT, VCC2, GND2) は次のLEDへつなぐ端子。r / g / b (0〜1) で発光色をアニメーション。${CHECK_BOARD}`,
  mount: "rigid",
  params: { pinOrder: { default: "DIN,VCC,GND", description: "入力側のピンの並び (例: GND,VCC,DIN)" } },
  states: RGB_STATES,
  animate: () => ({ glow: rgbGlow }),
  pins: (p) => [
    ...inline(pinOrder(p.pinOrder, WS2812_PINS)),
    ...pinOrder(p.pinOrder, WS2812_PINS).map((name, i) => ({ name: name === "DIN" ? "DOUT" : `${name}2`, x: i, y: -4, insert: false })),
  ],
  internal: () => [
    ["VCC", "VCC2"],
    ["GND", "GND2"],
  ],
  extent: [-0.8, -4.6, 2.8, 0.6],
  render({ pins, anim }) {
    return (
      rect(-0.75, -4.55, 3.5, 5.1, { rx: 0.3, fill: "#1b1b1b", stroke: "#000", "stroke-width": 0.05 }) +
      headerPins(pins.filter((p) => p.y === 0)) +
      rect(0.1, -3.1, 1.8, 1.8, { rx: 0.1, fill: "#f2f2f2" }) +
      circle(1, -2.2, 0.6, { fill: "#d9d9d9" }) +
      g(circle(1, -2.2, 2.2, { opacity: 0.2 }) + circle(1, -2.2, 1.4, { opacity: 0.4 }) + circle(1, -2.2, 0.7) + circle(1, -2.2, 0.35, { fill: "#fff", opacity: 0.8 }), {
        ...anim("glow"),
        "pointer-events": "none",
      })
    );
  },
};

const SSD1306_PINS = ["GND", "VCC", "SCL", "SDA"];

const ssd1306 = {
  type: "ssd1306",
  name: "OLED 0.96インチ SSD1306 (I2C)",
  category: "表示",
  description: `128x64 の I2C OLED。ピンの並びは製品により GND,VCC,SCL,SDA と VCC,GND,SCL,SDA があるので pinOrder で合わせる。画面はピンの下側に描く。text でアニメーション。${CHECK_BOARD}`,
  mount: "rigid",
  params: {
    pinOrder: { default: "GND,VCC,SCL,SDA", options: ["GND,VCC,SCL,SDA", "VCC,GND,SCL,SDA"], description: "ピンの並び" },
  },
  states: { text: { type: "string", default: "", description: "画面の文字 (\\n で改行)" } },
  animate: ({ values }) => Object.fromEntries(values("text").map((v, i) => [`text:${i}`, (s) => ({ opacity: String(s.text) === v ? 1 : 0 })])),
  pins: (p) => inline(pinOrder(p.pinOrder, SSD1306_PINS)),
  extent: [-3.9, -0.9, 6.9, 10.2],
  render({ pins, anim, values }) {
    const size = 0.8;
    const texts = values("text")
      .map((v, i) =>
        tag(
          "text",
          { x: -2.9, y: 2.3, "font-size": size, "font-family": "monospace", fill: "#9fe8ff", ...anim(`text:${i}`) },
          v
            .split("\n")
            .slice(0, 6)
            .map((l, j) => tag("tspan", { x: -2.9, dy: j === 0 ? size : size * 1.2 }, esc(l.slice(0, 18))))
            .join(""),
        ),
      )
      .join("");
    return (
      rect(-3.875, -0.85, 10.75, 10.95, { rx: 0.4, fill: "#1b3a6b", stroke: "#0f2445", "stroke-width": 0.06 }) +
      rect(-3.3, 1.65, 9.6, 5.7, { fill: "#0b0b0b", stroke: "#333", "stroke-width": 0.08 }) +
      headerPins(pins) +
      pins.map((p) => text(p.x, 0.75, p.name, { "font-size": 0.38, fill: "#fff", "text-anchor": "middle", "dominant-baseline": "central" })).join("") +
      texts
    );
  },
};

const qwiic = {
  type: "qwiic",
  name: "Qwiic 変換ケーブル",
  category: "コネクタ",
  description: "Qwiic (JST SH 4ピン) からピンヘッダへの変換ケーブル。GND (黒), 3V3 (赤), SDA (青), SCL (黄)。Qwiic は 3.3V。ケーブルの先のコネクタはピンの上側に描く。",
  mount: "rigid",
  params: {},
  pins: () => inline(["GND", "3V3", "SDA", "SCL"]),
  extent: [-1.2, -6.6, 4.2, 0.6],
  render({ rot }) {
    const cable = ["#263238", "#e53935", "#1e88e5", "#fdd835"]
      .map((c, i) => tag("path", { d: `M ${i} 0 C ${i} -2 ${1 + i * 0.33} -2.5 ${1 + i * 0.33} -4.4`, fill: "none", stroke: c, "stroke-width": 0.18 }))
      .join("");
    return (
      rect(-0.5, -0.5, 4, 1, { fill: "#222", rx: 0.1 }) +
      cable +
      rect(0.4, -6.4, 2.2, 2.0, { rx: 0.2, fill: "#f0f0f0", stroke: "#9e9e9e", "stroke-width": 0.06 }) +
      uprightText(1.5, -5.4, "Qwiic", rot, { "font-size": 0.42, fill: "#333", "text-anchor": "middle", "dominant-baseline": "central" })
    );
  },
};

const LCD_COLS = 16;

const lcd1602 = {
  type: "lcd1602",
  name: "キャラクタLCD 1602 (I2C)",
  category: "表示",
  description: "16文字x2行, I2C変換基板付き。ピン: GND, VCC, SDA, SCL。本体はピンの上側に描く。text (\\n で2行目) と backlight でアニメーション。",
  mount: "rigid",
  params: {},
  states: {
    text: { type: "string", default: "", description: "表示する文字 (1行16文字, \\n で改行)" },
    backlight: { type: "bool", default: true, description: "バックライト" },
  },
  animate: ({ values }) => ({
    light: (s) => ({ opacity: s.backlight ? 1 : 0 }),
    ...Object.fromEntries(values("text").map((v, i) => [`text:${i}`, (s) => ({ opacity: String(s.text) === v ? 1 : 0 })])),
  }),
  pins: () => inline(["GND", "VCC", "SDA", "SCL"]),
  extent: [-1.4, -15.4, 30.2, 0.6],
  render({ anim, values }) {
    const x0 = 1.9;
    const y0 = -11.4;
    const cw = 25.4 / LCD_COLS;
    const size = cw / 0.6;
    const texts = values("text")
      .map((v, i) =>
        tag(
          "text",
          { x: x0 + 0.25, y: y0, "font-size": size, "font-family": "monospace", fill: "#10241a", ...anim(`text:${i}`) },
          v
            .split("\n")
            .slice(0, 2)
            .map((l, j) => tag("tspan", { x: x0 + 0.25, dy: j === 0 ? size * 1.05 : size * 1.15 }, esc(l.slice(0, LCD_COLS))))
            .join(""),
        ),
      )
      .join("");
    return (
      headerPins(inline(["", "", "", ""])) +
      rect(-1.3, -15.2, 31.4, 14.6, { rx: 0.3, fill: "#1f6b3a", stroke: "#124526", "stroke-width": 0.06 }) +
      rect(0.4, -13.4, 28.4, 10.4, { rx: 0.2, fill: "#111" }) +
      rect(x0, y0 - 0.6, 25.4 + 0.5, 7.0, { fill: "#4c6b3a" }) +
      rect(x0, y0 - 0.6, 25.4 + 0.5, 7.0, { fill: "#a8d45a", ...anim("light") }) +
      texts +
      text(-0.9, -1.0, "GND VCC SDA SCL", { "font-size": 0.38, fill: "#fff", "text-anchor": "start", "dominant-baseline": "central" })
    );
  },
};

// two lead wires (red +, black -) from the pins up to a body drawn above them
function leadWires(topY) {
  return ["#e53935", "#263238"]
    .map((c, i) => tag("path", { d: `M ${i} 0 C ${i} ${n(topY / 2)} ${0.5 + (i - 0.5) * 0.6} ${n(topY / 2)} ${0.5 + (i - 0.5) * 0.6} ${n(topY)}`, fill: "none", stroke: c, "stroke-width": 0.2 }))
    .join("");
}

const speaker = {
  type: "speaker",
  name: "スピーカー (8Ω)",
  category: "出力",
  description: "リード線付きの小型スピーカー。ピン: +, -。ブレッドボードの外 (pos) に置いて配線するのが基本。on で音の波紋をアニメーション。",
  mount: "rigid",
  params: { label: { default: "8Ω", description: "表示する仕様" } },
  states: { on: { type: "bool", default: false, description: "鳴っている" } },
  animate: () => ({ waves: (s) => ({ opacity: s.on ? 1 : 0 }) }),
  pins: () => inline(["+", "-"]),
  extent: [-3.6, -11.2, 4.6, 0.5],
  render({ params, anim, rot }) {
    const ring = (cls) => circle(0, 0, 3.9, { fill: "none", stroke: "#ffb300", "stroke-width": 0.16, class: cls });
    return (
      leadWires(-2.6) +
      g(
        circle(0, 0, 2.9, { fill: "#30343a", stroke: "#111", "stroke-width": 0.08 }) +
          circle(0, 0, 2.3, { fill: "#4b5159" }) +
          circle(0, 0, 1.6, { fill: "#5d646d", stroke: "#3b4047", "stroke-width": 0.06 }) +
          circle(0, 0, 0.7, { fill: "#2b2f34" }) +
          uprightText(0, 2.35, params.label, rot, { "font-size": 0.45, fill: "#ddd", "text-anchor": "middle", "dominant-baseline": "central" }) +
          g(ring("bb-wave") + ring("bb-wave bb-wave2"), { ...anim("waves"), "pointer-events": "none" }),
        { transform: "translate(0.5 -5.5)" },
      )
    );
  },
};

const BATTERIES = { AAx2: [2, "3V"], AAx3: [3, "4.5V"], AAx4: [4, "6V"], "9V": [0, "9V"] };

const battery = {
  type: "battery",
  name: "電池ボックス",
  category: "電源",
  description: "リード線付き (赤が+, 黒が-)。ピン: +, -。ブレッドボードの外 (pos) に置いて、電源レールに配線するのが基本。",
  mount: "rigid",
  params: { kind: { default: "AAx2", options: Object.keys(BATTERIES), description: "電池の種類と本数" } },
  pins: () => inline(["+", "-"]),
  extent: [-4.2, -14.5, 5.2, 0.5],
  render({ params, rot }) {
    const [cells, volts] = BATTERIES[params.kind] ?? BATTERIES.AAx2;
    if (!cells) {
      // 9V snap battery
      return (
        leadWires(-2.4) +
        rect(-2.6, -12.4, 6.2, 10, { rx: 0.4, fill: "#1e3a5f", stroke: "#0f2238", "stroke-width": 0.08 }) +
        rect(-2.6, -12.4, 6.2, 3, { rx: 0.4, fill: "#f2b705" }) +
        uprightText(0.5, -6.5, volts, rot, { "font-size": 1.4, fill: "#fff", "text-anchor": "middle", "dominant-baseline": "central", "font-weight": "bold" })
      );
    }
    const h = cells * 2.4 + 0.8;
    const top = -2.4 - h;
    let body = rect(-3.6, top, 8.2, h, { rx: 0.3, fill: "#1b1b1b", stroke: "#000", "stroke-width": 0.08 });
    for (let i = 0; i < cells; i++) {
      const y = top + 0.5 + i * 2.4;
      const flip = i % 2 === 1;
      body +=
        rect(-3.0, y, 6.6, 1.9, { rx: 0.9, fill: "#c62828" }) +
        rect(flip ? -3.0 : 1.6, y, 2.0, 1.9, { rx: 0.9, fill: "#9e9e9e" }) +
        uprightText(0.3, y + 0.95, flip ? "−  +" : "+  −", rot, { "font-size": 0.7, fill: "#fff", "text-anchor": "middle", "dominant-baseline": "central" });
    }
    return leadWires(-2.4) + body + uprightText(0.5, top - 0.6, `${params.kind} ${volts}`, rot, { "font-size": 0.6, fill: "#333", "text-anchor": "middle", "dominant-baseline": "central" });
  },
};

export const BUILTIN_PARTS = [
  resistor,
  led,
  rgbled,
  diode,
  capacitor,
  electrolytic,
  cds,
  dht11,
  hcsr04,
  transistor,
  regulator,
  battery,
  button,
  trimmer,
  pot,
  buzzer,
  speaker,
  motor,
  servo,
  seg7,
  lcd1602,
  relay,
  header,
  dip,
  ne555,
  lm358,
  hc595,
  nano,
  pico,
  esp32,
  xiao,
  inmp441,
  max98357a,
  ws2812b,
  ssd1306,
  qwiic,
];
