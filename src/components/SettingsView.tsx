// Einstellungen: Ihr Unternehmen (Absender), Vorgaben für neue Rechnungen, Nummernkreise
import { useId, useState } from 'react'
import { PLACEHOLDERS } from '../lib/calc'
import { COUNTRIES } from '../lib/einvoice/codes'
import { getRepo } from '../lib/session'
import type { Defaults, Sender, Settings } from '../lib/types'
import { cleanIban, fmtIban, ibanOk } from '../lib/util'
import { Field, Icon, useToast } from './ui'

export function SettingsView() {
  const [st, setSt] = useState<Settings>(() => getRepo().settings())
  const toast = useToast()
  const write = (next: Settings) => { setSt(next); getRepo().saveSettings(next) }
  const s = st.sender, d = st.defaults
  const S = (k: keyof Sender) => (v: string) => write({ ...st, sender: { ...s, [k]: v } })
  const D = <K extends keyof Defaults>(k: K, v: Defaults[K]) => write({ ...st, defaults: { ...d, [k]: v } })
  const iban = cleanIban(s.iban)

  function loadLogo(file: File) {
    if (!/^image\//.test(file.type)) return toast('Bitte eine Bilddatei wählen (PNG, JPG, SVG).', 'negative')
    const url = URL.createObjectURL(file), img = new Image()
    img.onload = () => {
      const w = img.naturalWidth || 600, h = img.naturalHeight || 200, k = Math.min(1, 800 / w, 320 / h)
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k))
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      write({ ...st, sender: { ...s, logo: c.toDataURL('image/png'), logoW: c.width, logoH: c.height } })
    }
    img.onerror = () => { URL.revokeObjectURL(url); toast('Das Bild lässt sich nicht lesen.', 'negative') }
    img.src = url
  }

  return (
    <div className="stack">
      <header className="page-head">
        <h1 className="page-title">Einstellungen</h1>
        <p className="oe-muted">Diese Angaben stehen auf jeder Rechnung. Änderungen gelten für neue Rechnungen; festgeschriebene behalten ihren Stand.</p>
      </header>

      <section className="oe-card">
        <h2 className="card-title">Ihr Unternehmen</h2>
        <div className="grid g6">
          <Field className="s6" label="Name oder Firma" value={s.name} onChange={S('name')} input={{ autoComplete: 'organization' }} />
          <Field className="s6" label="Straße und Hausnummer" value={s.street} onChange={S('street')} input={{ autoComplete: 'address-line1' }} />
          <Field className="s2" label="PLZ" value={s.zip} onChange={S('zip')} input={{ inputMode: 'numeric', autoComplete: 'postal-code' }} />
          <Field className="s4" label="Ort" value={s.city} onChange={S('city')} input={{ autoComplete: 'address-level2' }} />
          <CountrySelect className="s6" value={s.country} onChange={S('country')} />
          <div className="oe-field s6">
            <span className="oe-label">Logo <span className="oe-muted">optional, erscheint oben rechts</span></span>
            <div className="logo-row">
              {s.logo && <img src={s.logo} alt="Ihr Logo" className="logo-prev" />}
              <label className="oe-dropzone logo-drop"
                onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) loadLogo(f) }}>
                <input type="file" className="oe-sr" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) loadLogo(f) }} />
                <span><strong>Bild wählen</strong> oder hierher ziehen</span>
              </label>
              {s.logo && <button type="button" className="oe-btn oe-btn--ghost oe-btn--icon" aria-label="Logo entfernen" title="Logo entfernen" onClick={() => write({ ...st, sender: { ...s, logo: '', logoW: 0, logoH: 0 } })}>{Icon.x}</button>}
            </div>
          </div>
        </div>
      </section>

      <section className="oe-card">
        <div className="cols">
          <div className="col">
            <h2 className="card-title">Kontakt</h2>
            <Field label="Ansprechpartner" value={s.contactName} onChange={S('contactName')} hint="Für XRechnung Pflicht" input={{ autoComplete: 'name' }} />
            <Field label="E-Mail" value={s.email} onChange={S('email')} input={{ type: 'email', autoComplete: 'email' }} />
            <Field label="Telefon" value={s.phone} onChange={S('phone')} input={{ type: 'tel', autoComplete: 'tel' }} />
            <Field label="Website" value={s.web} onChange={S('web')} opt="optional" input={{ autoComplete: 'url' }} />
          </div>
          <div className="col">
            <h2 className="card-title">Steuer</h2>
            <Field label="Steuernummer" value={s.taxno} onChange={S('taxno')} input={{ placeholder: '12/345/67890' }} />
            <Field label="USt-IdNr." value={s.vatid} onChange={S('vatid')} input={{ placeholder: 'DE123456789' }} hint="Eins von beiden ist Pflicht." />
          </div>
          <div className="col">
            <h2 className="card-title">Bankverbindung</h2>
            <Field label="IBAN" value={s.iban} onChange={S('iban')} invalid={!!iban && !ibanOk(iban)}
              hint={!iban ? '' : ibanOk(iban) ? 'IBAN gültig' : 'IBAN prüfen – die Prüfziffer passt nicht.'}
              input={{ className: 'oe-input oe-mono', spellCheck: false, autoComplete: 'off', onBlur: () => { if (ibanOk(s.iban)) S('iban')(fmtIban(s.iban)) } }} />
            <Field label="BIC" opt="optional" value={s.bic} onChange={S('bic')} input={{ className: 'oe-input oe-mono', spellCheck: false }} />
            <Field label="Bank" opt="optional" value={s.bank} onChange={S('bank')} />
            <Field label="Kontoinhaber" opt="falls abweichend" value={s.owner} onChange={S('owner')} />
          </div>
        </div>
      </section>

      <section className="oe-card">
        <h2 className="card-title">Vorgaben für neue Rechnungen</h2>
        <div className="grid g6">
          <div className="oe-field s6">
            <span className="oe-label">Umsatzsteuer</span>
            <div className="oe-segmented" role="radiogroup" aria-label="Umsatzsteuer">
              {([['std', 'Mit USt'], ['klein', 'Kleinunternehmer (§ 19)'], ['rc', 'Reverse Charge']] as const).map(([v, l]) => (
                <label key={v}><input type="radio" name="def-mode" checked={d.mode === v} onChange={() => D('mode', v)} /><span>{l}</span></label>
              ))}
            </div>
          </div>
          <div className="oe-field s3">
            <span className="oe-label">Preise eingeben als</span>
            <div className="oe-segmented" role="radiogroup" aria-label="Preise eingeben als">
              <label><input type="radio" name="def-gross" checked={d.gross === '0'} onChange={() => D('gross', '0')} /><span>Netto</span></label>
              <label><input type="radio" name="def-gross" checked={d.gross === '1'} onChange={() => D('gross', '1')} /><span>Brutto</span></label>
            </div>
          </div>
          <Field className="s3" label="Zahlungsziel in Tagen" value={d.days} onChange={(v) => D('days', v)} input={{ inputMode: 'numeric' }} />
          <label className="check s3"><input type="checkbox" checked={d.einvoice} onChange={(e) => D('einvoice', e.target.checked)} /><span>ZUGFeRD-Daten ins PDF einbetten</span></label>
          <label className="check s3"><input type="checkbox" checked={d.giro} onChange={(e) => D('giro', e.target.checked)} /><span>GiroCode (QR zum Überweisen) aufdrucken</span></label>
          <Field className="s6" label="Einleitung" value={d.intro} onChange={(v) => D('intro', v)} multiline={3} />
          <Field className="s6" label="Schlusstext" value={d.outro} onChange={(v) => D('outro', v)} multiline={5}
            hint={<>Platzhalter: {PLACEHOLDERS.map((p) => <code key={p}>{'{' + p + '}'}</code>).reduce<React.ReactNode[]>((a, c, i) => (i ? [...a, ' ', c] : [c]), [])}</>} />
        </div>
      </section>

      <section className="oe-card">
        <h2 className="card-title">Nummernkreise</h2>
        <div className="grid g6">
          <Field className="s3" label="Nächste Rechnungsnummer" value={st.nextNo} onChange={(v) => write({ ...st, nextNo: v })} input={{ className: 'oe-input oe-mono' }}
            hint="Wird beim Festschreiben vergeben und danach hochgezählt." />
          <Field className="s3" label="Nächste Kundennummer" value={st.nextCustomerNo} onChange={(v) => write({ ...st, nextCustomerNo: v })} input={{ className: 'oe-input oe-mono' }} />
        </div>
      </section>
    </div>
  )
}

export function CountrySelect({ value, onChange, className, label = 'Land' }: { value: string; onChange: (v: string) => void; className?: string; label?: string }) {
  const known = COUNTRIES.some(([c]) => c === value)
  const id = useId()
  return (
    <div className={'oe-field ' + (className || '')}>
      <label className="oe-label" htmlFor={id}>{label}</label>
      <select id={id} className="oe-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {!known && <option value={value}>{value || 'bitte wählen'}</option>}
        {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
      </select>
    </div>
  )
}
