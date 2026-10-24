// Daten aus Dateien (SQLite, JSON, altes Rechnungsbuch) auf die erwarteten Typen bringen.
// Fremde Dateien sind nicht vertrauenswürdig: nur bekannte Felder, richtige Typen, Logo nur als eingebettetes Bild.
import { countryCode } from '../einvoice/codes'
import {
  TAX_MODES, defaultDefaults, emptyArticle, emptyClient, emptyCustomer, emptyItem, emptySender, newInvoiceData,
  type Article, type Customer, type Defaults, type InvoiceData, type Item, type Sender,
} from '../types'
import { isObj, mergeTyped, today } from '../util'

const CHOICES = { mode: TAX_MODES, gross: ['0', '1'] } as const

function country(v: string): string {
  return countryCode(v) || v
}

export function normSender(v: unknown): Sender {
  const s = mergeTyped(emptySender(), v)
  s.country = country(s.country)
  if (s.logo && !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s.logo)) { s.logo = ''; s.logoW = s.logoH = 0 }
  return s
}
export function normDefaults(v: unknown): Defaults {
  return mergeTyped(defaultDefaults(), v, CHOICES)
}
export function normCustomer(v: unknown): Customer {
  const c = mergeTyped(emptyCustomer(), v)
  c.country = country(c.country)
  return c
}
export function normArticle(v: unknown): Article {
  return mergeTyped(emptyArticle(), v)
}
function normItem(v: unknown): Item {
  return mergeTyped(emptyItem(), v)
}
export function normInvoiceData(v: unknown): InvoiceData {
  const d = mergeTyped(newInvoiceData(defaultDefaults(), today()), v, CHOICES)
  const src = isObj(v) ? v : {}
  d.client = mergeTyped(emptyClient(), src.client)
  d.client.country = country(d.client.country)
  const items = Array.isArray(src.items) ? src.items.filter(isObj).map(normItem) : []
  d.items = items.length ? items : [emptyItem()]
  return d
}
