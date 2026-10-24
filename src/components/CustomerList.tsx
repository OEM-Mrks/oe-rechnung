// Kundenstamm: Liste mit Suche, Formular zum Anlegen und Bearbeiten
import { useMemo, useState } from 'react'
import { clientFromCustomer } from '../lib/db/repo'
import { countryName, isLeitwegId } from '../lib/einvoice/codes'
import { getRepo, useSession } from '../lib/session'
import { emptyCustomer, newInvoiceData, type Customer } from '../lib/types'
import { today } from '../lib/util'
import { CountrySelect } from './SettingsView'
import { Field, go, Icon, useConfirm, useToast } from './ui'

export function CustomerList() {
  const { version } = useSession()
  const repo = getRepo()
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<Customer | null>(null)
  const list = useMemo(() => repo.customers(), [repo, version])
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    return n ? list.filter((c) => [c.no, c.name, c.contact, c.city, c.email].some((v) => v.toLowerCase().includes(n))) : list
  }, [list, q])

  return (
    <div className="stack">
      <header className="page-head row">
        <div>
          <h1 className="page-title">Kunden</h1>
          <p className="oe-muted">{list.length === 1 ? '1 Kunde' : list.length + ' Kunden'} · neue Kunden landen beim Festschreiben einer Rechnung automatisch hier.</p>
        </div>
        <button type="button" className="oe-btn oe-btn--primary" onClick={() => setEdit(emptyCustomer())}>{Icon.plus}Neuer Kunde</button>
      </header>

      {edit && <CustomerForm key={edit.id ?? 'neu'} initial={edit} onDone={() => setEdit(null)} />}

      <section className="oe-card">
        <div className="list-tools">
          <input className="oe-input search" type="search" placeholder="Suchen nach Name, Nummer, Ort …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Kunden suchen" />
        </div>
        {!shown.length ? <p className="empty">{list.length ? 'Kein Kunde passt zur Suche.' : 'Noch keine Kunden angelegt.'}</p> : (
          <table className="tbl">
            <thead><tr><th>Nr.</th><th>Name</th><th className="hide-sm">Ort</th><th className="hide-sm">E-Mail</th><th><span className="oe-sr">Aktionen</span></th></tr></thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => setEdit(c)}>
                  <td className="oe-mono">{c.no}</td>
                  <td><strong>{c.name}</strong>{c.contact && <span className="sub">{c.contact}</span>}</td>
                  <td className="hide-sm">{[c.zip, c.city].filter(Boolean).join(' ')}{c.country !== 'DE' && ', ' + countryName(c.country)}</td>
                  <td className="hide-sm">{c.email}</td>
                  <td className="act">
                    <button type="button" className="oe-btn oe-btn--sm" onClick={(e) => {
                      e.stopPropagation()
                      const d = newInvoiceData(repo.settings().defaults, today())
                      d.client = clientFromCustomer(c); d.ref = c.buyerRef
                      go('rechnung/' + repo.newDraft(d))
                    }}>Rechnung</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

function CustomerForm({ initial, onDone }: { initial: Customer; onDone: () => void }) {
  const repo = getRepo()
  const toast = useToast()
  const confirm = useConfirm()
  const [c, setC] = useState<Customer>(initial)
  const F = (k: keyof Customer) => (v: string) => setC({ ...c, [k]: v })
  const isNew = c.id == null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!c.name.trim()) return toast('Bitte einen Namen eingeben.', 'negative')
    repo.saveCustomer(c)
    toast(isNew ? 'Kunde angelegt.' : 'Kunde gespeichert.', 'positive')
    onDone()
  }
  async function remove() {
    if (c.id == null) return
    const n = repo.invoiceCountForCustomer(c.id)
    const ok = await confirm({
      title: 'Kunde „' + c.name + '“ löschen?', danger: true, ok: 'Löschen',
      body: <p>{n ? 'Für diesen Kunden gibt es ' + n + ' Rechnung(en). Die Rechnungen bleiben mit ihrer Anschrift erhalten, sind aber nicht mehr mit dem Kundenstamm verknüpft.' : 'Der Kunde wird aus dem Kundenstamm entfernt.'}</p>,
    })
    if (ok === null) return
    repo.deleteCustomer(c.id)
    toast('Kunde gelöscht.')
    onDone()
  }

  return (
    <form className="oe-card form-card" onSubmit={submit}>
      <h2 className="card-title">{isNew ? 'Neuer Kunde' : 'Kunde bearbeiten'}</h2>
      <div className="grid g6">
        <Field className="s4" label="Name oder Firma" value={c.name} onChange={F('name')} input={{ autoFocus: true }} />
        <Field className="s2" label="Kundennummer" value={c.no} onChange={F('no')} hint={isNew ? 'Leer = automatisch' : ''} input={{ className: 'oe-input oe-mono' }} />
        <Field className="s6" label="Ansprechpartner" opt="optional" value={c.contact} onChange={F('contact')} input={{ placeholder: 'z. Hd. Frau Müller' }} />
        <Field className="s6" label="Straße und Hausnummer" value={c.street} onChange={F('street')} />
        <Field className="s2" label="PLZ" value={c.zip} onChange={F('zip')} />
        <Field className="s4" label="Ort" value={c.city} onChange={F('city')} />
        <CountrySelect className="s3" value={c.country} onChange={F('country')} />
        <Field className="s3" label="USt-IdNr." opt="optional" value={c.vatid} onChange={F('vatid')} />
        <Field className="s3" label="E-Mail für Rechnungen" value={c.email} onChange={F('email')} input={{ type: 'email' }} hint="Für XRechnung: elektronische Adresse des Kunden" />
        <Field className="s3" label="Leitweg-ID / Käuferreferenz" opt="optional" value={c.buyerRef} onChange={F('buyerRef')} input={{ className: 'oe-input oe-mono' }}
          hint={c.buyerRef && isLeitwegId(c.buyerRef) ? 'Leitweg-ID erkannt (öffentlicher Auftraggeber)' : 'Wird in neue Rechnungen übernommen'} />
        <Field className="s6" label="Notiz" opt="nur für Sie" value={c.note} onChange={F('note')} multiline={2} />
      </div>
      <div className="form-actions">
        {!isNew && <button type="button" className="oe-btn oe-btn--ghost danger-text" onClick={() => void remove()}>Löschen</button>}
        <span className="spacer" />
        <button type="button" className="oe-btn oe-btn--ghost" onClick={onDone}>Abbrechen</button>
        <button type="submit" className="oe-btn oe-btn--primary">Speichern</button>
      </div>
    </form>
  )
}
