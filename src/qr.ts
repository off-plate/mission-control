/* A QR code encoder, byte mode, error correction M, versions 1 to 20. Written
   here instead of adding a dependency (the app keeps four) for one job: the
   Czech "QR Platba" square on an invoice. Follows Project Nayuki's reference
   implementation (MIT) step for step. Returns the module grid, true = dark. */

const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26]
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16]

const rawModules = (v: number): number => {
  let r = (16 * v + 128) * v + 64
  if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36 }
  return r
}
const dataCodewords = (v: number): number => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v] * BLOCKS[v]

const gfMul = (x: number, y: number): number => {
  let z = 0
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x }
  return z
}
function rsDivisor(degree: number): number[] {
  const r: number[] = new Array(degree - 1).fill(0); r.push(1)
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1] }
    root = gfMul(root, 0x02)
  }
  return r
}
function rsRemainder(data: number[], div: number[]): number[] {
  const r: number[] = div.map(() => 0)
  for (const b of data) {
    const f = b ^ (r.shift() as number); r.push(0)
    div.forEach((c, i) => { r[i] ^= gfMul(c, f) })
  }
  return r
}

export function qrMatrix(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text))
  let ver = 1
  for (; ver <= 20; ver++) {
    const ccBits = ver < 10 ? 8 : 16
    if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver) * 8) break
  }
  if (ver > 20) throw new Error('Too long for a QR code')
  const size = ver * 4 + 17
  const cap = dataCodewords(ver) * 8

  // Bits: mode, count, data, terminator, pad.
  const bits: number[] = []
  const put = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1) }
  put(4, 4); put(bytes.length, ver < 10 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  put(0, Math.min(4, cap - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2))

  // Error correction, interleaved.
  const nBlocks = BLOCKS[ver], eccLen = ECC_PER_BLOCK[ver]
  const raw = Math.floor(rawModules(ver) / 8)
  const nShort = nBlocks - (raw % nBlocks), shortLen = Math.floor(raw / nBlocks)
  const div = rsDivisor(eccLen)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1))
    k += dat.length
    const ecc = rsRemainder(dat, div)
    if (i < nShort) dat.push(0)
    blocks.push(dat.concat(ecc))
  }
  const words: number[] = []
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) words.push(b[i]) })
  }

  // Function patterns.
  const mod: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false))
  const fn: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false))
  const set = (x: number, y: number, d: boolean) => { mod[y][x] = d; fn[y][x] = true }
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy))
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4)
    }
  }
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4)
  const align: number[] = []
  if (ver > 1) {
    const n = Math.floor(ver / 7) + 2
    const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2
    align.push(6)
    for (let pos = size - 7; align.length < n; pos -= step) align.splice(1, 0, pos)
  }
  align.forEach((ax, i) => align.forEach((ay, j) => {
    const last = align.length - 1
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }))
  const format = (mask: number) => {
    const d = (0 << 3) | mask // ECC level M = 0b00
    let rem = d
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const b = ((d << 10) | rem) ^ 0x5412
    const bit = (i: number) => ((b >>> i) & 1) !== 0
    for (let i = 0; i <= 5; i++) set(8, i, bit(i))
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
    set(8, size - 8, true)
  }
  format(0)
  if (ver >= 7) {
    let rem = ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const b = (ver << 12) | rem
    for (let i = 0; i < 18; i++) {
      const d = ((b >>> i) & 1) !== 0, a = size - 11 + (i % 3), c = Math.floor(i / 3)
      set(a, c, d); set(c, a, d)
    }
  }

  // Data, zigzag from the bottom right.
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert
      if (!fn[y][x] && i < words.length * 8) { mod[y][x] = ((words[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++ }
    }
  }

  // Masks: try all eight, keep the lowest penalty.
  const MASKS: ((x: number, y: number) => boolean)[] = [
    (x, y) => (x + y) % 2 === 0, (_x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ]
  const apply = (m: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x]
  }
  const penalty = (): number => {
    let p = 0, dark = 0
    for (let a = 0; a < size; a++) {
      let rx = 1, ry = 1
      for (let b = 1; b < size; b++) {
        if (mod[a][b] === mod[a][b - 1]) { rx++; if (rx === 5) p += 3; else if (rx > 5) p++ } else rx = 1
        if (mod[b][a] === mod[b - 1][a]) { ry++; if (ry === 5) p += 3; else if (ry > 5) p++ } else ry = 1
      }
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (mod[y][x]) dark++
      if (x < size - 1 && y < size - 1 && mod[y][x] === mod[y][x + 1] && mod[y][x] === mod[y + 1][x] && mod[y][x] === mod[y + 1][x + 1]) p += 3
    }
    const total = size * size
    p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
    return p
  }
  let best = 0, bestP = Infinity
  for (let m = 0; m < 8; m++) {
    apply(m); format(m)
    const pm = penalty()
    if (pm < bestP) { bestP = pm; best = m }
    apply(m)
  }
  apply(best); format(best)
  return mod
}

/** The grid as one SVG path, a module per unit, with a 4 module quiet zone. */
export function qrSvgPath(m: boolean[][]): { d: string; size: number } {
  let d = ''
  m.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x + 4} ${y + 4}h1v1h-1z` }))
  return { d, size: m.length + 8 }
}
