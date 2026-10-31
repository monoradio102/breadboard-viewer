// Advisory electrical checks ("参考"). They look for common beginner mistakes using the pin
// roles in parts/roles.js (or "role" on JSON pins). They do not simulate the circuit:
// no advice does not mean the circuit is right.

export function electricalAdvice(parts) {
  const out = [];
  const byNet = new Map(); // net name -> [{ ref, part, pin, role }]
  const rolesOf = new Map(parts.map((p) => [p, p.def.roles?.(p.params) ?? {}]));
  for (const part of parts) {
    for (const pin of part.pins) {
      if (!pin.node || !pin.net) continue;
      if (!byNet.has(pin.net)) byNet.set(pin.net, []);
      byNet.get(pin.net).push({ ref: `${part.id}.${pin.name}`, part, pin, role: rolesOf.get(part)[pin.name] ?? null });
    }
  }
  const is = (kind) => (m) => m.role?.kind === kind;
  const volts = (m) => m.role?.volts;
  const netOf = (part, name) => part.pins.find((p) => p.name === name)?.net;
  const round = (v) => Math.round(v * 100) / 100;

  for (const members of byNet.values()) {
    const supplies = members.filter(is("supply"));
    const gnds = members.filter(is("gnd"));
    const levels = [...new Set(supplies.map(volts).filter((v) => v !== undefined))];
    if (levels.length > 1) {
      out.push(`電圧の違う電源どうしがつながっています: ${supplies.map((s) => `${s.ref} (${volts(s) ?? "?"}V)`).join(", ")}`);
    }
    if (supplies.length && gnds.length) out.push(`電源と GND がつながっています (ショート): ${supplies[0].ref} と ${gnds[0].ref}`);
    const drivers = members.filter((m) => (is("supply")(m) || is("out")(m)) && volts(m) !== undefined);
    for (const m of members) {
      const r = m.role;
      if (r?.kind === "vin") {
        for (const s of supplies.filter((s) => volts(s) !== undefined)) {
          if (r.vmax !== undefined && volts(s) > r.vmax) out.push(`${m.ref} は ${r.vmax}V までですが、${s.ref} (${volts(s)}V) につながっています`);
          if (r.vmin !== undefined && volts(s) < r.vmin) out.push(`${m.ref} は ${r.vmin}V 以上が必要ですが、${s.ref} (${volts(s)}V) につながっています`);
        }
      }
      if (r?.kind === "io" && r.vmax !== undefined) {
        for (const d of drivers.filter((d) => volts(d) > r.vmax)) out.push(`${m.ref} (${r.vmax}V まで) に ${d.ref} の ${volts(d)}V が直接つながっています`);
      }
    }
  }

  // GND / power input left unconnected on a part that is otherwise wired up
  for (const part of parts) {
    const roles = rolesOf.get(part);
    const pins = part.pins.filter((p) => p.node && p.net);
    const linked = (p) => byNet.get(p.net).some((m) => m.part !== part);
    if (!pins.some(linked)) continue;
    const gndPins = pins.filter((p) => roles[p.name]?.kind === "gnd");
    if (gndPins.length && !gndPins.some(linked)) out.push(`${part.id} の GND がどこにもつながっていません`);
    for (const p of pins.filter((p) => roles[p.name]?.kind === "vin" && !roles[p.name].optional && !linked(p))) {
      out.push(`${part.id}.${p.name} (電源入力) がどこにもつながっていません`);
    }
  }

  // an input that needs a higher HIGH than what drives it (e.g. WS2812B DIN at 5 V from 3.3 V)
  const supplyOn = (part, name) => {
    const net = netOf(part, name);
    const s = net && byNet.get(net)?.find((m) => is("supply")(m) && volts(m) !== undefined);
    return s ? volts(s) : undefined;
  };
  for (const part of parts) {
    for (const [name, r] of Object.entries(rolesOf.get(part))) {
      if (r?.kind !== "in") continue;
      const vih = r.vih ?? (r.vihRatio && r.ref ? r.vihRatio * (supplyOn(part, r.ref) ?? NaN) : undefined);
      if (!Number.isFinite(vih)) continue;
      for (const m of byNet.get(netOf(part, name)) ?? []) {
        const level = m.role?.kind === "io" ? m.role.voh : m.role?.kind === "out" ? m.role.volts : undefined;
        if (level !== undefined && level < vih - 1e-9) {
          out.push(`${part.id}.${name} は HIGH に ${round(vih)}V 以上が必要ですが、${m.ref} の出力は ${level}V です (レベル変換を検討)`);
        }
      }
    }
  }

  // capacitors: voltage rating from the value ("100uF 6.3V"), polarity of electrolytics
  for (const part of parts.filter((p) => p.type === "electrolytic" || p.type === "capacitor")) {
    const [a, b] = part.type === "electrolytic" ? ["+", "-"] : ["1", "2"];
    const across = (x, y) => {
      const hi = byNet.get(netOf(part, x))?.find((m) => is("supply")(m) && volts(m) !== undefined);
      const lo = byNet.get(netOf(part, y))?.some(is("gnd"));
      return hi && lo ? hi : null;
    };
    const rating = /(\d+(?:\.\d+)?)\s*V\b/i.exec(String(part.params.value ?? ""));
    for (const [x, y] of [[a, b], [b, a]]) {
      const hi = across(x, y);
      if (!hi) continue;
      if (part.type === "electrolytic" && x === "-") {
        out.push(`${part.id} (電解コンデンサ) の向きが逆です: − 側に ${hi.ref} (${volts(hi)}V)、+ 側に GND がつながっています`);
      }
      if (rating && volts(hi) > Number(rating[1])) out.push(`${part.id} の耐圧 ${rating[1]}V を超える ${volts(hi)}V (${hi.ref}) がかかります`);
    }
  }

  // an LED straight between a power / GPIO pin and GND has no current-limiting resistor
  for (const part of parts.filter((p) => p.type === "led" || p.type === "rgbled")) {
    const k = netOf(part, "K");
    if (!k || !byNet.get(k)?.some(is("gnd"))) continue;
    for (const a of part.type === "led" ? ["A"] : ["R", "G", "B"]) {
      const driver = byNet.get(netOf(part, a))?.find((m) => ["supply", "io", "out"].includes(m.role?.kind));
      if (driver) out.push(`${part.id} が抵抗なしで ${driver.ref} と GND の間にあります (電流制限抵抗を入れましょう)`);
    }
  }
  return [...new Set(out)];
}
