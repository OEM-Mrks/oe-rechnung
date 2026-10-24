// PDF/A-3b mit eingebetteter factur-x.xml (ZUGFeRD 2 / Factur-X) aus einem jsPDF-Dokument machen
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib'
import type { PdfAssets } from './assets'

export interface PdfMeta {
  title: string
  subject: string
  author: string
}
const CREATOR = 'oe-rechnung'
const PRODUCER = 'oe-rechnung mit jsPDF und pdf-lib'

function x(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}
function b64bytes(b: string): Uint8Array {
  const s = atob(b), u = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i)
  return u
}
function xmpDate(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function buildXmp(m: PdfMeta, d: Date, zf: boolean): string {
  const li = (t: string) => '<rdf:Alt><rdf:li xml:lang="x-default">' + x(t) + '</rdf:li></rdf:Alt>'
  const prop = (n: string, desc: string) =>
    '<rdf:li rdf:parseType="Resource"><pdfaProperty:name>' + n + '</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>' + desc + '</pdfaProperty:description></rdf:li>'
  return '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>3</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description>' +
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:format>application/pdf</dc:format><dc:title>' + li(m.title) + '</dc:title>' +
      (m.author ? '<dc:creator><rdf:Seq><rdf:li>' + x(m.author) + '</rdf:li></rdf:Seq></dc:creator>' : '') + '<dc:description>' + li(m.subject) + '</dc:description></rdf:Description>' +
    '<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"><pdf:Producer>' + x(PRODUCER) + '</pdf:Producer></rdf:Description>' +
    '<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:CreatorTool>' + x(CREATOR) + '</xmp:CreatorTool><xmp:CreateDate>' + xmpDate(d) + '</xmp:CreateDate><xmp:ModifyDate>' + xmpDate(d) +
      '</xmp:ModifyDate><xmp:MetadataDate>' + xmpDate(d) + '</xmp:MetadataDate></rdf:Description>' +
    (zf ? '<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"><fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>factur-x.xml</fx:DocumentFileName><fx:Version>1.0</fx:Version><fx:ConformanceLevel>EN 16931</fx:ConformanceLevel></rdf:Description>' +
      '<rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">' +
      '<pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource"><pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema><pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI><pdfaSchema:prefix>fx</pdfaSchema:prefix><pdfaSchema:property><rdf:Seq>' +
      prop('DocumentFileName', 'The name of the embedded XML document') + prop('DocumentType', 'The type of the hybrid document in capital letters, e.g. INVOICE or ORDER') +
      prop('Version', 'The actual version of the standard applying to the embedded XML document') + prop('ConformanceLevel', 'The conformance level of the embedded XML document') +
      '</rdf:Seq></pdfaSchema:property></rdf:li></rdf:Bag></pdfaExtension:schemas></rdf:Description>' : '') +
    '</rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>'
}

export async function finishPdf(bytes: ArrayBuffer, xml: string, m: PdfMeta, assets: PdfAssets): Promise<Uint8Array> {
  const now = new Date()
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
  const ctx = pdf.context, catalog = pdf.catalog, N = PDFName.of
  pdf.setTitle(m.title); pdf.setSubject(m.subject); if (m.author) pdf.setAuthor(m.author)
  pdf.setCreator(CREATOR); pdf.setProducer(PRODUCER); pdf.setCreationDate(now); pdf.setModificationDate(now); pdf.setLanguage('de-DE')
  // Farbprofil (sRGB, CC0: saucecontrol/Compact-ICC-Profiles) als OutputIntent
  const icc = ctx.register(ctx.flateStream(b64bytes(assets.icc), { N: 3 }))
  catalog.set(N('OutputIntents'), ctx.obj([ctx.register(ctx.obj({
    Type: 'OutputIntent', S: 'GTS_PDFA1', OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'), Info: PDFString.of('sRGB IEC61966-2.1'), DestOutputProfile: icc,
  }))]))
  catalog.set(N('Metadata'), ctx.register(ctx.stream(new TextEncoder().encode(buildXmp(m, now, !!xml)), { Type: 'Metadata', Subtype: 'XML' })))
  if (xml) {
    const xb = new TextEncoder().encode(xml)
    const ef = ctx.register(ctx.flateStream(xb, { Type: 'EmbeddedFile', Subtype: 'text/xml', Params: { Size: xb.length, ModDate: PDFString.fromDate(now) } }))
    const fs = ctx.register(ctx.obj({
      Type: 'Filespec', F: PDFString.of('factur-x.xml'), UF: PDFHexString.fromText('factur-x.xml'), Desc: PDFString.of('Factur-X/ZUGFeRD-Rechnung'),
      AFRelationship: 'Alternative', EF: { F: ef, UF: ef },
    }))
    catalog.set(N('AF'), ctx.obj([fs]))
    catalog.set(N('Names'), ctx.obj({ EmbeddedFiles: { Names: [PDFString.of('factur-x.xml'), fs] } }))
  }
  // Ungenutzte Standardschriften von jsPDF entfernen (PDF/A verlangt eingebettete Schriften)
  for (const pg of pdf.getPages()) {
    const fonts = pg.node.Resources()?.lookup(N('Font'))
    if (!(fonts instanceof PDFDict)) continue
    for (const k of fonts.keys()) {
      const f = fonts.lookup(k), base = f instanceof PDFDict ? f.lookup(N('BaseFont')) : undefined
      if (base instanceof PDFName && !/NotoSans/.test(base.asString())) fonts.delete(k)
    }
  }
  return pdf.save({ useObjectStreams: false })
}
