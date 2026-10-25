// Die geöffnete Datei: Repo im Speicher, Dateizugriff (File System Access API, sonst Download)
// und automatische Arbeitskopie im Browser, damit bei geschlossenem Tab nichts verloren geht.
// Mit Dateizugriff (Chrome/Edge) wird die Datei laufend beobachtet: Änderungen von außen, etwa durch die KI
// über den MCP-Server, werden übernommen; haben beide Seiten geändert, entscheidet der Nutzer.
import { useSyncExternalStore } from 'react'
import { idbDel, idbGet, idbSet } from './db/idb'
import { FileError, Repo } from './db/repo'
import { sqlite } from './db/sqlite'
import { exportJson, importJson } from './db/transfer'
import { download, safeFileName, today } from './util'

// File System Access API (Chrome, Edge, Opera) – nicht in den Standard-Typen von TypeScript
interface FsHandle {
  name: string
  getFile(): Promise<File>
  createWritable(): Promise<{ write(d: BufferSource | Blob): Promise<void>; close(): Promise<void> }>
  queryPermission(o: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(o: { mode: 'readwrite' }): Promise<PermissionState>
}
type PickerWindow = Window & {
  showOpenFilePicker?: (o: unknown) => Promise<FsHandle[]>
  showSaveFilePicker?: (o: unknown) => Promise<FsHandle>
}
const w = window as PickerWindow
export const canSaveInPlace = typeof w.showOpenFilePicker === 'function' && typeof w.showSaveFilePicker === 'function'
const TYPES = [{ description: 'Rechnungsdatenbank (SQLite)', accept: { 'application/vnd.sqlite3': ['.sqlite', '.sqlite3', '.db'] } }]
const WATCH_MS = 2000

interface WorkCopy { bytes: Uint8Array; name: string; dirty: boolean; savedAt: string; at: string; fileMod?: number }

export interface SessionState {
  repo: Repo | null
  name: string // Dateiname
  dirty: boolean // Änderungen seit dem letzten Speichern in die Datei
  savedAt: string
  inPlace: boolean // Speichern schreibt direkt in die geöffnete Datei
  linked: boolean // Datei wird beobachtet (Schreibrecht vorhanden)
  conflict: boolean // Datei wurde außerhalb geändert, während hier ungespeicherte Änderungen bestehen
  external: number // zählt Übernahmen von außen; Seiten werden damit neu aufgebaut
  version: number
}

let state: SessionState = { repo: null, name: '', dirty: false, savedAt: '', inPlace: false, linked: false, conflict: false, external: 0, version: 0 }
let handle: FsHandle | null = null
let fileMod = 0 // lastModified der Datei, die dieser Stand kennt
let unsub: (() => void) | null = null
let workTimer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()
const onExternal = new Set<(msg: string) => void>()

function set(p: Partial<SessionState>): void {
  state = { ...state, ...p }
  for (const fn of listeners) fn()
}
export function useSession(): SessionState {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn) }, () => state)
}
export function getRepo(): Repo {
  if (!state.repo) throw new Error('Keine Datei geöffnet')
  return state.repo
}
// Meldung, wenn Änderungen von außen übernommen wurden (für einen Toast)
export function onExternalChange(fn: (msg: string) => void): () => void {
  onExternal.add(fn)
  return () => onExternal.delete(fn)
}

function attach(repo: Repo, name: string, h: FsHandle | null, dirty: boolean, savedAt = '', mod = 0, extra: Partial<SessionState> = {}): void {
  unsub?.()
  if (state.repo && state.repo !== repo) state.repo.close()
  handle = h
  fileMod = mod
  unsub = repo.subscribe(() => { set({ dirty: true, version: repo.version }); scheduleWorkCopy() })
  set({ repo, name, dirty, savedAt, inPlace: !!h, linked: !!h, conflict: false, version: repo.version, ...extra })
  void idbSet('handle', h)
  scheduleWorkCopy(0)
}
function scheduleWorkCopy(delay = 400): void {
  clearTimeout(workTimer)
  workTimer = setTimeout(() => {
    const r = state.repo
    if (!r) return
    const wc: WorkCopy = { bytes: r.export(), name: state.name, dirty: state.dirty, savedAt: state.savedAt, at: new Date().toISOString(), fileMod }
    void idbSet('work', wc)
  }, delay)
}

/* ---------- Datei beobachten ---------- */
async function readLinked(): Promise<File | null> {
  if (!handle) return null
  try { return await handle.getFile() } catch { return null } // kein Recht oder Datei weg
}
async function adopt(file: File, msg: string): Promise<void> {
  const SQL = await sqlite()
  const repo = Repo.open(SQL, new Uint8Array(await file.arrayBuffer()))
  attach(repo, file.name, handle, false, new Date(file.lastModified).toISOString(), file.lastModified, { external: state.external + 1 })
  for (const fn of onExternal) fn(msg)
}
let checking = false
async function check(): Promise<void> {
  if (checking || !state.repo || !handle || document.visibilityState !== 'visible') return
  checking = true
  try {
    const f = await readLinked()
    set({ linked: !!f })
    if (!f || f.lastModified === fileMod) return
    if (!state.dirty) await adopt(f, 'Änderungen aus der Datei übernommen (z. B. von der KI).')
    else if (!state.conflict) set({ conflict: true })
  } catch (e) {
    console.error(e) // z. B. Datei gerade halb geschrieben: beim nächsten Durchlauf erneut
  } finally { checking = false }
}
setInterval(() => void check(), WATCH_MS)
document.addEventListener('visibilitychange', () => void check())
window.addEventListener('focus', () => void check())

// Konflikt auflösen: Datei übernehmen (eigene Änderungen verwerfen) oder eigene Fassung behalten
export async function resolveConflict(take: 'datei' | 'meine'): Promise<string> {
  const f = await readLinked()
  if (!f) throw new FileError('Die Datei lässt sich gerade nicht lesen.')
  if (take === 'datei') { await adopt(f, ''); return 'Stand aus der Datei geladen.' }
  fileMod = f.lastModified
  set({ conflict: false })
  return 'Ihre Fassung bleibt. Beim Speichern überschreibt sie die Änderungen in der Datei.'
}
// Nach einem Neuladen: Zugriff auf die zuletzt geöffnete Datei wieder erlauben (braucht einen Klick)
export async function relink(): Promise<string> {
  if (!handle) return ''
  if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new FileError('Ohne Zugriff kann die Datei nicht beobachtet werden.')
  set({ linked: true })
  await check()
  return 'Verbunden mit ' + handle.name + '.'
}

/* ---------- Öffnen, Speichern, Schließen ---------- */
export function defaultName(company: string): string {
  return 'Rechnungen_' + (safeFileName(company, 40) || 'Firma') + '.sqlite'
}

export async function newFile(company: string): Promise<void> {
  const SQL = await sqlite()
  attach(Repo.create(SQL, { name: company.trim() }), defaultName(company), null, true)
}

export async function openFile(file: File, h: FsHandle | null = null): Promise<string> {
  const SQL = await sqlite()
  const bytes = new Uint8Array(await file.arrayBuffer())
  const isJson = /\.json$/i.test(file.name) || bytes[0] === 0x7b
  if (isJson) {
    const { repo, info } = importJson(SQL, new TextDecoder().decode(bytes))
    attach(repo, defaultName(repo.settings().sender.name), null, true)
    return info + ' Bitte jetzt als Datenbank speichern.'
  }
  const repo = Repo.open(SQL, bytes)
  attach(repo, file.name, h, false, new Date(file.lastModified).toISOString(), file.lastModified)
  return 'Datei geöffnet: ' + file.name
}

// Auswahl über den Dateidialog des Browsers; null = Browser kann es nicht, Fallback über <input type=file>
export async function pickAndOpen(): Promise<string | null> {
  if (!canSaveInPlace) return null
  let hs: FsHandle[]
  try {
    hs = await w.showOpenFilePicker!({ types: [...TYPES, { description: 'JSON-Sicherung', accept: { 'application/json': ['.json'] } }], excludeAcceptAllOption: false, multiple: false })
  } catch { return '' } // abgebrochen
  const file = await hs[0].getFile()
  return openFile(file, /\.json$/i.test(file.name) ? null : hs[0])
}

async function writeTo(h: FsHandle, bytes: Uint8Array): Promise<number> {
  if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') {
    throw new FileError('Ohne Schreibrecht kann die Datei nicht gespeichert werden.')
  }
  const ws = await h.createWritable()
  await ws.write(bytes as Uint8Array<ArrayBuffer>)
  await ws.close()
  return (await h.getFile()).lastModified
}
function saved(name: string, mod: number): void {
  fileMod = mod
  set({ dirty: false, conflict: false, savedAt: new Date().toISOString(), name, inPlace: !!handle, linked: !!handle })
  scheduleWorkCopy(0)
}

export async function save(): Promise<string> {
  const r = getRepo()
  if (handle) {
    // Wurde die Datei inzwischen woanders geändert, erst fragen statt still zu überschreiben
    const f = await readLinked()
    if (f && f.lastModified !== fileMod && !state.conflict) {
      set({ conflict: true })
      throw new FileError('Die Datei wurde inzwischen außerhalb geändert (z. B. von der KI). Bitte oben entscheiden, welche Fassung gelten soll.')
    }
    saved(handle.name, await writeTo(handle, r.export()))
    return 'Gespeichert in ' + handle.name
  }
  return saveAs()
}
export async function saveAs(): Promise<string> {
  const r = getRepo(), bytes = r.export()
  if (canSaveInPlace) {
    let h: FsHandle
    try { h = await w.showSaveFilePicker!({ suggestedName: state.name, types: TYPES }) } catch { return '' }
    const mod = await writeTo(h, bytes)
    handle = h
    void idbSet('handle', h)
    saved(h.name, mod)
    return 'Gespeichert als ' + h.name + '. Ab jetzt speichert „Speichern“ direkt in diese Datei.'
  }
  download(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/vnd.sqlite3' }), state.name)
  saved(state.name, 0)
  return 'Datei heruntergeladen: ' + state.name + '. Beim nächsten Mal diese Datei wieder öffnen.'
}
export function downloadJson(): void {
  const r = getRepo()
  download(new Blob([exportJson(r)], { type: 'application/json' }), state.name.replace(/\.(sqlite3?|db)$/i, '') + '_' + today() + '.json')
}

export async function close(): Promise<void> {
  clearTimeout(workTimer)
  unsub?.(); unsub = null
  state.repo?.close()
  handle = null
  fileMod = 0
  await idbDel('work'); await idbDel('handle')
  set({ repo: null, name: '', dirty: false, savedAt: '', inPlace: false, linked: false, conflict: false, version: 0 })
}

// Arbeitskopie vom letzten Besuch
export async function peekWorkCopy(): Promise<Omit<WorkCopy, 'bytes'> | null> {
  const wc = await idbGet<WorkCopy>('work')
  if (!wc || !(wc.bytes instanceof Uint8Array)) return null
  const { bytes: _b, ...info } = wc
  return info
}
export async function resumeWorkCopy(): Promise<string> {
  const wc = await idbGet<WorkCopy>('work')
  if (!wc) throw new FileError('Keine Arbeitskopie gefunden.')
  const SQL = await sqlite()
  const h = (await idbGet<FsHandle>('handle')) || null
  // Läuft im Klick auf „Weiterarbeiten“: dabei gleich den Dateizugriff wieder erlauben lassen
  let granted = false
  if (h) { try { granted = (await h.requestPermission({ mode: 'readwrite' })) === 'granted' } catch { granted = false } }
  attach(Repo.open(SQL, wc.bytes), wc.name, h, wc.dirty, wc.savedAt, wc.fileMod || 0, { linked: granted })
  if (granted) {
    const f = await readLinked()
    if (f && f.lastModified !== fileMod) {
      if (!wc.dirty) { await adopt(f, ''); return 'Neuester Stand aus ' + f.name + ' geladen.' }
      set({ conflict: true })
    }
  }
  return ''
}

window.addEventListener('beforeunload', (e) => {
  if (state.repo && state.dirty) e.preventDefault()
})

// Nur im Entwicklungsmodus: eine Datei über ein nachgebautes Datei-Handle öffnen (für Tests der Live-Übernahme)
if (import.meta.env.DEV) {
  (window as unknown as { __oeTest: unknown }).__oeTest = { open: async (h: FsHandle) => openFile(await h.getFile(), h) }
}
