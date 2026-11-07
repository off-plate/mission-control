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
  const person = (i: any) => ({ id: i.id, title: i.person })
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
    description: 'Add someone to the People page. A tier is required: take it from his words (core = family, partner, closest few; close = real close friends; friends; business = any professional tie; wider = knows and likes, rarely sees; distant = barely in touch). If he named none, ask. The contact cadence is the circle\'s default and the dot is placed on the circle\'s ring, exactly like the app\'s own "+". rel is his own words ("brother", "my accountant"). Refuses a person with the same name unless allow_duplicate is true. Does not create links between people.',
    inputSchema: z.object({ name: z.string().min(1).max(120), tier, rel: z.string().max(80).optional(), job: z.string().max(120).optional(), birthday: mmdd.optional(), birth_year: year.optional(), allow_duplicate: z.boolean().optional() }),
    annotations: ann.W,
  }, ({ allow_duplicate, birth_year, ...i }) => write((b) => ops.addPerson(b, { ...i, birthYear: birth_year, allowDuplicate: allow_duplicate })))

  r.tool('edit_person', {
    title: 'Change a person',
    description: 'Change a person found by id or by name words. Use it to fix a name or spelling ("Milan Shadek" is "Milan Šádek": person "Milan Shadek", new_name "Milan Šádek"). Only the fields you pass change. Changing tier also moves the dot to the new ring but leaves the contact cadence as it was (set cadence_days too if it should change). job, birthday, birth_year and name_day_as can be set to null to clear them. reminders_off: true stops the check-in reminder for this person. Not supported: moving the dot by hand, links between people.',
    inputSchema: z.object({
      ...who, new_name: z.string().min(1).max(120).optional(), tier: tier.optional(), rel: z.string().max(80).optional(), job: z.string().max(120).nullable().optional(),
      birthday: mmdd.nullable().optional(), birth_year: year.nullable().optional(), name_day_as: z.string().max(120).nullable().optional(),
      cadence_days: z.number().int().min(1).max(3650).optional().describe('How often he wants to be in touch, in days'), reminders_off: z.boolean().optional(),
    }),
    annotations: ann.WI,
  }, (i) => write((b) => ops.editPerson(b, person(i), { name: i.new_name, tier: i.tier, rel: i.rel, job: i.job, birthday: i.birthday, birthYear: i.birth_year, nameDayAs: i.name_day_as, cadenceDays: i.cadence_days, remindersOff: i.reminders_off })))

  r.tool('delete_person', {
    title: 'Remove a person',
    description: 'Remove a person from the People page, with their links and logged contacts (all buried so no device brings them back). Confirm with the user first unless they asked for it. Refuses, saying so, when the person has more than one logged contact or link: this connector\'s safety stop allows one row per list per change, so remove them in the app instead (it has undo).',
    inputSchema: z.object(who), annotations: ann.D,
  }, (i) => write((b) => ops.deletePerson(b, person(i))))

  r.tool('log_contact', {
    title: 'Log that he was in touch',
    description: 'Record that Michael was in touch with someone: channel inperson (default), call, message, video or email; day defaults to today, never in the future. This is what resets the person\'s "last contact" and overdue state. The same person, day and channel twice is refused as already logged. For a prospect (a business), use log_touch instead.',
    inputSchema: z.object({ ...who, channel: channel.optional(), date: date.optional() }), annotations: ann.W,
  }, (i) => write((b) => ops.logContact(b, person(i), { channel: i.channel, date: i.date })))

  r.tool('remove_contact', {
    title: 'Remove a logged contact',
    description: 'Undo a wrongly logged contact. Pass contact_id, or the person and the day (plus channel if two exist that day). The row is buried so it does not come back.',
    inputSchema: z.object({ contact_id: z.string().optional(), ...who, date: date.optional(), channel: channel.optional() }), annotations: ann.D,
  }, (i) => write((b) => ops.removeContact(b, { contactId: i.contact_id, person: i.contact_id ? undefined : person(i), date: i.date, channel: i.channel })))

  /* ---------------- prospects ---------------- */
  r.tool('list_prospects', {
    title: 'List prospects',
    description: 'The Business pipeline (hundreds of rows): always returns the count per stage (byStage), plus up to limit (default 30, max 100) matching prospects, most recently changed first, each with stage, source, value, touches, last touch, days since, the next outreach step, whether a follow-up is due, and its contacts. Filter by stage (a Sheet status: ' + ops.SHEET_STATUSES.join(', ') + '), source, words (name, domain, why, contact names), open_only (still in the email sequence, not replied/closed), needs_follow_up (contacted and the next step\'s 2 days have passed). Use get_prospect for one in full.',
    inputSchema: z.object({ stage: z.string().optional(), source: source.optional(), query: z.string().optional(), open_only: z.boolean().optional(), needs_follow_up: z.boolean().optional(), limit: z.number().int().min(1).max(100).optional() }),
    annotations: ann.RO,
  }, (i) => read((b) => ops.listProspects(b, { stage: i.stage, source: i.source, query: i.query, openOnly: i.open_only, needsFollowUp: i.needs_follow_up, limit: i.limit })))

  r.tool('get_prospect', {
    title: 'Read a prospect',
    description: 'One prospect in full: stage, why, notes, links, its contact people (emails, phones) and every logged touch. Touch bodies are clipped to 300 characters unless full_bodies is true.',
    inputSchema: z.object({ ...whom, full_bodies: z.boolean().optional() }), annotations: ann.RO,
  }, (i) => read((b) => ops.getProspect(b, prospect(i), i.full_bodies)))

  r.tool('add_prospect', {
    title: 'Add a prospect',
    description: 'Add a business he is reaching out to. It starts at stage "Ready to contact" with no touches, like the app. source is required (ask if unclear). A contact name (with role, email, phone, decides) adds the person at the business. Refuses a prospect with the same name or domain unless allow_duplicate is true. value (0-100) only if he gave one. Not supported: setting the stage on creation (use edit_prospect), Sheet columns.',
    inputSchema: z.object({ name: z.string().min(1).max(120), source, domain: z.string().max(120).optional(), value: z.number().int().min(0).max(100).optional(), why: z.string().max(200).optional(), ...contactFields, allow_duplicate: z.boolean().optional() }),
    annotations: ann.W,
  }, ({ allow_duplicate, ...i }) => write((b) => ops.addProspect(b, { ...i, allowDuplicate: allow_duplicate })))

  r.tool('edit_prospect', {
    title: 'Change a prospect',
    description: 'Change a prospect found by id, name words or domain. Only the fields you pass change. stage must be a Sheet status (' + ops.SHEET_STATUSES.join(', ') + '); old lane names like "contacted" are mapped. For Lost or Rejected also give lost_reason. A contact name updates that person at the business or adds a new one. Note: the Prospects Sheet is the master for stage on its rows, and its next sync can overwrite a stage set here. Not supported: deleting a prospect, notes, links, next step.',
    inputSchema: z.object({ ...whom, new_name: z.string().min(1).max(120).optional(), domain: z.string().max(120).optional(), source: source.optional(), stage: z.string().optional(), value: z.number().int().min(0).max(100).optional(), why: z.string().max(200).optional(), lost_reason: z.string().max(200).optional(), ...contactFields }),
    annotations: ann.WI,
  }, ({ new_name, lost_reason, id, prospect: pr, ...i }) => write((b) => ops.editProspect(b, { id, title: pr }, { ...i, name: new_name, lostReason: lost_reason })))

  r.tool('log_touch', {
    title: 'Log an outreach step',
    description: 'Log an outreach step on a prospect: step work (work email), reminder, personal (personal email), call or visit. subject and body = what he actually sent, word for word (never paraphrase). The first touch moves a prospect before "Contacted" to Contacted. "to" names a contact at the business (default: the one marked as deciding); it must match a contact or the call is refused. Day defaults to today, never in the future. The same step, day and subject twice is refused as already logged.',
    inputSchema: z.object({ ...whom, step: z.enum(ops.STEPS), date: date.optional(), to: z.string().max(120).optional(), subject: z.string().max(200).optional(), body: z.string().max(4000).optional() }),
    annotations: ann.W,
  }, ({ id, prospect: pr, step, ...i }) => write((b) => ops.logTouch(b, { id, title: pr }, { step, ...i })))
}
