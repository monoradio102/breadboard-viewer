// Automatic wiring: given placed parts and the nets they should form, add jumper wires.
// Pure functions (no DOM); used by the autoWire op (see ops.js / docs/OPS.md).
//
// A net is a list of members: part pins ("U1.D4"), holes ("a10"), or whole rails ("T+", "T-",
// "B+", "B-"). Members already connected (same strip, existing wires) need nothing. A part's
// internal links (a tact switch's always-connected legs) do not count: a net must not depend on
// a part staying in place, e.g. the top and bottom GND rails joined only through a switch. The rest are joined one wire at a time, always taking the cheapest wire over all
// nets (short, no crossing, not over a used hole or a part body, inside the board). Then each new
// wire is taken out and routed again with all the others in place, as long as that lowers the
// total: a wire laid early no longer blocks one laid later.
import { boardStrips } from "./board.js";
import { resolveCircuit } from "./circuit.js";
import { bodyBox, coveredBy } from "./inspect.js";
import { wirePoints } from "./wires.js";

const RAILS = ["T+", "T-", "B+", "B-"];
const COST = { length: 1, crossing: 25, alongside: 20, overHole: 40, overBody: 8, body: 12, offBoard: 10, bend: 2, detour: 1.5 };
const PALETTE = ["yellow", "blue", "green", "orange", "purple", "white", "brown", "gray"];
// free lanes between hole rows (pitch units): above row a, the centre trench, below row j
const LANES = [3, 9.5, 16];
const NEAR = 0.22; // a wire this close to a hole's centre covers it

// nets: { name: [members] } or [[members]]. Returns { wires: [new wire objects], notes: [],
// netNames: [the net of each wire] }.
// Throws Error with a readable message when a member does not exist or a net cannot be wired.
// budget: how many searches for one wire (cheapest()) the whole run may make. The run is the
// same for the same input on any machine; a bigger budget tries more orders and swaps.
export function autoWire(circuit, nets, { idPrefix = "W", passes = 3, budget = 300 } = {}) {
  const result = resolveCircuit(circuit);
  if (result.errors.length) throw new Error(`回路にエラーがあります: ${result.errors[0]}`);
  const { board } = result;
  const list = Array.isArray(nets) ? nets.map((m, i) => [`net${i + 1}`, m]) : Object.entries(nets ?? {});
  if (!list.length) throw new Error('nets が空です ({ "SDA": ["U1.D4", "DISP1.SDA"], ... })');

  // member -> node (a hole, a rail's first hole, or an off-board pin's node)
  const nodeOf = (m) => {
    const s = String(m);
    if (RAILS.includes(s)) {
      if (!board.rails) throw new Error(`このボードには電源レール (${s}) がありません`);
      return `${s}${board.railCols[0]}`;
    }
    if (board.has(s)) return s;
    const dot = s.indexOf(".");
    const part = dot > 0 ? result.parts.find((p) => p.id === s.slice(0, dot)) : null;
    if (!part) throw new Error(`"${s}" は部品のピン (例: "U1.D4")、穴、レール (T+ / T- / B+ / B-) のどれでもありません`);
    const pin = part.pins.find((p) => p.name === s.slice(dot + 1));
    if (!pin) throw new Error(`${part.id} にピン "${s.slice(dot + 1)}" はありません (${part.pins.map((p) => p.name).join(", ")})`);
    if (!pin.node) throw new Error(`${s} はどこにも挿さっていません`);
    return pin.node;
  };
  // pins joined inside their part stand for each other: keep one of them per net
  const internalKey = (m) => {
    const s = String(m);
    const dot = s.indexOf(".");
    const part = dot > 0 ? result.parts.find((p) => p.id === s.slice(0, dot)) : null;
    const g = part?.internal.findIndex((group) => group.includes(s.slice(dot + 1))) ?? -1;
    return g >= 0 ? `${part.id}#${g}` : s;
  };
  const todo = list.map(([name, members], i) => {
    if (!Array.isArray(members) || members.length < 2) throw new Error(`net "${name}": 2つ以上のメンバーが必要です`);
    const nodes = members.map(nodeOf);
    const keys = members.map(internalKey);
    return { name, color: colorFor(name, members.map(String), i), nodes: nodes.filter((_, k) => keys.indexOf(keys[k]) === k) };
  });

  // fixed facts about the board
  const baseUsed = new Set(result.occupied.keys());
  const covered = coveredBy(result);
  const terminals = new Map(); // node -> end { ref, x, y, node }
  for (const part of result.parts) {
    for (const pin of part.pins) if (!pin.hole && pin.node) terminals.set(pin.node, { ref: `${part.id}.${pin.name}`, x: pin.x, y: pin.y, node: pin.node });
  }
  const holeEnds = new Map([...board.holes].filter(([h]) => !covered.has(h)).map(([h, p]) => [h, { ref: h, x: p.x, y: p.y, hole: h, node: h }]));
  const trace = (w) => withBox(wirePoints(w, 0.35));
  const baseDrawn = result.wires.map(trace);
  // part bodies a wire should not run over, resistors and LEDs included (shrunk a little:
  // grazing an edge is fine). A wire to one of the part's own pins may touch it.
  const bodies = result.parts.map((part) => {
    const b = bodyBox(part);
    const edge = part.def.mount === "leads" && !part.offboard ? 0.15 : 0.6; // as in the layout check
    const [mx, my] = [Math.min(edge, b.w * 0.25), Math.min(edge, b.h * 0.25)];
    return { id: part.id, x: b.x + mx, y: b.y + my, w: b.w - 2 * mx, h: b.h - 2 * my };
  });
  const bounds = board.bounds;
  const kitStyle = circuit.wireStyle === "kit";

  // connectivity of the board plus the given auto wires
  const unionFind = (autos) => {
    const parent = new Map();
    const find = (a) => {
      if (!parent.has(a)) parent.set(a, a);
      let r = a;
      while (parent.get(r) !== r) r = parent.get(r);
      parent.set(a, r);
      return r;
    };
    const union = (a, b) => parent.set(find(a), find(b));
    for (const strip of boardStrips(board)) strip.slice(1).forEach((h) => union(strip[0], h));
    for (const w of result.wires) union(w.nodes[0], w.nodes[1]);
    for (const w of autos) union(w.a.node, w.b.node);
    return find;
  };
  // everything that constrains a new wire, given the auto wires already laid
  const context = (autos) => ({
    find: unionFind(autos),
    used: new Set([...baseUsed, ...autos.flatMap((w) => [w.a.hole, w.b.hole]).filter(Boolean)]),
    drawn: [...baseDrawn, ...autos.map((w) => w.points)],
  });
  const endsOf = (ctx, root) => [
    ...[...holeEnds.values()].filter((e) => !ctx.used.has(e.hole) && ctx.find(e.hole) === root),
    ...[...terminals.values()].filter((t) => ctx.find(t.node) === root),
  ];

  let spent = 0;
  const outOfBudget = () => spent >= budget;

  // 1. lay wires one by one: the cheapest over all nets (order null), or net by net in `order`
  const route = (order) => {
    const autos = [];
    for (;;) {
      const ctx = context(autos);
      let best = null;
      const pending = todo.filter((net) => new Set(net.nodes.map(ctx.find)).size > 1);
      const nets = order ? pending.slice().sort((p, q) => order.indexOf(p) - order.indexOf(q)).slice(0, 1) : pending;
      for (const net of nets) {
        const roots = [...new Set(net.nodes.map(ctx.find))];
        for (let i = 0; i < roots.length; i++) {
          for (let j = i + 1; j < roots.length; j++) {
            const c = cheapest(ctx, endsOf(ctx, roots[i]), endsOf(ctx, roots[j]));
            if (c && (!best || c.cost < best.cost)) best = { ...c, net };
          }
        }
      }
      if (!best) return pending.length ? { failed: pending[0] } : { autos };
      autos.push(best);
    }
  };

  // 2. rip up and reroute each wire with all the others in place, while the total goes down
  const improve = (autos) => {
    for (let pass = 0; pass < passes; pass++) {
      let improved = false;
      let current = total(autos);
      for (let i = 0; i < autos.length && !outOfBudget(); i++) {
        const others = autos.filter((_, k) => k !== i);
        const ctx = context(others);
        const w = autos[i];
        const c = cheapest(ctx, endsOf(ctx, ctx.find(w.a.node)), endsOf(ctx, ctx.find(w.b.node)));
        if (!c || (c.a === w.a && c.b === w.b && JSON.stringify(c.shape) === JSON.stringify(w.shape))) continue;
        const trial = [...others.slice(0, i), { ...c, net: w.net }, ...others.slice(i)];
        const t = total(trial);
        if (t < current - 1e-6) {
          autos.splice(i, 1, { ...c, net: w.net });
          current = t;
          improved = true;
        }
      }
      if (!improved) break;
    }
    return autos;
  };

  // 3. a wire still in trouble and a wire near it: take both out, try the first one's few best
  //    routes and lay the second around each (finds "this one goes round so that one fits")
  const improvePairs = (autos) => {
    for (let pass = 0; pass < passes; pass++) {
      let improved = false;
      const troubled = autos.map((w, i) => (inTrouble(w, autos.filter((_, k) => k !== i)) ? i : -1)).filter((i) => i >= 0);
      for (const i of troubled) {
        for (let j = 0; j < autos.length && !improved && !outOfBudget(); j++) {
          if (j === i || !overlaps(autos[i].points.box, autos[j].points.box)) continue;
          const others = autos.filter((_, k) => k !== i && k !== j);
          let best = { autos, cost: total(autos) };
          for (const [first, second] of [[autos[i], autos[j]], [autos[j], autos[i]]]) {
            const ctx1 = context(others);
            const ends = (ctx, w) => [endsOf(ctx, ctx.find(w.a.node)), endsOf(ctx, ctx.find(w.b.node))];
            const [fa, fb] = ends(ctx1, first);
            for (const c1 of cheapest(ctx1, fa, fb, 8)) {
              const a1 = { ...c1, net: first.net };
              const ctx2 = context([...others, a1]);
              const [sa, sb] = ends(ctx2, second);
              if (ctx2.find(second.a.node) === ctx2.find(second.b.node)) continue;
              const c2 = cheapest(ctx2, sa, sb);
              if (!c2) continue;
              const trial = [...others, a1, { ...c2, net: second.net }];
              const cost = total(trial);
              if (cost < best.cost - 1e-6) best = { autos: trial, cost };
            }
          }
          if (best.autos !== autos) {
            autos = best.autos;
            improved = true;
          }
        }
        if (improved) break;
      }
      if (!improved) break;
    }
    return autos;
  };

  // a few starting orders (cheapest-first, then each net first in turn); keep the best result
  const orders = [null, ...todo.slice(0, 6).map((first) => [first, ...todo.filter((t) => t !== first)])];
  let autos = null;
  let bestTotal = Infinity;
  let failed = null;
  for (const order of orders) {
    if (autos && outOfBudget()) break;
    const r = route(order);
    if (r.failed) {
      failed = r.failed;
      continue;
    }
    const done = improvePairs(improve(r.autos));
    const t = total(done);
    if (t < bestTotal - 1e-6) [autos, bestTotal] = [done, t];
    if (autos === done && !hasTrouble(done)) break; // clean already: no need to try further orders
  }
  if (!autos) throw new Error(`net "${failed.name}" をつなげませんでした (空いている穴が足りません)`);

  // the wires, and a note for any that still cross or cover something
  const taken = new Set([...result.wires.map((w) => w.id), ...result.parts.map((p) => p.id), ...(circuit.overlays ?? []).map((o) => o.id)]);
  let n = 0;
  const nextId = () => {
    do n++;
    while (taken.has(`${idPrefix}${n}`));
    taken.add(`${idPrefix}${n}`);
    return `${idPrefix}${n}`;
  };
  const wires = [];
  const notes = [];
  const netNames = [];
  autos.forEach((w, i) => {
    netNames.push(w.net.name);
    const { detour, ...shape } = w.shape;
    const trouble = inTrouble(w, autos.filter((_, k) => k !== i));
    const wire = { id: nextId(), from: w.a.ref, to: w.b.ref, color: w.net.color, ...shape, note: `自動配線: ${w.net.name}${trouble ? " (交差・重なりあり)" : ""}` };
    wires.push(wire);
    if (trouble) notes.push(`${wire.id} (${w.net.name}) は、ほかの配線と交差するか、使っている穴や部品の上を通ります`);
  });
  return { wires, notes, netNames };

  // ---- costs ----

  function inTrouble(w, others) {
    return wireCost(w, others) - lengthOf(w.points) * COST.length - 3 >= COST.crossing - 1e-6;
  }

  function hasTrouble(autos) {
    return autos.some((w, i) => inTrouble(w, autos.filter((_, k) => k !== i)));
  }

  function total(autos) {
    return autos.reduce((sum, w, i) => sum + wireCost(w, autos.filter((_, k) => k !== i)), 0);
  }

  function wireCost(w, others) {
    const used = new Set([...baseUsed, ...others.flatMap((o) => [o.a.hole, o.b.hole]).filter(Boolean)]);
    return costOf(w.points, w.a, w.b, w.shape, { used, drawn: [...baseDrawn, ...others.map((o) => o.points)] });
  }

  // best wire between two sets of possible ends
  // the best wire between two sets of possible ends; with k, the k best (different ends or shapes).
  // Two stages: the straight wire for the nearest pairs of ends, then every shape for the pairs
  // that did best (and the shortest ones).
  function cheapest(ctx, as, bs, k = 0) {
    spent++;
    const pairs = [];
    for (const a of as) for (const b of bs) pairs.push({ a, b, d: Math.hypot(a.x - b.x, a.y - b.y) });
    pairs.sort((p, q) => p.d - q.d);
    const near = pairs.slice(0, 150);
    const keep = Math.max(1, k);
    const tryShape = (a, b, shape, kit) => {
      const points = trace({ a, b, via: (shape.via ?? []).map(([x, y]) => ({ x, y })), bend: shape.bend, elbow: shape.elbow, kit });
      return { a, b, shape, points, cost: costOf(points, a, b, shape, ctx) };
    };
    // a wire costs at least its length: past the best straight one so far, nothing can win
    let bound = Infinity;
    const tried = [];
    for (const p of near) {
      if (p.d * COST.length >= bound && tried.length >= keep) break;
      p.straight = tryShape(p.a, p.b, {}, kitStyle && Boolean(p.a.hole && p.b.hole));
      tried.push(p);
      if (tried.length >= keep) bound = Math.min(bound, tried.map((t) => t.straight.cost).sort((x, y) => x - y)[keep - 1] + COST.bend * 0.25 + COST.detour + 12);
    }
    const promising = [...new Set([...tried.slice().sort((p, q) => p.straight.cost - q.straight.cost).slice(0, 10), ...tried.slice(0, 6)])];
    const top = []; // ascending by cost
    const offer = (c) => {
      if (top.length === keep && c.cost >= top[keep - 1].cost) return;
      top.push(c);
      top.sort((p, q) => p.cost - q.cost);
      if (top.length > keep) top.pop();
    };
    for (const p of tried) offer(p.straight);
    for (const { a, b } of promising) {
      const kit = kitStyle && Boolean(a.hole && b.hole);
      for (const shape of shapes(a, b, kit).slice(1)) offer(tryShape(a, b, shape, kit));
    }
    return k ? top : (top[0] ?? null);
  }

  function shapes(a, b, kit) {
    if (kit) {
      const straight = Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6;
      return straight ? [{}] : [{}, { elbow: "v" }];
    }
    const out = [{}, { bend: 0.12 }, { bend: -0.12 }, { bend: 0.25 }, { bend: -0.25 }];
    // around: up or down into a free lane, along it, and back (only on the board)
    if (a.hole && b.hole && Math.abs(a.x - b.x) > 1.5) {
      for (const y of LANES) if (y > bounds.y && y < bounds.y + bounds.h) out.push({ via: [[a.x, y], [b.x, y]], detour: true });
    }
    return out;
  }

  function costOf(points, a, b, shape, { used, drawn }) {
    const len = lengthOf(points);
    let cost = len * COST.length + Math.abs(shape.bend ?? 0) * COST.bend + (shape.detour ? COST.detour : 0);
    // crossings with what is drawn already (touching at a shared end does not count), and
    // stretches laid right along another wire
    for (const other of drawn) cost += crossings(points, other) * COST.crossing + alongside(points, other) * COST.alongside;
    // right over a hole someone uses (its own two ends excepted)
    for (const h of used) {
      if (h === a.hole || h === b.hole) continue;
      const p = board.pos(h);
      if (!p || Math.abs(p.x - (a.x + b.x) / 2) > len || Math.abs(p.y - (a.y + b.y) / 2) > len) continue; // far away
      if (points.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < NEAR)) cost += COST.overHole;
    }
    // its own ends right under another wire
    for (const end of [a, b]) {
      if (!end.hole) continue;
      if (drawn.some((line) => line.some((q) => Math.hypot(q.x - end.x, q.y - end.y) < NEAR))) cost += COST.overHole;
    }
    // over part bodies (each body crossed, and how far), and off the board when both ends are on it
    const step = len / Math.max(1, points.length - 1);
    const own = (bx) => [a.ref, b.ref].some((r) => r.startsWith(`${bx.id}.`));
    const crossed = new Set();
    for (const q of points) {
      for (const bx of bodies) {
        if (q.x > bx.x && q.x < bx.x + bx.w && q.y > bx.y && q.y < bx.y + bx.h && !own(bx)) {
          cost += COST.overBody * step;
          crossed.add(bx);
        }
      }
      if (a.hole && b.hole && (q.x < bounds.x || q.x > bounds.x + bounds.w || q.y < bounds.y || q.y > bounds.y + bounds.h)) cost += COST.offBoard * step;
    }
    return cost + crossed.size * COST.body;
  }
}

function lengthOf(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return len;
}

// black for ground, red for supplies (by the net's name or the rails in it), else a palette colour
function colorFor(name, members, i) {
  const s = String(name).toLowerCase();
  if (/gnd|ground|vss|^-$|−|(^|\/)[tb]-/.test(s) || members.some((m) => m === "T-" || m === "B-")) return "black";
  if (/vcc|vdd|vin|3v3|3\.3|5v|vbus|bat|power|pwr|(^|\/)[tb]\+/.test(s) || members.some((m) => m === "T+" || m === "B+")) return "red";
  return PALETTE[i % PALETTE.length];
}

// number of proper intersections between two polylines; wires that share an end (a terminal)
// do not cross there
function crossings(p, q) {
  if (p.box && q.box && (p.box.x1 < q.box.x0 || q.box.x1 < p.box.x0 || p.box.y1 < q.box.y0 || q.box.y1 < p.box.y0)) return 0;
  const near = (u, v) => Math.hypot(u.x - v.x, u.y - v.y) < 0.05;
  const shared = [p[0], p.at(-1)].filter((e) => near(e, q[0]) || near(e, q.at(-1)));
  let count = 0;
  const qb = q.box;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1];
    const b = p[i];
    if (qb && (Math.max(a.x, b.x) < qb.x0 || Math.min(a.x, b.x) > qb.x1 || Math.max(a.y, b.y) < qb.y0 || Math.min(a.y, b.y) > qb.y1)) continue;
    for (let j = 1; j < q.length; j++) {
      if (!segmentsCross(a, b, q[j - 1], q[j])) continue;
      if (shared.some((e) => near(e, p[i - 1]) || near(e, p[i]))) continue;
      count++;
    }
  }
  return count;
}

function segmentsCross(a, b, c, d) {
  const orient = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function withBox(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  points.box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  return points;
}

function overlaps(p, q, m = 1) {
  return !(p.x1 + m < q.x0 || q.x1 + m < p.x0 || p.y1 + m < q.y0 || q.y1 + m < p.y0);
}

// length (pitch units, roughly) of p that runs within 0.3 of q, away from their shared ends
function alongside(p, q) {
  if (p.box && q.box && !overlaps(p.box, q.box, 0.3)) return 0;
  const ends = [q[0], q.at(-1), p[0], p.at(-1)];
  const qb = q.box;
  let n = 0;
  for (const u of p) {
    if (qb && (u.x < qb.x0 - 0.3 || u.x > qb.x1 + 0.3 || u.y < qb.y0 - 0.3 || u.y > qb.y1 + 0.3)) continue;
    if (ends.some((e) => (e.x - u.x) ** 2 + (e.y - u.y) ** 2 < 0.36)) continue;
    if (q.some((v) => (v.x - u.x) ** 2 + (v.y - u.y) ** 2 < 0.09)) n++;
  }
  return n * 0.35;
}
