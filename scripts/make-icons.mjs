// Erzeugt die PNG-Symbole in icons/ aus icons/icon.svg (Chromium über Playwright).
//   node scripts/make-icons.mjs
// Das App-Symbol ist der Entwurf „13 Scheibe“ aus brand/logos-gym/ (randloses Quadrat, iOS rundet die Ecken selbst).
// Die PNG-Dateien sind voll deckend (kein transparenter Rand), das Zeichen liegt innerhalb der Sicherheitszone für „maskable“.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(path.join(ROOT, 'tests/emulator/package.json'))('playwright');
const svg = fs.readFileSync(path.join(ROOT, 'icons/icon.svg'), 'utf8');
const JOBS = [['icon-152', 152], ['icon-167', 167], ['icon-180', 180], ['icon-192', 192], ['icon-512', 512], ['icon-maskable-512', 512]];

const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH ? {} : { executablePath: '/opt/pw-browsers/chromium' });
for (const [name, size] of JOBS) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;background:#000"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}" style="display:block"></body>`);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(ROOT, 'icons', name + '.png'), clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  console.log(name + '.png');
}
await browser.close();
