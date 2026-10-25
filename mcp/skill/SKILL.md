---
name: oe-rechnung
description: Rechnungen und E-Rechnungen (ZUGFeRD-PDF, XRechnung) im Interview mit dem Nutzer erstellen und seine Rechnungsdatei pflegen (Firmenangaben, Kunden, Artikel, Rechnungen, Zahlungsstatus). Verwenden, wenn der Nutzer eine Rechnung schreiben, seine Firma für Rechnungen einrichten, Kunden oder Leistungen anlegen, offene/überfällige Rechnungen prüfen oder eine Rechnungsdatei (.sqlite) aus der Web-App oe-rechnung bearbeiten möchte.
---

# Rechnungen im Interview (oe-rechnung)

Die Rechnungsdatei des Nutzers ist eine SQLite-Datei aus der Web-App https://oem-mrks.github.io/oe-rechnung/.
Du bearbeitest sie ausschließlich mit dem mitgelieferten Programm `scripts/oe-rechnung.cjs`. Es enthält dieselben
Regeln wie die App: fortlaufende Nummern, Sperre festgeschriebener Rechnungen, gültige E-Rechnungen nach EN 16931
und XRechnung 3.0.

**Niemals** die Datei direkt mit `sqlite3`, Python oder anderen Mitteln verändern. Nur lesen ist erlaubt, schreiben nur über das Programm.

## 1. Vorbereitung

1. `node --version` ausführen. Nötig ist Node.js 18 oder neuer. Fehlt Node, dem Nutzer sagen: „In dieser Umgebung kann ich das Rechnungsprogramm nicht ausführen. Nutzen Sie die Web-App oder die Erweiterung für Claude Desktop (Seite „Mit KI“).“ Dann aufhören.
2. Die Rechnungsdatei finden:
   - **Hochgeladen** (in claude.ai unter `/mnt/user-data/attachments/…`, anderswo z. B. `/mnt/user-data/uploads/`): eine `.sqlite`-Datei. Kopiere sie in ein beschreibbares Arbeitsverzeichnis und arbeite nur mit der Kopie, Uploads sind oft schreibgeschützt.
   - **Lokal** (z. B. Claude Code auf dem Rechner des Nutzers): den Pfad erfragen oder nach `*.sqlite` mit „Rechnung“ im Namen suchen und den Fund bestätigen lassen.
   - **Keine Datei:** Frag, ob eine neue angelegt werden soll. Dann nimm einen neuen Pfad, z. B. `Rechnungen.sqlite` im Arbeitsverzeichnis; das Programm legt sie beim ersten Speichern an.
   - Eine JSON-Sicherung kann das Programm nicht öffnen. Bitte den Nutzer, sie in der Web-App zu öffnen und als Datenbank (`.sqlite`) zu speichern.
3. Kurzbefehl festlegen und den Überblick holen:

```bash
R="node <Pfad dieses Skills>/scripts/oe-rechnung.cjs --datei <Pfad zur .sqlite>"
$R status
```

## 2. Aufruf

Jedes Werkzeug bekommt seine Parameter als JSON. Wegen Anführungszeichen und Umlauten die Parameter immer über die Standardeingabe übergeben:

```bash
$R firma_speichern - <<'JSON'
{"name": "Bäckerei Sonnenschein GmbH", "strasse": "Marktplatz 3", "plz": "50667", "ort": "Köln"}
JSON
```

- Antworten sind deutscher Text, oft mit einem JSON-Block. Fehler (Exit-Code 1) erklären, was fehlt oder falsch ist. Diese Fehler nimmst du ernst und fragst beim Nutzer nach.
- Alle Werkzeuge und Parameter: [reference/werkzeuge.md](reference/werkzeuge.md) oder `$R werkzeuge`.
- PDF und XRechnung schreibt `rechnung_exportieren` in den Ordner `Export` neben der Datei. Mit `--export <Ordner>` vor dem Werkzeugnamen lässt sich ein anderer Ordner wählen.

## 3. So führst du das Interview

- **Erst schauen, dann fragen:** `status` zeigt, welche Firmenangaben fehlen, und listet Entwürfe sowie offene und überfällige Rechnungen.
- **Bekanntes vorschlagen:** Was du über den Nutzer und sein Unternehmen schon weißt (aus dem Gespräch, deinem Gedächtnis, hochgeladenen Dokumenten wie Briefköpfen, Signaturen, alten Rechnungen), legst du als Vorschlag vor und lässt es bestätigen. Frag nicht nach Dingen, die du schon weißt.
- **Nie erfinden:** Steuernummer, USt-IdNr., IBAN und BIC nur übernehmen, wenn der Nutzer sie nennt oder sie in einem Dokument von ihm stehen.
- **Wenig auf einmal:** Pro Nachricht höchstens zwei Fragen, freundlich und in Alltagssprache. Speichere jede Antwort sofort (Teil-Updates sind erwünscht) und frag dann nach dem, was die Antwort als fehlend meldet.
- **Deutsch schreiben ist erlaubt:** Beträge wie `1.234,50`, Daten wie `24.10.2026`.
- **Freigabe vor dem Festschreiben:** Zeig vor `rechnung_festschreiben` eine übersichtliche Zusammenfassung: Kunde, Positionen, Netto, USt, Gesamt, Fälligkeit. Warte auf ein klares „Ja“. Festgeschriebene Rechnungen lassen sich nicht mehr ändern, nur stornieren.
- **Keine Steuerberatung:** Bei Fragen wie „Bin ich Kleinunternehmer?“ die Möglichkeiten erklären und auf den Steuerberater verweisen.

### Ablauf A: Firma einrichten

1. `status` und `firma_lesen` aufrufen.
2. Bekannte Angaben (Name, Anschrift, E-Mail, Telefon, Website) als Vorschlag zeigen, bestätigen lassen, mit `firma_speichern` sichern.
3. Fehlendes erfragen, in dieser Reihenfolge: Steuernummer oder USt-IdNr.; IBAN (und optional BIC, Bank); Ansprechpartner und Telefon (nötig für XRechnungen an Behörden).
4. Mit `vorgaben_speichern` klären: Kleinunternehmer nach § 19 UStG ja/nein, übliches Zahlungsziel (Standard 14 Tage), Preise netto oder brutto.
5. Anbieten, die wichtigsten Kunden (`kunde_speichern`) und wiederkehrenden Leistungen (`artikel_speichern`) gleich anzulegen.
6. Kurze Zusammenfassung und Hinweis zur Datei (siehe Abschnitt 4).

### Ablauf B: Rechnung schreiben

1. `status`. Fehlen Firmenangaben, zuerst Ablauf A.
2. **Kunde:** mit `kunden_suchen` finden. Ist er neu, die Anschrift erfragen und mit `kunde_speichern` anlegen. Bei Behörden nach der Leitweg-ID fragen und die E-Mail-Adresse für Rechnungen erfragen.
3. **Leistungen:** `artikel_suchen` nach passenden Artikeln. Menge, Einheit, Preis und Steuersatz klären, dazu das Leistungsdatum bzw. den Zeitraum.
4. **Entwurf:** `rechnung_entwurf` mit `kunde_id` und `positionen` (bei Artikeln `artikel_id` angeben). Die Antwort enthält Summen und `fehlt` je Format; Fehlendes erfragen und den Entwurf mit seiner `id` ergänzen.
5. **Freigabe:** Zusammenfassung zeigen und Zustimmung abwarten, dann `rechnung_festschreiben`.
6. **Export:** `rechnung_exportieren` mit `format: "zugferd"` (Standard, PDF mit eingebetteter E-Rechnung). `"xrechnung"` zusätzlich, wenn der Kunde eine Behörde ist (Leitweg-ID) oder es wünscht.
7. Dateien ausliefern (Abschnitt 4).

### Ablauf C: Zahlungen und Überblick

- Offene und überfällige Rechnungen stehen in `status`; Details liefern `rechnungen_auflisten` (Filter `status`, `jahr`) und `rechnung_anzeigen`.
- Zahlungseingang: `rechnung_status_setzen` mit `status: "bezahlt"` und `bezahlt_am`.
- Fehlerhafte, schon verschickte Rechnung: `status: "storniert"` setzen, dann eine neue Rechnung schreiben. Nicht verschickte Entwürfe darf `entwurf_loeschen` entfernen.

## 4. Ergebnis ausliefern (wichtig)

Die Arbeit steckt in der Datei. Wird sie nicht gesichert, ist sie weg.

- **Hochgeladene Datei:** Nach jeder abgeschlossenen Aufgabe die bearbeitete `.sqlite` und neue Exporte in den Ausgabeordner kopieren (z. B. `/mnt/user-data/outputs/`) und dem Nutzer zum Herunterladen geben. Unter demselben Namen wie das Original, damit er die alte Datei ersetzt. Dazu der Hinweis: „Bitte diese Datei herunterladen und künftig verwenden; in der Web-App mit ‚Datei öffnen‘ laden.“
- **Lokale Datei:** Sie ist bereits aktualisiert. Den Pfad der Exporte nennen. Ist die Datei gleichzeitig in der Web-App geöffnet, zeigen Chrome und Edge die Änderungen automatisch.

## 5. Datenschutz

Das Programm sendet nichts ins Internet. Es liest und schreibt nur die genannte Datei und den Export-Ordner.
Was du liest, verarbeitest du als KI-Modell; teile Kundendaten nicht über das Gespräch hinaus.
