#!/usr/bin/env node
// Generates the agent guides from docs/agent/common.md (run by `npm run build`, after dist/bb.mjs):
//   llms.txt                         for agents given only the site URL
//   skill/breadboard-viewer/         Agent Skill: SKILL.md + bb.mjs + FORMAT.md + OPS.md
//   skill/breadboard-viewer.zip      the same folder, for uploading as a skill
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";

const BASE = "https://monoradio102.github.io/breadboard-viewer/";
const SKILL = "breadboard-viewer";
const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const fill = (text, vars) => text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k]);

const common = read("docs/agent/common.md");
const INSTALL = `d=~/.claude/skills/${SKILL}; mkdir -p "$d"; for f in SKILL.md bb.mjs FORMAT.md OPS.md; do curl -fsSL "${BASE}skill/${SKILL}/$f" -o "$d/$f"; done`;

// ---- llms.txt ----
const llms = `# Breadboard Viewer

> ブレッドボード上の配線を JSON で記述し、SVG / PNG / アニメーションとして描画するツールです。
> このファイルは、AIエージェントがこのサイトの URL だけを渡されたときの手引きです。リポジトリをクローンする必要はありません。
> (このファイルは docs/agent/common.md から生成しています)

Base URL: ${BASE}

## 使い始める (シェルと Node.js 18 以上がある場合)

依存のない1ファイルのコマンドラインツールを取得します。以下の \`node bb.mjs\` はこのファイルを指します。

\`\`\`bash
curl -fsSLO ${BASE}dist/bb.mjs
\`\`\`

## よく使う場合: Claude のスキルとしてインストール

一度インストールすると、URL を渡さなくても、ブレッドボードの配線図を頼むだけで使われます。

\`\`\`bash
# Claude Code (個人のスキル。プロジェクト単位なら ~/.claude を .claude に)
${INSTALL}
\`\`\`

claude.ai では、${BASE}skill/${SKILL}.zip をスキルとしてアップロードします。

## ブラウザを操作できる場合

エディタ ${BASE} を開き、\`window.bb\` を使います。

\`\`\`js
bb.load(circuitJson)            // 回路を読み込む (オブジェクト / JSON 文字列 / 書き出した SVG)
bb.apply([{ op: "addWire", from: "c22", to: "T-22", color: "black" }])
bb.check()                      // 検証結果とネットリスト (テキスト)
bb.svg()                        // アニメーション付き SVG / bb.svg({ time: 1500 }) で静止画
await bb.png({ time: 1500 })    // PNG の Blob (background: null で透過)
bb.get()                        // 現在の回路 JSON
bb.link()                       // この回路を開くリンク (#data=…)
bb.help()
\`\`\`

${fill(common, { CLI: "node bb.mjs", BASE, EDITOR: BASE, FORMAT: `${BASE}docs/FORMAT.md`, OPS: `${BASE}docs/OPS.md` })}`;
writeFileSync(new URL("llms.txt", root), llms);

// ---- skill ----
const skillDir = new URL(`skill/${SKILL}/`, root);
mkdirSync(skillDir, { recursive: true });
const skillMd = `---
name: ${SKILL}
description: ブレッドボードの配線図を JSON で作成・検証し、SVG / PNG / GIF / MP4 に描画する (Breadboard Viewer)。Arduino、Raspberry Pi Pico、ESP32 などの電子工作で、ブレッドボード上の組み方を図にする、配線やネットリストを確かめる、動作をアニメーションで説明するときに使う。Use for breadboard wiring diagrams, layout images and animations.
---

# Breadboard Viewer

ブレッドボード上の配線を JSON で記述し、このスキルに同梱した \`bb.mjs\` (依存のない1ファイルの CLI) で検証・描画します。

- \`$SKILL_DIR\` は、このスキルのフォルダです (例: \`~/.claude/skills/${SKILL}\`)
- \`bb.mjs\` が見つからないときは ${BASE}dist/bb.mjs から取得してください
- 回路の JSON や画像は、ユーザーの作業フォルダに作ります
- エディタ: ${BASE}

${fill(common, { CLI: 'node "$SKILL_DIR/bb.mjs"', BASE, EDITOR: BASE, FORMAT: "このフォルダの `FORMAT.md`", OPS: "このフォルダの `OPS.md`" })}`;
writeFileSync(new URL("SKILL.md", skillDir), skillMd);
copyFileSync(new URL("dist/bb.mjs", root), new URL("bb.mjs", skillDir));
copyFileSync(new URL("docs/FORMAT.md", root), new URL("FORMAT.md", skillDir));
copyFileSync(new URL("docs/OPS.md", root), new URL("OPS.md", skillDir));

const files = readdirSync(skillDir)
  .sort()
  .map((name) => ({ name: `${SKILL}/${name}`, data: readFileSync(new URL(name, skillDir)) }));
writeFileSync(new URL(`skill/${SKILL}.zip`, root), zip(files));
console.log(`llms.txt, skill/${SKILL}/ (${files.length} files), skill/${SKILL}.zip`);

// ---- minimal zip writer (deflate, fixed timestamps so the output is reproducible) ----
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4); // version needed
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(8, 8); // deflate
    head.writeUInt16LE(0, 10); // time
    head.writeUInt16LE(0x21, 12); // date 1980-01-01
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    head.writeUInt16LE(0, 28);
    locals.push(head, nameBuf, packed);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4); // version made by
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0x21, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(packed.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    centrals.push(cen, nameBuf);
    offset += head.length + nameBuf.length + packed.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
