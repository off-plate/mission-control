/* OUTREACH FROM GMAIL (Google Apps Script, runs in his personal Gmail).

   florian@off-plate.com is a "Send mail as" alias of his personal Gmail, so
   every outreach email sits in that Sent folder and every reply lands in that
   inbox. Every morning and evening this asks Mission Control which addresses
   belong to prospects, finds mail to and from them, and hands it to the outreach-ingest
   function. It reads nothing else.

   Setup, once:
     1. script.google.com > New project, paste this file.
     2. Project Settings > Script properties: OUTREACH_SECRET = the same value
        set as the Supabase secret. Never put the secret in this file.
     3. Run setup() once and approve read-only Gmail access.
   The first run looks back 60 days, so earlier emails are picked up too. */

const ENDPOINT = 'https://fhfempisopwsdkmvywbt.supabase.co/functions/v1/outreach-ingest'
const ALIAS = 'florian@off-plate.com'
const TZ = 'Europe/Prague'

function setup() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t))
  /* Morning and evening is enough (his call, 2026-10-11). */
  ScriptApp.newTrigger('sync').timeBased().atHour(7).everyDays(1).inTimezone(TZ).create()
  ScriptApp.newTrigger('sync').timeBased().atHour(21).everyDays(1).inTimezone(TZ).create()
  sync()
}

function call_(payload) {
  const secret = PropertiesService.getScriptProperties().getProperty('OUTREACH_SECRET')
  if (!secret) throw new Error('Set OUTREACH_SECRET in Script properties first')
  const res = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-outreach-secret': secret }, payload: JSON.stringify(payload),
  })
  if (res.getResponseCode() !== 200) throw new Error('outreach-ingest ' + res.getResponseCode() + ': ' + res.getContentText())
  return JSON.parse(res.getContentText())
}

/* "Michael <a@b.cz>, c@d.cz" -> ['a@b.cz', 'c@d.cz'] */
function addresses_(header) {
  return (String(header || '').match(/[^\s<>,;"]+@[^\s<>,;"]+/g) || []).map((a) => a.toLowerCase())
}

/* The new text only: drop the quoted thread under it. */
function fresh_(body) {
  const lines = String(body || '').split('\n')
  const out = []
  for (const l of lines) {
    if (/^>/.test(l) || /^(On|Dne) .+(wrote|napsal\(a\)|napsal|napsala):\s*$/.test(l.trim())) break
    out.push(l)
  }
  return out.join('\n').trim().slice(0, 4000)
}

function chunks_(list, n) {
  const out = []
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n))
  return out
}

function sync() {
  const props = PropertiesService.getScriptProperties()
  const days = props.getProperty('backfilled') ? 3 : 60
  const t = call_({ action: 'targets' })
  const terms = t.emails.concat(t.domains)
  if (!terms.length) return

  const isTarget = (a) => t.emails.indexOf(a) >= 0 || t.domains.some((d) => a.endsWith('@' + d) || a.endsWith('.' + d))
  const me = Session.getActiveUser().getEmail().toLowerCase()
  const mine = (a) => a === me || a === ALIAS
  const events = []
  const seen = {}

  chunks_(terms, 15).forEach((group) => {
    const to = group.map((x) => 'to:' + x).join(' OR ')
    const from = group.map((x) => 'from:' + x).join(' OR ')
    const threads = GmailApp.search('newer_than:' + days + 'd in:sent (' + to + ')', 0, 200)
      .concat(GmailApp.search('newer_than:' + days + 'd (' + from + ')', 0, 200))
    threads.forEach((th) => th.getMessages().forEach((m) => {
      const id = m.getId()
      if (seen[id]) return
      const sender = addresses_(m.getFrom())[0] || ''
      const day = Utilities.formatDate(m.getDate(), TZ, 'yyyy-MM-dd')
      const base = { id: id, day: day, subject: m.getSubject(), body: fresh_(m.getPlainBody()) }
      if (mine(sender)) {
        const rcpt = addresses_(m.getTo()).filter(isTarget)[0]
        if (!rcpt) return
        seen[id] = true
        events.push(Object.assign(base, { kind: 'sent', via: sender === ALIAS ? 'offplate' : 'personal', counterpart: rcpt }))
      } else if (isTarget(sender)) {
        seen[id] = true
        events.push(Object.assign(base, { kind: 'reply', counterpart: sender }))
      }
    }))
  })

  if (events.length) call_({ action: 'events', events: events })
  props.setProperty('backfilled', '1')
}
