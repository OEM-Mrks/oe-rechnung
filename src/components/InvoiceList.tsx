// Übersicht aller Rechnungen mit Filter nach Jahr und Status, Summen und Journal als PDF
import { useMemo, useState } from 'react'
import { getRepo, useSession } from '../lib/session'
import { STATUS_LABEL, type InvoiceRow, type InvoiceStatus } from '../lib/types'
import { deDate, download, eur, round2, today } from '../lib/util'
import { go, Icon, useToast } from './ui'

const BADGE: Record<InvoiceStatus, string> = { entwurf: '', offen: 'oe-badge--warning', bezahlt: 'oe-badge--positive', storniert: 'oe-badge--negative' }

export function InvoiceList() {
  const { version } = useSession()
  const repo = getRepo()
  const toast = useToast()
  const [year, setYear] = useState('')
  const [status, setStatus] = useState<'' | InvoiceStatus>('')
  const [busy, setBusy] = useState(false)
  const all = useMemo(() => repo.invoices(), [repo, version])
  const years = useMemo(() => [...new Set(all.map((i) => i.date.slice(0, 4)).filter(Boolean))].sort().reverse(), [all])
  const rows = all.filter((i) => (!year || i.date.startsWith(year)) && (!status || i.status === status))
  const t = today()
  const sum = rows.reduce((s, i) => {
    if (i.status === 'entwurf' || i.status === 'storniert') return s
    s.n++; s.total = round2(s.total + i.total)
    if (i.status === 'offen') { s.open = round2(s.open + i.total); if (i.due < t) s.over++ }
    return s
  }, { n: 0, total: 0, open: 0, over: 0 })

  async function journal() {
    setBusy(true)
    try {
      const { journalPdf } = await import('../lib/pdf/journal')
      const list = rows.filter((i) => i.status !== 'entwurf').slice().reverse()
      const bytes = await journalPdf(list, year, repo.settings().sender)
      download(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), 'Rechnungsjournal' + (year ? '_' + year : '') + '_' + t + '.pdf')
      toast('Journal als PDF gespeichert.', 'positive')
    } catch (e) {
      console.error(e)
      toast('Das Journal ließ sich nicht erzeugen.', 'negative')
    } finally { setBusy(false) }
  }

  return (
    <div className="stack">
      <header className="page-head row">
        <div>
          <h1 className="page-title">Rechnungen</h1>
          <p className="oe-muted">
            {sum.n} {sum.n === 1 ? 'Rechnung' : 'Rechnungen'} · {eur(sum.total)}
            {sum.open > 0 && <> · offen {eur(sum.open)}</>}
            {sum.over > 0 && <> · <span className="warn-text">{sum.over} überfällig</span></>}
          </p>
        </div>
        <button type="button" className="oe-btn oe-btn--primary" onClick={() => go('rechnung/' + repo.newDraft())}>{Icon.plus}Neue Rechnung</button>
      </header>

      <section className="oe-card">
        <div className="list-tools">
          <select className="oe-select" value={year} onChange={(e) => setYear(e.target.value)} aria-label="Jahr">
            <option value="">Alle Jahre</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className="oe-select" value={status} onChange={(e) => setStatus(e.target.value as InvoiceStatus | '')} aria-label="Status">
            <option value="">Alle Status</option>
            {(Object.keys(STATUS_LABEL) as InvoiceStatus[]).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
          </select>
          <span className="spacer" />
          <button type="button" className="oe-btn oe-btn--sm" disabled={busy || !rows.some((i) => i.status !== 'entwurf')} onClick={() => void journal()}>Journal als PDF</button>
        </div>
        {!rows.length ? (
          <p className="empty">{all.length ? 'Keine Rechnung passt zum Filter.' : 'Noch keine Rechnungen. Legen Sie mit „Neue Rechnung“ die erste an.'}</p>
        ) : (
          <table className="tbl">
            <thead><tr><th>Nr.</th><th>Datum</th><th>Kunde</th><th className="num">Brutto</th><th className="hide-sm">Fällig</th><th>Status</th></tr></thead>
            <tbody>{rows.map((i) => <Row key={i.id} i={i} t={t} />)}</tbody>
          </table>
        )}
      </section>
    </div>
  )
}

function Row({ i, t }: { i: InvoiceRow; t: string }) {
  const over = i.status === 'offen' && i.due < t
  return (
    <tr className={'clickable' + (i.status === 'storniert' ? ' is-storno' : '')} onClick={() => go('rechnung/' + i.id)}>
      <td className="oe-mono">{i.finalized ? i.no : <span className="oe-muted">{i.data.no || 'Entwurf'}</span>}</td>
      <td>{deDate(i.date)}</td>
      <td className="cust">{i.customer || <span className="oe-muted">ohne Kunde</span>}</td>
      <td className="num">{eur(i.total)}</td>
      <td className={'hide-sm' + (over ? ' warn-text' : '')}>{i.finalized && i.status === 'offen' ? deDate(i.due) : ''}</td>
      <td><span className={'oe-badge ' + BADGE[i.status]}>{over ? 'Überfällig' : STATUS_LABEL[i.status]}</span></td>
    </tr>
  )
}
