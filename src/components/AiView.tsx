// Anleitung: die Rechnungsdatei zusammen mit einer KI bedienen (lokaler MCP-Server)
import { useState } from 'react'
import { canSaveInPlace, useSession } from '../lib/session'
import { Icon, useToast } from './ui'

const MCPB = './mcp/oe-rechnung.mcpb'
const SKILL = './mcp/oe-rechnung-skill.zip'

export function AiView() {
  const s = useSession()
  const toast = useToast()
  const [os, setOs] = useState<'mac' | 'win'>(() => (/Win/.test(navigator.platform) ? 'win' : 'mac'))
  const dir = os === 'mac' ? '/Users/IHR-NAME/Documents/Rechnungen' : 'C:\\\\Users\\\\IHR-NAME\\\\Documents\\\\Rechnungen'
  const server = os === 'mac' ? '/Users/IHR-NAME/oe-rechnung-mcp/server/index.cjs' : 'C:\\\\Users\\\\IHR-NAME\\\\oe-rechnung-mcp\\\\server\\\\index.cjs'
  const config = `{
  "mcpServers": {
    "oe-rechnung": {
      "command": "node",
      "args": ["${server}", "--ordner", "${dir}", "--datei", "${s.name || 'Rechnungen.sqlite'}"]
    }
  }
}`
  return (
    <div className="stack ai">
      <header className="page-head">
        <h1 className="page-title">Mit KI arbeiten</h1>
        <p className="oe-muted lead">
          Lassen Sie sich von einer KI interviewen: Sie trägt ein, was sie über Ihr Unternehmen schon weiß, fragt nur nach dem Rest,
          legt Kunden und Leistungen an und schreibt Rechnungen. Jede Rechnung geben Sie selbst frei. Zwei Wege stehen zur Wahl:
        </p>
      </header>

      <section className="ways" aria-label="Zwei Wege zur KI">
        <div className="oe-card way">
          <p className="eyebrow">Weg 1 · mit Live-Ansicht</p>
          <h2 className="card-title">Erweiterung für Claude Desktop</h2>
          <p>Die KI arbeitet direkt mit der Datei auf Ihrem Rechner, und diese Seite zeigt jede Änderung sofort an. Herunterladen und doppelklicken; Claude Desktop fragt nach dem
            <strong> Ordner</strong> und dem <strong>Dateinamen</strong>{s.name && <> (Ihre aktuelle Datei heißt <code>{s.name}</code>)</>}.</p>
          <a className="oe-btn oe-btn--primary" href={MCPB} download>{Icon.down}Erweiterung (.mcpb)</a>
        </div>
        <div className="oe-card way">
          <p className="eyebrow">Weg 2 · ohne Installation</p>
          <h2 className="card-title">Skill für Claude</h2>
          <p>Funktioniert auch in Claude im Browser. Laden Sie die ZIP-Datei in Claude in den Einstellungen bei den Skills hoch; die Code-Ausführung muss eingeschaltet sein.
            Dann geben Sie Ihre <code>.sqlite</code>-Datei ins Gespräch und laden am Ende die aktualisierte Datei samt PDF und XRechnung wieder herunter.</p>
          <a className="oe-btn" href={SKILL} download>{Icon.down}Skill (.zip)</a>
          <p className="oe-hint">Für Claude Code: ZIP nach <code>~/.claude/skills/</code> entpacken. Die KI arbeitet dann direkt mit der Datei auf Ihrem Rechner.</p>
        </div>
      </section>

      <ol className="steps">
        <li className="oe-card">
          <h2 className="card-title">Interview starten</h2>
          <p>Schreiben Sie in Claude zum Beispiel:</p>
          <ul className="examples">
            <li>„Richte meine Rechnungsdatei ein.“</li>
            <li>„Schreib eine Rechnung an die Bäckerei Sonnenschein über 6 Stunden Beratung im Oktober.“</li>
            <li>„Welche Rechnungen sind überfällig?“</li>
          </ul>
          <p className="oe-muted">Mit der Erweiterung stehen im Plus-Menü von Claude auch die fertigen Abläufe „Firma einrichten (Interview)“ und „Rechnung schreiben (Interview)“.
            Festgeschrieben wird eine Rechnung erst, wenn Sie zustimmen. PDF und XRechnung landen im Unterordner <code>Export</code>.</p>
        </li>
        <li className="oe-card">
          <h2 className="card-title">Ergebnis übernehmen</h2>
          <p><strong>Erweiterung:</strong> Öffnen Sie dieselbe Datei hier mit „Datei öffnen“. {canSaveInPlace
            ? <>Ihr Browser übernimmt Änderungen der KI dann automatisch{s.linked && <> – für <strong>{s.name}</strong> ist das bereits aktiv <span className="live">live</span></>}.</>
            : <>Ihr Browser kann Dateien nicht beobachten; öffnen Sie die Datei nach Änderungen der KI erneut, oder nutzen Sie Chrome bzw. Edge.</>}
            {' '}Speichern Sie eigene Änderungen, bevor Sie die KI arbeiten lassen. Haben beide Seiten gleichzeitig etwas geändert, fragt die App nach.</p>
          <p><strong>Skill im Browser:</strong> Speichern Sie hier zuerst, damit die Datei aktuell ist. Laden Sie danach die Datei herunter, die Claude Ihnen zurückgibt, und öffnen Sie sie hier.
            Sie ersetzt Ihre bisherige Datei.</p>
        </li>
      </ol>

      <details className="oe-card more">
        <summary className="card-title">Andere KI-Programme (Claude Code, Cursor, LM Studio …)</summary>
        <p>Die Erweiterung ist ein ZIP-Archiv. Entpacken Sie sie (Endung in <code>.zip</code> ändern) und tragen Sie den Server in die MCP-Konfiguration Ihres Programms ein. Benötigt Node.js ab Version 18.</p>
        <div className="oe-segmented os" role="radiogroup" aria-label="Betriebssystem">
          <label><input type="radio" name="os" checked={os === 'mac'} onChange={() => setOs('mac')} /><span>macOS / Linux</span></label>
          <label><input type="radio" name="os" checked={os === 'win'} onChange={() => setOs('win')} /><span>Windows</span></label>
        </div>
        <pre className="code"><code>{config}</code></pre>
        <button type="button" className="oe-btn oe-btn--sm" onClick={() => { void navigator.clipboard.writeText(config).then(() => toast('Konfiguration kopiert.', 'positive')) }}>{Icon.copy}Kopieren</button>
      </details>

      <section className="oe-panel">
        <h2 className="card-title">Datenschutz</h2>
        <p>Erweiterung und Skill-Programm lesen und schreiben nur Ihre Rechnungsdatei und den Export-Ordner und senden nichts ins Internet, auch nicht an uns.
          Was die Werkzeuge an die KI zurückgeben (z. B. Kundenanschriften und Beträge), verarbeitet aber das KI-Modell, mit dem Sie arbeiten. Bei Claude ist das Anthropic.
          Beim Skill im Browser liegt zusätzlich die ganze Datei für die Dauer des Gesprächs in der abgeschotteten Arbeitsumgebung von Claude.
          Wer das vermeiden möchte, nutzt ein lokales Modell, etwa über LM Studio.</p>
      </section>
    </div>
  )
}
