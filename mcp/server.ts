// Lokaler MCP-Server: Eine KI (Claude Desktop, Claude Code, LM Studio …) bedient die Rechnungsdatei des Nutzers.
// Läuft auf dem Rechner des Nutzers, liest und schreibt nur die angegebene SQLite-Datei und den Export-Ordner.
//   node server.cjs --ordner ~/Rechnungen [--datei Rechnungen.sqlite]
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { z } from 'zod'
import { calc, dueIso, subject } from '../src/lib/calc'
import { missing } from '../src/lib/check'
import { clientFromCustomer, FileError, Repo } from '../src/lib/db/repo'
import { buildCii } from '../src/lib/einvoice/cii'
import { countryCode, countryName, isLeitwegId } from '../src/lib/einvoice/codes'
import { invoicePdf } from '../src/lib/pdf/invoice'
import {
  STATUS_LABEL, emptyCustomer, emptyItem, newInvoiceData,
  type Article, type Customer, type InvoiceData, type InvoiceRow, type Item, type Sender, type TaxMode,
} from '../src/lib/types'
import { deDate, eur, fmtIban, ibanOk, money, num, safeFileName, today } from '../src/lib/util'

const VERSION = '0.2.0'

/* ---------- Aufruf-Parameter ---------- */
function arg(name: string): string {
  const i = process.argv.indexOf('--' + name)
  return i > -1 ? process.argv[i + 1] || '' : ''
}
function expand(p: string): string {
  const x = p.replace(/^~(?=$|\/|\\)/, homedir())
  return isAbsolute(x) ? x : resolve(x)
}
const DIR = expand(arg('ordner') || process.env.OE_RECHNUNG_ORDNER || join(homedir(), 'Rechnungen'))
const FILE = expand(join(DIR, arg('datei') || process.env.OE_RECHNUNG_DATEI || 'Rechnungen.sqlite'))
const EXPORT_DIR = join(DIR, 'Export')

/* ---------- Datei: bei jedem Aufruf frisch lesen, atomar schreiben ---------- */
let SQL: SqlJsStatic
function load(): Repo {
  if (!existsSync(FILE)) return Repo.create(SQL)
  return Repo.open(SQL, new Uint8Array(readFileSync(FILE)))
}
function store(repo: Repo): void {
  mkdirSync(dirname(FILE), { recursive: true })
  const tmp = FILE + '.tmp-' + process.pid
  writeFileSync(tmp, repo.export())
  renameSync(tmp, FILE)
}
// Lesen: Datei nicht anfassen. Schreiben: nach erfolgreicher Änderung zurückschreiben.
function read<T>(fn: (r: Repo) => T): T {
  const r = load()
  try { return fn(r) } finally { r.close() }
}
function write<T>(fn: (r: Repo) => T): T {
  const r = load()
  try {
    const out = fn(r)
    store(r)
    return out
  } finally { r.close() }
}

/* ---------- Antworten ---------- */
type Result = { content: { type: 'text'; text: string }[]; isError?: boolean }
function ok(text: string, data?: unknown): Result {
  return { content: [{ type: 'text', text: data === undefined ? text : text + '\n\n```json\n' + JSON.stringify(data, null, 1) + '\n```' }] }
}
function fail(e: unknown): Result {
  const msg = e instanceof FileError || e instanceof UserError ? e.message : 'Fehler: ' + (e instanceof Error ? e.message : String(e))
  return { content: [{ type: 'text', text: msg }], isError: true }
}
class UserError extends Error {}
function guard<A>(fn: (a: A) => Result | Promise<Result>) {
  return async (a: A): Promise<Result> => { try { return await fn(a) } catch (e) { return fail(e) } }
}

const SENDER_LABEL: Record<string, string> = {
  name: 'Firmenname', street: 'Straße', zip: 'PLZ', city: 'Ort', country: 'Land', contactName: 'Ansprechpartner',
  email: 'E-Mail', phone: 'Telefon', web: 'Website', taxno: 'Steuernummer', vatid: 'USt-IdNr.', iban: 'IBAN', bic: 'BIC', bank: 'Bank', owner: 'Kontoinhaber',
}
function senderView(s: Sender) {
  const { logo, logoW: _w, logoH: _h, ...rest } = s
  return { ...rest, country: rest.country + ' (' + countryName(rest.country) + ')', iban: rest.iban ? fmtIban(rest.iban) : '', logo: logo ? 'vorhanden' : 'keins (nur in der Web-App hochladbar)' }
}
function senderGaps(s: Sender): string[] {
  const g: string[] = []
  if (!s.name.trim()) g.push('Firmenname')
  if (!s.street.trim() || !s.zip.trim() || !s.city.trim()) g.push('Anschrift (Straße, PLZ, Ort)')
  if (!s.taxno.trim() && !s.vatid.trim()) g.push('Steuernummer oder USt-IdNr.')
  if (!ibanOk(s.iban)) g.push(s.iban.trim() ? 'gültige IBAN (Prüfziffer passt nicht)' : 'IBAN')
  if (!s.email.trim()) g.push('E-Mail')
  if (!s.phone.trim()) g.push('Telefon (für XRechnung)')
  if (!s.contactName.trim()) g.push('Ansprechpartner (für XRechnung)')
  return g
}
function customerView(c: Customer) {
  return { id: c.id, nr: c.no, name: c.name, ansprechpartner: c.contact, strasse: c.street, plz: c.zip, ort: c.city, land: c.country, ust_idnr: c.vatid, email: c.email, leitweg_id_oder_referenz: c.buyerRef, notiz: c.note }
}
function articleView(a: Article) {
  return { id: a.id, nr: a.no, bezeichnung: a.name, beschreibung: a.desc, einheit: a.unit, preis_netto: a.price, ust: a.vat }
}
function invoiceView(r: Repo, inv: InvoiceRow) {
  const d = inv.data, T = calc(d), st = r.settings(), s = inv.sender || st.sender
  const no = inv.finalized ? inv.no : d.no.trim() || st.nextNo
  const m = missing(d, s, T)
  return {
    id: inv.id, nummer: inv.finalized ? inv.no : '(Entwurf, wird ' + no + ')', status: STATUS_LABEL[inv.status], festgeschrieben: !!inv.finalized,
    datum: deDate(d.date), faellig: deDate(dueIso(d)), betreff: subject(d, no),
    kunde: { kunde_id: d.client.customerId, name: d.client.name, anschrift: [d.client.street, [d.client.zip, d.client.city].filter(Boolean).join(' '), d.client.country !== 'DE' ? countryName(d.client.country) : ''].filter(Boolean).join(', '), email: d.client.email, ust_idnr: d.client.vatid },
    referenz: d.ref, bestellnummer: d.orderNo, umsatzsteuer: { std: 'mit USt', klein: 'Kleinunternehmer § 19', rc: 'Reverse Charge' }[d.mode], preise: d.gross === '1' ? 'brutto' : 'netto',
    positionen: T.lines.filter((l) => l.used).map((l, k) => ({ pos: k + 1, bezeichnung: d.items[l.i].t, beschreibung: d.items[l.i].d, menge: d.items[l.i].q, einheit: d.items[l.i].u, preis: d.items[l.i].p, ust: l.rate + ' %', rabatt: d.items[l.i].r ? d.items[l.i].r + ' %' : '', betrag: eur(l.amt) })),
    summen: { netto: eur(T.net), ust: eur(T.taxTotal), gesamt: eur(T.total), rabatt_gesamt: T.discAmt ? eur(T.discAmt) : '' },
    fehlt: { rechnung: m.invoice, zugferd: m.zugferd, xrechnung: m.xrechnung },
    bezahlt_am: inv.paid ? deDate(inv.paid) : '',
  }
}
function parseDate(s: string | undefined, field: string): string | undefined {
  if (s === undefined || s === '') return s
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s.trim())
  const iso = de ? de[3] + '-' + de[2].padStart(2, '0') + '-' + de[1].padStart(2, '0') : s.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new UserError(field + ': Datum bitte als TT.MM.JJJJ oder JJJJ-MM-TT angeben.')
  return iso
}
function country(v: string | undefined): string | undefined {
  if (v === undefined) return undefined
  const c = countryCode(v)
  if (!c) throw new UserError('Land „' + v + '“ unbekannt. Bitte als Ländercode angeben, z. B. DE, AT, CH.')
  return c
}
const pick = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>

/* ---------- Server ---------- */
const INSTRUCTIONS = `Dieser Server verwaltet die Rechnungsdatei des Nutzers (Kunden, Artikel, Rechnungen, E-Rechnungen ZUGFeRD und XRechnung). Alles bleibt lokal auf seinem Rechner.

Arbeite im Interview-Stil:
- Rufe zuerst "status" auf. Er zeigt, welche Angaben zur Firma noch fehlen und was offen ist.
- Was du über den Nutzer oder sein Unternehmen schon weißt (aus dem Gespräch, deinem Gedächtnis, Signaturen, Dokumenten), schlägst du vor und lässt es kurz bestätigen, statt danach zu fragen. Erfinde nie Steuernummer, USt-IdNr. oder IBAN.
- Frage immer nur wenige Dinge auf einmal, in natürlicher Sprache. Speichere Antworten sofort (Teil-Updates sind erlaubt), dann frage nach dem Nächsten, was laut Antwort noch fehlt.
- Rechnungen: Kunden mit "kunden_suchen" finden oder neu anlegen, Leistungen mit "artikel_suchen". Erst einen Entwurf anlegen, die Zusammenfassung zeigen und Fehlendes erfragen.
- "rechnung_festschreiben" vergibt die endgültige Nummer und sperrt die Rechnung. Nur aufrufen, wenn der Nutzer den Entwurf ausdrücklich freigegeben hat.
- Beträge, Mengen und Daten dürfen deutsch geschrieben sein (1.234,50; 24.10.2026).
- Hinweis an den Nutzer: Ist die Datei gleichzeitig in der Web-App geöffnet, dort vorher speichern. Chrome und Edge übernehmen Änderungen der KI dann automatisch.
Keine Steuerberatung: bei steuerlichen Grundsatzfragen auf Steuerberater verweisen.`

const server = new McpServer({ name: 'oe-rechnung', version: VERSION }, { instructions: INSTRUCTIONS })

const RO = { readOnlyHint: true, openWorldHint: false }
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }

server.registerTool('status', {
  title: 'Überblick',
  description: 'Überblick über die Rechnungsdatei: Pfad, fehlende Firmenangaben, Anzahl Kunden/Artikel/Rechnungen, offene und überfällige Rechnungen, nächste Rechnungsnummer. Zu Beginn jedes Gesprächs aufrufen.',
  annotations: RO,
}, guard(() => {
  if (!existsSync(FILE)) {
    return ok('Die Datei ' + FILE + ' gibt es noch nicht. Sie wird beim ersten Speichern angelegt. Beginne mit den Firmenangaben (firma_speichern).',
      { datei: FILE, neu: true, fehlt_firma: read((r) => senderGaps(r.settings().sender)) })
  }
  return read((r) => {
    const st = r.settings(), inv = r.invoices(), t = today()
    const open = inv.filter((i) => i.status === 'offen')
    return ok('Rechnungsdatei geöffnet.', {
      datei: FILE, export_ordner: EXPORT_DIR, firma: st.sender.name || '(noch kein Name)', fehlt_firma: senderGaps(st.sender),
      kunden: r.customers().length, artikel: r.articles().length, rechnungen: inv.filter((i) => i.finalized).length,
      entwuerfe: inv.filter((i) => !i.finalized).map((i) => ({ id: i.id, kunde: i.customer, gesamt: eur(i.total) })),
      offen: { anzahl: open.length, summe: eur(open.reduce((a, i) => a + i.total, 0)) },
      ueberfaellig: open.filter((i) => i.due < t).map((i) => ({ id: i.id, nummer: i.no, kunde: i.customer, faellig: deDate(i.due), betrag: eur(i.total) })),
      naechste_rechnungsnummer: st.nextNo,
    })
  })
}))

server.registerTool('firma_lesen', {
  title: 'Firmenangaben und Vorgaben lesen',
  description: 'Liefert die gespeicherten Angaben zum eigenen Unternehmen (Absender) sowie die Vorgaben für neue Rechnungen.',
  annotations: RO,
}, guard(() => read((r) => {
  const st = r.settings()
  return ok('Gespeicherte Angaben:', { firma: senderView(st.sender), fehlt: senderGaps(st.sender), vorgaben: { ...st.defaults, naechste_rechnungsnummer: st.nextNo, naechste_kundennummer: st.nextCustomerNo } })
})))

server.registerTool('firma_speichern', {
  title: 'Firmenangaben speichern',
  description: 'Speichert Angaben zum eigenen Unternehmen (Rechnungsabsender). Nur die übergebenen Felder werden geändert, Teil-Updates sind ausdrücklich erwünscht. Antwort nennt, was noch fehlt.',
  inputSchema: {
    name: z.string().optional().describe('Name oder Firma'),
    strasse: z.string().optional(), plz: z.string().optional(), ort: z.string().optional(),
    land: z.string().optional().describe('Ländercode (DE, AT …) oder Name'),
    ansprechpartner: z.string().optional().describe('Name der Kontaktperson, für XRechnung Pflicht'),
    email: z.string().optional(), telefon: z.string().optional(), website: z.string().optional(),
    steuernummer: z.string().optional(), ust_idnr: z.string().optional(),
    iban: z.string().optional(), bic: z.string().optional(), bank: z.string().optional(),
    kontoinhaber: z.string().optional().describe('Nur falls abweichend vom Firmennamen'),
  },
  annotations: RW,
}, guard((a) => write((r) => {
  const st = r.settings()
  if (a.iban !== undefined && a.iban.trim() && !ibanOk(a.iban)) throw new UserError('Die IBAN ' + a.iban + ' ist ungültig (Prüfziffer passt nicht). Bitte noch einmal nachfragen. Nichts gespeichert.')
  Object.assign(st.sender, pick({
    name: a.name, street: a.strasse, zip: a.plz, city: a.ort, country: country(a.land), contactName: a.ansprechpartner, email: a.email, phone: a.telefon,
    web: a.website, taxno: a.steuernummer, vatid: a.ust_idnr?.replace(/\s/g, '').toUpperCase(), iban: a.iban !== undefined ? fmtIban(a.iban) : undefined,
    bic: a.bic?.replace(/\s/g, '').toUpperCase(), bank: a.bank, owner: a.kontoinhaber,
  }))
  r.saveSettings(st)
  const gaps = senderGaps(st.sender)
  const changed = Object.keys(pick(a)).map((k) => SENDER_LABEL[{ strasse: 'street', plz: 'zip', ort: 'city', land: 'country', ansprechpartner: 'contactName', telefon: 'phone', website: 'web', steuernummer: 'taxno', ust_idnr: 'vatid', kontoinhaber: 'owner' }[k] || k] || k)
  return ok('Gespeichert: ' + changed.join(', ') + '. ' + (gaps.length ? 'Es fehlt noch: ' + gaps.join(', ') + '.' : 'Die Firmenangaben sind vollständig.'), { firma: senderView(st.sender) })
})))

server.registerTool('vorgaben_speichern', {
  title: 'Vorgaben für neue Rechnungen',
  description: 'Ändert Standardwerte für neue Rechnungen und die Nummernkreise. Platzhalter in Texten: {betrag} {faellig} {nummer} {name} {datum} {kunde}.',
  inputSchema: {
    umsatzsteuer: z.enum(['mit_ust', 'kleinunternehmer', 'reverse_charge']).optional(),
    preise_brutto: z.boolean().optional().describe('true = Preise werden brutto eingegeben'),
    zahlungsziel_tage: z.number().int().min(0).max(365).optional(),
    girocode: z.boolean().optional(), zugferd_einbetten: z.boolean().optional(),
    einleitung: z.string().optional(), schlusstext: z.string().optional(),
    naechste_rechnungsnummer: z.string().optional(), naechste_kundennummer: z.string().optional(),
  },
  annotations: RW,
}, guard((a) => write((r) => {
  const st = r.settings(), d = st.defaults
  const mode: Record<string, TaxMode> = { mit_ust: 'std', kleinunternehmer: 'klein', reverse_charge: 'rc' }
  if (a.umsatzsteuer) d.mode = mode[a.umsatzsteuer]
  if (a.preise_brutto !== undefined) d.gross = a.preise_brutto ? '1' : '0'
  if (a.zahlungsziel_tage !== undefined) d.days = String(a.zahlungsziel_tage)
  if (a.girocode !== undefined) d.giro = a.girocode
  if (a.zugferd_einbetten !== undefined) d.einvoice = a.zugferd_einbetten
  if (a.einleitung !== undefined) d.intro = a.einleitung
  if (a.schlusstext !== undefined) d.outro = a.schlusstext
  if (a.naechste_rechnungsnummer?.trim()) st.nextNo = a.naechste_rechnungsnummer.trim()
  if (a.naechste_kundennummer?.trim()) st.nextCustomerNo = a.naechste_kundennummer.trim()
  r.saveSettings(st)
  return ok('Vorgaben gespeichert.', { ...d, naechste_rechnungsnummer: st.nextNo, naechste_kundennummer: st.nextCustomerNo })
})))

server.registerTool('kunden_suchen', {
  title: 'Kunden suchen',
  description: 'Sucht im Kundenstamm nach Name, Kundennummer, Ort oder E-Mail. Ohne Suchbegriff: alle Kunden.',
  inputSchema: { suche: z.string().optional() },
  annotations: RO,
}, guard((a) => read((r) => {
  const q = (a.suche || '').trim().toLowerCase()
  const list = r.customers().filter((c) => !q || [c.no, c.name, c.contact, c.city, c.email].some((v) => v.toLowerCase().includes(q)))
  return ok(list.length ? list.length + ' Kunde(n) gefunden.' : 'Kein Kunde gefunden.', list.slice(0, 50).map(customerView))
})))

const customerFields = {
  name: z.string().optional(), ansprechpartner: z.string().optional(), strasse: z.string().optional(), plz: z.string().optional(), ort: z.string().optional(),
  land: z.string().optional().describe('Ländercode oder Name, Standard DE'), ust_idnr: z.string().optional(),
  email: z.string().optional().describe('E-Mail für Rechnungen; für XRechnung die elektronische Adresse des Kunden'),
}
server.registerTool('kunde_speichern', {
  title: 'Kunde anlegen oder ändern',
  description: 'Legt einen Kunden an (ohne id) oder ändert ihn (mit id, nur übergebene Felder). Kundennummer wird automatisch vergeben, wenn leer.',
  inputSchema: {
    id: z.number().int().optional(), nr: z.string().optional(), ...customerFields,
    leitweg_id_oder_referenz: z.string().optional().describe('Leitweg-ID bei öffentlichen Auftraggebern, sonst feste Käuferreferenz'),
    notiz: z.string().optional(),
  },
  annotations: RW,
}, guard((a) => write((r) => {
  const base = a.id != null ? r.customer(a.id) : emptyCustomer()
  if (!base) throw new UserError('Kunde ' + a.id + ' nicht gefunden.')
  const c: Customer = { ...base, ...pick({ no: a.nr, name: a.name, contact: a.ansprechpartner, street: a.strasse, zip: a.plz, city: a.ort, country: country(a.land), vatid: a.ust_idnr, email: a.email, buyerRef: a.leitweg_id_oder_referenz, note: a.notiz }) }
  if (!c.name.trim()) throw new UserError('Ein Kunde braucht mindestens einen Namen.')
  const id = r.saveCustomer(c)
  const saved = r.customer(id)!
  const gaps = [!saved.street.trim() || !saved.zip.trim() || !saved.city.trim() ? 'Anschrift' : '', !saved.email.trim() ? 'E-Mail (für XRechnung)' : ''].filter(Boolean)
  return ok((a.id != null ? 'Kunde geändert' : 'Kunde angelegt') + ': ' + saved.name + ' (' + saved.no + ').' + (gaps.length ? ' Es fehlt noch: ' + gaps.join(', ') + '.' : '') +
    (saved.buyerRef && isLeitwegId(saved.buyerRef) ? ' Leitweg-ID erkannt: XRechnung für Behörden möglich.' : ''), customerView(saved))
})))

server.registerTool('artikel_suchen', {
  title: 'Artikel und Leistungen suchen',
  description: 'Sucht wiederkehrende Leistungen/Artikel mit Preis und Steuersatz.',
  inputSchema: { suche: z.string().optional() },
  annotations: RO,
}, guard((a) => read((r) => {
  const q = (a.suche || '').trim().toLowerCase()
  const list = r.articles().filter((x) => !q || [x.no, x.name, x.desc].some((v) => v.toLowerCase().includes(q)))
  return ok(list.length ? list.length + ' Artikel gefunden.' : 'Kein Artikel gefunden.', list.slice(0, 50).map(articleView))
})))

server.registerTool('artikel_speichern', {
  title: 'Artikel anlegen oder ändern',
  description: 'Legt einen Artikel bzw. eine wiederkehrende Leistung an (ohne id) oder ändert ihn (mit id).',
  inputSchema: {
    id: z.number().int().optional(), nr: z.string().optional(), bezeichnung: z.string().optional(), beschreibung: z.string().optional(),
    einheit: z.string().optional().describe('z. B. Std, Stk, Tag, Pauschal, Monat'), preis_netto: z.string().optional(), ust: z.enum(['19', '7', '0']).optional(),
  },
  annotations: RW,
}, guard((a) => write((r) => {
  const base = a.id != null ? r.articles().find((x) => x.id === a.id) : { id: null, no: '', name: '', desc: '', unit: 'Stk', price: '', vat: '19' }
  if (!base) throw new UserError('Artikel ' + a.id + ' nicht gefunden.')
  const x: Article = { ...base, ...pick({ no: a.nr, name: a.bezeichnung, desc: a.beschreibung, unit: a.einheit, price: a.preis_netto !== undefined ? money(num(a.preis_netto)) : undefined, vat: a.ust }) }
  if (!x.name.trim()) throw new UserError('Ein Artikel braucht eine Bezeichnung.')
  const id = r.saveArticle(x)
  return ok('Artikel gespeichert: ' + x.name + ' (' + eur(num(x.price)) + ' netto, ' + x.vat + ' % USt).', articleView({ ...x, id }))
})))

server.registerTool('rechnungen_auflisten', {
  title: 'Rechnungen auflisten',
  description: 'Listet Rechnungen und Entwürfe, optional gefiltert nach Status und Jahr.',
  inputSchema: { status: z.enum(['entwurf', 'offen', 'bezahlt', 'storniert']).optional(), jahr: z.string().optional() },
  annotations: RO,
}, guard((a) => read((r) => {
  const t = today()
  const list = r.invoices().filter((i) => (!a.status || i.status === a.status) && (!a.jahr || i.date.startsWith(a.jahr)))
  return ok(list.length + ' Rechnung(en).', list.slice(0, 100).map((i) => ({
    id: i.id, nummer: i.finalized ? i.no : 'Entwurf', datum: deDate(i.date), kunde: i.customer, gesamt: eur(i.total),
    status: i.status === 'offen' && i.due < t ? 'überfällig' : STATUS_LABEL[i.status], faellig: i.status === 'offen' ? deDate(i.due) : '',
  })))
})))

server.registerTool('rechnung_anzeigen', {
  title: 'Rechnung anzeigen',
  description: 'Zeigt eine Rechnung oder einen Entwurf vollständig mit Positionen, Summen und fehlenden Pflichtangaben.',
  inputSchema: { id: z.number().int() },
  annotations: RO,
}, guard((a) => read((r) => {
  const inv = r.invoice(a.id)
  if (!inv) throw new UserError('Rechnung ' + a.id + ' nicht gefunden.')
  return ok('Rechnung:', invoiceView(r, inv))
})))

const itemSchema = z.object({
  artikel_id: z.number().int().optional().describe('Übernimmt Bezeichnung, Beschreibung, Einheit, Preis und USt aus dem Artikel; weitere Felder überschreiben'),
  bezeichnung: z.string().optional(), beschreibung: z.string().optional(),
  menge: z.string().optional().describe('z. B. "2,5"'), einheit: z.string().optional(),
  preis: z.string().optional().describe('Einzelpreis, netto oder brutto je nach preise_brutto'),
  ust: z.enum(['19', '7', '0']).optional(), rabatt_prozent: z.string().optional(),
})
server.registerTool('rechnung_entwurf', {
  title: 'Rechnungsentwurf anlegen oder ändern',
  description: 'Legt einen Rechnungsentwurf an (ohne id) oder ändert einen Entwurf (mit id; nur übergebene Felder, "positionen" ersetzt alle Positionen). ' +
    'Antwort enthält Summen und fehlende Pflichtangaben je Format. Festgeschriebene Rechnungen lassen sich nicht ändern.',
  inputSchema: {
    id: z.number().int().optional(),
    kunde_id: z.number().int().optional().describe('Kunde aus dem Kundenstamm; übernimmt Anschrift und Leitweg-ID'),
    kunde: z.object(customerFields).optional().describe('Kundenanschrift direkt (ohne Kundenstamm) oder Abweichungen'),
    positionen: z.array(itemSchema).optional(),
    rechnungsdatum: z.string().optional(), leistungsdatum: z.string().optional(), leistung_bis: z.string().optional().describe('nur bei Leistungszeitraum'),
    zahlungsziel_tage: z.number().int().min(0).max(365).optional(),
    referenz: z.string().optional().describe('Käuferreferenz bzw. Leitweg-ID (für XRechnung Pflicht)'), bestellnummer: z.string().optional(),
    betreff: z.string().optional(), einleitung: z.string().optional(), schlusstext: z.string().optional(),
    umsatzsteuer: z.enum(['mit_ust', 'kleinunternehmer', 'reverse_charge']).optional(), preise_brutto: z.boolean().optional(),
    rabatt_gesamt_prozent: z.string().optional(), girocode: z.boolean().optional(),
    rechnungsnummer: z.string().optional().describe('Nur wenn ausdrücklich gewünscht; sonst nächste freie Nummer beim Festschreiben'),
  },
  annotations: RW,
}, guard((a) => write((r) => {
  let id = a.id
  if (id == null) id = r.newDraft()
  const inv = r.invoice(id)
  if (!inv) throw new UserError('Rechnung ' + id + ' nicht gefunden.')
  if (inv.finalized) throw new UserError('Rechnung ' + inv.no + ' ist festgeschrieben und kann nicht geändert werden. Für eine Korrektur: stornieren und neu ausstellen.')
  const d: InvoiceData = a.id == null ? newInvoiceData(r.settings().defaults, today()) : inv.data
  if (a.kunde_id != null) {
    const c = r.customer(a.kunde_id)
    if (!c) throw new UserError('Kunde ' + a.kunde_id + ' nicht gefunden.')
    d.client = clientFromCustomer(c)
    if (c.buyerRef && a.referenz === undefined) d.ref = c.buyerRef
  }
  if (a.kunde) {
    const k = a.kunde
    Object.assign(d.client, pick({ name: k.name, contact: k.ansprechpartner, street: k.strasse, zip: k.plz, city: k.ort, country: country(k.land), vatid: k.ust_idnr, email: k.email }))
  }
  const mode: Record<string, TaxMode> = { mit_ust: 'std', kleinunternehmer: 'klein', reverse_charge: 'rc' }
  if (a.umsatzsteuer) d.mode = mode[a.umsatzsteuer]
  if (a.preise_brutto !== undefined) d.gross = a.preise_brutto ? '1' : '0'
  if (a.positionen) {
    const arts = r.articles(), gross = d.gross === '1' && d.mode === 'std'
    d.items = a.positionen.map((p): Item => {
      let it = emptyItem()
      if (p.artikel_id != null) {
        const art = arts.find((x) => x.id === p.artikel_id)
        if (!art) throw new UserError('Artikel ' + p.artikel_id + ' nicht gefunden.')
        const net = num(art.price)
        it = { ...it, t: art.name, d: art.desc, u: art.unit || it.u, v: art.vat, p: art.price ? money(gross ? net * (1 + num(art.vat) / 100) : net) : '' }
      }
      return { ...it, ...pick({ t: p.bezeichnung, d: p.beschreibung, q: p.menge, u: p.einheit, p: p.preis, v: p.ust, r: p.rabatt_prozent }) }
    })
    if (!d.items.length) d.items = [emptyItem()]
  }
  Object.assign(d, pick({
    date: parseDate(a.rechnungsdatum, 'Rechnungsdatum'), sdate: parseDate(a.leistungsdatum, 'Leistungsdatum'), edate: parseDate(a.leistung_bis, 'Leistung bis'),
    days: a.zahlungsziel_tage !== undefined ? String(a.zahlungsziel_tage) : undefined, ref: a.referenz, orderNo: a.bestellnummer, subject: a.betreff,
    intro: a.einleitung, outro: a.schlusstext, discount: a.rabatt_gesamt_prozent, giro: a.girocode, no: a.rechnungsnummer,
  }))
  r.saveDraft(id, d)
  const view = invoiceView(r, r.invoice(id)!)
  const gaps = view.fehlt.rechnung
  return ok((a.id == null ? 'Entwurf angelegt (id ' + id + ').' : 'Entwurf ' + id + ' geändert.') + ' Gesamt ' + view.summen.gesamt + '. ' +
    (gaps.length ? 'Für eine gültige Rechnung fehlt noch: ' + gaps.join(', ') + '.' : 'Alle Pflichtangaben sind da. Vor dem Festschreiben dem Nutzer die Zusammenfassung zeigen und Freigabe einholen.'), view)
})))

server.registerTool('rechnung_festschreiben', {
  title: 'Rechnung festschreiben',
  description: 'Vergibt die endgültige Rechnungsnummer, speichert den Absender-Stand und sperrt die Rechnung gegen Änderungen. Nur nach ausdrücklicher Freigabe durch den Nutzer aufrufen.',
  inputSchema: { id: z.number().int() },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
}, guard((a) => write((r) => {
  const inv = r.invoice(a.id)
  if (!inv) throw new UserError('Rechnung ' + a.id + ' nicht gefunden.')
  const st = r.settings(), m = missing(inv.data, st.sender, calc(inv.data))
  if (!inv.finalized && m.invoice.length) throw new UserError('Noch nicht festschreibbar, es fehlt: ' + m.invoice.join(', ') + '.')
  const no = r.finalize(a.id)
  return ok('Rechnung ' + no + ' ist festgeschrieben. Mit "rechnung_exportieren" als ZUGFeRD-PDF oder XRechnung speichern.', invoiceView(r, r.invoice(a.id)!))
})))

server.registerTool('rechnung_exportieren', {
  title: 'Rechnung als Datei speichern',
  description: 'Schreibt eine festgeschriebene Rechnung als ZUGFeRD-PDF (PDF/A-3 mit eingebetteter E-Rechnung), einfaches PDF oder XRechnung-XML in den Export-Ordner neben der Rechnungsdatei.',
  inputSchema: { id: z.number().int(), format: z.enum(['zugferd', 'pdf', 'xrechnung']).default('zugferd') },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, guard(async (a) => {
  const { inv, s } = read((r) => {
    const inv = r.invoice(a.id)
    if (!inv) throw new UserError('Rechnung ' + a.id + ' nicht gefunden.')
    if (!inv.finalized) throw new UserError('Rechnung ' + a.id + ' ist noch ein Entwurf. Erst nach Freigabe durch den Nutzer festschreiben.')
    return { inv, s: inv.sender || r.settings().sender }
  })
  const m = missing(inv.data, s, calc(inv.data))
  if (a.format === 'xrechnung' && m.xrechnung.length) throw new UserError('Für XRechnung fehlt noch: ' + m.xrechnung.join(', ') + '. Firmenangaben mit firma_speichern ergänzen; Kundenangaben fließen erst in neue Rechnungen ein.')
  mkdirSync(EXPORT_DIR, { recursive: true })
  const base = join(EXPORT_DIR, 'Rechnung_' + (safeFileName(inv.no) || inv.id))
  let path: string
  if (a.format === 'xrechnung') {
    path = base + '_XRechnung.xml'
    writeFileSync(path, buildCii(inv.data, inv.no, s, calc(inv.data), 'xrechnung'))
  } else {
    path = base + '.pdf'
    writeFileSync(path, await invoicePdf(inv.data, inv.no, s, a.format === 'zugferd'))
  }
  return ok('Gespeichert: ' + path)
}))

server.registerTool('rechnung_status_setzen', {
  title: 'Zahlungsstatus setzen',
  description: 'Markiert eine festgeschriebene Rechnung als bezahlt, offen oder storniert.',
  inputSchema: { id: z.number().int(), status: z.enum(['offen', 'bezahlt', 'storniert']), bezahlt_am: z.string().optional().describe('Datum der Zahlung, Standard heute') },
  annotations: RW,
}, guard((a) => write((r) => {
  const inv = r.invoice(a.id)
  if (!inv?.finalized) throw new UserError('Nur festgeschriebene Rechnungen haben einen Zahlungsstatus.')
  r.setStatus(a.id, a.status, parseDate(a.bezahlt_am, 'Bezahlt am') || '')
  return ok('Rechnung ' + inv.no + ': ' + STATUS_LABEL[a.status] + '.')
})))

server.registerTool('entwurf_loeschen', {
  title: 'Entwurf löschen',
  description: 'Löscht einen nicht festgeschriebenen Rechnungsentwurf.',
  inputSchema: { id: z.number().int() },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
}, guard((a) => write((r) => {
  const inv = r.invoice(a.id)
  if (!inv) throw new UserError('Entwurf ' + a.id + ' nicht gefunden.')
  if (inv.finalized) throw new UserError('Festgeschriebene Rechnungen lassen sich nicht löschen, nur stornieren.')
  r.deleteDraft(a.id)
  return ok('Entwurf ' + a.id + ' gelöscht.')
})))

/* ---------- Interview-Vorlagen ---------- */
server.registerPrompt('einrichtung', {
  title: 'Firma einrichten (Interview)',
  description: 'Führt Schritt für Schritt durch die Angaben zum eigenen Unternehmen und füllt bereits Bekanntes vor.',
}, () => ({
  messages: [{ role: 'user', content: { type: 'text', text:
    'Richte mit mir meine Rechnungsdatei ein, als kurzes Interview.\n' +
    '1. Rufe "status" und "firma_lesen" auf.\n' +
    '2. Trage zusammen, was du über mich und mein Unternehmen bereits weißt (Name, Anschrift, E-Mail, Telefon, Website). Zeig mir das als Vorschlag und frag, ob es stimmt. Speichere Bestätigtes sofort mit "firma_speichern".\n' +
    '3. Frag dann nur nach dem, was noch fehlt, höchstens zwei Dinge pro Frage: zuerst Steuernummer oder USt-IdNr., dann Bankverbindung, dann Ansprechpartner und Telefon (für XRechnungen an Behörden).\n' +
    '4. Frag, ob ich Kleinunternehmer nach § 19 UStG bin und welches Zahlungsziel ich üblicherweise gebe (Standard 14 Tage), und speichere das mit "vorgaben_speichern".\n' +
    '5. Biete an, meine wichtigsten Kunden und wiederkehrenden Leistungen gleich anzulegen.\n' +
    'Erfinde keine Steuernummern oder Bankdaten. Zum Schluss: kurze Zusammenfassung.' } }],
}))

server.registerPrompt('rechnung_schreiben', {
  title: 'Rechnung schreiben (Interview)',
  description: 'Erstellt im Gespräch eine Rechnung: Kunde, Leistungen, Daten, Kontrolle, Festschreiben, Export.',
  argsSchema: { worum_geht_es: z.string().optional().describe('z. B. "12 Stunden Webdesign für Müller GmbH im Oktober"') },
}, (a) => ({
  messages: [{ role: 'user', content: { type: 'text', text:
    'Schreib mit mir eine Rechnung, als kurzes Interview.' + (a.worum_geht_es ? ' Es geht um: ' + a.worum_geht_es + '.' : '') + '\n' +
    '1. Rufe "status" auf. Fehlen Firmenangaben, kläre die zuerst.\n' +
    '2. Kunde: mit "kunden_suchen" finden. Ist er neu, die Anschrift erfragen und mit "kunde_speichern" anlegen. Bei Behörden nach der Leitweg-ID fragen.\n' +
    '3. Leistungen: mit "artikel_suchen" nach passenden Artikeln schauen und Menge, Einheit und Preis klären. Frag nach dem Leistungsdatum bzw. -zeitraum.\n' +
    '4. Lege den Entwurf mit "rechnung_entwurf" an und zeig mir eine übersichtliche Zusammenfassung mit allen Positionen und dem Gesamtbetrag. Frag nach, was laut Antwort noch fehlt.\n' +
    '5. Erst wenn ich ausdrücklich zustimme: "rechnung_festschreiben", dann "rechnung_exportieren" (ZUGFeRD-PDF; XRechnung, wenn der Kunde eine Behörde ist oder es wünscht). Nenne mir den Dateipfad.' } }],
}))

async function main() {
  SQL = await initSqlJs({ locateFile: (f) => join(dirname(process.argv[1]), f) })
  await server.connect(new StdioServerTransport())
  console.error('oe-rechnung MCP ' + VERSION + ' bereit, Datei: ' + FILE)
}
main().catch((e) => { console.error(e); process.exit(1) })
