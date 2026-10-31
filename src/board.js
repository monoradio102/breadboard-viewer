// Breadboard geometry.
//
// All coordinates are in "pitch units": 1 unit = 2.54 mm (0.1 inch), y grows downward.
// Hole ids:
//   main grid : "<row><col>"  row = a..j, col = 1..cols   e.g. "a10", "j63"
//   power rail: "<T|B><+|->"<col>                          e.g. "T+5", "B-12"
// Columns are connected vertically within a-e and within f-j.
// Each rail row (T+, T-, B+, B-) is connected along its whole length.

export const BOARD_TYPES = {
  full: { cols: 63, rails: true, label: "フルサイズ (830穴)" },
  half: { cols: 30, rails: true, label: "ハーフサイズ (400穴)" },
  mini: { cols: 17, rails: false, label: "ミニ (170穴)" },
};

export const ROWS = "abcdefghij";
export const RAILS = ["T+", "T-", "B+", "B-"];

const ROW_Y = { a: 4, b: 5, c: 6, d: 7, e: 8, f: 11, g: 12, h: 13, i: 14, j: 15 };
const RAIL_Y = { "T+": 1, "T-": 2, "B+": 17, "B-": 18 };

const HOLE_RE = /^([a-j])(\d+)$|^([TB][+-])(\d+)$/;

export function colX(col) {
  return col + 1;
}

// Rail holes come in groups of 5 starting at column 3, with a one-hole gap between groups.
export function railCols(cols) {
  const out = [];
  for (let start = 3; start <= cols - 1; start += 6) {
    for (let c = start; c < start + 5 && c <= cols - 1; c++) out.push(c);
  }
  return out;
}

export function parseHole(id) {
  const m = HOLE_RE.exec(String(id));
  if (!m) return null;
  if (m[1]) return { kind: "main", row: m[1], col: Number(m[2]) };
  return { kind: "rail", rail: m[3], col: Number(m[4]) };
}

export function createBoard(type = "half") {
  const spec = BOARD_TYPES[type];
  if (!spec) throw new Error(`unknown board type "${type}" (use: ${Object.keys(BOARD_TYPES).join(", ")})`);
  const holes = new Map(); // id -> {x, y}
  const byPos = new Map(); // "x,y" -> id
  const add = (id, x, y) => {
    holes.set(id, { x, y });
    byPos.set(`${x},${y}`, id);
  };
  for (let col = 1; col <= spec.cols; col++) {
    for (const row of ROWS) add(`${row}${col}`, colX(col), ROW_Y[row]);
  }
  const rcols = spec.rails ? railCols(spec.cols) : [];
  for (const rail of spec.rails ? RAILS : []) {
    for (const col of rcols) add(`${rail}${col}`, colX(col), RAIL_Y[rail]);
  }
  const bounds = spec.rails
    ? { x: 0, y: 0, w: spec.cols + 3, h: 19 }
    : { x: 0, y: 2.4, w: spec.cols + 3, h: 14.2 };
  return {
    type,
    ...spec,
    railCols: rcols,
    holes,
    bounds,
    rowY: ROW_Y,
    railY: RAIL_Y,
    has: (id) => holes.has(id),
    pos: (id) => holes.get(id) ?? null,
    holeAt(x, y) {
      const rx = Math.round(x * 1000) / 1000;
      const ry = Math.round(y * 1000) / 1000;
      return byPos.get(`${rx},${ry}`) ?? null;
    },
  };
}

// Groups of holes that are electrically connected by the board itself.
export function boardStrips(board) {
  const strips = [];
  for (let col = 1; col <= board.cols; col++) {
    strips.push(["a", "b", "c", "d", "e"].map((r) => `${r}${col}`));
    strips.push(["f", "g", "h", "i", "j"].map((r) => `${r}${col}`));
  }
  if (board.rails) {
    for (const rail of RAILS) strips.push(board.railCols.map((c) => `${rail}${c}`));
  }
  return strips;
}
