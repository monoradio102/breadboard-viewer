// Frame-accurate PNG capture with Playwright (used by `bb.mjs render` and `bb.mjs frames`).
//
// The animated SVG is loaded once; for each frame its CSS animations are paused at time t.
// User SVG (part sprites / overlays) runs on its own clock inside <image>, so each one is opened
// in a separate page with JavaScript disabled (its scripts never run, the network is blocked),
// paused at t, captured as a transparent PNG and swapped into the frame.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SPRITE_PREFIX = "data:image/svg+xml;charset=utf-8,";

// True when the Playwright package can be loaded (with or without its own Chromium).
export function hasPlaywright() {
  try {
    loadPlaywright();
    return true;
  } catch {
    return false;
  }
}

// Where the Playwright package was found (a folder), or null.
export function playwrightPlace() {
  try {
    loadPlaywright();
    return found.place;
  } catch {
    return null;
  }
}

// Whether Playwright can start its own Chromium: null when it can, else the reason (one line).
// It is actually launched: the files Playwright uses vary by version (full Chromium, or the
// headless shell only) and may belong to another version of the package.
export async function playwrightBrowserProblem() {
  try {
    const browser = await loadPlaywright().chromium.launch();
    await browser.close();
    return null;
  } catch (e) {
    const line = String(e?.message ?? e).split("\n").find((l) => l.trim() && !/^browserType\.launch:?$/.test(l.trim())) ?? "起動できません";
    return line.replace(/^browserType\.launch:\s*/, "").trim();
  }
}

// channel: "chrome" uses the installed Google Chrome; executablePath any Chromium-based browser.
export async function launchBrowser({ channel, executablePath } = {}) {
  const { chromium } = loadPlaywright();
  return chromium.launch({ ...(channel ? { channel } : {}), ...(executablePath ? { executablePath } : {}) });
}

// browser: share one browser between several captures (closed by the caller).
export async function openCapture(svg, { scale = 2, transparent = false, channel, executablePath, browser: shared } = {}) {
  const browser = shared ?? (await launchBrowser({ channel, executablePath }));
  const block = (ctx) => ctx.route("**/*", (route) => route.abort());
  const mainCtx = await browser.newContext({ deviceScaleFactor: scale });
  await block(mainCtx);
  const main = await mainCtx.newPage();
  await main.setContent(`<body style="margin:0;background:${transparent ? "transparent" : "#fff"}">${svg}</body>`);

  // one page per distinct sprite, sized like its <image> on screen
  const sprites = await main.evaluate((prefix) => {
    const list = [];
    document.querySelectorAll("image").forEach((img, i) => {
      const href = img.getAttribute("href") ?? "";
      if (!href.startsWith(prefix)) return;
      const m = img.getScreenCTM();
      const k = Math.hypot(m.a, m.b);
      img.dataset.sprite = String(i);
      // restart: the sprite's clock starts each time the overlay becomes visible
      const starts = img.dataset.restart ? img.dataset.restart.split(",").map(Number) : null;
      const cycle = Number(img.dataset.cycle) || 0;
      list.push({ i, href, starts, cycle, w: img.width.baseVal.value * k, h: img.height.baseVal.value * k, fit: img.getAttribute("preserveAspectRatio") });
    });
    return list;
  }, SPRITE_PREFIX);
  const spriteCtx = sprites.length ? await browser.newContext({ deviceScaleFactor: scale, javaScriptEnabled: false }) : null;
  if (spriteCtx) await block(spriteCtx);
  for (const sp of sprites) {
    sp.page = await spriteCtx.newPage();
    const source = decodeURIComponent(sp.href.slice(SPRITE_PREFIX.length)).replace(/^\s*<\?xml[^>]*>/, "");
    const sized = source.replace(/<svg\b([^>]*)>/, (_, attrs) => {
      const rest = attrs.replace(/\s(width|height|preserveAspectRatio)\s*=\s*("[^"]*"|'[^']*')/g, "");
      return `<svg${rest} width="${sp.w}" height="${sp.h}" preserveAspectRatio="${sp.fit ?? "xMidYMid meet"}">`;
    });
    await sp.page.setContent(`<body style="margin:0;background:transparent">${sized}</body>`);
  }

  const seek = (t) => {
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = t;
    }
    for (const s of document.querySelectorAll("svg")) {
      s.pauseAnimations?.();
      s.setCurrentTime?.(t / 1000);
    }
  };

  return {
    async frame(t, path) {
      for (const sp of sprites) {
        await sp.page.evaluate(seek, spriteTime(sp, t));
        const png = await sp.page.locator("svg").first().screenshot({ omitBackground: true });
        sp.png = `data:image/png;base64,${png.toString("base64")}`;
      }
      await main.evaluate(
        async ({ t, swaps }) => {
          for (const a of document.getAnimations()) {
            a.pause();
            a.currentTime = t;
          }
          for (const { i, png } of swaps) {
            const pre = new Image();
            pre.src = png;
            await pre.decode();
            document.querySelector(`[data-sprite="${i}"]`).setAttribute("href", png);
          }
        },
        { t, swaps: sprites.map(({ i, png }) => ({ i, png })) },
      );
      await main.locator("svg").first().screenshot({ path, omitBackground: transparent });
    },
    close: () => (shared ? Promise.all([mainCtx.close(), spriteCtx?.close()]) : browser.close()),
  };
}

// Playwright is looked for next to this file (and NODE_PATH), then in the folder the command is
// run from, then among the global npm packages: bb.mjs is often copied on its own (a skill
// folder, /tmp) while Playwright sits in the project or was installed with npm -g.
let found = null;
function loadPlaywright() {
  if (found) return found.module;
  const names = ["playwright", "playwright-core", "@playwright/test"];
  const places = [fileURLToPath(new URL(".", import.meta.url)), process.cwd(), globalModules()];
  for (const place of places.filter(Boolean)) {
    const require = createRequire(join(place, "noop.js"));
    for (const name of names) {
      try {
        found = { module: require(name), place: dirname(require.resolve(name)) };
        return found.module;
      } catch {
        // try the next package name / place
      }
    }
  }
  const err = new Error(
    "PNG の書き出しには Playwright が必要です。このファイルと同じフォルダか、コマンドを実行するフォルダで次を実行してください:\n" +
      "  npm i playwright && npx playwright install chromium",
  );
  err.code = "NO_PLAYWRIGHT";
  throw err;
}

// npm's global node_modules folder (npm root -g), or null.
function globalModules() {
  try {
    const r = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"], { encoding: "utf8", timeout: 10000, shell: process.platform === "win32" });
    const dir = r.status === 0 ? r.stdout.trim() : "";
    return dir && existsSync(dir) ? dirname(dir) : null; // createRequire looks in <dir>/node_modules
  } catch {
    return null;
  }
}

// Time on a sprite's own clock: the frame time, or the time since the overlay last became
// visible (restart: true).
function spriteTime(sp, t) {
  if (!sp.starts?.length) return t;
  const local = sp.cycle ? t % sp.cycle : t;
  const since = sp.starts.filter((s) => s <= local);
  return Math.max(0, local - (since.length ? Math.max(...since) : sp.starts[0]));
}
