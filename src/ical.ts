/* The calendar parser lives with the Edge Function that uses it.

   Not a copy: the same file, imported from both sides. The function does the
   parsing now, because his feed is 4.8 MB and 5,462 events, and shipping that
   to the browser every ten minutes came to roughly 8 GB a month against a free
   tier of 5. The function sends the week it was asked for instead, which is a
   few kilobytes.

   The app still needs the types, and the tests still run against the same
   code, so re-exporting keeps one parser with one set of tests rather than two
   that drift. */
export * from '../supabase/functions/_shared/ical'
