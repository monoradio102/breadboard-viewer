// Frame-accurate PNG capture with Playwright (used by `bb.mjs render` and `bb.mjs frames`).
//
// The animated SVG is loaded once; for each frame its CSS animations are paused at time t.
// User SVG (part sprites / overlays) runs on its own clock inside <image>, so each one is opened
// in a separate page with JavaScript disabled (its scripts never run, the network is blocked),
// paused at t, captured as a transparent PNG and swapped into the frame.
import { createRequire } from "node:module";

const SPRITE_PREFIX = "data:image/svg+xml;charset=utf-8,";

export async function openCapture(svg, { scale = 2, transparent = false } = {}) {
  // require() also finds a globally installed Playwright (NODE_PATH), which import() does not.
  const { chromium } = createRequire(import.meta.url)("playwright");
  const browser = await chromium.launch();
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
      list.push({ i, href, w: img.width.baseVal.value * k, h: img.height.baseVal.value * k, fit: img.getAttribute("preserveAspectRatio") });
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
        await sp.page.evaluate(seek, t);
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
    close: () => browser.close(),
  };
}
