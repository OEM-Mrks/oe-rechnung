// Datenmodell. Eingaben bleiben Strings (so wie getippt, z. B. "1.234,50"); gerechnet wird in calc.ts.

export type TaxMode = 'std' | 'klein' | 'rc'
export const TAX_MODES: readonly TaxMode[] = ['std', 'klein', 'rc']
export type InvoiceStatus = 'entwurf' | 'offen' | 'bezahlt' | 'storniert'
export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  entwurf: 'Entwurf',
  offen: 'Offen',
  bezahlt: 'Bezahlt',
  storniert: 'Storniert',
}

export interface Sender {
  name: string
  street: string
  zip: string
  city: string
  country: string
  contactName: string
  email: string
  phone: string
  web: string
  taxno: string
  vatid: string
  iban: string
  bic: string
  bank: string
  owner: string
  logo: string
  logoW: number
  logoH: number
}

export interface Customer {
  id: number | null
  no: string
  name: string
  contact: string
  street: string
  zip: string
  city: string
  country: string
  vatid: string
  email: string
  buyerRef: string // Leitweg-ID oder feste Käuferreferenz (BT-10)
  note: string
}

export interface Article {
  id: number | null
  no: string
  name: string
  desc: string
  unit: string
  price: string // netto
  vat: string
}

export interface Item {
  t: string // Bezeichnung
  d: string // Beschreibung
  q: string // Menge
  u: string // Einheit
  p: string // Einzelpreis (netto oder brutto, siehe gross)
  v: string // USt-Satz
  r: string // Rabatt in %
}

// Kundenanschrift auf der Rechnung (Stand zum Zeitpunkt der Rechnung)
export type Client = Omit<Customer, 'id' | 'note'> & { customerId: number | null }

export interface InvoiceData {
  no: string // leer = nächste freie Nummer beim Festschreiben
  date: string
  sdate: string
  edate: string
  days: string
  ref: string // Käuferreferenz / Leitweg-ID (BT-10)
  orderNo: string // Bestellnummer (BT-13)
  subject: string
  intro: string
  outro: string
  mode: TaxMode
  gross: '0' | '1'
  discount: string
  giro: boolean
  client: Client
  items: Item[]
}

export interface InvoiceRow {
  id: number
  no: string
  status: InvoiceStatus
  date: string
  due: string
  customerId: number | null
  customer: string
  net: number
  tax: number
  total: number
  data: InvoiceData
  sender: Sender | null // Stand beim Festschreiben
  finalized: string
  paid: string
  created: string
  updated: string
}

export interface Defaults {
  mode: TaxMode
  gross: '0' | '1'
  giro: boolean
  einvoice: boolean // ZUGFeRD-XML ins PDF einbetten
  days: string
  intro: string
  outro: string
}

export interface Settings {
  sender: Sender
  defaults: Defaults
  nextNo: string
  nextCustomerNo: string
}

export function emptySender(): Sender {
  return {
    name: '', street: '', zip: '', city: '', country: 'DE', contactName: '', email: '', phone: '', web: '',
    taxno: '', vatid: '', iban: '', bic: '', bank: '', owner: '', logo: '', logoW: 0, logoH: 0,
  }
}
export function emptyCustomer(): Customer {
  return { id: null, no: '', name: '', contact: '', street: '', zip: '', city: '', country: 'DE', vatid: '', email: '', buyerRef: '', note: '' }
}
export function emptyClient(): Client {
  const { id: _id, note: _note, ...rest } = emptyCustomer()
  return { ...rest, customerId: null }
}
export function emptyArticle(): Article {
  return { id: null, no: '', name: '', desc: '', unit: 'Stk', price: '', vat: '19' }
}
export function emptyItem(): Item {
  return { t: '', d: '', q: '1', u: 'Std', p: '', v: '19', r: '' }
}
export function defaultDefaults(): Defaults {
  return {
    mode: 'std', gross: '0', giro: true, einvoice: true, days: '14',
    intro: 'Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihren Auftrag. Für unsere Leistungen berechnen wir Ihnen:',
    outro: 'Bitte überweisen Sie {betrag} bis zum {faellig} unter Angabe der Rechnungsnummer {nummer}.\n\nMit freundlichen Grüßen\n{name}',
  }
}
export function defaultSettings(): Settings {
  return { sender: emptySender(), defaults: defaultDefaults(), nextNo: new Date().getFullYear() + '-001', nextCustomerNo: 'K-0001' }
}
export function newInvoiceData(d: Defaults, date: string): InvoiceData {
  return {
    no: '', date, sdate: '', edate: '', days: d.days, ref: '', orderNo: '', subject: '', intro: d.intro, outro: d.outro,
    mode: d.mode, gross: d.gross, discount: '', giro: d.giro, client: emptyClient(), items: [emptyItem()],
  }
}
