# Design-Skills für Claude Code

Diese Skills lädt Claude Code automatisch, wenn in diesem Repository gearbeitet wird (Ordner `.claude/skills/`).
Sie sind unverändert aus öffentlichen, MIT-lizenzierten Quellen kopiert; die jeweilige `LICENSE` liegt im Ordner.
Das eigene Designsystem der App steht in [`/DESIGN.md`](../../DESIGN.md) – es hat Vorrang vor allgemeinen Regeln.

| Ordner | Inhalt | Quelle (Stand) |
|---|---|---|
| `apple-hig-ios/` | Apple Human Interface Guidelines fürs iPhone: Safe Areas, 44-pt-Tippflächen, Navigation, Dynamic Type, Dark Mode, Barrierefreiheit, Haptik | [ehmo/platform-design-skills](https://github.com/ehmo/platform-design-skills) `skills/ios` (dc2be82) |
| `web-design-rules/` | Web-Plattform-Regeln: WCAG, semantisches HTML, responsives Layout, Performance | [ehmo/platform-design-skills](https://github.com/ehmo/platform-design-skills) `skills/web` (dc2be82) |
| `web-interface-guidelines/` | Vercel Web Interface Guidelines als Prüfliste (lokal, ohne Netz) | [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) `command.md` (e3d624b) |
| `taste-skill/` | „Anti-Slop“-Regeln: edle Abstände, reduzierte Paletten, Typografie, dezente Micro-Interactions | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) `skills/taste-skill` (ce26fc2) |

Aktualisieren: Repository klonen und den jeweiligen Ordner erneut hierher kopieren.

Nicht enthalten, weil sie ausführbare Programme bzw. große Datensätze mitbringen: Impeccable (lädt ein Hilfsprogramm nach),
UI/UX Pro Max (Python-Skripte, ~4 MB). Beide lassen sich bei Bedarf pro Sitzung installieren.
