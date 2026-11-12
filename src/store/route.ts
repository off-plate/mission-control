import type { PageId } from '../types'

/* One route carries an argument: a past day. '#/day/2026-07-14' is a real
   address, so a date anywhere in the app can simply link to the day it names. */
export function routeFromHash(): { page: PageId; day: string | null } {
  const h = location.hash.replace('#/', '')
  const m = h.match(/^day\/(\d{4}-\d{2}-\d{2})$/)
  if (m) return { page: 'day', day: m[1] }
  // The give-up screen lives on the Jar page; the Jar reads the same hash.
  if (h === 'give-up') return { page: 'timeline', day: null }
  const pages: PageId[] = ['today', 'plan', 'projects', 'habits', 'routines', 'goals', 'quitting', 'settings', 'notes', 'bills', 'mymind', 'reminders', 'revolut', 'invoices', 'focus', 'board', 'zone', 'apps', 'calendar', 'assistant', 'timeline', 'skills', 'health', 'gym', 'longevity', 'watchless', 'ideas', 'prompts', 'people', 'business', 'clients', 'meetings', 'outreach']
  return { page: (pages as string[]).includes(h) ? (h as PageId) : 'today', day: null }
}
