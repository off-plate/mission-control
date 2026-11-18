/* Notes helpers shared by the page and the editor. Split out of notes.tsx in the
   #80 refactor; restored 2026-11-18 from the pre-refactor code because the
   folder was never committed and main could not build. */

export const headOf = (body: string) => (body.split('\n')[0] ?? '').replace(/^\s*#{1,3}\s+/, '')
export const restOf = (body: string) => body.split('\n').slice(1).join('\n')
export const join = (head: string, rest: string) => (rest ? `${head}\n${rest}` : head)

/** A line with its marks taken off, for places that show text rather than
 *  render it. A list row printing `**status**` is showing him the plumbing. */
export function plain(line: string): string {
  return line
    .replace(/^\s*#{1,3}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*[-*]\s+(\[[ xX]\]\s*)?/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim()
}
