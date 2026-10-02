// Renders PWA/OG PNG assets from inline SVG with the pre-installed Chromium (no native image deps).
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = path.join(root, "web", "public");
const brand = path.join(root, "branding");
fs.mkdirSync(path.join(pub, "icons"), { recursive: true });

const star = (fill, dot, pad = 0) => `<path transform="translate(${pad} ${pad}) scale(${(64 - 2 * pad) / 64})" d="M32 6 L36.5 27.5 L58 32 L36.5 36.5 L32 58 L27.5 36.5 L6 32 L27.5 27.5 Z" fill="${fill}"/><circle cx="32" cy="32" r="${3.2 * (64 - 2 * pad) / 64}" fill="${dot}"/>`;
const iconSvg = (size, maskable) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}"><rect width="64" height="64" rx="${maskable ? 0 : 14}" fill="#0f1420"/>${star("#ffffff", "#0f1420", maskable ? 12 : 6)}</svg>`;
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <rect width="1200" height="630" fill="#0f1420"/>
  <g transform="translate(96 215) scale(3.1)"><circle cx="32" cy="32" r="30" fill="none" stroke="#9fb3ff" stroke-width="2" opacity=".4"/>${star("#e8ecf5", "#0f1420")}</g>
  <text x="340" y="300" font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-size="84" font-weight="700" fill="#e8ecf5" letter-spacing="-2">Northstar</text>
  <text x="344" y="352" font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-size="24" fill="#a3acbf" letter-spacing="6">PERSONAL STRATEGY OS</text>
  <text x="344" y="430" font-family="'Hiragino Sans', 'Noto Sans JP', sans-serif" font-size="40" fill="#ffffff">人生にも、経営戦略を。</text>
  <text x="344" y="480" font-family="'Hiragino Sans', 'Noto Sans JP', sans-serif" font-size="22" fill="#a3acbf">「忙しい。でも何も進んでない。」を終わらせる。</text>
</svg>`;

const exe = process.env.PLAYWRIGHT_CHROMIUM_PATH || (fs.existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" : undefined);
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: exe });
const page = await browser.newPage();
async function render(svg, w, h, out) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
  console.log("wrote", path.relative(root, out));
}
await render(iconSvg(192, false), 192, 192, path.join(pub, "icons", "icon-192.png"));
await render(iconSvg(512, false), 512, 512, path.join(pub, "icons", "icon-512.png"));
await render(iconSvg(512, true), 512, 512, path.join(pub, "icons", "maskable-512.png"));
await render(iconSvg(180, false), 180, 180, path.join(pub, "apple-touch-icon.png"));
await render(ogSvg, 1200, 630, path.join(pub, "og-image.png"));
fs.copyFileSync(path.join(pub, "og-image.png"), path.join(brand, "og-image.png"));
fs.copyFileSync(path.join(pub, "icons", "icon-512.png"), path.join(brand, "pwa-icon-512.png"));
fs.copyFileSync(path.join(pub, "icons", "maskable-512.png"), path.join(brand, "pwa-maskable-512.png"));
await browser.close();
