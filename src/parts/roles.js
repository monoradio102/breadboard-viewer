// Electrical roles of built-in part pins, used only for the advisory checks in erc.js.
//
//   { kind: "gnd" }
//   { kind: "supply", volts }          a pin that provides power (board 5V / 3V3 out, battery +)
//   { kind: "vin", vmin?, vmax?, optional? }   a power input (optional: may be left unconnected)
//   { kind: "io", vmax? }              a GPIO; vmax = highest voltage it tolerates
//   { kind: "out", volts }             a signal output driving that voltage (e.g. HC-SR04 ECHO = 5 V)
//
// The values are typical figures for hobby parts and may not match every product.

const gnd = { kind: "gnd" };
const supply = (volts) => ({ kind: "supply", volts });
const vin = (vmin, vmax, extra = {}) => ({ kind: "vin", vmin, vmax, ...extra });

// GPIO pins of a board, matched by name
function ioPins(pattern, vmax) {
  return { pattern, role: { kind: "io", vmax } };
}

const BATTERY_VOLTS = { AAx2: 3, AAx3: 4.5, AAx4: 6, "9V": 9 };

export const BUILTIN_ROLES = {
  nano: { pins: { "5V": supply(5), "3V3": supply(3.3), GND: gnd, GND2: gnd, VIN: vin(7, 12, { optional: true }) }, io: ioPins(/^(D\d+|A\d|TX1|RX0)$/, 5.5) },
  pico: {
    pins: { VBUS: supply(5), VSYS: vin(1.8, 5.5, { optional: true }), "3V3": supply(3.3), AGND: gnd, ...gnds("GND", 7) },
    io: ioPins(/^GP\d+$/, 3.6),
  },
  esp32: { pins: { "3V3": supply(3.3), "5V": supply(5), GND: gnd, GND2: gnd, GND3: gnd }, io: ioPins(/^IO\d+$/, 3.6) },
  xiao: { pins: { "3V3": supply(3.3), "5V": supply(5), GND: gnd }, io: ioPins(/^D\d+$/, 3.6) },
  regulator: {
    pins: (p) => {
      const m = /78(\d\d)/.exec(String(p.model));
      return { IN: vin(undefined, 35), GND: gnd, OUT: m ? supply(Number(m[1])) : { kind: "supply" } };
    },
  },
  battery: { pins: (p) => ({ "+": supply(BATTERY_VOLTS[p.kind] ?? 3), "-": gnd }) },
  dht11: { pins: { VCC: vin(3, 5.5), GND: gnd } },
  hcsr04: { pins: { VCC: vin(4.5, 5.5), GND: gnd, ECHO: { kind: "out", volts: 5 } } },
  relay: { pins: { VCC: vin(4.5, 5.5), GND: gnd } },
  lcd1602: { pins: { VCC: vin(4.5, 5.5), GND: gnd } },
  servo: { pins: { VCC: vin(4.5, 6), GND: gnd } },
  ne555: { pins: { VCC: vin(4.5, 16), GND: gnd } },
  lm358: { pins: { VCC: vin(3, 32), GND: gnd } },
  "74hc595": { pins: { VCC: vin(2, 6), GND: gnd } },
  inmp441: { pins: { VDD: vin(1.8, 3.6), GND: gnd } },
  max98357a: { pins: { Vin: vin(2.5, 5.5), GND: gnd } },
  ws2812b: { pins: { VCC: vin(3.5, 5.5), GND: gnd } },
  ssd1306: { pins: { VCC: vin(3, 5.5), GND: gnd } },
  qwiic: { pins: { "3V3": vin(3, 3.6), GND: gnd } },
};

function gnds(prefix, count) {
  const out = { [prefix]: gnd };
  for (let i = 2; i <= count; i++) out[`${prefix}${i}`] = gnd;
  return out;
}

// role of each pin name of a built-in part: { name: role }
export function builtinRoles(type, params, pinNames) {
  const spec = BUILTIN_ROLES[type];
  if (!spec) return {};
  const fixed = typeof spec.pins === "function" ? spec.pins(params) : (spec.pins ?? {});
  const out = { ...fixed };
  if (spec.io) for (const name of pinNames) if (!(name in out) && spec.io.pattern.test(name)) out[name] = spec.io.role;
  return out;
}

// role from a JSON pin: "role": "gnd" | "supply" | "vin" | "io" | "out", with volts / vmin / vmax / optional
export function jsonRole(pin) {
  if (!pin.role) return null;
  const kinds = ["gnd", "supply", "vin", "io", "out"];
  if (!kinds.includes(pin.role)) return null;
  const role = { kind: pin.role };
  for (const k of ["volts", "vmin", "vmax"]) if (Number.isFinite(pin[k])) role[k] = pin[k];
  if (pin.optional) role.optional = true;
  return role;
}
