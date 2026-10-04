// Renders the Chrome Web Store icon: 128x128 with the artwork in the middle 96x96,
// as the store's image guidelines ask. Usage: node scripts/make-store-icon.mjs
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'store', 'icon-128.png');

const browser = await chromium.launch();
const page = await browser.newPage();
const dataUrl = await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  // Same artwork as the toolbar icon (drawn on a 128 grid), scaled into the 96x96 safe area.
  ctx.translate(16, 16);
  ctx.scale(96 / 120, 96 / 120);
  ctx.translate(-4, -4);
  ctx.fillStyle = '#6d4fc2';
  ctx.beginPath();
  ctx.roundRect(4, 4, 120, 120, 28);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(30, 40);
  ctx.lineTo(70, 34);
  ctx.lineTo(100, 64);
  ctx.lineTo(64, 100);
  ctx.lineTo(34, 70);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  ctx.fillStyle = '#6d4fc2';
  ctx.beginPath();
  ctx.arc(50, 54, 8, 0, Math.PI * 2);
  ctx.fill();
  return c.toDataURL('image/png');
});
writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
await browser.close();
console.log(`Wrote ${out}`);
