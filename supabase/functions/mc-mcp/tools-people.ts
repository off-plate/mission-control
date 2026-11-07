/* People (relationships) and prospects (the Business pipeline). Logic lives in ops-people.ts. */
import * as ops from './ops-people.ts'
import type { Reg } from './reg.ts'

export function register(r: Reg): void {
  const { z, read, write, ann } = r
  const who = {
    id: z.string().optional().describe('Exact id from list_people (preferred)'),
    person: z.string().optional().describe('Name words, accents and word order do not matter ("Shadek Milan" finds "Milan Šádek"). Must match exactly one person.'),
  }
  const whom = {
    id: z.string().optional().describe('Exact id from list_prospects (preferred)'),
    prospect: z.string().optional().describe('Part of the business name or its domain. Must match exactly one prospect.'),
  }
  const tier = z.enum(ops.TIERS)
  const channel = z.enum(ops.CHANNELS)
  const mmdd = z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).describe('MM-DD, like 03-27')
  const year = z.number().int().min(1900).max(new Date().getFullYear())
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD, Prague time, not in the future')
  const source = z.enum(ops.SOURCES).describe('found = he found them, inbound = they reached out, friend, referral = friend of a friend, met = met in person')
  const contactFields = {
    contact: z.string().max(120).optional().describe('Name of a person AT the business. Matched by name inside it (updated), else added.'),
    role: z.string().max(80).optional(), email: z.string().max(160).optional(), phone: z.string().max(40).optional(),
    decides: z.boolean().optional().describe('This contact can say yes'),
  }
  const links = z.object({ drive: z.string().max(500).nullable().optional(), outreach: z.string().max(500).nullable().optional(), proposal: z.string().max(500).nullable().optional() })
    .describe('The three file links on the card (Drive folder, outreach doc, proposal). Only the ones you pass change; null or "" removes that link.')
  const nextFields = {
    next_step: z.string().max(300).optional().describe('The Business room\'s one next step with this client ("" empties it). Setting it restarts the "quiet for N days" clock, like in the app.'),
    waiting_on: z.enum(['me', 'client']).optional().describe('Who the next step waits on: me or client. Alone, it keeps the step\'s text.'),
  }
  const other = { other_id: z.string().optional().describe('Exact id of the other person'), other: z.string().optional().describe('Name words of the OTHER person (same forgiving matching as person)') }
  const bondWords = {
    other_is_to_person: z.string().max(80).optional().describe('What the OTHER person is to `person`, e.g. "brother", "boss", "friend"'),
    person_is_to_other: z.string().max(80).optional().describe('What `person` is to the other one (a link keeps each direction as its own word: "brother" one way can be "sister" the other)'),
  }
  const person = (i: any) => ({ id: i.id, title: i.person })
  const otherP = (i: any) => ({ id: i.other_id, title: i.other })
  const prospect = (i: any) => ({ id: i.id, title: i.prospect })

  /* ---------------- people ---------------- */
  r.tool('list_people', {
    title: 'List people',
    description: 'His People page: everyone with their circle (tier), what they are to him, job, birthday, how often he wants contact, last contact (day, channel, days ago) and whether they are overdue. Default order is the page\'s "who to reach": most overdue first. Filter by words (name, relationship, job), tier, overdue_only, or birthdays_within_days (then ordered by soonest birthday). Capped at limit (default 50).',
    inputSchema: z.object({ query: z.string().optional(), tier: tier.optional(), overdue_only: z.boolean().optional(), birthdays_within_days: z.number().int().min(0).max(366).optional(), limit: z.number().int().min(1).max(200).optional() }),
    annotations: ann.RO,
  }, (i) => read((b) => ops.listPeople(b, { query: i.query, tier: i.tier, overdueOnly: i.overdue_only, birthdaysWithinDays: i.birthdays_within_days, limit: i.limit })))

  r.tool('add_person', {
    title: 'Add a person',
    description: 'Add someone to the People page. A tier is required: take it from his words (core = family, partner, closest few; close = real close friends; friends; business = any professional tie; wider = knows and likes, rarely sees; distant = barely in touch). If he named none, ask. The contact cadence is the circle\'s default and the dot is placed on the circle\'s ring, exactly like the app\'s own "+". rel is his own words ("brother", "my accountant"). Refuses a person with the same name unless allow_duplicate is true. Create links to other people with link_people afterwards.',
    inputSchema: z.object({ name: z.string().min(1).max(120), tier, rel: z.string().max(80).optional(), job: z.string().max(120).optional(), birthday: mmdd.optional(), birth_year: year.optional(), allow_duplicate: z.boolean().optional() }),
    annotations: ann.W,
  }, ({ allow_duplicate, birth_year, ...i }) => write((b) => ops.addPerson(b, { ...i, birthYear: birth_year, allowDuplicate: allow_duplicate })))

  r.tool('edit_person', {
    title: 'Change a person',
    description: 'Change a person found by id or by name words. Use it to fix a name or spelling ("Milan Shadek" is "Milan Šádek": person "Milan Shadek", new_name "Milan Šádek"). Only the fields you pass change. Changing tier also moves the dot to the new ring but leaves the contact cadence as it was (set cadence_days too if it should change). job, birthday, birth_year and name_day_as can be set to null to clear them. reminders_off: true stops the check-in reminder for this person (false turns it back on). Clearing the birthday also clears the birth year, like the card. x and y (both) move the dot on the canvas; it is clamped into the person\'s own ring like a drag. The name day is not stored: it comes from the Czech calendar by first name, so only name_day_as ("goes by", e.g. Veronika for "Verů") is editable. Links between people: link_people, edit_link, unlink_people.',
    inputSchema: z.object({
      ...who, new_name: z.string().min(1).max(120).optional(), tier: tier.optional(), rel: z.string().max(80).optional(), job: z.string().max(120).nullable().optional(),
      birthday: mmdd.nullable().optional(), birth_year: year.nullable().optional(), name_day_as: z.string().max(120).nullable().optional(),
      cadence_days: z.number().int().min(1).max(3650).optional().describe('How often he wants to be in touch, in days'), reminders_off: z.boolean().optional(),
      x: z.number().optional().describe('Canvas x (centre = Michael at 0,0). Needs y too.'), y: z.number().optional(),
    }),
    annotations: ann.WI,
  }, (i) => write((b) => ops.editPerson(b, person(i), { name: i.new_name, tier: i.tier, rel: i.rel, job: i.job, birthday: i.birthday, birthYear: i.birth_year, nameDayAs: i.name_day_as, cadenceDays: i.cadence_days, remindersOff: i.reminders_off, x: i.x, y: i.y })))

  r.tool('delete_person', {
    title: 'Remove a person',
    description: 'Remove a person from the People page together with ALL their logged contacts and links to other people, exactly like the app\'s "Remove from People" (every removed row is buried so no device brings it back). Works however many contacts and links they have. Destructive: confirm first unless the user clearly asked for it. The app offers undo for 8 seconds or so; this connector does not, so re-adding means add_person plus log_contact and link_people again.',
    inputSchema: z.object(who), annotations: ann.D,
  }, (i) => write((b) => ops.deletePerson(b, person(i))))

  r.tool('log_contact', {
    title: 'Log that he was in touch',
    description: 'Record that Michael was in touch with someone: channel inperson (default), call, message, video or email; day defaults to today, never in the future. This is what resets the person\'s "last contact" and overdue state. The same person, day and channel twice is refused as a likely retry unless allow_duplicate is true. For a prospect (a business), use log_touch instead.',
    inputSchema: z.object({ ...who, channel: channel.optional(), date: date.optional(), allow_duplicate: z.boolean().optional() }), annotations: ann.W,
  }, (i) => write((b) => ops.logContact(b, person(i), { channel: i.channel, date: i.date, allowDuplicate: i.allow_duplicate })))

  r.tool('remove_contact', {
    title: 'Remove a logged contact',
    description: 'Undo a wrongly logged contact. Pass contact_id, or the person and the day (plus channel if two exist that day). The row is buried so it does not come back.',
    inputSchema: z.object({ contact_id: z.string().optional(), ...who, date: date.optional(), channel: channel.optional() }), annotations: ann.D,
  }, (i) => write((b) => ops.removeContact(b, { contactId: i.contact_id, person: i.contact_id ? undefined : person(i), date: i.date, channel: i.channel })))

  r.tool('edit_contact', {
    title: 'Correct a logged contact',
    description: 'Change the day and/or channel of a logged contact (find it by contact_id, or the person and its current day, plus channel if two exist that day). The People card has no in-place edit, so this does what he would do there: removes the old entry (buried) and logs a corrected one, which therefore gets a new id. The new day cannot be in the future.',
    inputSchema: z.object({ contact_id: z.string().optional(), ...who, date: date.optional().describe('The CURRENT day of the contact, to find it'), channel: channel.optional().describe('The CURRENT channel, if two contacts share the day'), new_date: date.optional(), new_channel: channel.optional(), allow_duplicate: z.boolean().optional() }),
    annotations: ann.D,
  }, (i) => write((b) => ops.editContact(b, { contactId: i.contact_id, person: i.contact_id ? undefined : person(i), date: i.date, channel: i.channel, newDate: i.new_date, newChannel: i.new_channel, allowDuplicate: i.allow_duplicate })))

  /* ---------------- links between people ---------------- */
  r.tool('link_people', {
    title: 'Link two people',
    description: 'Connect two people on the People page and say what they are to each other: "Ada\'s brother is Adam" = person "Ada", other "Adam", other_is_to_person "brother", person_is_to_other "sister". Either word or both may be given. If they are already linked, the words you pass are set on the existing link (no second link). An empty word changes nothing here (use edit_link to clear one). Both people are found with the forgiving name matching; a person cannot be linked to themselves.',
    inputSchema: z.object({ ...who, ...other, ...bondWords }), annotations: ann.WI,
  }, (i) => write((b) => ops.linkPeople(b, person(i), otherP(i), { otherIsToPerson: i.other_is_to_person, personIsToOther: i.person_is_to_other })))

  r.tool('edit_link', {
    title: 'Change what two linked people are to each other',
    description: 'Change the word(s) on an existing link between two people. other_is_to_person is what the other one is to `person`; person_is_to_other the reverse. Pass an empty string to clear a word. Refuses if they are not linked yet (use link_people).',
    inputSchema: z.object({ ...who, ...other, ...bondWords }), annotations: ann.WI,
  }, (i) => write((b) => ops.editLink(b, person(i), otherP(i), { otherIsToPerson: i.other_is_to_person, personIsToOther: i.person_is_to_other })))

  r.tool('unlink_people', {
    title: 'Remove the link between two people',
    description: 'Remove the link between two people (both directions at once; the link is buried so no device brings it back). The people themselves stay.',
    inputSchema: z.object({ ...who, ...other }), annotations: ann.D,
  }, (i) => write((b) => ops.unlinkPeople(b, person(i), otherP(i))))

  /* ---------------- prospects ---------------- */
  r.tool('list_prospects', {
    title: 'List prospects',
    description: 'The Business pipeline (hundreds of rows): always returns the count per stage (byStage), plus up to limit (default 30, max 100) matching prospects, most recently changed first, each with stage, source, value, touches, last touch, days since, the next outreach step, whether a follow-up is due, its contacts, and (Business room) the next step with who it waits on and whether it is a finished client. Filter by stage (a Sheet status: ' + ops.SHEET_STATUSES.join(', ') + '), source, words (name, domain, why, contact names), open_only (still in the email sequence, not replied/closed), needs_follow_up (contacted and the next step\'s 2 days have passed). Use get_prospect for one in full.',
    inputSchema: z.object({ stage: z.string().optional(), source: source.optional(), query: z.string().optional(), open_only: z.boolean().optional(), needs_follow_up: z.boolean().optional(), limit: z.number().int().min(1).max(100).optional() }),
    annotations: ann.RO,
  }, (i) => read((b) => ops.listProspects(b, { stage: i.stage, source: i.source, query: i.query, openOnly: i.open_only, needsFollowUp: i.needs_follow_up, limit: i.limit })))

  r.tool('get_prospect', {
    title: 'Read a prospect',
    description: 'One prospect in full: stage, why, notes, links, the Business room\'s next step, finished-client date, meetings with prep marked ready, a reply waiting for a decision, its contact people (emails, phones) and every logged touch (with ids, for remove_touch). Touch bodies are clipped to 300 characters unless full_bodies is true.',
    inputSchema: z.object({ ...whom, full_bodies: z.boolean().optional() }), annotations: ann.RO,
  }, (i) => read((b) => ops.getProspect(b, prospect(i), i.full_bodies)))

  r.tool('add_prospect', {
    title: 'Add a prospect',
    description: 'Add a business he is reaching out to. source is required (ask if unclear). stage is optional and defaults to "Ready to contact" like the app\'s Add form; any Sheet status may be given (' + ops.SHEET_STATUSES.join(', ') + '). Optional: domain, value (0-100, only if he gave one), why, notes, links (drive/outreach/proposal URLs), next_step and waiting_on, and one contact person at the business (contact + role, email, phone, decides). Refuses a prospect with the same name or domain unless allow_duplicate is true. The Prospects Sheet is the master for stage on rows it holds, and its next sync can overwrite the stage of a prospect that is also a Sheet row; it never deletes anything.',
    inputSchema: z.object({ name: z.string().min(1).max(120), source, stage: z.string().optional(), domain: z.string().max(120).optional(), value: z.number().int().min(0).max(100).optional(), why: z.string().max(200).optional(), notes: z.string().max(8000).optional(), links: links.optional(), ...nextFields, ...contactFields, allow_duplicate: z.boolean().optional() }),
    annotations: ann.W,
  }, ({ allow_duplicate, next_step, waiting_on, ...i }) => write((b) => ops.addProspect(b, { ...i, nextStep: next_step, waitingOn: waiting_on, allowDuplicate: allow_duplicate })))

  r.tool('edit_prospect', {
    title: 'Change a prospect',
    description: 'Change anything on a prospect card that the Business pages edit, found by id, name words or domain. Only the fields you pass change. stage must be a Sheet status (' + ops.SHEET_STATUSES.join(', ') + '); old lane names like "contacted" are mapped. For Lost, Rejected or Dropped also give lost_reason. domain, value, why, lost_reason and notes accept null (or "") to clear. links sets the Drive/outreach/proposal URLs. next_step / waiting_on set the Business room\'s next step and who it waits on. closed: true marks an Acquired client finished (Done), false puts it back to Active. A contact name updates that person at the business or adds a new one (to rename, remove or clear a contact use edit_prospect_contact). IMPORTANT: the Prospects Sheet is the master for stage (and the Sheet columns) on rows it holds; the app\'s next /offplate-sync overwrites a stage set here with the Sheet\'s status, so change the Sheet too if it must stick. Everything else (value, notes, links, next step, contacts, touches) is never touched by the sync. The Sheet columns themselves (country, niche, rating, web problem...) are read-only in the app and here.',
    inputSchema: z.object({
      ...whom, new_name: z.string().min(1).max(120).optional(), domain: z.string().max(120).nullable().optional(), source: source.optional(), stage: z.string().optional(),
      value: z.number().int().min(0).max(100).nullable().optional(), why: z.string().max(200).nullable().optional(), lost_reason: z.string().max(200).nullable().optional(),
      notes: z.string().max(8000).nullable().optional(), links: links.optional(), ...nextFields, closed: z.boolean().optional(), ...contactFields,
    }),
    annotations: ann.WI,
  }, ({ new_name, lost_reason, next_step, waiting_on, id, prospect: pr, ...i }) => write((b) => ops.editProspect(b, { id, title: pr }, { ...i, name: new_name, lostReason: lost_reason, nextStep: next_step, waitingOn: waiting_on })))

  r.tool('delete_prospect', {
    title: 'Remove a prospect',
    description: 'Remove a prospect card with its contacts and logged touches (they live inside the card; the card is buried so no device brings it back). Destructive: confirm first unless the user clearly asked. If the business is still a row in the Prospects Sheet, the app\'s Sheet sync may add a card for it again unless the Sheet row is dropped there (the app only keeps a deleted card away when it carries the Sheet\'s own id). The app offers undo; this connector does not.',
    inputSchema: z.object(whom), annotations: ann.D,
  }, ({ id, prospect: pr }) => write((b) => ops.deleteProspect(b, { id, title: pr })))

  r.tool('edit_prospect_contact', {
    title: 'Change a contact at a business',
    description: 'Change one contact person on a prospect card (found by their id or name words inside the business): rename them, set role/email/phone (null or "" clears), mark or unmark "decides" (the one who can say yes). Adding a person: edit_prospect with contact.',
    inputSchema: z.object({ ...whom, contact: z.string().describe('Name words or id of the contact at this business'), new_name: z.string().min(1).max(120).optional(), role: z.string().max(80).nullable().optional(), email: z.string().max(160).nullable().optional(), phone: z.string().max(40).nullable().optional(), decides: z.boolean().optional() }),
    annotations: ann.WI,
  }, ({ id, prospect: pr, contact, new_name, ...i }) => write((b) => ops.editProspectContact(b, { id, title: pr }, { id: /^pp-/.test(contact) ? contact : undefined, title: contact }, { name: new_name, ...i })))

  r.tool('remove_prospect_contact', {
    title: 'Remove a contact from a business',
    description: 'Remove one contact person from a prospect card (their id or name words). Touches already sent to them stay, just without a name, as in the app.',
    inputSchema: z.object({ ...whom, contact: z.string().describe('Name words or id of the contact at this business') }), annotations: ann.D,
  }, ({ id, prospect: pr, contact }) => write((b) => ops.removeProspectContact(b, { id, title: pr }, { id: /^pp-/.test(contact) ? contact : undefined, title: contact })))

  r.tool('remove_touch', {
    title: 'Remove a logged outreach step',
    description: 'Remove a wrongly logged outreach step from a prospect: pass touch_id (from get_prospect), or step plus day. The stage is not moved back (the app does not either; use edit_prospect for that). The app has no way to edit a touch in place: remove it and log_touch again.',
    inputSchema: z.object({ ...whom, touch_id: z.string().optional(), step: z.enum(ops.STEPS).optional(), date: date.optional() }), annotations: ann.D,
  }, ({ id, prospect: pr, touch_id, step, date: d }) => write((b) => ops.removeTouch(b, { id, title: pr }, { touchId: touch_id, step, date: d })))

  r.tool('resolve_prospect_reply', {
    title: 'Decide on a reply the Gmail sync found',
    description: 'A prospect can carry a reply the Gmail sync detected, waiting for his yes (get_prospect shows it). action accept = the app\'s "Move to Responded waiting" (stage becomes Responded waiting, the reply is cleared); dismiss = "Not a real reply" (reply cleared, stage unchanged). Refuses when no reply is waiting. Replies are only ever detected by the sync, never created here.',
    inputSchema: z.object({ ...whom, action: z.enum(['accept', 'dismiss']) }), annotations: ann.WI,
  }, ({ id, prospect: pr, action }) => write((b) => ops.resolveReply(b, { id, title: pr }, action === 'accept')))

  r.tool('mark_meeting_prep_ready', {
    title: 'Mark meeting prep as ready',
    description: 'On the Business meetings list, "Prep is ready" for a client meeting: records the calendar event\'s uid on the prospect. Get event_uid from get_calendar (each event has a uid). The app can only mark it ready, never un-mark, so this cannot either.',
    inputSchema: z.object({ ...whom, event_uid: z.string().min(1).max(500) }), annotations: ann.WI,
  }, ({ id, prospect: pr, event_uid }) => write((b) => ops.markPrepReady(b, { id, title: pr }, event_uid)))

  r.tool('log_touch', {
    title: 'Log an outreach step',
    description: 'Log an outreach step on a prospect: step work (work email), reminder, personal (personal email), call or visit. subject and body = what he actually sent, word for word (never paraphrase). The first touch moves a prospect before "Contacted" to Contacted. "to" names a contact at the business (default: the one marked as deciding); it must match a contact or the call is refused. Day defaults to today, never in the future. The same step, day and subject twice is refused as a likely retry unless allow_duplicate is true.',
    inputSchema: z.object({ ...whom, step: z.enum(ops.STEPS), date: date.optional(), to: z.string().max(120).optional(), subject: z.string().max(200).optional(), body: z.string().max(4000).optional(), allow_duplicate: z.boolean().optional() }),
    annotations: ann.W,
  }, ({ id, prospect: pr, step, allow_duplicate, ...i }) => write((b) => ops.logTouch(b, { id, title: pr }, { step, ...i, allowDuplicate: allow_duplicate })))
}
