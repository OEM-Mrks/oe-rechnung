// E-Rechnung im Format UN/CEFACT CII (Cross Industry Invoice):
//  - "en16931": ZUGFeRD 2 / Factur-X Profil EN 16931, eingebettet als factur-x.xml ins PDF
//  - "xrechnung": XRechnung 3.0 (CII-Syntax) als eigenständige XML-Datei
// Reihenfolge der Elemente folgt dem CII-Schema (D16B), sonst schlägt die Schemaprüfung fehl.
import { dueIso, modeNote, type Totals } from '../calc'
import type { InvoiceData, Sender } from '../types'
import { cleanIban, deDate, ibanOk, num } from '../util'
import { countryCode, isLeitwegId, unitCode } from './codes'

export type Profile = 'en16931' | 'xrechnung'
export const GUIDELINE: Record<Profile, string> = {
  en16931: 'urn:cen.eu:en16931:2017',
  xrechnung: 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0',
}
const PEPPOL_PROCESS = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0'

function x(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}
function a2(n: number): string {
  return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2)
}
function n4(n: number): string {
  return String(Math.round(n * 10000) / 10000)
}
function d102(iso: string): string {
  return '<udt:DateTimeString format="102">' + String(iso).replace(/-/g, '') + '</udt:DateTimeString>'
}
function el(name: string, value: string): string {
  return value ? '<ram:' + name + '>' + x(value) + '</ram:' + name + '>' : ''
}

interface Party { name: string; street: string; zip: string; city: string; country: string }
function addrXml(o: Party): string {
  return '<ram:PostalTradeAddress>' + el('PostcodeCode', o.zip.trim()) + el('LineOne', o.street.trim()) + el('CityName', o.city.trim()) +
    '<ram:CountryID>' + (countryCode(o.country) || 'DE') + '</ram:CountryID></ram:PostalTradeAddress>'
}

export function buildCii(inv: InvoiceData, no: string, s: Sender, T: Totals, profile: Profile): string {
  const c = inv.client, xr = profile === 'xrechnung'
  const cat = (rate: number) => (inv.mode === 'klein' ? 'E' : inv.mode === 'rc' ? 'AE' : rate > 0 ? 'S' : 'Z')
  const taxXml = (rate: number) =>
    '<ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>' + cat(rate) + '</ram:CategoryCode><ram:RateApplicablePercent>' + n4(rate) + '</ram:RateApplicablePercent>'
  const note = modeNote(inv)
  const o: string[] = []
  o.push('<?xml version="1.0" encoding="UTF-8"?>',
    '<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">',
    '<rsm:ExchangedDocumentContext>' +
      (xr ? '<ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>' + PEPPOL_PROCESS + '</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>' : '') +
      '<ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>' + GUIDELINE[profile] + '</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>',
    '<rsm:ExchangedDocument><ram:ID>' + x(no) + '</ram:ID><ram:TypeCode>380</ram:TypeCode><ram:IssueDateTime>' + d102(inv.date) + '</ram:IssueDateTime>' +
      (note ? '<ram:IncludedNote><ram:Content>' + x(note) + '</ram:Content></ram:IncludedNote>' : '') + '</rsm:ExchangedDocument>',
    '<rsm:SupplyChainTradeTransaction>')

  let pos = 0
  for (const l of T.lines) {
    if (!l.used) continue
    const it = inv.items[l.i]
    pos++
    const name = String(it.t || '').trim() || 'Position ' + pos, desc = String(it.d || '').trim()
    o.push('<ram:IncludedSupplyChainTradeLineItem>',
      '<ram:AssociatedDocumentLineDocument><ram:LineID>' + pos + '</ram:LineID></ram:AssociatedDocumentLineDocument>',
      '<ram:SpecifiedTradeProduct><ram:Name>' + x(name) + '</ram:Name>' + (desc ? '<ram:Description>' + x(desc) + '</ram:Description>' : '') + '</ram:SpecifiedTradeProduct>',
      '<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>' + n4(l.pNet) + '</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>',
      '<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="' + unitCode(it.u) + '">' + n4(l.q) + '</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>',
      '<ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax>' + taxXml(l.rate) + '</ram:ApplicableTradeTax>' +
        (l.allow ? '<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator><ram:CalculationPercent>' + n4(l.r * 100) +
          '</ram:CalculationPercent><ram:BasisAmount>' + a2(l.base) + '</ram:BasisAmount><ram:ActualAmount>' + a2(l.allow) + '</ram:ActualAmount><ram:Reason>Rabatt</ram:Reason></ram:SpecifiedTradeAllowanceCharge>' : '') +
        '<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>' + a2(l.net) + '</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement>',
      '</ram:IncludedSupplyChainTradeLineItem>')
  }

  // Vereinbarung: Käuferreferenz, Verkäufer, Käufer, Bestellung
  const vatid = s.vatid.replace(/\s/g, ''), taxno = s.taxno.trim()
  const person = s.contactName.trim() || (xr ? s.name.trim() : '')
  const contact = el('PersonName', person) +
    (s.phone.trim() ? '<ram:TelephoneUniversalCommunication>' + el('CompleteNumber', s.phone.trim()) + '</ram:TelephoneUniversalCommunication>' : '') +
    (s.email.trim() ? '<ram:EmailURIUniversalCommunication>' + el('URIID', s.email.trim()) + '</ram:EmailURIUniversalCommunication>' : '')
  const ref = inv.ref.trim()
  const buyerAddr = c.email.trim()
    ? '<ram:URIUniversalCommunication><ram:URIID schemeID="EM">' + x(c.email.trim()) + '</ram:URIID></ram:URIUniversalCommunication>'
    : isLeitwegId(ref) ? '<ram:URIUniversalCommunication><ram:URIID schemeID="0204">' + x(ref) + '</ram:URIID></ram:URIUniversalCommunication>' : ''
  o.push('<ram:ApplicableHeaderTradeAgreement>',
    el('BuyerReference', ref),
    '<ram:SellerTradeParty>' + (!vatid && taxno ? el('ID', taxno) : '') + el('Name', s.name.trim()) +
      (contact ? '<ram:DefinedTradeContact>' + contact + '</ram:DefinedTradeContact>' : '') + addrXml(s) +
      (s.email.trim() ? '<ram:URIUniversalCommunication><ram:URIID schemeID="EM">' + x(s.email.trim()) + '</ram:URIID></ram:URIUniversalCommunication>' : '') +
      (vatid ? '<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">' + x(vatid) + '</ram:ID></ram:SpecifiedTaxRegistration>' : '') +
      (taxno ? '<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">' + x(taxno) + '</ram:ID></ram:SpecifiedTaxRegistration>' : '') + '</ram:SellerTradeParty>',
    '<ram:BuyerTradeParty>' + el('ID', c.no.trim()) + el('Name', c.name.trim()) +
      (c.contact.trim() ? '<ram:DefinedTradeContact>' + el('PersonName', c.contact.trim()) + '</ram:DefinedTradeContact>' : '') + addrXml(c) + buyerAddr +
      (c.vatid.trim() ? '<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">' + x(c.vatid.replace(/\s/g, '')) + '</ram:ID></ram:SpecifiedTaxRegistration>' : '') + '</ram:BuyerTradeParty>',
    inv.orderNo.trim() ? '<ram:BuyerOrderReferencedDocument>' + el('IssuerAssignedID', inv.orderNo.trim()) + '</ram:BuyerOrderReferencedDocument>' : '',
    '</ram:ApplicableHeaderTradeAgreement>')

  // Lieferung
  const sd = inv.sdate || inv.date, period = !!inv.edate && inv.edate !== sd
  o.push('<ram:ApplicableHeaderTradeDelivery><ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime>' + d102(period ? inv.edate : sd) +
    '</ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent></ram:ApplicableHeaderTradeDelivery>')

  // Abrechnung
  const reason = inv.mode === 'klein' ? '<ram:ExemptionReason>Kleinunternehmer gemäß § 19 UStG</ram:ExemptionReason>'
    : inv.mode === 'rc' ? '<ram:ExemptionReason>Steuerschuldnerschaft des Leistungsempfängers</ram:ExemptionReason>' : ''
  const due = dueIso(inv)
  o.push('<ram:ApplicableHeaderTradeSettlement>',
    '<ram:PaymentReference>' + x(no) + '</ram:PaymentReference>',
    '<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>',
    ibanOk(s.iban)
      ? '<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:Information>SEPA-Überweisung</ram:Information><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>' + cleanIban(s.iban) +
        '</ram:IBANID>' + el('AccountName', s.owner.trim() || s.name.trim()) + '</ram:PayeePartyCreditorFinancialAccount>' +
        (s.bic.trim() ? '<ram:PayeeSpecifiedCreditorFinancialInstitution>' + el('BICID', s.bic.replace(/\s/g, '').toUpperCase()) + '</ram:PayeeSpecifiedCreditorFinancialInstitution>' : '') +
        '</ram:SpecifiedTradeSettlementPaymentMeans>'
      : '<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>1</ram:TypeCode></ram:SpecifiedTradeSettlementPaymentMeans>')
  for (const g of T.vat) {
    o.push('<ram:ApplicableTradeTax><ram:CalculatedAmount>' + a2(g.tax) + '</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>' + reason + '<ram:BasisAmount>' + a2(g.base) +
      '</ram:BasisAmount><ram:CategoryCode>' + cat(g.rate) + '</ram:CategoryCode>' + (inv.mode === 'rc' ? '<ram:ExemptionReasonCode>VATEX-EU-AE</ram:ExemptionReasonCode>' : '') +
      '<ram:RateApplicablePercent>' + n4(g.rate) + '</ram:RateApplicablePercent></ram:ApplicableTradeTax>')
  }
  if (period) o.push('<ram:BillingSpecifiedPeriod><ram:StartDateTime>' + d102(sd) + '</ram:StartDateTime><ram:EndDateTime>' + d102(inv.edate) + '</ram:EndDateTime></ram:BillingSpecifiedPeriod>')
  for (const g of T.vat) {
    if (!g.allow) continue
    o.push('<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator><ram:CalculationPercent>' + n4(T.discPct) +
      '</ram:CalculationPercent><ram:BasisAmount>' + a2(g.lines) + '</ram:BasisAmount><ram:ActualAmount>' + a2(g.allow) + '</ram:ActualAmount><ram:Reason>Rabatt</ram:Reason><ram:CategoryTradeTax>' +
      taxXml(g.rate) + '</ram:CategoryTradeTax></ram:SpecifiedTradeAllowanceCharge>')
  }
  o.push('<ram:SpecifiedTradePaymentTerms><ram:Description>' + (num(inv.days) > 0 ? 'Zahlbar bis ' + deDate(due) : 'Zahlbar sofort') +
      '</ram:Description><ram:DueDateDateTime>' + d102(due) + '</ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>',
    '<ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:LineTotalAmount>' + a2(T.sum) + '</ram:LineTotalAmount>' +
      (T.discAmt ? '<ram:AllowanceTotalAmount>' + a2(T.discAmt) + '</ram:AllowanceTotalAmount>' : '') +
      '<ram:TaxBasisTotalAmount>' + a2(T.net) + '</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="EUR">' + a2(T.taxTotal) + '</ram:TaxTotalAmount><ram:GrandTotalAmount>' + a2(T.total) +
      '</ram:GrandTotalAmount><ram:DuePayableAmount>' + a2(T.total) + '</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>',
    '</ram:ApplicableHeaderTradeSettlement></rsm:SupplyChainTradeTransaction></rsm:CrossIndustryInvoice>')
  return o.filter(Boolean).join('\n')
}
