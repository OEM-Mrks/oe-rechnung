// Zugriff auf die SQLite-Datei (sql.js, komplett im Arbeitsspeicher des Browsers)
import type { Database, SqlJsStatic, SqlValue } from 'sql.js'
import { calc, dueIso } from '../calc'
import { isLeitwegId } from '../einvoice/codes'
import {
  defaultSettings, emptyClient, newInvoiceData,
  type Article, type Customer, type InvoiceData, type InvoiceRow, type InvoiceStatus, type Sender, type Settings,
} from '../types'
import { clone, nextNo, today } from '../util'
import { normArticle, normCustomer, normDefaults, normInvoiceData, normSender } from './normalize'
import { FORMAT, SCHEMA, SCHEMA_VERSION } from './schema'

export class FileError extends Error {}

type Params = SqlValue[] | Record<string, SqlValue>
type Row = Record<string, SqlValue>

function now(): string {
  return new Date().toISOString()
}
function parse(s: SqlValue): unknown {
  try { return typeof s === 'string' ? JSON.parse(s) : null } catch { return null }
}

export class Repo {
  readonly db: Database
  private listeners = new Set<() => void>()
  version = 0

  private constructor(db: Database) {
    this.db = db
    db.run('PRAGMA foreign_keys = ON')
  }

  static create(SQL: SqlJsStatic, sender?: Partial<Sender>): Repo {
    const r = new Repo(new SQL.Database())
    r.db.exec(SCHEMA)
    r.run('INSERT INTO meta (key, value) VALUES (?, ?), (?, ?), (?, ?)', ['format', FORMAT, 'schema', String(SCHEMA_VERSION), 'created', now()])
    const s = defaultSettings()
    if (sender) Object.assign(s.sender, sender)
    r.writeSettings(s)
    return r
  }

  static open(SQL: SqlJsStatic, bytes: Uint8Array): Repo {
    const head = new TextDecoder().decode(bytes.slice(0, 15))
    if (head !== 'SQLite format 3') throw new FileError('Das ist keine SQLite-Datei.')
    let db: Database
    try { db = new SQL.Database(bytes) } catch { throw new FileError('Die Datei ist beschädigt und lässt sich nicht öffnen.') }
    let format = '', schema = 0
    try {
      const res = db.exec("SELECT key, value FROM meta WHERE key IN ('format', 'schema')")
      for (const [k, v] of res[0]?.values || []) { if (k === 'format') format = String(v); if (k === 'schema') schema = Number(v) }
    } catch { /* keine meta-Tabelle */ }
    if (format !== FORMAT) { db.close(); throw new FileError('Diese Datenbank stammt nicht aus dieser Rechnungs-App.') }
    if (schema > SCHEMA_VERSION) { db.close(); throw new FileError('Die Datei ist mit einer neueren Version erstellt worden. Bitte die Seite neu laden.') }
    const ok = db.exec('PRAGMA integrity_check')[0]?.values[0]?.[0]
    if (ok !== 'ok') { db.close(); throw new FileError('Die Datenbank ist beschädigt (Integritätsprüfung fehlgeschlagen).') }
    return new Repo(db)
  }

  export(): Uint8Array {
    const bytes = this.db.export()
    this.db.run('PRAGMA foreign_keys = ON') // export() öffnet die Datenbank neu und setzt Pragmas zurück
    return bytes
  }
  close(): void {
    this.db.close()
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private changed(): void {
    this.version++
    for (const fn of this.listeners) fn()
  }

  /* ---------- SQL-Helfer ---------- */
  all(sql: string, params: Params = []): Row[] {
    const st = this.db.prepare(sql)
    try {
      st.bind(params)
      const out: Row[] = []
      while (st.step()) out.push(st.getAsObject())
      return out
    } finally { st.free() }
  }
  one(sql: string, params: Params = []): Row | null {
    return this.all(sql, params)[0] || null
  }
  run(sql: string, params: Params = []): void {
    this.db.run(sql, params)
  }
  private lastId(): number {
    return Number(this.db.exec('SELECT last_insert_rowid()')[0].values[0][0])
  }
  transaction<T>(fn: () => T): T {
    this.db.run('BEGIN')
    try {
      const r = fn()
      this.db.run('COMMIT')
      return r
    } catch (e) {
      this.db.run('ROLLBACK')
      throw e
    }
  }
  private log(invoiceId: number | null, action: string, detail = ''): void {
    this.run('INSERT INTO events (at, invoice_id, action, detail) VALUES (?, ?, ?, ?)', [now(), invoiceId, action, detail])
  }

  /* ---------- Einstellungen ---------- */
  settings(): Settings {
    const s = defaultSettings()
    for (const r of this.all('SELECT key, value FROM settings')) {
      const v = parse(r.value)
      if (r.key === 'sender') s.sender = normSender(v)
      else if (r.key === 'defaults') s.defaults = normDefaults(v)
      else if (r.key === 'nextNo' && typeof v === 'string') s.nextNo = v
      else if (r.key === 'nextCustomerNo' && typeof v === 'string') s.nextCustomerNo = v
    }
    return s
  }
  private writeSettings(s: Settings): void {
    for (const k of ['sender', 'defaults', 'nextNo', 'nextCustomerNo'] as const) {
      this.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, JSON.stringify(s[k])])
    }
  }
  saveSettings(s: Settings): void {
    this.writeSettings(s)
    this.changed()
  }

  /* ---------- Kunden ---------- */
  private toCustomer(r: Row): Customer {
    return normCustomer({ ...r, buyerRef: r.buyer_ref })
  }
  customers(): Customer[] {
    return this.all('SELECT * FROM customers ORDER BY name COLLATE NOCASE, no').map((r) => this.toCustomer(r))
  }
  customer(id: number): Customer | null {
    const r = this.one('SELECT * FROM customers WHERE id = ?', [id])
    return r ? this.toCustomer(r) : null
  }
  saveCustomer(input: Customer): number {
    const c = normCustomer(input)
    const id = this.transaction(() => {
      if (c.id == null || !this.one('SELECT id FROM customers WHERE id = ?', [c.id])) return this.saveCustomerRaw(c)
      this.run('UPDATE customers SET no=?, name=?, contact=?, street=?, zip=?, city=?, country=?, vatid=?, email=?, buyer_ref=?, note=?, updated=? WHERE id=?',
        [c.no.trim(), c.name.trim(), c.contact, c.street, c.zip, c.city, c.country, c.vatid, c.email.trim(), c.buyerRef.trim(), c.note, now(), c.id])
      return c.id
    })
    this.changed()
    return id
  }
  deleteCustomer(id: number): void {
    this.run('DELETE FROM customers WHERE id = ?', [id])
    this.changed()
  }
  invoiceCountForCustomer(id: number): number {
    return Number(this.one('SELECT COUNT(*) AS n FROM invoices WHERE customer_id = ?', [id])?.n || 0)
  }

  /* ---------- Artikel ---------- */
  articles(): Article[] {
    return this.all('SELECT id, no, name, description AS desc, unit, price, vat FROM articles ORDER BY name COLLATE NOCASE').map(normArticle)
  }
  saveArticle(input: Article): number {
    const a = normArticle(input), t = now()
    const vals = [a.no.trim(), a.name.trim(), a.desc, a.unit.trim(), a.price.trim(), a.vat]
    let id: number
    if (a.id != null && this.one('SELECT id FROM articles WHERE id = ?', [a.id])) {
      this.run('UPDATE articles SET no=?, name=?, description=?, unit=?, price=?, vat=?, updated=? WHERE id=?', [...vals, t, a.id])
      id = a.id
    } else {
      this.run('INSERT INTO articles (no, name, description, unit, price, vat, created, updated) VALUES (?,?,?,?,?,?,?,?)', [...vals, t, t])
      id = this.lastId()
    }
    this.changed()
    return id
  }
  deleteArticle(id: number): void {
    this.run('DELETE FROM articles WHERE id = ?', [id])
    this.changed()
  }

  /* ---------- Rechnungen ---------- */
  private toInvoice(r: Row): InvoiceRow {
    return {
      id: Number(r.id), no: String(r.no), status: r.status as InvoiceStatus, date: String(r.date), due: String(r.due),
      customerId: r.customer_id == null ? null : Number(r.customer_id), customer: String(r.customer),
      net: Number(r.net), tax: Number(r.tax), total: Number(r.total),
      data: normInvoiceData(parse(r.data)), sender: r.sender ? normSender(parse(r.sender)) : null,
      finalized: String(r.finalized), paid: String(r.paid), created: String(r.created), updated: String(r.updated),
    }
  }
  invoices(): InvoiceRow[] {
    return this.all('SELECT * FROM invoices ORDER BY (status = \'entwurf\') DESC, date DESC, no DESC, id DESC').map((r) => this.toInvoice(r))
  }
  invoice(id: number): InvoiceRow | null {
    const r = this.one('SELECT * FROM invoices WHERE id = ?', [id])
    return r ? this.toInvoice(r) : null
  }
  private figures(d: InvoiceData) {
    const T = calc(d)
    return { date: d.date, due: dueIso(d), customer_id: d.client.customerId, customer: d.client.name.trim(), net: T.net, tax: T.taxTotal, total: T.total }
  }
  newDraft(from?: InvoiceData): number {
    const st = this.settings()
    const d = from ? normInvoiceData(clone(from)) : newInvoiceData(st.defaults, today())
    const f = this.figures(d), t = now()
    this.run('INSERT INTO invoices (status, date, due, customer_id, customer, net, tax, total, data, created, updated) VALUES (\'entwurf\',?,?,?,?,?,?,?,?,?,?)',
      [f.date, f.due, f.customer_id, f.customer, f.net, f.tax, f.total, JSON.stringify(d), t, t])
    const id = this.lastId()
    this.changed()
    return id
  }
  saveDraft(id: number, data: InvoiceData): void {
    const d = normInvoiceData(data), f = this.figures(d)
    if (d.client.customerId != null && !this.one('SELECT id FROM customers WHERE id = ?', [d.client.customerId])) d.client.customerId = null
    this.run('UPDATE invoices SET date=?, due=?, customer_id=?, customer=?, net=?, tax=?, total=?, data=?, updated=? WHERE id=? AND finalized = \'\'',
      [f.date, f.due, d.client.customerId, f.customer, f.net, f.tax, f.total, JSON.stringify(d), now(), id])
    this.changed()
  }
  deleteDraft(id: number): void {
    this.run('DELETE FROM invoices WHERE id = ? AND finalized = \'\'', [id])
    this.changed()
  }
  // Vergibt die Nummer, speichert den Absender-Stand und sperrt die Rechnung. Gibt die Nummer zurück.
  finalize(id: number): string {
    const no = this.transaction(() => {
      const inv = this.invoice(id)
      if (!inv) throw new Error('Rechnung nicht gefunden')
      if (inv.finalized) return inv.no
      const st = this.settings(), d = inv.data
      const no = (d.no.trim() || inv.no.trim() || st.nextNo).trim()
      if (this.one('SELECT id FROM invoices WHERE no = ? AND id <> ?', [no, id])) throw new FileError('Die Rechnungsnummer ' + no + ' ist schon vergeben.')
      if (no === st.nextNo) { st.nextNo = nextNo(no); this.writeSettings(st) }
      // Kunde in den Kundenstamm übernehmen bzw. aktualisieren
      const c = d.client
      if (c.name.trim()) {
        const match = c.customerId != null ? this.customer(c.customerId)
          : this.one('SELECT id FROM customers WHERE (no <> \'\' AND no = ?) OR (? = \'\' AND name = ? COLLATE NOCASE) LIMIT 1', [c.no.trim(), c.no.trim(), c.name.trim()])
        if (!match) {
          const { customerId: _cid, ...fields } = c
          // Eine Leitweg-ID gilt dauerhaft für den Auftraggeber, eine sonstige Referenz nur für diese Rechnung
          c.customerId = this.saveCustomerRaw({ ...fields, id: null, note: '', buyerRef: isLeitwegId(d.ref) ? d.ref.trim() : '' })
          c.no = this.customer(c.customerId)?.no || c.no
        } else if (c.customerId == null) c.customerId = Number(match.id)
      }
      d.no = no
      const f = this.figures(d), t = now()
      this.run('UPDATE invoices SET no=?, status=\'offen\', date=?, due=?, customer_id=?, customer=?, net=?, tax=?, total=?, data=?, sender=?, finalized=?, updated=? WHERE id=?',
        [no, f.date, f.due, c.customerId, f.customer, f.net, f.tax, f.total, JSON.stringify(d), JSON.stringify(st.sender), t, t, id])
      this.log(id, 'festgeschrieben', no)
      return no
    })
    this.changed()
    return no
  }
  // Neuen Kunden anlegen (ohne Transaktion und ohne changed()); leere Kundennummer wird fortlaufend vergeben
  private saveCustomerRaw(c: Customer): number {
    const st = this.settings()
    if (!c.no.trim()) { c.no = st.nextCustomerNo; st.nextCustomerNo = nextNo(st.nextCustomerNo); this.writeSettings(st) }
    const t = now()
    this.run('INSERT INTO customers (no, name, contact, street, zip, city, country, vatid, email, buyer_ref, note, created, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [c.no.trim(), c.name.trim(), c.contact, c.street, c.zip, c.city, c.country, c.vatid, c.email.trim(), c.buyerRef.trim(), c.note, t, t])
    return this.lastId()
  }
  setStatus(id: number, status: Exclude<InvoiceStatus, 'entwurf'>, paid = ''): void {
    const inv = this.invoice(id)
    if (!inv || !inv.finalized || inv.status === status) return
    this.run('UPDATE invoices SET status=?, paid=?, updated=? WHERE id=?', [status, status === 'bezahlt' ? paid || today() : '', now(), id])
    this.log(id, 'status', inv.status + ' → ' + status)
    this.changed()
  }
  // Nur für Rechnungen, die noch nicht verschickt wurden: Sperre aufheben, Nummer bleibt
  unlock(id: number, reason: string): void {
    this.run('UPDATE invoices SET finalized=\'\', status=\'entwurf\', sender=NULL, updated=? WHERE id=?', [now(), id])
    this.log(id, 'entsperrt', reason)
    this.changed()
  }
  duplicate(id: number): number {
    const inv = this.invoice(id)
    if (!inv) throw new Error('Rechnung nicht gefunden')
    const d = clone(inv.data)
    d.no = ''; d.date = today(); d.sdate = ''; d.edate = ''; d.subject = ''
    return this.newDraft(d)
  }
  events(invoiceId: number): { at: string; action: string; detail: string }[] {
    return this.all('SELECT at, action, detail FROM events WHERE invoice_id = ? ORDER BY id', [invoiceId]).map((r) => ({ at: String(r.at), action: String(r.action), detail: String(r.detail) }))
  }

  /* ---------- Import (altes Rechnungsbuch, JSON-Sicherung) ---------- */
  importInvoice(row: { no: string; status: InvoiceStatus; data: InvoiceData; sender: Sender | null; finalized: string; paid: string; created: string }): void {
    const d = normInvoiceData(row.data), f = this.figures(d), t = now()
    this.run('INSERT INTO invoices (no, status, date, due, customer_id, customer, net, tax, total, data, sender, finalized, paid, created, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [row.no, row.status, f.date, f.due, d.client.customerId, f.customer, f.net, f.tax, f.total, JSON.stringify(d), row.sender ? JSON.stringify(row.sender) : null,
        row.finalized, row.paid, row.created || t, t])
    this.log(this.lastId(), 'importiert', row.no)
  }
  importCustomer(c: Customer): number {
    return this.saveCustomerRaw(normCustomer(c))
  }
  importArticle(a: Article): void {
    const x = normArticle(a), t = now()
    this.run('INSERT INTO articles (no, name, description, unit, price, vat, created, updated) VALUES (?,?,?,?,?,?,?,?)', [x.no, x.name, x.desc, x.unit, x.price, x.vat, t, t])
  }
  replaceSettings(s: Settings): void {
    this.writeSettings(s)
  }
  notify(): void {
    this.changed()
  }
}

export function clientFromCustomer(c: Customer) {
  const { id, note: _note, ...rest } = c
  return { ...emptyClient(), ...rest, customerId: id }
}
