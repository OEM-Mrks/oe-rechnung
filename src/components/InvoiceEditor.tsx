// Eine Rechnung bearbeiten (Entwurf) oder ansehen (festgeschrieben), Vorschau und Downloads
import { useEffect, useMemo, useRef, useState } from 'react'
import { calc, dueIso, modeNote, PLACEHOLDERS } from '../lib/calc'
import { missing } from '../lib/check'
import { clientFromCustomer, FileError } from '../lib/db/repo'
import { isLeitwegId, UNIT_SUGGESTIONS } from '../lib/einvoice/codes'
import { downloadPdf, downloadXRechnung, pdfBlob } from '../lib/output'
import { getRepo, useSession } from '../lib/session'
import { emptyClient, emptyItem, STATUS_LABEL, type Article, type Client, type Customer, type InvoiceData, type InvoiceRow, type Item, type TaxMode } from '../lib/types'
import { deDate, eur, fmtPct, money, num } from '../lib/util'
import { CountrySelect } from './SettingsView'
import { Field, go, Icon, useConfirm, useToast } from './ui'

export function InvoiceEditor({ id }: { id: number }) {
  const repo = getRepo()
  const { version } = useSession()
  const [row, setRow] = useState<InvoiceRow | null>(() => repo.invoice(id))
  const [data, setData] = useState<InvoiceData | null>(() => row?.data ?? null)
  // Nach Festschreiben/Entsperren/Status neu laden
  const reload = () => { const r = repo.invoice(id); setRow(r); if (r) setData(r.data) }
  if (!row || !data) return <div className="oe-card"><p>Diese Rechnung gibt es nicht (mehr). <a href="#/rechnungen">Zur Übersicht</a></p></div>
  return <Editor key={row.finalized || 'draft'} row={row} data={data} setData={setData} reload={reload} version={version} />
}

interface EditorProps { row: InvoiceRow; data: InvoiceData; setData: (d: InvoiceData) => void; reload: () => void; version: number }

function Editor({ row, data, setData, reload, version }: EditorProps) {
  const repo = getRepo()
  const toast = useToast()
  const confirm = useConfirm()
  const locked = !!row.finalized
  const settings = useMemo(() => repo.settings(), [repo, version])
  const sender = locked && row.sender ? row.sender : settings.sender
  const customers = useMemo(() => repo.customers(), [repo, version])
  const articles = useMemo(() => repo.articles(), [repo, version])
  const no = locked ? row.no : data.no.trim() || settings.nextNo
  const T = useMemo(() => calc(data), [data])
  const miss = useMemo(() => missing(data, sender, T), [data, sender, T])
  const [busy, setBusy] = useState(false)

  // Entwurf automatisch speichern
  const pending = useRef<InvoiceData | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const flush = () => { if (pending.current) { repo.saveDraft(row.id, pending.current); pending.current = null } }
  useEffect(() => () => { clearTimeout(timer.current); flush() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  function change(next: InvoiceData) {
    if (locked) return
    setData(next)
    pending.current = next
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 300)
  }
  const set = <K extends keyof InvoiceData>(k: K, v: InvoiceData[K]) => change({ ...data, [k]: v })
  const setClient = (c: Partial<Client>) => change({ ...data, client: { ...data.client, ...c } })

  /* ---------- Vorschau ---------- */
  const [preview, setPreview] = useState<string>('')
  const [showPrev, setShowPrev] = useState(false)
  useEffect(() => {
    if (!showPrev) return
    let url = '', cancelled = false
    const t = setTimeout(() => {
      pdfBlob(data, no, sender, false).then((b) => {
        if (cancelled) return
        url = URL.createObjectURL(b)
        setPreview(url + '#view=FitH')
      }).catch((e) => { console.error(e); toast('Vorschau ließ sich nicht erzeugen.', 'negative') })
    }, 500)
    return () => { cancelled = true; clearTimeout(t); if (url) setTimeout(() => URL.revokeObjectURL(url), 3000) }
  }, [showPrev, data, no, sender, toast])

  /* ---------- Festschreiben und Herunterladen ---------- */
  async function output(kind: 'pdf' | 'xrechnung') {
    flush()
    const needed = [...miss.invoice, ...(kind === 'xrechnung' ? miss.xrechnung : settings.defaults.einvoice ? miss.zugferd : [])]
    if (needed.length) return toast('Es fehlt noch: ' + needed.join(', ') + '.', 'negative')
    let r = row
    if (!locked) {
      const ok = await confirm({
        title: 'Rechnung ' + no + ' festschreiben?', ok: 'Festschreiben und herunterladen',
        body: <><p>Die Rechnung erhält die Nummer <strong>{no}</strong> und wird gesperrt, damit sie nach dem Versand nicht mehr verändert werden kann.</p>
          <p className="oe-muted">Den Kunden übernehmen wir dabei in den Kundenstamm, falls er dort noch fehlt.</p></>,
      })
      if (ok === null) return
      try { repo.finalize(row.id) } catch (e) { return toast(e instanceof FileError ? e.message : 'Festschreiben fehlgeschlagen', 'negative') }
      r = repo.invoice(row.id)!
    }
    setBusy(true)
    try {
      const s = r.sender || sender
      if (kind === 'pdf') await downloadPdf(r.data, r.no, s, settings.defaults.einvoice)
      else downloadXRechnung(r.data, r.no, s)
      toast((kind === 'pdf' ? (settings.defaults.einvoice ? 'ZUGFeRD-Rechnung' : 'PDF') : 'XRechnung') + ' ' + r.no + ' gespeichert. Datei speichern nicht vergessen.', 'positive')
    } catch (e) {
      console.error(e)
      toast('Die Datei ließ sich nicht erzeugen.', 'negative')
    } finally {
      setBusy(false)
      if (!locked) reload()
    }
  }
  async function unlock() {
    const reason = await confirm({
      title: 'Rechnung ' + row.no + ' wieder bearbeiten?', ok: 'Entsperren', input: 'Grund (wird im Protokoll vermerkt)',
      body: <p>Nur sinnvoll, wenn die Rechnung noch <strong>nicht verschickt</strong> wurde. Wurde sie schon verschickt, legen Sie stattdessen eine Korrektur an: Rechnung stornieren und eine Kopie neu ausstellen.</p>,
    })
    if (reason === null) return
    repo.unlock(row.id, reason)
    reload()
    toast('Rechnung entsperrt. Beim nächsten Herunterladen wird sie erneut festgeschrieben.')
  }
  async function removeDraft() {
    if ((await confirm({ title: 'Entwurf löschen?', danger: true, ok: 'Löschen' })) === null) return
    clearTimeout(timer.current); pending.current = null
    repo.deleteDraft(row.id)
    go('rechnungen')
  }
  function copy() {
    flush()
    const nid = repo.duplicate(row.id)
    toast('Kopie als neuer Entwurf angelegt.', 'positive')
    go('rechnung/' + nid)
  }

  /* ---------- Positionen ---------- */
  const setItem = (i: number, p: Partial<Item>) => set('items', data.items.map((it, k) => (k === i ? { ...it, ...p } : it)))
  function pickArticle(i: number, name: string) {
    const a = articles.find((x) => x.name === name)
    if (!a) return setItem(i, { t: name })
    setItem(i, articleItem(a, data.gross === '1' && data.mode === 'std', data.items[i]))
  }
  const priceLabel = T.std ? (T.gross ? 'Preis brutto' : 'Preis netto') : 'Preis'

  return (
    <div className="stack editor">
      <header className="page-head row">
        <div>
          <a className="back" href="#/rechnungen">{Icon.back}Alle Rechnungen</a>
          <h1 className="page-title">
            {locked ? 'Rechnung ' + row.no : 'Neue Rechnung'}{' '}
            <span className={'oe-badge ' + (locked ? '' : 'oe-badge--accent')}>{locked && <>{Icon.lock} </>}{STATUS_LABEL[row.status]}</span>
          </h1>
          {locked && <p className="oe-muted">Festgeschrieben am {deDate(row.finalized.slice(0, 10))}{row.status === 'bezahlt' && row.paid && <> · bezahlt am {deDate(row.paid)}</>}</p>}
        </div>
        <div className="oe-toolbar">
          {locked ? <>
            <select className="oe-select" value={row.status} aria-label="Status"
              onChange={(e) => { repo.setStatus(row.id, e.target.value as 'offen' | 'bezahlt' | 'storniert'); reload() }}>
              <option value="offen">Offen</option><option value="bezahlt">Bezahlt</option><option value="storniert">Storniert</option>
            </select>
            <button type="button" className="oe-btn oe-btn--sm" onClick={copy}>{Icon.copy}Kopie</button>
            <button type="button" className="oe-btn oe-btn--sm oe-btn--ghost" onClick={() => void unlock()}>Entsperren …</button>
          </> : <>
            <button type="button" className="oe-btn oe-btn--sm oe-btn--ghost danger-text" onClick={() => void removeDraft()}>Entwurf löschen</button>
          </>}
        </div>
      </header>

      {!sender.name.trim() && !locked && (
        <div className="notice">Ihre eigenen Angaben (Firma, Anschrift, Steuernummer, Bank) fehlen noch. <a href="#/einstellungen">Jetzt in den Einstellungen ergänzen</a></div>
      )}

      <fieldset className="plain" disabled={locked}>
        <div className="pair">
          <section className="oe-card">
            <h2 className="card-title">Kunde</h2>
            <CustomerPicker customers={customers} client={data.client}
              onPick={(c) => change({ ...data, client: c ? clientFromCustomer(c) : emptyClient(), ref: c && c.buyerRef ? c.buyerRef : c ? data.ref : '' })} />
            <div className="grid g6">
              <Field className="s6" label="Name oder Firma" value={data.client.name} onChange={(v) => setClient({ name: v })} />
              <Field className="s6" label="Ansprechpartner" opt="optional" value={data.client.contact} onChange={(v) => setClient({ contact: v })} />
              <Field className="s6" label="Straße und Hausnummer" value={data.client.street} onChange={(v) => setClient({ street: v })} />
              <Field className="s2" label="PLZ" value={data.client.zip} onChange={(v) => setClient({ zip: v })} />
              <Field className="s4" label="Ort" value={data.client.city} onChange={(v) => setClient({ city: v })} />
              <CountrySelect className="s3" value={data.client.country} onChange={(v) => setClient({ country: v })} />
              <Field className="s3" label="USt-IdNr." opt="opt." value={data.client.vatid} onChange={(v) => setClient({ vatid: v })} />
              <Field className="s3" label="Kundennummer" opt="opt." value={data.client.no} onChange={(v) => setClient({ no: v })} input={{ className: 'oe-input oe-mono' }} />
              <Field className="s3" label="E-Mail" opt="für XRechnung" value={data.client.email} onChange={(v) => setClient({ email: v })} input={{ type: 'email' }} />
            </div>
          </section>

          <section className="oe-card">
            <h2 className="card-title">Rechnungsdaten</h2>
            <div className="grid g6">
              <Field className="s3" label="Rechnungsnummer" value={locked ? row.no : data.no} onChange={(v) => set('no', v)}
                input={{ className: 'oe-input oe-mono', placeholder: settings.nextNo }} hint={locked ? '' : 'Leer = nächste freie Nummer'} />
              <Field className="s3" label="Rechnungsdatum" value={data.date} onChange={(v) => set('date', v)} input={{ type: 'date' }} />
              <Field className="s3" label="Zahlungsziel in Tagen" value={data.days} onChange={(v) => set('days', v)} input={{ inputMode: 'numeric' }}
                hint={num(data.days) > 0 ? 'Fällig am ' + deDate(dueIso(data)) : 'Sofort fällig'} />
              <Field className="s3" label="Leistungsdatum" value={data.sdate} onChange={(v) => set('sdate', v)} input={{ type: 'date' }} hint="Leer = Rechnungsdatum" />
              <Field className="s3" label="Leistung bis" opt="optional" value={data.edate} onChange={(v) => set('edate', v)} input={{ type: 'date' }} hint="Nur bei einem Zeitraum" />
              <Field className="s3" label="Bestellnummer" opt="optional" value={data.orderNo} onChange={(v) => set('orderNo', v)} />
              <Field className="s6" label="Käuferreferenz / Leitweg-ID" opt="für XRechnung Pflicht" value={data.ref} onChange={(v) => set('ref', v)} input={{ className: 'oe-input oe-mono' }}
                hint={isLeitwegId(data.ref) ? 'Leitweg-ID erkannt' : 'Bei Behörden die Leitweg-ID, sonst z. B. Ihre Referenz beim Kunden'} />
              <Field className="s6" label="Betreff" value={data.subject} onChange={(v) => set('subject', v)} input={{ placeholder: 'Rechnung Nr. ' + no }} />
              <Field className="s6" label="Einleitung" value={data.intro} onChange={(v) => set('intro', v)} multiline={3} />
            </div>
          </section>
        </div>

        <section className="oe-card">
          <div className="card-head">
            <h2 className="card-title">Positionen</h2>
            <div className="oe-toolbar">
              <div className="oe-segmented" role="radiogroup" aria-label="Umsatzsteuer">
                {([['std', 'Mit USt'], ['klein', 'Kleinunternehmer'], ['rc', 'Reverse Charge']] as [TaxMode, string][]).map(([v, l]) => (
                  <label key={v}><input type="radio" name="mode" checked={data.mode === v} onChange={() => set('mode', v)} /><span>{l}</span></label>
                ))}
              </div>
              {data.mode === 'std' && (
                <div className="oe-segmented" role="radiogroup" aria-label="Preise eingeben als">
                  <label><input type="radio" name="gross" checked={data.gross === '0'} onChange={() => set('gross', '0')} /><span>Netto</span></label>
                  <label><input type="radio" name="gross" checked={data.gross === '1'} onChange={() => set('gross', '1')} /><span>Brutto</span></label>
                </div>
              )}
            </div>
          </div>

          <div className={'items' + (data.mode === 'std' ? '' : ' no-vat')}>
            <div className="ihead" aria-hidden="true">
              <span className="i-main">Leistung</span><span className="i-q">Menge</span><span className="i-u">Einheit</span><span className="i-p">{priceLabel}</span>
              <span className="i-v">USt</span><span className="i-r">Rabatt %</span><span className="i-s">Betrag</span><span />
            </div>
            {data.items.map((it, i) => (
              <div className="item" key={i}>
                <div className="i-main">
                  <input className="oe-input" value={it.t} list="articles" placeholder="Leistung oder Artikel" aria-label={'Bezeichnung Position ' + (i + 1)} onChange={(e) => pickArticle(i, e.target.value)} />
                  <textarea className="oe-input desc" rows={1} value={it.d} placeholder="Beschreibung (optional)" aria-label={'Beschreibung Position ' + (i + 1)} onChange={(e) => setItem(i, { d: e.target.value })} />
                </div>
                <label className="i-q"><span className="cl">Menge</span><input className="oe-input num" inputMode="decimal" value={it.q} onChange={(e) => setItem(i, { q: e.target.value })} /></label>
                <label className="i-u"><span className="cl">Einheit</span><input className="oe-input" list="units" value={it.u} onChange={(e) => setItem(i, { u: e.target.value })} /></label>
                <label className="i-p"><span className="cl">{priceLabel}</span><input className="oe-input num" inputMode="decimal" placeholder="0,00" value={it.p} onChange={(e) => setItem(i, { p: e.target.value })} /></label>
                <label className="i-v"><span className="cl">USt</span>
                  <select className="oe-select" value={it.v} onChange={(e) => setItem(i, { v: e.target.value })}>{['19', '7', '0'].map((v) => <option key={v} value={v}>{v} %</option>)}</select>
                </label>
                <label className="i-r"><span className="cl">Rabatt %</span><input className="oe-input num" inputMode="decimal" placeholder="0" value={it.r} onChange={(e) => setItem(i, { r: e.target.value })} /></label>
                <div className="i-s"><span className="cl">Betrag</span><output>{T.lines[i]?.used ? eur(T.lines[i].amt) : ''}</output></div>
                <button type="button" className="oe-btn oe-btn--ghost oe-btn--icon i-del" aria-label={'Position ' + (i + 1) + ' löschen'} title="Löschen"
                  onClick={() => set('items', data.items.length > 1 ? data.items.filter((_, k) => k !== i) : [emptyItem()])}>{Icon.x}</button>
              </div>
            ))}
            <datalist id="articles">{articles.map((a) => <option key={a.id} value={a.name}>{eur(num(a.price))} netto</option>)}</datalist>
            <datalist id="units">{UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}</datalist>
          </div>
          {!locked && <button type="button" className="oe-btn add-item" onClick={() => set('items', [...data.items, { ...emptyItem(), u: data.items.at(-1)?.u || 'Std' }])}>{Icon.plus}Position hinzufügen</button>}

          <div className="totals">
            <Field className="disc" label="Rabatt auf alles" opt="in %" value={data.discount} onChange={(v) => set('discount', v)} input={{ inputMode: 'decimal', className: 'oe-input num', placeholder: '0' }} />
            <div className="totbox">
              <dl className="tl">
                {T.discAmt > 0 && <>
                  <dt>{T.gross ? 'Summe Positionen netto' : 'Summe Positionen'}</dt><dd>{eur(T.sum)}</dd>
                  <dt>Rabatt {fmtPct.format(T.discPct)} %</dt><dd>−{eur(T.discAmt)}</dd>
                </>}
                {T.std && <>
                  <dt>Nettobetrag</dt><dd>{eur(T.net)}</dd>
                  {T.taxes.map((t) => <Fragment2 key={t.rate} a={'zzgl. USt ' + fmtPct.format(t.rate) + ' %'} b={eur(t.tax)} />)}
                </>}
                <dt className="tot">Gesamtbetrag</dt><dd className="tot">{eur(T.total)}</dd>
              </dl>
              {modeNote(data) && <p className="mode-note">{modeNote(data)}</p>}
            </div>
          </div>
        </section>

        <section className="oe-card">
          <h2 className="card-title">Schlusstext</h2>
          <Field label={<span className="oe-sr">Schlusstext</span>} value={data.outro} onChange={(v) => set('outro', v)} multiline={5}
            hint={<>Platzhalter: {PLACEHOLDERS.map((p) => <code key={p}>{'{' + p + '}'}</code>).reduce<React.ReactNode[]>((a, c, i) => (i ? [...a, ' ', c] : [c]), [])}</>} />
          <label className="check"><input type="checkbox" checked={data.giro} onChange={(e) => set('giro', e.target.checked)} /><span>GiroCode zum Überweisen aufdrucken</span></label>
        </section>
      </fieldset>

      <section className="oe-panel status-panel" aria-live="polite">
        <Status title="Rechnung" items={miss.invoice} ok="Alle Pflichtangaben nach § 14 UStG sind da." />
        <Status title="ZUGFeRD" items={miss.invoice.length ? [] : miss.zugferd} ok={settings.defaults.einvoice ? 'PDF mit eingebetteter E-Rechnung (EN 16931)' : 'Eingebettete E-Rechnung ist in den Einstellungen abgeschaltet'} />
        <Status title="XRechnung" items={miss.xrechnung} ok="Bereit für XRechnung 3.0 (z. B. für Behörden)" />
      </section>

      {showPrev && <div className="preview">{preview ? <iframe title="Vorschau der Rechnung" src={preview} /> : <p className="oe-muted">Vorschau wird erstellt …</p>}</div>}

      <div className="bar">
        <div className="bar-sum"><span>Gesamt</span><strong>{eur(T.total)}</strong></div>
        <button type="button" className="oe-btn" aria-expanded={showPrev} onClick={() => setShowPrev(!showPrev)}>{Icon.eye}<span className="long">{showPrev ? 'Vorschau schließen' : 'Vorschau'}</span></button>
        <button type="button" className="oe-btn" disabled={busy} onClick={() => void output('xrechnung')}>{Icon.down}<span className="long">XRechnung</span><span className="short">XML</span></button>
        <button type="button" className="oe-btn oe-btn--primary" disabled={busy} onClick={() => void output('pdf')}>{Icon.down}<span className="long">{settings.defaults.einvoice ? 'ZUGFeRD-PDF' : 'PDF'}</span><span className="short">PDF</span></button>
      </div>
    </div>
  )
}

function Fragment2({ a, b }: { a: string; b: string }) {
  return <><dt>{a}</dt><dd>{b}</dd></>
}

function Status({ title, items, ok }: { title: string; items: string[]; ok: string }) {
  return (
    <div className={'st ' + (items.length ? 'st--miss' : 'st--ok')}>
      <span className={'oe-badge ' + (items.length ? 'oe-badge--warning' : 'oe-badge--positive')}>{title}</span>
      <span>{items.length ? 'Es fehlt: ' + items.join(', ') + '.' : ok}</span>
    </div>
  )
}

function CustomerPicker({ customers, client, onPick }: { customers: Customer[]; client: Client; onPick: (c: Customer | null) => void }) {
  if (!customers.length) return <p className="oe-hint picker-hint">Noch keine Kunden im Kundenstamm. Neue Kunden werden beim Festschreiben automatisch angelegt.</p>
  return (
    <div className="oe-field picker">
      <label className="oe-label" htmlFor="cust-pick">Aus dem Kundenstamm</label>
      <select id="cust-pick" className="oe-select" value={client.customerId ?? ''} onChange={(e) => onPick(customers.find((c) => String(c.id) === e.target.value) || null)}>
        <option value="">– neuer Kunde –</option>
        {customers.map((c) => <option key={c.id} value={c.id!}>{c.name}{c.city ? ', ' + c.city : ''}{c.no ? ' (' + c.no + ')' : ''}</option>)}
      </select>
    </div>
  )
}

function articleItem(a: Article, gross: boolean, cur: Item): Item {
  const net = num(a.price), rate = num(a.vat)
  return { ...cur, t: a.name, d: cur.d || a.desc, u: a.unit || cur.u, v: a.vat, p: a.price ? money(gross ? net * (1 + rate / 100) : net) : cur.p }
}
