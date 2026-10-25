import { useEffect, useRef, useState } from 'react'
import { AiView } from './components/AiView'
import { ArticleList } from './components/ArticleList'
import { CustomerList } from './components/CustomerList'
import { InvoiceEditor } from './components/InvoiceEditor'
import { InvoiceList } from './components/InvoiceList'
import { SettingsView } from './components/SettingsView'
import { StartScreen } from './components/StartScreen'
import { ConfirmProvider, go, Icon, ToastProvider, useConfirm, useRoute, useToast } from './components/ui'
import { close, downloadJson, onExternalChange, relink, resolveConflict, save, saveAs, useSession } from './lib/session'

const NAV = [['rechnungen', 'Rechnungen'], ['kunden', 'Kunden'], ['artikel', 'Artikel'], ['einstellungen', 'Einstellungen'], ['ki', 'Mit KI']] as const

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <Main />
      </ConfirmProvider>
    </ToastProvider>
  )
}

function Main() {
  const s = useSession()
  const route = useRoute()
  const toast = useToast()
  useEffect(() => onExternalChange((msg) => toast(msg, 'positive')), [toast])
  if (!s.repo) return <StartScreen />
  const [page, arg] = route
  const section = page === 'rechnung' ? 'rechnungen' : page || 'rechnungen'
  return (
    <div className="shell">
      <TopBar section={section} />
      <main className="page" key={s.external}>
        <FileNotices />
        {page === 'rechnung' && arg ? <InvoiceEditor key={arg} id={Number(arg)} />
          : section === 'kunden' ? <CustomerList />
          : section === 'artikel' ? <ArticleList />
          : section === 'einstellungen' ? <SettingsView />
          : section === 'ki' ? <AiView />
          : <InvoiceList />}
      </main>
    </div>
  )
}

// Hinweise zur Verbindung mit der Datei: Konflikt mit Änderungen von außen, Zugriff nach Neuladen erneuern
function FileNotices() {
  const s = useSession()
  const toast = useToast()
  const act = (p: Promise<string>) => p.then((m) => m && toast(m, 'positive')).catch((e: unknown) => toast(e instanceof Error ? e.message : 'Das hat nicht geklappt.', 'negative'))
  if (s.conflict) return (
    <div className="notice notice--strong file-notice" role="alert">
      <p><strong>Die Datei wurde außerhalb geändert</strong>, zum Beispiel von der KI, während Sie hier ungespeicherte Änderungen haben.</p>
      <div className="oe-toolbar">
        <button type="button" className="oe-btn oe-btn--sm oe-btn--primary" onClick={() => void act(resolveConflict('datei'))}>Stand aus der Datei laden</button>
        <button type="button" className="oe-btn oe-btn--sm" onClick={() => void act(resolveConflict('meine'))}>Meine Fassung behalten</button>
      </div>
    </div>
  )
  if (s.inPlace && !s.linked) return (
    <div className="notice file-notice">
      <p>Der Browser braucht Ihre Erlaubnis, um <strong>{s.name}</strong> wieder zu lesen und zu speichern. Erst dann werden Änderungen der KI automatisch angezeigt.</p>
      <div className="oe-toolbar"><button type="button" className="oe-btn oe-btn--sm" onClick={() => void act(relink())}>Zugriff erlauben</button></div>
    </div>
  )
  return null
}

function TopBar({ section }: { section: string }) {
  const s = useSession()
  const toast = useToast()
  const confirm = useConfirm()
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const off = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false) }
    document.addEventListener('click', off)
    return () => document.removeEventListener('click', off)
  }, [menu])
  // Strg/Cmd+S speichert
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void doSave(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function doSave(as: boolean) {
    setMenu(false)
    try { toast(await (as ? saveAs() : save()), 'positive') } catch (e) { toast(e instanceof Error ? e.message : 'Speichern fehlgeschlagen', 'negative') }
  }
  async function doClose() {
    setMenu(false)
    if (s.dirty && (await confirm({
      title: 'Datei schließen?', danger: true, ok: 'Schließen und verwerfen',
      body: <p>Es gibt Änderungen, die noch nicht in der Datei gespeichert sind. Beim Schließen wird auch die Arbeitskopie in diesem Browser gelöscht.</p>,
    })) === null) return
    await close()
    go('')
  }

  return (
    <header className="topbar">
      <div className="topbar-row">
        <a className="brand" href="#/rechnungen">Rechnungen</a>
        <div className="filestate" title={s.inPlace ? 'Speichern schreibt direkt in diese Datei' : 'Speichern lädt die Datei herunter'}>
          <span className="filename">{s.name}</span>
          {s.dirty ? <span className="oe-badge oe-badge--warning">Nicht gespeichert</span> : <span className="oe-badge oe-badge--positive">Gespeichert</span>}
          {s.linked && <span className="live" title="Änderungen in der Datei, etwa durch die KI, werden automatisch übernommen">live</span>}
        </div>
        <div className="topbar-actions" ref={menuRef}>
          <button type="button" className={'oe-btn oe-btn--sm' + (s.dirty ? ' oe-btn--primary' : '')} onClick={() => void doSave(false)}>{Icon.save}Speichern</button>
          <button type="button" className="oe-btn oe-btn--sm oe-btn--ghost" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu(!menu)}>Datei ▾</button>
          {menu && (
            <div className="menu" role="menu">
              <button type="button" role="menuitem" onClick={() => void doSave(true)}>Speichern unter …</button>
              <button type="button" role="menuitem" onClick={() => { setMenu(false); downloadJson(); toast('JSON-Sicherung heruntergeladen.', 'positive') }}>JSON-Sicherung herunterladen</button>
              <button type="button" role="menuitem" className="danger" onClick={() => void doClose()}>Datei schließen</button>
            </div>
          )}
        </div>
      </div>
      <nav className="tabs" aria-label="Bereiche">
        {NAV.map(([k, label]) => (
          <a key={k} href={'#/' + k} className={'tab' + (section === k ? ' is-active' : '')} aria-current={section === k ? 'page' : undefined}>{label}</a>
        ))}
      </nav>
    </header>
  )
}
