// Frame-accurate PNG capture with Playwright (used by `bb.mjs render` and `bb.mjs frames`).
//
// The animated SVG is loaded once; for each frame its CSS animations are paused at time t.
// User SVG (part sprites / overlays) runs on its own clock inside <image>, so each one is opened
// in a separate page with JavaScript disabled (its scripts never run, the network is blocked),
// paused at t, captured as a transparent PNG and swapped into the frame.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

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

// True when Playwright and its Chromium are installed (otherwise PNGs go through tools/raster.mjs).
export function hasBrowser() {
  try {
    const path = loadPlaywright().chromium.executablePath();
    return Boolean(path) && existsSync(path);
  } catch {
    return false;
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

function loadPlaywright() {
  // require() also finds a globally installed Playwright (NODE_PATH), which import() does not.
  const require = createRequire(import.meta.url);
  for (const name of ["playwright", "playwright-core", "@playwright/test"]) {
    try {
      return require(name);
    } catch {
      // try the next package name
    }
  }
  const err = new Error(
    "PNG の書き出しには Playwright が必要です。このファイルと同じフォルダで次を実行してください:\n" +
      "  npm i playwright && npx playwright install chromium",
  );
  err.code = "NO_PLAYWRIGHT";
  throw err;
}

// Time on a sprite's own clock: the frame time, or the time since the overlay last became
// visible (restart: true).
function spriteTime(sp, t) {
  if (!sp.starts?.length) return t;
  const local = sp.cycle ? t % sp.cycle : t;
  const since = sp.starts.filter((s) => s <= local);
  return Math.max(0, local - (since.length ? Math.max(...since) : sp.starts[0]));
}
