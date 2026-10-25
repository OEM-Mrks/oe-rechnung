# Rechnungen – E-Rechnungen lokal im Browser

Rechnungsprogramm mit Kundenstamm und Artikeln, das komplett im Browser läuft. Es gibt keinen Server und kein Konto:
Alle Daten liegen in **einer SQLite-Datei auf dem Computer des Nutzers**. Die Seite liefert nur die Oberfläche
(statisch über GitHub Pages).

## Funktionen

- **Rechnungen** mit Netto- oder Bruttopreisen, mehreren Steuersätzen, Positions- und Gesamtrabatt,
  Kleinunternehmer (§ 19 UStG) und Reverse Charge, Leistungsdatum oder -zeitraum, GiroCode
- **E-Rechnung**
  - ZUGFeRD 2 / Factur-X, Profil EN 16931: PDF/A-3b mit eingebetteter `factur-x.xml`
  - XRechnung 3.0 (CII-Syntax) als XML-Datei, z. B. für Behörden mit Leitweg-ID
- **Kundenstamm** mit fortlaufenden Kundennummern; neue Kunden werden beim Festschreiben automatisch übernommen
- **Artikel und Leistungen**, per Auswahl in Rechnungspositionen übernehmen
- **Festschreiben**: beim ersten Download erhält die Rechnung ihre Nummer und wird gesperrt (in der Datenbank per Trigger
  abgesichert). Entsperren nur mit Begründung, alles steht im Protokoll (`events`)
- **Rechnungsjournal** als PDF, Status offen / bezahlt / storniert, Überfällig-Anzeige
- **Daten**: SQLite-Datei öffnen und speichern (Chrome/Edge direkt in die Datei, andere Browser per Download),
  automatische Arbeitskopie im Browser (IndexedDB), JSON-Sicherung, Import des alten Rechnungsbuchs vom
  Rechnungsgenerator auf oemedia.de

## Mit KI arbeiten (lokaler MCP-Server)

Eine KI (Claude Desktop, Claude Code, Cursor, LM Studio …) kann die Rechnungsdatei über einen **lokalen MCP-Server** bedienen,
im Interview-Stil: Sie trägt ein, was sie über das Unternehmen schon weiß, fragt nur nach dem Rest, legt Kunden und Leistungen an,
schreibt Entwürfe und schreibt sie erst nach ausdrücklicher Freigabe fest. Der Server läuft auf dem Rechner des Nutzers und
liest und schreibt nur die gewählte Datei und deren Unterordner `Export`; es gibt keinen Server bei uns.

- **Claude Desktop:** `oe-rechnung.mcpb` von der Seite „Mit KI“ herunterladen und doppelklicken (Ordner und Dateiname wählen)
- **Andere Programme:** `.mcpb` entpacken (ZIP) und `node server/index.cjs --ordner <Ordner> --datei <Name>.sqlite` eintragen
- **Werkzeuge:** `status`, `firma_lesen`, `firma_speichern`, `vorgaben_speichern`, `kunden_suchen`, `kunde_speichern`,
  `artikel_suchen`, `artikel_speichern`, `rechnungen_auflisten`, `rechnung_anzeigen`, `rechnung_entwurf`, `rechnung_festschreiben`,
  `rechnung_exportieren` (ZUGFeRD-PDF, PDF, XRechnung), `rechnung_status_setzen`, `entwurf_loeschen`
- **Interview-Vorlagen (Prompts):** `einrichtung`, `rechnung_schreiben`; dazu Server-Anweisungen für den Interview-Stil
- **Live-Ansicht:** Ist dieselbe Datei in der Web-App geöffnet (Chrome/Edge), übernimmt die App Änderungen der KI alle 2 Sekunden
  automatisch. Haben beide Seiten ungespeicherte Änderungen, fragt die App, welche Fassung gilt.

### Alternativ: Skill

Dieselben Werkzeuge gibt es als **Skill** (`/mcp/oe-rechnung-skill.zip`): `SKILL.md` mit dem Interview-Ablauf, ein
Befehlszeilen-Programm (`scripts/oe-rechnung.cjs`, eine Datei ohne Abhängigkeiten, Node.js ab 18, kein Internet nötig) und eine
automatisch erzeugte Werkzeug-Referenz. Damit funktioniert es ohne Installation auch in Claude im Browser: Der Nutzer gibt seine
`.sqlite`-Datei ins Gespräch und lädt am Ende die aktualisierte Datei samt PDF und XRechnung herunter. In Claude Code genügt es,
das ZIP nach `~/.claude/skills/` zu entpacken.

Node.js in Claudes Sandbox: Die [Doku zur Code-Ausführung](https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool)
garantiert nur Python 3.11. Anthropics eigene Skills (Word, PowerPoint) nutzen dort aber `node`. Der Skill prüft Node daher als
ersten Schritt und verweist sonst auf die Web-App bzw. die Erweiterung. Offline getestet in `node:18-slim` mit `--network none`;
am 25.10.2026 in claude.ai ausprobiert: Node v22.23.4 vorhanden, Interview von halbleerer Datei bis ZUGFeRD-PDF und XRechnung.

### Aufbau

| Datei | Inhalt |
|---|---|
| `mcp/core.ts` | Werkzeuge, Interview-Vorlagen, Dateizugriff (gemeinsam für beide Wege) |
| `mcp/server.ts` | MCP-Server (stdio) |
| `mcp/cli.ts` | Befehlszeile für den Skill: `--datei X <werkzeug> -` mit JSON über die Standardeingabe |
| `mcp/skill/SKILL.md` | Anleitung für die KI (Interview-Stil, Abläufe, Ergebnis ausliefern) |
| `mcp/build.mjs` | Bündelt mit esbuild, erzeugt `.mcpb` (via `mcpb pack`) und Skill-ZIP; Teil von `npm run build` |

`scripts/mcp.test.ts` und `scripts/skill.test.ts` testen beide Bündel von der leeren Datei bis zum Export.

## Technik

TypeScript, React 19, Vite. SQLite über [sql.js](https://github.com/sql-js/sql.js) (WebAssembly),
PDF mit jsPDF + jspdf-autotable + pdf-lib, QR-Code mit qrcode-generator. Alle Bibliotheken werden mitgebündelt,
es gibt keine Aufrufe an fremde Server (Content-Security-Policy im Build).

| Pfad | Inhalt |
|---|---|
| `src/lib/calc.ts` | Rechenlogik (Zeilen netto, Steuergruppen, Rabatte nach EN 16931) |
| `src/lib/einvoice/cii.ts` | CII-XML für ZUGFeRD (EN 16931) und XRechnung 3.0 |
| `src/lib/pdf/` | Rechnungs-PDF, PDF/A-3-Nachbearbeitung, Journal |
| `src/lib/db/` | SQLite-Schema, Zugriff (`repo.ts`), JSON-Import/-Export |
| `src/lib/session.ts` | geöffnete Datei, Speichern, Arbeitskopie |
| `src/components/` | Oberfläche |

## Entwicklung

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # Unit-Tests
npm run build    # MCP-Paket + Web-App nach dist/
```

## E-Rechnungen prüfen

`npm run samples` schreibt fünf Beispielfälle (Standard, Brutto mit Rabatten, Kleinunternehmer, Reverse Charge AT,
sofort fällig mit 0 %) als XRechnung-XML, ZUGFeRD-XML und ZUGFeRD-PDF nach `samples/`. Geprüft am 24.10.2026:

- KoSIT-Validator 1.6.3 mit Konfiguration XRechnung 3.0.2 (2026-08-31): alle XRechnungen und ZUGFeRD-XMLs
  *acceptable*, ohne Fehler und ohne Warnungen
- Mustang 2.26.0 (mit veraPDF): alle PDFs gültig als PDF/A-3 und ZUGFeRD EN 16931

```bash
docker run --rm -v "$PWD":/w -w /w eclipse-temurin:21-jre java -jar validator.jar -s kosit/scenarios.xml -r kosit -o report samples/*.xml
docker run --rm -v "$PWD":/w -w /w eclipse-temurin:21-jre java -jar mustang.jar --action validate --source samples/standard_zugferd.pdf
```

## Veröffentlichen

GitHub Actions baut bei jedem Push auf `main` und veröffentlicht auf GitHub Pages (`.github/workflows/pages.yml`).
Einmalig: *Settings → Pages → Source: GitHub Actions*. Für eine eigene Subdomain eine Datei `public/CNAME` mit dem
Hostnamen anlegen und beim DNS-Anbieter einen CNAME auf `<benutzer>.github.io` setzen.

## Hinweise

Keine Steuerberatung. Die App ist kein zertifiziertes Buchhaltungsprogramm; für die Aufbewahrung (8 Jahre für
Rechnungen) und Sicherung der Datei ist der Nutzer selbst verantwortlich.
