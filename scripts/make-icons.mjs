// Renders the toolbar icons with Chromium. Usage: node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  const dataUrl = await page.evaluate(size => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const s = size / 128;
    ctx.scale(s, s);
    // Purple rounded square
    ctx.fillStyle = '#6d4fc2';
    ctx.beginPath();
    ctx.roundRect(4, 4, 120, 120, 28);
    ctx.fill();
    // White tag
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(30, 40);
    ctx.lineTo(70, 34);
    ctx.lineTo(100, 64);
    ctx.lineTo(64, 100);
    ctx.lineTo(34, 70);
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fill();
    // Tag hole (purple, so it reads on any toolbar color)
    ctx.fillStyle = '#6d4fc2';
    ctx.beginPath();
    ctx.arc(50, 54, size <= 16 ? 9 : 8, 0, Math.PI * 2);
    ctx.fill();
    return c.toDataURL('image/png');
  }, size);
  writeFileSync(join(outDir, `icon-${size}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
}
await browser.close();
