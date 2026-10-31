// New ids count up from the highest number in use, so a removed id is not handed out again
// (an animation or step that still names "W6" must not quietly move to a new wire).
// Every quoted string in the circuit counts: ids of parts / wires / overlays, the names in
// animation tracks, groups and steps, and retiredIds (ids removed by ops, kept there for this).

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The highest n of "<prefix><n>" anywhere in the circuit (0 when none).
export function highestId(circuit, prefix) {
  const re = new RegExp(`"${escape(prefix)}(\\d+)"`, "g");
  let max = 0;
  for (const m of JSON.stringify(circuit).matchAll(re)) max = Math.max(max, Number(m[1]));
  return max;
}
