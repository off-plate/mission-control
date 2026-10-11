/* The Business view's derived numbers.
     node --experimental-strip-types scripts/prospect-test.ts */
import { age, cleanDomain, nextStep, replyOdds } from '../src/prospectcalc.ts'

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

if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1) }
console.log('\nall passed')
