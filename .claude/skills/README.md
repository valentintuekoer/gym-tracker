# Design-Skills und Werkzeuge für Claude Code

Claude Code lädt die Skills in `.claude/skills/` automatisch, wenn in diesem Repository gearbeitet wird.
Das eigene Designsystem der App steht in [`/DESIGN.md`](../../DESIGN.md) – es hat Vorrang vor allgemeinen Regeln;
die projektweiten Regeln (Anti-Slop, Typografie, Marketing vs. App, Mobile-First, WCAG AA) stehen in
[`design-system/SKILL.md`](design-system/SKILL.md).

## Eigene Richtlinie

| Ordner | Inhalt |
|---|---|
| `design-system/` | Verbindliche Projekt-Richtlinie + Arbeitsablauf mit Sichtprüfung + Wegweiser, welcher Skill wofür |

## Eingebundene Skills

Unverändert aus öffentlichen Quellen kopiert (Lizenz im jeweiligen Ordner bzw. im Quell-Repository).

| Ordner | Inhalt | Quelle |
|---|---|---|
| `impeccable/` | Design, Kritik, Politur, Detektor für Anti-Patterns, Live-Iteration im Browser. Der Launcher `scripts/impeccable` lädt beim ersten Aufruf ein versionsfestes Hilfsprogramm von den GitHub-Releases des Projekts und prüft es gegen eine SHA-256-Datei | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) (Apache-2.0) |
| `animate/`, `animation-performance/`, `animation-vocabulary/`, `apple-design/`, `break-ui/`, `emil-design-eng/`, `find-animation-opportunities/`, `improve-animations/`, `mobile-native/`, `review-animations/`, `prototype/` | Mikro-Interaktionen, Federn, Gesten, Performance von Animationen, „fühlt sich nativ an“, Worst-Case-Test für UI | [emilkowalski/skill](https://github.com/emilkowalski/skill) (MIT) |
| `web-design-guidelines/` | Prüfung gegen die Web Interface Guidelines; **lädt die aktuellen Regeln bei jeder Prüfung live** von GitHub (die gepinnte Offline-Fassung ist `web-interface-guidelines/`) | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) |
| `shadcn/` | shadcn/ui: Komponenten hinzufügen, Presets, Registry. Gilt nur für React-/Tailwind-Projekte mit `components.json` – diese App ist Vanilla-JS | [shadcn-ui/ui](https://github.com/shadcn-ui/ui) (MIT) |
| `apple-hig-ios/` | Apple Human Interface Guidelines fürs iPhone | [ehmo/platform-design-skills](https://github.com/ehmo/platform-design-skills) `skills/ios` (dc2be82, MIT) |
| `web-design-rules/` | Web-Plattform-Regeln: WCAG, semantisches HTML, responsives Layout, Performance | [ehmo/platform-design-skills](https://github.com/ehmo/platform-design-skills) `skills/web` (dc2be82, MIT) |
| `web-interface-guidelines/` | Vercel Web Interface Guidelines als Prüfliste (lokal, ohne Netz) | [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) `command.md` (e3d624b, MIT) |
| `taste-skill/` | „Anti-Slop“-Regeln: edle Abstände, reduzierte Paletten, Typografie | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) `skills/taste-skill` (ce26fc2, MIT) |

Quelle und Prüfsumme der mit `npx skills` installierten Skills stehen in [`/skills-lock.json`](../../skills-lock.json).
Aktualisieren: `npx skills update` (oder `npx skills experimental_install`, um sie aus der Lock-Datei wiederherzustellen).

## Plugin und MCP-Server (in `.claude/settings.json` bzw. `.mcp.json`)

- **`frontend-design`** (Plugin aus dem Anthropic-Verzeichnis, Projekt-Einstellung `enabledPlugins`): Richtung und Mut für unverwechselbare Oberflächen.
  Claude Code fragt beim ersten Öffnen des Projekts, ob das Plugin installiert werden soll.
- **Playwright-MCP** (`.mcp.json`, [`@playwright/mcp`](https://github.com/microsoft/playwright-mcp), Apache-2.0, auf eine Version festgelegt):
  Browser-Werkzeuge (`browser_navigate`, `browser_take_screenshot`, `browser_snapshot`, …), damit Claude die gerenderte Oberfläche ansehen kann.
  Claude Code fragt vor dem ersten Start nach Freigabe. Ohne vorinstalliertes Chromium einmal `npx playwright install chromium` ausführen.

## Sichtprüfung per Skript

```
cd tests/emulator && npm install      # einmalig (Playwright)
node scripts/screenshots.mjs [Ordner] [--wide] [--routes=#/,#/history]
```

Startet die App lokal im Gastmodus, speichert Screenshots (Phone, hell + dunkel; mit `--wide` auch Tablet) und meldet
seitliches Scrollen, Tippflächen unter 44 pt, Buttons ohne Namen und Skriptfehler (`report.json`). Der Ordner `screenshots/` ist git-ignoriert.

Nicht eingebunden: UI/UX Pro Max (Python-Skripte, ~4 MB) – lässt sich bei Bedarf pro Sitzung installieren.
