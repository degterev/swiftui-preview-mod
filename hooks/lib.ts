// Pure helpers: reading Xcode's RenderPreview answer and sizing the pane.

export type Rendered = { path: string; label: string }

// Xcode MCP's RenderPreview answers JSON text; undefined when it rendered nothing.
export function parseRendered(text: string | undefined): Rendered | undefined {
  try {
    const out = JSON.parse(text ?? '') as {
      previewSnapshotPath?: string
      displayName?: string
      renderedDestination?: { deviceModelName?: string }
    }
    if (!out.previewSnapshotPath) return undefined
    const device = out.renderedDestination?.deviceModelName

    return { path: out.previewSnapshotPath, label: [out.displayName, device].filter(Boolean).join(' · ') }
  } catch {
    return undefined
  }
}

// The RenderPreview arguments that change the picture, for the label: `Dark Appearance · AX 3 · uk`.
// Takes the whole `tool.call` input, whose type knows nothing of an MCP tool's arguments.
export function variantLabel(input: object): string[] {
  const args = input as { previewVariantOverrides?: Record<string, unknown>; previewLocalizationOverride?: unknown }

  return [...Object.values(args.previewVariantOverrides ?? {}), args.previewLocalizationOverride]
    .filter((v): v is string => typeof v === 'string' && v !== '')
}

// PNG is read and padded here, so the mod needs no image tool.
type Chunk = { type: string; data: Uint8Array }

const view = (d: Uint8Array) => new DataView(d.buffer, d.byteOffset, d.byteLength)

function chunks(png: Uint8Array): Chunk[] {
  const out: Chunk[] = []
  for (let i = 8; i + 12 <= png.length; i += 12 + view(png).getUint32(i)) {
    const n = view(png).getUint32(i)
    out.push({ type: String.fromCharCode(...png.subarray(i + 4, i + 8)), data: png.subarray(i + 8, i + 8 + n) })
  }

  return out
}

// Width, height and pixels per point (Xcode tags @3x as 216 dpi, @2x as 144, in pHYs as pixels
// per metre); @3x when untagged or tagged 72 dpi; undefined when it is no PNG.
export function pngInfo(png: Uint8Array): { width: number; height: number; scale: number } | undefined {
  if (String.fromCharCode(...png.subarray(1, 4)) !== 'PNG') return undefined
  const all = chunks(png)
  const ihdr = all.find(c => c.type === 'IHDR')?.data
  if (!ihdr || ihdr.length < 13) return undefined
  const phys = all.find(c => c.type === 'pHYs')?.data
  const scale = phys?.length === 9 && phys[8] === 1 ? Math.round((view(phys).getUint32(0) * 0.0254) / 72) : 0

  return { width: view(ihdr).getUint32(0), height: view(ihdr).getUint32(4), scale: scale > 1 ? scale : 3 }
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0)

  return out
}

const u32 = (n: number) => {
  const out = new Uint8Array(4)
  view(out).setUint32(0, n)

  return out
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1

  return n >>> 0
})

function chunk(type: string, data: Uint8Array) {
  const body = concat([Uint8Array.from(type, c => c.charCodeAt(0)), data])
  let crc = 0xffffffff
  for (const b of body) crc = CRC[(crc ^ b) & 255]! ^ (crc >>> 8)

  return concat([u32(data.length), body, u32((crc ^ 0xffffffff) >>> 0)])
}

// zlib's adler32_combine: the Adler-32 of A then B from each one's and B's length.
function adlerCombine(a: number, b: number, lengthB: number) {
  const BASE = 65521
  const rem = lengthB % BASE
  const s1 = (a & 0xffff) + (b & 0xffff) + BASE - 1
  const s2 = ((rem * (a & 0xffff)) % BASE) + (a >>> 16) + (b >>> 16) + BASE - rem

  return ((s2 % BASE) * 65536 + (s1 % BASE)) >>> 0
}

// The PNG with `rows` transparent rows on top; undefined unless 8-bit RGBA, not interlaced, as
// Xcode writes. Nothing is decoded: the rows go in as stored deflate blocks ahead of Xcode's own,
// and a transparent row is zeros, which the first row's filters already assume above it.
export function padTop(png: Uint8Array, rows: number): Uint8Array | undefined {
  const info = pngInfo(png)
  const all = chunks(png)
  const ihdr = all.find(c => c.type === 'IHDR')?.data
  if (!info || !ihdr || ihdr[8] !== 8 || ihdr[9] !== 6 || ihdr[12] !== 0) return undefined
  const zlib = concat(all.filter(c => c.type === 'IDAT').map(c => c.data))
  // A preset dictionary (FDICT) would sit before the deflate data.
  if (zlib.length < 6 || zlib[1]! & 0x20) return undefined
  const rowBytes = 1 + info.width * 4
  const length = rows * rowBytes
  const blocks: Uint8Array[] = []
  for (let at = 0; at < length; at += 65535) {
    const n = Math.min(65535, length - at)
    // Not final, stored: a zero header byte, then LEN and its complement, little-endian.
    const block = new Uint8Array(5 + n)
    block.set([0, n & 255, n >> 8, (n ^ 0xffff) & 255, (n ^ 0xffff) >> 8])
    blocks.push(block)
  }
  // The Adler-32 of `length` zeros is 1, with its second sum `length`.
  const adler = adlerCombine(((length % 65521) * 65536 + 1) >>> 0, view(zlib).getUint32(zlib.length - 4), info.height * rowBytes)
  const idat = concat([zlib.subarray(0, 2), ...blocks, zlib.subarray(2, -4), u32(adler)])
  const header = ihdr.slice()
  view(header).setUint32(4, info.height + rows)
  const isIdat = (c: Chunk) => c.type === 'IDAT'
  const first = all.findIndex(isIdat)

  return concat([
    png.subarray(0, 8),
    ...all.map((c, i) =>
      i === first ? chunk('IDAT', idat) : isIdat(c) ? new Uint8Array() : chunk(c.type, c.type === 'IHDR' ? header : c.data)),
  ])
}

export const fromBase64 = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0))

export function toBase64(bytes: Uint8Array) {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))

  return btoa(text)
}

const clamp = (n: number) => Math.max(1, Math.min(255, n))

// A terminal cell in screen points: what `CELL_SCRIPT` prints, halved for a 2x display.
export type Cell = { width: number; height: number }

// Prints a cell's size in device pixels (`x y`) from the tty of the nearest ancestor that has one.
export const CELL_SCRIPT = `
import fcntl, os, struct, subprocess, termios
p = os.getppid()
while p > 1:
    tty, ppid = (subprocess.run(['ps', '-o', 'tty=,ppid=', '-p', str(p)], capture_output=True, text=True).stdout.split() + ['', '1'])[:2]
    if tty not in ('', '??'): break
    p = int(ppid)
rows, cols, x, y = struct.unpack('HHHH', fcntl.ioctl(os.open('/dev/' + tty, os.O_RDONLY | os.O_NOCTTY), termios.TIOCGWINSZ, bytes(8)))
print(x / cols, y / rows)
`

// At 100% the view's own size in points is pixels / scale, shown 1:1 in screen points like
// Xcode's canvas, shrunk to fit the pane and never enlarged (that pixelates).
// ponytail: Xcode caps a snapshot's long side at 1500 px (a whole device screen), so a capped one
// is only fit to the pane, enlarged on a tall one; read the real scale from the device model if that ever matters.
// Zoomed in, the picture may outgrow the pane's height, which scrolls; never its width.
// `Image` fills its columns×rows box, so `height` is the snapshot's padded to the box's aspect; rows
// are rounded up, so only ever the height.
export function fitImage(width: number, height: number, scale: number, cell: Cell, columns: number, rows: number, zoom = 1) {
  const isCapped = Math.max(width, height) >= 1500
  const rowsPerColumn = (height / width) * (cell.width / cell.height)
  const natural = isCapped ? Math.min(columns, rows / rowsPerColumn) : width / scale / cell.width
  const maxRows = zoom > 1 ? 255 : rows
  // Floored to the pane, so the rows derived from it never exceed `maxRows`.
  const c = clamp(Math.min(Math.round(natural * zoom), Math.floor(columns), Math.floor(maxRows / rowsPerColumn)))
  // Capped too: in floating point `c * rowsPerColumn` can land a hair above `maxRows`.
  const r = clamp(Math.min(Math.ceil(c * rowsPerColumn), Math.floor(maxRows)))
  const aspect = (c * cell.width) / (r * cell.height)

  return {
    columns: c,
    rows: r,
    height: Math.max(height, Math.round(width / aspect)),
  }
}

export const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3, 4]

// The next zoom step in or out from `zoom`, held at the ends.
export function stepZoom(zoom: number, by: 1 | -1): number {
  const next = by > 0 ? ZOOMS.find(z => z > zoom) : [...ZOOMS].reverse().find(z => z < zoom)

  return next ?? zoom
}
