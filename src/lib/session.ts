// Die geöffnete Datei: Repo im Speicher, Dateizugriff (File System Access API, sonst Download)
// und automatische Arbeitskopie im Browser, damit bei geschlossenem Tab nichts verloren geht.
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

interface WorkCopy { bytes: Uint8Array; name: string; dirty: boolean; savedAt: string; at: string }

export interface SessionState {
  repo: Repo | null
  name: string // Dateiname
  dirty: boolean // Änderungen seit dem letzten Speichern in die Datei
  savedAt: string
  inPlace: boolean // Speichern schreibt direkt in die geöffnete Datei
  version: number
}

let state: SessionState = { repo: null, name: '', dirty: false, savedAt: '', inPlace: false, version: 0 }
let handle: FsHandle | null = null
let unsub: (() => void) | null = null
let workTimer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()

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

function attach(repo: Repo, name: string, h: FsHandle | null, dirty: boolean, savedAt = ''): void {
  unsub?.()
  if (state.repo && state.repo !== repo) state.repo.close()
  handle = h
  unsub = repo.subscribe(() => { set({ dirty: true, version: repo.version }); scheduleWorkCopy() })
  set({ repo, name, dirty, savedAt, inPlace: !!h, version: repo.version })
  void idbSet('handle', h)
  scheduleWorkCopy(0)
}
function scheduleWorkCopy(delay = 400): void {
  clearTimeout(workTimer)
  workTimer = setTimeout(() => {
    const r = state.repo
    if (!r) return
    const wc: WorkCopy = { bytes: r.export(), name: state.name, dirty: state.dirty, savedAt: state.savedAt, at: new Date().toISOString() }
    void idbSet('work', wc)
  }, delay)
}

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
  attach(repo, file.name, h, false, new Date(file.lastModified).toISOString())
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

async function writeTo(h: FsHandle, bytes: Uint8Array): Promise<void> {
  if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') {
    throw new FileError('Ohne Schreibrecht kann die Datei nicht gespeichert werden.')
  }
  const ws = await h.createWritable()
  await ws.write(bytes as Uint8Array<ArrayBuffer>)
  await ws.close()
}
function saved(name: string): void {
  set({ dirty: false, savedAt: new Date().toISOString(), name, inPlace: !!handle })
  scheduleWorkCopy(0)
}

export async function save(): Promise<string> {
  const r = getRepo()
  if (handle) {
    await writeTo(handle, r.export())
    saved(handle.name)
    return 'Gespeichert in ' + handle.name
  }
  return saveAs()
}
export async function saveAs(): Promise<string> {
  const r = getRepo(), bytes = r.export()
  if (canSaveInPlace) {
    let h: FsHandle
    try { h = await w.showSaveFilePicker!({ suggestedName: state.name, types: TYPES }) } catch { return '' }
    await writeTo(h, bytes)
    handle = h
    void idbSet('handle', h)
    saved(h.name)
    return 'Gespeichert als ' + h.name + '. Ab jetzt speichert „Speichern“ direkt in diese Datei.'
  }
  download(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/vnd.sqlite3' }), state.name)
  saved(state.name)
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
  await idbDel('work'); await idbDel('handle')
  set({ repo: null, name: '', dirty: false, savedAt: '', inPlace: false, version: 0 })
}

// Arbeitskopie vom letzten Besuch
export async function peekWorkCopy(): Promise<Omit<WorkCopy, 'bytes'> | null> {
  const wc = await idbGet<WorkCopy>('work')
  if (!wc || !(wc.bytes instanceof Uint8Array)) return null
  const { bytes: _b, ...info } = wc
  return info
}
export async function resumeWorkCopy(): Promise<void> {
  const wc = await idbGet<WorkCopy>('work')
  if (!wc) throw new FileError('Keine Arbeitskopie gefunden.')
  const SQL = await sqlite()
  const repo = Repo.open(SQL, wc.bytes)
  const h = (await idbGet<FsHandle>('handle')) || null
  attach(repo, wc.name, h, wc.dirty, wc.savedAt)
}

window.addEventListener('beforeunload', (e) => {
  if (state.repo && state.dirty) e.preventDefault()
})
