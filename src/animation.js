// Animation: a "script" of part / wire states over time, compiled to CSS keyframes so an
// exported SVG animates on its own (also inside <img>, e.g. a GitHub README).
//
// circuit.animation = {
//   "duration": 2000, "loop": true,
//   "tracks": [ { "target": "D1", "keys": [ { "t": 0, "on": true }, { "t": 1000, "on": false } ] } ],
//   "captions": [ { "t": 0, "text": "..." } ]
// }
//
// Each part type declares its states (`states`) and how they map to CSS on its animated
// elements (`animate`). State types:
//   bool / string : hold the value until the next key
//   number        : linear interpolation between keys
//   rate          : rpm, linearly interpolated; its running angle is available as `<name>Angle`

export const WIRE_STATES = {
  flow: { type: "bool", default: false, description: "線に沿って信号が流れる表示 (from → to)" },
};

export const OVERLAY_STATES = {
  show: { type: "bool", default: true, description: "表示する" },
  opacity: { type: "number", default: 1, description: "不透明度 0〜1" },
};

const SAMPLES = 60;

// Builds per-target timelines. Problems go to `warnings`.
export function buildTimeline(parts, wires, animation, warnings = [], overlays = []) {
  const targets = new Map();
  for (const p of parts) targets.set(p.id, { kind: "part", specs: p.def.states ?? {}, base: p.inst.state ?? {} });
  for (const w of wires) targets.set(w.id, { kind: "wire", specs: WIRE_STATES, base: w.state ?? {} });
  for (const o of overlays) targets.set(o.id, { kind: "overlay", specs: OVERLAY_STATES, base: o.state ?? {} });

  const anim = animation && typeof animation === "object" ? animation : null;
  const duration = Math.max(1, Number(anim?.duration) || 1000);
  const tracks = new Map();
  for (const [id, target] of targets) tracks.set(id, makeTrack(target.specs, target.base, []));

  for (const [i, tr] of (anim?.tracks ?? []).entries()) {
    const target = targets.get(tr.target);
    if (!target) {
      warnings.push(`animation.tracks[${i}]: target "${tr.target}" が見つかりません`);
      continue;
    }
    const keys = [];
    for (const key of tr.keys ?? []) {
      const t = Number(key.t);
      if (!Number.isFinite(t)) {
        warnings.push(`animation ${tr.target}: キーに t (ミリ秒) がありません`);
        continue;
      }
      for (const name of Object.keys(key)) {
        if (name !== "t" && !(name in target.specs)) {
          warnings.push(`animation ${tr.target}: 状態 "${name}" はありません (使えるもの: ${Object.keys(target.specs).join(", ") || "なし"})`);
        }
      }
      keys.push({ ...key, t });
    }
    const prev = tracks.get(tr.target);
    tracks.set(tr.target, makeTrack(target.specs, target.base, [...prev.keys, ...keys]));
  }
  const captions = (anim?.captions ?? [])
    .map((c) => ({ t: Number(c.t) || 0, text: String(c.text ?? "") }))
    .sort((a, b) => a.t - b.t);
  const animated = Boolean(anim) && ([...tracks.values()].some((t) => t.keys.length) || captions.length > 0);
  return { duration, loop: anim?.loop !== false, tracks, captions, animated };
}

export function makeTrack(specs, base, keys) {
  keys = [...keys].sort((a, b) => a.t - b.t);
  const defaults = {};
  for (const [name, spec] of Object.entries(specs)) defaults[name] = base[name] ?? spec.default;

  const stateAt = (t) => {
    const s = { ...defaults };
    for (const [name, spec] of Object.entries(specs)) {
      const ks = keys.filter((k) => name in k);
      let prev = null;
      let next = null;
      for (const k of ks) {
        if (k.t <= t) prev = k;
        else if (!next) next = k;
      }
      if (!prev) continue;
      const lerp = spec.type === "number" || spec.type === "rate";
      if (lerp && next && next.t > prev.t) {
        const f = (t - prev.t) / (next.t - prev.t);
        s[name] = Number(prev[name]) + (Number(next[name]) - Number(prev[name])) * f;
      } else {
        s[name] = prev[name];
      }
    }
    return s;
  };
  const rates = Object.entries(specs).filter(([, s]) => s.type === "rate").map(([n]) => n);
  return { keys, specs, stateAt, rates, defaults };
}

// State at time 0 (used for the static drawing), including rate angles.
export function initialState(track) {
  const s = track.stateAt(0);
  for (const r of track.rates) s[`${r}Angle`] = 0;
  return s;
}

// Samples a track over one loop. Steps get a sample just before the change so CSS
// keyframes switch sharply; rates are integrated into `<name>Angle` (degrees).
export function sampleTrack(track, duration) {
  const eps = Math.max(0.5, duration / 4000);
  const times = new Set([0, duration]);
  for (const k of track.keys) {
    if (k.t > 0 && k.t < duration) {
      times.add(k.t);
      times.add(Math.max(0, k.t - eps));
    }
  }
  const smooth = Object.values(track.specs).some((s) => s.type === "number" || s.type === "rate");
  if (smooth) for (let i = 1; i < SAMPLES; i++) times.add((duration * i) / SAMPLES);
  const sorted = [...times].sort((a, b) => a - b);
  const out = [];
  const angles = Object.fromEntries(track.rates.map((r) => [r, 0]));
  let prev = null;
  for (const t of sorted) {
    const s = track.stateAt(t);
    if (prev) {
      for (const r of track.rates) {
        const rpm = (Number(prev.s[r]) + Number(s[r])) / 2;
        angles[r] += rpm * 6 * ((t - prev.t) / 1000); // rpm -> deg/s = rpm * 360 / 60
      }
    }
    for (const r of track.rates) s[`${r}Angle`] = angles[r];
    out.push({ t, s });
    prev = { t, s };
  }
  return out;
}

export function cssDecl(props) {
  return Object.entries(props)
    .map(([k, v]) => `${k}:${typeof v === "number" ? Math.round(v * 1000) / 1000 : v}`)
    .join(";");
}

// Compiles animated elements to CSS. `elements` is a list of
// { selector, track, map: (state) => cssProps } collected while rendering.
export function compileCss(elements, timeline, prefix) {
  const { duration, loop } = timeline;
  let css = "";
  let n = 0;
  const cache = new Map();
  for (const el of elements) {
    let samples = cache.get(el.track);
    if (!samples) cache.set(el.track, (samples = sampleTrack(el.track, duration)));
    const decls = samples.map(({ t, s }) => ({ t, d: cssDecl(el.map(s)) }));
    if (decls.every((x) => x.d === decls[0].d)) continue; // never changes: the inline style is enough
    const frames = decls.filter((x, i) => i === 0 || i === decls.length - 1 || x.d !== decls[i - 1].d || x.d !== decls[i + 1].d);
    const name = `${prefix}-k${n++}`;
    css += `@keyframes ${name}{${frames.map((f) => `${pct(f.t / duration)}{${f.d}}`).join("")}}`;
    css += `${el.selector}{animation:${name} ${duration}ms linear ${loop ? "infinite" : "1"} both}`;
  }
  return css;
}

const pct = (f) => `${Math.round(f * 100000) / 1000}%`;

// Always-running effects used by some parts (wire flow, buzzer waves).
const EFFECT_KEYFRAMES =
  "@keyframes bb-dash{to{stroke-dashoffset:-.8}}" +
  "@keyframes bb-wave{from{transform:scale(.55);opacity:1}to{transform:scale(1.25);opacity:0}}";

export const EFFECT_CSS =
  ".bb-flow{animation:bb-dash .6s linear infinite}.bb-wave{animation:bb-wave 1s ease-out infinite}.bb-wave2{animation-delay:-.5s}" +
  EFFECT_KEYFRAMES;

// The same effects frozen at time t (ms): paused animations with a negative delay.
export function stillEffectCss(t) {
  const ms = Math.round(t);
  return (
    `.bb-flow{animation:bb-dash .6s linear infinite paused;animation-delay:-${ms}ms}` +
    `.bb-wave{animation:bb-wave 1s ease-out infinite paused;animation-delay:-${ms}ms}.bb-wave2{animation-delay:-${ms + 500}ms}` +
    EFFECT_KEYFRAMES
  );
}

// Distinct values a state takes in a track (for parts that draw one element per value).
export function valuesOf(track, name) {
  const vals = [track.defaults[name], ...track.keys.filter((k) => name in k).map((k) => k[name])];
  return [...new Set(vals.filter((v) => v !== undefined).map(String))];
}

export function captionTrack(captions) {
  return makeTrack(
    { caption: { type: "string", default: -1 } },
    {},
    captions.map((c, i) => ({ t: c.t, caption: i })),
  );
}

// State at time t (ms) within one loop, including rate angles, for still frames.
export function stateAtTime(track, t) {
  if (!(t > 0)) return initialState(track);
  return sampleTrack(track, t).at(-1).s;
}
