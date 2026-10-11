/* The Business view's derived numbers.
     node --experimental-strip-types scripts/prospect-test.ts */
import { age, applyEvents, cleanDomain, isReady, matchProspect, nextStep, replyOdds, stepForSent } from '../src/prospectcalc.ts'

const fails: string[] = []
const ok = (n: string, c: boolean, d = ''): void => {
  console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`)
  if (!c) fails.push(n)
}
const t = (step: any, day = '2026-10-01') => ({ id: step, step, day })
const base = { stage: 'contacted' as const, source: 'found' as const, people: [], touches: [] as any[], createdAt: new Date('2026-09-20T12:00:00').getTime() }

ok('domain cleaned', cleanDomain(' https://www.Pekarna.cz/kontakt?x=1 ') === 'pekarna.cz')
ok('next is work email first', nextStep(base) === 'work')
ok('next skips what is done', nextStep({ ...base, touches: [t('work'), t('reminder')] }) === 'personal')
ok('call or visit after three emails', nextStep({ ...base, touches: [t('work'), t('reminder'), t('personal')] }) === 'callOrVisit')
ok('nothing after a call', nextStep({ ...base, touches: [t('work'), t('reminder'), t('personal'), t('call')] }) === null)
ok('no next step in conversation', nextStep({ ...base, stage: 'talking' }) === null)
ok('age from last touch', age({ ...base, touches: [t('work', '2026-09-25'), t('reminder', '2026-10-01')] }, '2026-10-04').days === 3)
ok('age from added', age(base, '2026-10-04').days === 14 && age(base, '2026-10-04').since === 'added')
ok('found, cold', replyOdds(base) === 15)
ok('inbound with a decider', replyOdds({ ...base, source: 'inbound', people: [{ id: 'a', name: 'J', decides: true, email: 'j@x.cz' }] as any }) === 70)
ok('decider without a way to reach them adds nothing', replyOdds({ ...base, people: [{ id: 'a', name: 'J', decides: true }] as any }) === 15)
ok('each unanswered touch costs 10, floor 5', replyOdds({ ...base, touches: [t('work'), t('reminder')] }) === 5)
ok('hidden once answered', replyOdds({ ...base, stage: 'talking' }) === null)

// The Gmail sync (2026-10-11)
const pr = (o: any) => ({ id: 'p', name: 'Biz', source: 'found', stage: 'reach', people: [], touches: [], createdAt: 0, updatedAt: 0, ...o })
const owner = pr({ id: 'a', domain: 'pekarna.cz', people: [{ id: 'o', name: 'Jana', email: 'Jana@Pekarna.cz' }] })
const free = pr({ id: 'b', domain: 'gmail.com', people: [{ id: 'q', name: 'Petr', email: 'petr@gmail.com' }] })
ok('match by exact email, any case', matchProspect([free, owner], 'jana@pekarna.cz')?.id === 'a')
ok('match by business domain', matchProspect([owner], 'info@pekarna.cz')?.id === 'a')
ok('freemail domain never matches strangers', matchProspect([free], 'someone@gmail.com') === undefined)
ok('alias: first email, then reminder', stepForSent({ touches: [] }, 'offplate') === 'work' && stepForSent({ touches: [t('work')] as any }, 'offplate') === 'reminder')
ok('personal address is the personal email', stepForSent({ touches: [t('work')] as any }, 'personal') === 'personal')
ok('alias after the reminder is conversation', stepForSent({ touches: [t('work'), t('reminder')] as any }, 'offplate') === null)
const ev = (id: string, kind: 'sent' | 'reply', day: string, o: any = {}) => ({ id, kind, day, via: 'offplate', counterpart: 'jana@pekarna.cz', ...o })
const r1 = applyEvents([owner as any], [ev('m2', 'sent', '2026-10-10', { subject: 'RE: Web' }), ev('m1', 'sent', '2026-10-08', { subject: 'Web' })], 5)
const p1 = r1.prospects[0]
ok('sent emails become work then reminder, by day', p1.touches.map((x) => x.step).join() === 'work,reminder' && p1.touches[0].day === '2026-10-08')
ok('first email moves it to Contacted', p1.stage === 'contacted' && p1.updatedAt === 5)
ok('touch goes to the matching person', p1.touches[0].to === 'o')
ok('both events done', r1.done.join() === 'm1,m2')
ok('applying twice adds nothing', applyEvents(r1.prospects, [ev('m1', 'sent', '2026-10-08')]).prospects[0].touches.length === 2)
const r2 = applyEvents(r1.prospects, [ev('m3', 'reply', '2026-10-11', { subject: 'Re: Web', via: null })])
ok('a reply waits for his yes, stage unchanged', r2.prospects[0].replied?.day === '2026-10-11' && r2.prospects[0].stage === 'contacted')
const r3 = applyEvents([owner as any], [ev('m9', 'sent', '2026-10-08', { counterpart: 'x@unknown.cz' })])
ok('no prospect yet: event stays open', r3.done.length === 0)
const r4 = applyEvents([{ ...owner, stage: 'talking' } as any], [ev('m5', 'sent', '2026-10-08')])
ok('in conversation: seen, no touch', r4.done.join() === 'm5' && r4.prospects[0].touches.length === 0)
ok('ready 2 days after the last touch', isReady(p1, '2026-10-12') && !isReady(p1, '2026-10-11'))
ok('never contacted is not "ready"', !isReady(owner as any, '2026-10-30'))

if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1) }
console.log('\nall passed')
