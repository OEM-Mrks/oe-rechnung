// Kleine Hilfen für Zahlen, Datum, Geld und IBAN (aus dem Rechnungsgenerator auf oemedia.de übernommen)

export function pad(n: number): string {
  return (n < 10 ? '0' : '') + n
}
export function isoDate(d: Date): string {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}
export function today(): string {
  return isoDate(new Date())
}
export function parseIso(s: string | undefined | null): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '')
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null
}
export function deDate(s: string | undefined | null): string {
  const d = parseIso(s)
  return d ? pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() : ''
}
export function addDays(iso: string, days: number): string {
  const d = parseIso(iso) || new Date()
  d.setDate(d.getDate() + Math.max(0, Math.round(days)))
  return isoDate(d)
}

export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100
}
// Deutsche Eingaben wie "1.234,50 €" oder "19 %" in Zahlen wandeln
export function num(v: unknown): number {
  if (typeof v === 'number') return isFinite(v) ? v : 0
  let s = String(v == null ? '' : v).replace(/[\s€% ]/g, '')
  if (!s) return 0
  if (s.indexOf(',') > -1) s = s.replace(/\./g, '').replace(',', '.')
  const n = parseFloat(s)
  return isFinite(n) ? n : 0
}

const fmtEUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
export const fmtNum = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 })
export const fmtPct = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 })
const fmtMoney = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export function eur(x: number): string {
  return fmtEUR.format(x).replace(/[  ]/g, ' ')
}
// Betrag für Eingabefelder, z. B. 1234.5 -> "1.234,50"
export function money(x: number): string {
  return fmtMoney.format(x)
}

export function cleanIban(s: string | undefined | null): string {
  return String(s || '').replace(/\s+/g, '').toUpperCase()
}
export function ibanOk(s: string | undefined | null): boolean {
  const x = cleanIban(s)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(x)) return false
  const r = x.slice(4) + x.slice(0, 4)
  let d = ''
  for (let i = 0; i < r.length; i++) {
    const c = r.charCodeAt(i)
    d += c >= 65 ? String(c - 55) : r[i]
  }
  let m = 0
  for (let i = 0; i < d.length; i += 7) m = parseInt(String(m) + d.substr(i, 7), 10) % 97
  return m === 1
}
export function fmtIban(s: string | undefined | null): string {
  return cleanIban(s).replace(/(.{4})/g, '$1 ').trim()
}

// "2026-009" -> "2026-010", "RE99" -> "RE100"
export function nextNo(no: string): string {
  const m = /^(.*?)(\d+)(\D*)$/.exec(no || '')
  if (!m) return no ? no + '-2' : ''
  let n = String(parseInt(m[2], 10) + 1)
  while (n.length < m[2].length) n = '0' + n
  return m[1] + n + m[3]
}

export function safeFileName(s: string, max = 60): string {
  return String(s || '').replace(/[^\wäöüÄÖÜß.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max)
}

export function download(blob: Blob, name: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

export function isObj(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x)
}
export function str(x: unknown): string {
  return typeof x === 'string' ? x : typeof x === 'number' ? String(x) : ''
}

// Übernimmt nur Schlüssel des Standardwerts und erzwingt dessen Typ: Dateien können fremd oder
// kaputt sein ({"name": 1}, null in Listen) und dürfen die App nicht blockieren.
export function mergeTyped<T extends object>(base: T, data: unknown, choices: Record<string, readonly string[]> = {}): T {
  if (!isObj(data)) return base
  const b = base as Record<string, unknown>
  for (const k of Object.keys(b)) {
    if (!(k in data)) continue
    const v = data[k]
    const cur = b[k]
    if (k in choices) {
      if (typeof v === 'string' && choices[k].includes(v)) b[k] = v
    } else if (Array.isArray(cur)) {
      // Listen behandelt der Aufrufer selbst
    } else if (cur && typeof cur === 'object') mergeTyped(cur as object, v, choices)
    else if (typeof cur === 'string') {
      if (typeof v === 'string' || typeof v === 'number') b[k] = String(v)
    } else if (typeof cur === 'boolean') b[k] = !!v
    else if (typeof cur === 'number') b[k] = num(v)
    else if (cur === null && (typeof v === 'number' || v === null)) b[k] = v
  }
  return base
}

export function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T
}
