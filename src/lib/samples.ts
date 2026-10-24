// Beispieldaten für Tests, Prüfskript und die Demo-Datei
import { defaultDefaults, emptyClient, newInvoiceData, type InvoiceData, type Sender } from './types'
import { emptySender } from './types'

export function sampleSender(): Sender {
  return {
    ...emptySender(), name: 'Muster Design GmbH', street: 'Musterweg 5', zip: '10115', city: 'Berlin', country: 'DE',
    contactName: 'Maria Muster', email: 'rechnung@muster-design.example', phone: '+49 30 1234567', web: 'muster-design.example',
    taxno: '30/123/45678', vatid: 'DE123456789', iban: 'DE89 3704 0044 0532 0130 00', bic: 'COBADEFFXXX', bank: 'Commerzbank',
  }
}

export function sampleInvoice(): InvoiceData {
  const d = newInvoiceData(defaultDefaults(), '2026-10-24')
  d.ref = '04011000-12345-03'
  d.orderNo = 'B-4711'
  d.client = {
    ...emptyClient(), name: 'Beispiel AG', contact: 'Herr Schmidt', street: 'Hauptstraße 1', zip: '80331', city: 'München',
    country: 'DE', email: 'einkauf@beispiel.example',
  }
  d.items = [
    { t: 'Webdesign', d: 'Startseite und drei Unterseiten', q: '12', u: 'Std', p: '95', v: '19', r: '' },
    { t: 'Fachbuch', d: '', q: '2', u: 'Stk', p: '24,90', v: '7', r: '' },
  ]
  return d
}
