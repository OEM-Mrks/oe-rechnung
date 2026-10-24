// JSON-Sicherung (eigenes Format) und Übernahme des alten Rechnungsbuchs vom Rechnungsgenerator auf oemedia.de
import type { SqlJsStatic } from 'sql.js'
import type { InvoiceData, InvoiceStatus } from '../types'
import { defaultSettings } from '../types'
import { isObj, str } from '../util'
import { normArticle, normCustomer, normDefaults, normInvoiceData, normSender } from './normalize'
import { FileError, Repo } from './repo'
import { FORMAT, SCHEMA_VERSION } from './schema'

const STATUSES: InvoiceStatus[] = ['entwurf', 'offen', 'bezahlt', 'storniert']
const LEGACY_FORMAT = 'oemedia-rechnungsbuch'

export function exportJson(repo: Repo): string {
  const invoices = repo.invoices().map(({ id: _id, customerId: _c, ...inv }) => inv)
  const customers = repo.customers()
  const out = {
    format: FORMAT + '-json', version: SCHEMA_VERSION, exported: new Date().toISOString(),
    settings: repo.settings(), customers, articles: repo.articles().map(({ id: _id, ...a }) => a), invoices,
  }
  return JSON.stringify(out, null, 1)
}

export function importJson(SQL: SqlJsStatic, text: string): { repo: Repo; info: string } {
  let o: unknown
  try { o = JSON.parse(text) } catch { throw new FileError('Diese Datei lässt sich nicht lesen (kein gültiges JSON).') }
  if (!isObj(o)) throw new FileError('Unbekanntes Dateiformat.')
  if (o.format === LEGACY_FORMAT) return importLegacy(SQL, o)
  if (o.format !== FORMAT + '-json') throw new FileError('Diese JSON-Datei stammt nicht aus dieser Rechnungs-App.')
  const repo = Repo.create(SQL)
  repo.transaction(() => {
    const st = defaultSettings(), src = isObj(o.settings) ? o.settings : {}
    st.sender = normSender(src.sender); st.defaults = normDefaults(src.defaults)
    if (typeof src.nextNo === 'string') st.nextNo = src.nextNo
    if (typeof src.nextCustomerNo === 'string') st.nextCustomerNo = src.nextCustomerNo
    repo.replaceSettings(st)
    // Kunden-IDs der Sicherung auf neue IDs abbilden
    const ids = new Map<number, number>()
    for (const c of Array.isArray(o.customers) ? o.customers.filter(isObj) : []) {
      const old = typeof c.id === 'number' ? c.id : null
      const nid = repo.importCustomer({ ...normCustomer(c), id: null })
      if (old != null) ids.set(old, nid)
    }
    for (const a of Array.isArray(o.articles) ? o.articles.filter(isObj) : []) repo.importArticle({ ...normArticle(a), id: null })
    for (const j of Array.isArray(o.invoices) ? o.invoices.filter(isObj) : []) {
      const data = normInvoiceData(j.data)
      const cid = data.client.customerId
      data.client.customerId = cid != null ? ids.get(cid) ?? null : null
      const status = STATUSES.includes(j.status as InvoiceStatus) ? (j.status as InvoiceStatus) : 'entwurf'
      const finalized = status === 'entwurf' ? '' : str(j.finalized) || new Date().toISOString()
      repo.importInvoice({ no: str(j.no), status, data, sender: j.sender ? normSender(j.sender) : null, finalized, paid: str(j.paid), created: str(j.created) })
    }
  })
  return { repo, info: 'JSON-Sicherung übernommen.' }
}

// Altes Rechnungsbuch: { format: "oemedia-rechnungsbuch", sender, settings, nextNo, customers[], journal[] }
function importLegacy(SQL: SqlJsStatic, o: Record<string, unknown>): { repo: Repo; info: string } {
  const repo = Repo.create(SQL)
  let n = 0, k = 0
  repo.transaction(() => {
    const st = defaultSettings()
    st.sender = normSender(o.sender)
    const s = isObj(o.settings) ? o.settings : {}
    st.defaults = normDefaults({ ...st.defaults, ...s, einvoice: s.einvoice ?? true })
    if (typeof o.nextNo === 'string' && o.nextNo) st.nextNo = o.nextNo
    repo.replaceSettings(st)
    const byKey = new Map<string, number>()
    const key = (c: { no: string; name: string }) => (c.no || c.name).trim().toLowerCase()
    for (const raw of Array.isArray(o.customers) ? o.customers.filter(isObj) : []) {
      const c = normCustomer({ ...raw, id: null })
      if (!c.name.trim()) continue
      const id = repo.importCustomer(c)
      byKey.set(key(c), id); k++
    }
    for (const j of Array.isArray(o.journal) ? o.journal.filter(isObj) : []) {
      const inv = isObj(j.invoice) ? j.invoice : {}
      const legacy = isObj(inv.inv) ? inv.inv : {}
      const data: InvoiceData = normInvoiceData({ ...legacy, mode: inv.mode, gross: inv.gross, discount: inv.discount, giro: inv.giro, client: inv.client, items: inv.items })
      data.no = str(j.no) || data.no
      data.client.customerId = byKey.get(key(data.client)) ?? null
      const status = STATUSES.includes(j.status as InvoiceStatus) && j.status !== 'entwurf' ? (j.status as InvoiceStatus) : 'offen'
      repo.importInvoice({ no: data.no, status, data, sender: st.sender, finalized: str(j.created) || new Date().toISOString(), paid: str(j.paid), created: str(j.created) })
      n++
    }
  })
  return { repo, info: 'Altes Rechnungsbuch übernommen: ' + n + ' Rechnungen, ' + k + ' Kunden.' }
}
