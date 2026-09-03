/* Reading a pasted list of debts.

   Getting eight balances into Bills meant eight trips through the debt sheet,
   so the whole list can be pasted at once instead. Kept away from the sheet
   that renders it so the parsing can be reasoned about, and tested, without a
   browser. */

export interface ParsedDebtLine {
  /** What the line called it, cleaned of separators. */
  name: string
  /** Rounded crowns, or null when the line carried no readable figure. */
  amount: number | null
  /** The line as typed, so a row that failed to parse can show why. */
  raw: string
}

/** Czech figures arrive as "42 350 Kč": space-grouped thousands, comma for
 *  the decimal. JS \s already covers the non-breaking and thin spaces a copy
 *  out of a bank statement carries, so stripping it is enough. A trailing
 *  ",dd" is a real decimal; everything else that looks like grouping goes. */
export function parseAmount(text: string): number | null {
  let t = text.replace(/\s/g, '')
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.')
  else t = t.replace(/[.,]/g, '')
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

/** One debt per line, "name<separator>amount". The amount is whatever number
 *  sits at the end of the line, so ":", "-", "–", a tab or plain spaces all
 *  work, and a trailing "Kč" or "CZK" is ignored. A name may itself contain
 *  digits; only a run of digits that reaches the end of the line can be the
 *  amount. */
export function parseDebtLines(text: string): ParsedDebtLine[] {
  const rows: ParsedDebtLine[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/(\d[\d\s.,]*)\s*(?:kč|kc|czk|,-)?\.?\s*$/i)
    if (!m || m.index === undefined) {
      rows.push({ name: line, amount: null, raw: line })
      continue
    }
    const name = line.slice(0, m.index).replace(/[\s:;=|,–—-]+$/, '').trim()
    rows.push({ name: name || line, amount: name ? parseAmount(m[1]) : null, raw: line })
  }
  return rows
}
