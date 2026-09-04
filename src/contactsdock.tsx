import type { ReactNode } from 'react'
import { useStore } from './store'
import { contactDaysSince, contactStatus } from './types'
import * as Icon from './icons'

/* THE FLOATING CONTACTS GLANCE. Same door as Note/Bills/Timeline: a chip in
   the corner dock (see dock.tsx) that opens a compact read here, with a way
   out to the full page. The compact read is deliberately narrow -- who has
   gone quiet, right now -- rather than a shrunk copy of the full board or
   table, on the same reasoning Bills' own dock panel gives for staying a
   headline instead of the whole page: a glance answers "who am I
   neglecting", not "show me everyone". */
export function ContactsChip() {
  return <Icon.DockUser size={22} />
}

export function ContactsPanel({ dockControls, onOpenFull }: { dockControls?: ReactNode; onOpenFull?: () => void }) {
  const { contacts, contactActivity, setPage, logContactActivity } = useStore()
  const openFull = () => { setPage('contacts'); onOpenFull?.() }

  const quiet = contacts
    .map((c) => ({ c, days: contactDaysSince(c, contactActivity) }))
    .filter(({ c }) => contactStatus(c, contactActivity) === 'quiet')
    .sort((a, b) => b.days - a.days)

  return (
    <div className="contactsdock-panel">
      <div className="contactsdock-head">
        <span className="contactsdock-title">Contacts</span>
        <button className="btn btn-primary dock-open-btn" onClick={openFull} title="Open Contacts">
          <Icon.ExternalLink size={13} />
          Contacts
        </button>
        {dockControls}
      </div>
      <div className="contactsdock-body">
        {contacts.length === 0 ? (
          <p className="contactsdock-empty">Nobody added yet.</p>
        ) : quiet.length === 0 ? (
          <p className="contactsdock-empty">Nobody's gone quiet right now.</p>
        ) : (
          quiet.map(({ c, days }) => (
            <div className="contactsdock-row" key={c.id}>
              <span className="contactsdock-name">{c.name}<span className="contactsdock-days">{days}d</span></span>
              <button className="contactsdock-touch" title={`Log a touch with ${c.name}`} onClick={() => logContactActivity(c.id, 'call')}>
                <Icon.Check size={13} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
