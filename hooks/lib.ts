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

// `sips -g ... <png>` reads only the header, whatever the file's size.
export const SIZE_ARGS = ['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'dpiWidth']

// Width, height and pixels per point (Xcode tags @3x as 216 dpi, @2x as 144) from SIZE_ARGS'
// output; @3x when untagged, undefined when it has no size.
export function parseSize(text: string): { width: number; height: number; scale: number } | undefined {
  const width = Number(/pixelWidth: (\d+)/.exec(text)?.[1])
  const height = Number(/pixelHeight: (\d+)/.exec(text)?.[1])
  const scale = Math.round(Number(/dpiWidth: ([\d.]+)/.exec(text)?.[1] ?? 216) / 72) || 3

  return width && height ? { width, height, scale } : undefined
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

// The view's own size in points is pixels / scale, shown 1:1 in screen
// points like Xcode's canvas at 100%, shrunk to fit the pane and never enlarged (that pixelates).
// ponytail: Xcode caps a snapshot's long side at 1500 px (a whole device screen), so a capped one
// is only fit to the pane; read the real scale from the device model if that ever matters.
export function fitImage(width: number, height: number, scale: number, cell: Cell, columns: number, rows: number) {
  const isCapped = Math.max(width, height) >= 1500
  const rowsPerColumn = (height / width) * (cell.width / cell.height)
  const natural = isCapped ? Infinity : width / scale / cell.width
  // Floored to the pane, so the rows derived from it never exceed `rows`.
  const c = clamp(Math.min(Math.round(natural), Math.floor(columns), Math.floor(rows / rowsPerColumn)))

  return { columns: c, rows: clamp(Math.round(c * rowsPerColumn)) }
}
