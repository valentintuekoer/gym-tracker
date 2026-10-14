// Baut die Liquid-Glass-Demo zu EINER Datei (CSS und JavaScript eingebettet), die sich ohne Server öffnen lässt –
// ES-Module funktionieren auf file:// nicht. Benötigt Node und Internet für `npx esbuild` (nur zum Bauen).
//
//   node scripts/build-liquid-glass.mjs                      → liquid-glass/liquid-glass-demo.html (vollständige Seite)
//   node scripts/build-liquid-glass.mjs --fragment datei     → nur Titel, Stil, Inhalt, Skript (für Einbettung ohne <html>/<head>/<body>)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'liquid-glass');
const args = process.argv.slice(2);
const fragmentOut = args.includes('--fragment') ? path.resolve(args[args.indexOf('--fragment') + 1]) : null;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const js = execFileSync('npx', ['-y', 'esbuild@0.25.10', '--bundle', '--format=iife', '--target=es2022', path.join(ROOT, 'demo/demo.js')], { encoding: 'utf8', maxBuffer: 16e6 })
  .replace(/<\/script/gi, '<\\/script');
const css = read('src/liquid-glass.css') + '\n' + read('demo/demo.css');
const html = read('index.html');

const title = /<title>[\s\S]*?<\/title>/.exec(html)[0];
const body = /<body>([\s\S]*)<\/body>/.exec(html)[1].trim();
const description = /<meta name="description"[^>]*>/.exec(html)[0];

if (fragmentOut) {
  fs.writeFileSync(fragmentOut, `${title}\n<meta name="claude:viewport-fit-sides" content="cover">\n<style>\n${css}\n</style>\n${body}\n<script>\n${js}\n</script>\n`);
  console.log('Fragment geschrieben:', fragmentOut, Math.round(fs.statSync(fragmentOut).size / 1024) + ' KB');
} else {
  const out = path.join(ROOT, 'liquid-glass-demo.html');
  fs.writeFileSync(out, `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
${title}
${description}
<link rel="icon" href="data:,">
<!-- Erzeugt mit: node scripts/build-liquid-glass.mjs – Quellen liegen in liquid-glass/src und liquid-glass/demo -->
<style>
${css}
</style>
</head>
<body>
${body}
<script>
${js}
</script>
</body>
</html>
`);
  console.log('Geschrieben:', out, Math.round(fs.statSync(out).size / 1024) + ' KB');
}
