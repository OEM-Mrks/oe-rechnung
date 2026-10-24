// Kleine Bausteine: Feld, Toast, Bestätigungsdialog, Hash-Navigation, Icons
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'

/* ---------- Navigation über den Hash (#/rechnungen, #/rechnung/3 …), Zurück-Taste funktioniert ---------- */
function subscribeHash(fn: () => void) {
  window.addEventListener('hashchange', fn)
  return () => window.removeEventListener('hashchange', fn)
}
export function useRoute(): string[] {
  const h = useSyncExternalStore(subscribeHash, () => location.hash)
  return h.replace(/^#\/?/, '').split('/').filter(Boolean)
}
export function go(path: string): void {
  location.hash = '#/' + path
}

/* ---------- Toast ---------- */
type Kind = '' | 'positive' | 'negative'
const ToastCtx = createContext<(msg: string, kind?: Kind) => void>(() => {})
export function useToast() {
  return useContext(ToastCtx)
}
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; kind: Kind; on: boolean }>({ msg: '', kind: '', on: false })
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = useCallback((msg: string, kind: Kind = '') => {
    if (!msg) return
    setT({ msg, kind, on: true })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setT((x) => ({ ...x, on: false })), Math.min(9000, 2600 + msg.length * 30))
  }, [])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className={'oe-toast' + (t.on ? ' is-visible' : '') + (t.kind ? ' oe-toast--' + t.kind : '')} role="status" aria-live="polite">{t.msg}</div>
    </ToastCtx.Provider>
  )
}

/* ---------- Bestätigungsdialog (natives <dialog>) ---------- */
interface ConfirmOpts { title: string; body?: ReactNode; ok?: string; danger?: boolean; input?: string }
type Pending = ConfirmOpts & { resolve: (v: string | null) => void }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<string | null>>(async () => null)
// Gibt null (abgebrochen) oder den eingegebenen Text ('' ohne Eingabefeld) zurück
export function useConfirm() {
  return useContext(ConfirmCtx)
}
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [p, setP] = useState<Pending | null>(null)
  const [val, setVal] = useState('')
  const ref = useRef<HTMLDialogElement>(null)
  const ask = useCallback((o: ConfirmOpts) => new Promise<string | null>((resolve) => { setVal(''); setP({ ...o, resolve }) }), [])
  useEffect(() => { if (p && ref.current && !ref.current.open) ref.current.showModal() }, [p])
  const done = (v: string | null) => { ref.current?.close(); p?.resolve(v); setP(null) }
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <dialog ref={ref} className="dlg" onCancel={(e) => { e.preventDefault(); done(null) }}>
        {p && (
          <form method="dialog" onSubmit={(e) => { e.preventDefault(); if (p.input === undefined || val.trim()) done(p.input === undefined ? '' : val.trim()) }}>
            <h2 className="dlg-title">{p.title}</h2>
            {p.body && <div className="dlg-body">{p.body}</div>}
            {p.input !== undefined && (
              <div className="oe-field">
                <label className="oe-label" htmlFor="dlg-input">{p.input}</label>
                <input id="dlg-input" className="oe-input" value={val} onChange={(e) => setVal(e.target.value)} autoFocus />
              </div>
            )}
            <div className="dlg-actions">
              <button type="button" className="oe-btn oe-btn--ghost" onClick={() => done(null)}>Abbrechen</button>
              <button type="submit" className={'oe-btn ' + (p.danger ? 'oe-btn--danger' : 'oe-btn--primary')} disabled={p.input !== undefined && !val.trim()}>{p.ok || 'OK'}</button>
            </div>
          </form>
        )}
      </dialog>
    </ConfirmCtx.Provider>
  )
}

/* ---------- Formularfeld ---------- */
interface FieldProps {
  label: ReactNode
  value: string
  onChange: (v: string) => void
  id?: string
  hint?: ReactNode
  opt?: string // z. B. "optional"
  className?: string
  invalid?: boolean
  multiline?: number
  input?: React.InputHTMLAttributes<HTMLInputElement>
}
export function Field({ label, value, onChange, id, hint, opt, className, invalid, multiline, input }: FieldProps) {
  const auto = useId()
  const fid = id || auto
  return (
    <div className={'oe-field ' + (className || '')}>
      <label className="oe-label" htmlFor={fid}>{label}{opt && <span className="oe-muted"> {opt}</span>}</label>
      {multiline
        ? <textarea id={fid} className="oe-input" rows={multiline} value={value} onChange={(e) => onChange(e.target.value)} />
        : <input id={fid} className="oe-input" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid || undefined} {...input} />}
      {hint && <span className="oe-hint">{hint}</span>}
    </div>
  )
}

/* ---------- Icons (inline SVG, kein Icon-Font) ---------- */
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
export const Icon = {
  plus: <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" {...P} strokeWidth={2} /></svg>,
  x: <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" {...P} /></svg>,
  down: <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v10M5.5 8.5L10 13l4.5-4.5M4 16.5h12" {...P} strokeWidth={2} /></svg>,
  save: <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 3.5h9.5L16.5 6.5V16.5H4zM7 3.5v4h6v-4M7 16.5v-5h6v5" {...P} /></svg>,
  lock: <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 9h10v8H5zM7 9V6.5a3 3 0 0 1 6 0V9" {...P} /></svg>,
  back: <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12 4l-6 6 6 6" {...P} strokeWidth={2} /></svg>,
  copy: <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 7h9v9H7zM4 13V4h9" {...P} /></svg>,
  eye: <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" {...P} /><circle cx="10" cy="10" r="2.3" {...P} /></svg>,
}
