// Startseite ohne geöffnete Datei: neu anlegen, Datei öffnen oder mit der Arbeitskopie weitermachen
import { useEffect, useRef, useState } from 'react'
import { canSaveInPlace, newFile, openFile, peekWorkCopy, pickAndOpen, resumeWorkCopy } from '../lib/session'
import { deDate } from '../lib/util'
import { go, useToast } from './ui'

type Work = Awaited<ReturnType<typeof peekWorkCopy>>

export function StartScreen() {
  const toast = useToast()
  const [company, setCompany] = useState('')
  const [work, setWork] = useState<Work>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { void peekWorkCopy().then(setWork) }, [])

  async function run(fn: () => Promise<string | void | null>, next = 'rechnungen') {
    setBusy(true)
    try {
      const msg = await fn()
      if (msg === '') return // Dialog abgebrochen
      if (msg) toast(msg, 'positive')
      go(next)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Das hat nicht geklappt.', 'negative')
    } finally { setBusy(false) }
  }
  async function open() {
    const r = await pickAndOpen().catch((e: unknown) => { toast(e instanceof Error ? e.message : 'Öffnen fehlgeschlagen', 'negative'); return '' })
    if (r === null) input.current?.click() // Browser ohne Dateizugriff: normales Dateifeld
    else if (r) { toast(r, 'positive'); go('rechnungen') }
  }

  return (
    <main className="start">
      <header className="start-head">
        <p className="eyebrow">Rechnungen schreiben im Browser</p>
        <h1 className="start-title">E-Rechnungen erstellen.<br />Ihre Daten bleiben bei Ihnen.</h1>
        <p className="start-lead">
          Kunden, Artikel und Rechnungen liegen in einer Datei auf Ihrem Computer, nicht auf unserem Server.
          Sie erzeugen ZUGFeRD-PDFs und XRechnungen, die den Vorgaben der E-Rechnungspflicht entsprechen.
        </p>
      </header>

      <div className="start-grid">
        {work && (
          <section className="oe-card start-card start-card--resume">
            <h2 className="card-title">Weiterarbeiten</h2>
            <p className="oe-muted">
              <strong>{work.name}</strong>, zuletzt bearbeitet am {deDate(work.at.slice(0, 10))}.
              {work.dirty && <><br /><span className="warn-text">Enthält Änderungen, die noch nicht in der Datei gespeichert sind.</span></>}
            </p>
            <button type="button" className="oe-btn oe-btn--primary" disabled={busy} onClick={() => run(async () => (await resumeWorkCopy()) || undefined)}>Weiterarbeiten</button>
          </section>
        )}

        <section className="oe-card start-card">
          <h2 className="card-title">Neu anlegen</h2>
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await newFile(company) }, 'einstellungen') }}>
            <div className="oe-field">
              <label className="oe-label" htmlFor="start-company">Ihr Firmenname</label>
              <input id="start-company" className="oe-input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Muster Design GmbH" autoComplete="organization" />
            </div>
            <button type="submit" className="oe-btn oe-btn--dark" disabled={busy}>Neue Datei anlegen</button>
          </form>
        </section>

        <section className="oe-card start-card">
          <h2 className="card-title">Datei öffnen</h2>
          <p className="oe-muted">Ihre Rechnungsdatei (<code>.sqlite</code>), eine JSON-Sicherung oder ein Rechnungsbuch vom Rechnungsgenerator auf oemedia.de.</p>
          <button type="button" className="oe-btn" disabled={busy} onClick={() => void open()}>Datei öffnen …</button>
          <input ref={input} type="file" className="oe-sr" accept=".sqlite,.sqlite3,.db,.json,application/json" tabIndex={-1}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void run(() => openFile(f)) }} />
        </section>
      </div>

      <section className="start-facts" aria-label="So funktioniert es">
        <div><h3>Lokal</h3><p>Alles läuft in Ihrem Browser. Es gibt kein Konto und keine Datenübertragung.</p></div>
        <div><h3>Eine Datei</h3><p>Eine SQLite-Datenbank, die Sie sichern, verschieben und mit jedem SQLite-Programm öffnen können.</p></div>
        <div><h3>Mit KI</h3><p>Optional: Eine KI richtet im Interview alles ein und schreibt Rechnungen für Sie. Anleitung nach dem Öffnen unter „Mit KI“.</p></div>
        <div><h3>E-Rechnung</h3><p>ZUGFeRD (EN 16931, PDF/A-3) und XRechnung 3.0, geprüft mit dem KoSIT-Validator.</p></div>
        <div><h3>{canSaveInPlace ? 'Direkt speichern' : 'Herunterladen'}</h3><p>{canSaveInPlace
          ? 'Ihr Browser kann direkt in die geöffnete Datei speichern.'
          : 'Ihr Browser speichert per Download. In Chrome oder Edge geht es direkt in die Datei.'}</p></div>
      </section>
    </main>
  )
}
