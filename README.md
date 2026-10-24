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
npm run build    # nach dist/
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
