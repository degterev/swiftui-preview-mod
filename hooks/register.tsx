import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Shot } from '../types'
import { CELL_SCRIPT, fitImage, fromBase64, padTop, parseRendered, pngInfo, stepZoom, toBase64, variantLabel } from './lib'
import type { Cell } from './lib'

const PANE = 'swiftui-preview'
const TITLE = 'SwiftUI Preview'
const shot = atom({ plugin: 'swiftui-preview', key: 'shot' } as const, null)
const zoom = atom({ plugin: 'swiftui-preview', key: 'zoom' } as const, 1)

// The terminal's cell in screen points; a guess until measured.
let cell: Cell = { width: 8, height: 17 }
async function measureCell($: EngineInterface) {
  const run = await $.process.run(['python3', '-c', CELL_SCRIPT]).catch(() => undefined)
  const [x, y] = (run?.stdout ?? '').split(' ').map(Number)
  // ponytail: assumes a 2x (Retina) display; read the backing scale if a 1x screen shows up
  if (x && y) cell = { width: x / 2, height: y / 2 }
}

// The snapshot with rows on top to fill the pane box, base64, kept for the renders that follow.
let padded: { key: string; png?: string } = { key: '' }
async function pad($: EngineInterface, current: Shot, rows: number) {
  const key = `${current.path}@${current.generation}+${rows}`
  if (padded.key !== key) {
    const read = await $.fs.read(current.path, { as: 'bytes' }).catch(() => undefined)
    const png = read && padTop(fromBase64(read.base64), rows)
    // `{ png }` takes at most 2 MiB; past it, or unpadded, the box stretches the snapshot a little.
    padded = { key, png: png && png.length <= 2 * 1024 * 1024 ? toBase64(png) : undefined }
  }

  return padded.png
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'swiftui-preview', description: 'Show the last SwiftUI preview' })

    return next(e)
  })

  on('command.run', { command: 'swiftui-preview' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'SwiftUI preview pane opened.' }
  })

  // Xcode MCP's RenderPreview (`claude mcp add xcode -- xcrun mcpbridge`), whatever the server is named.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (!e.tool.endsWith('__RenderPreview') || ran.isError) return ran
    const rendered = parseRendered(ran.text)
    if (!rendered) return ran
    try {
      const size = pngInfo(fromBase64((await $.fs.read(rendered.path, { as: 'bytes' })).base64))
      if (!size) throw new Error(`no PNG at ${rendered.path}`)
      await measureCell($)
      const label = [rendered.label, ...variantLabel(e)].filter(Boolean).join(' · ')
      await update($, shot, () => ({ ...rendered, ...size, label, generation: Date.now() }) satisfies Shot)
      // Opened unasked, the pane waits for a wide enough terminal: say where the preview is.
      const { isPlaced } = await $.ui.open({ id: PANE, title: TITLE })
      if (!isPlaced) $.ui.toast('SwiftUI preview ready: /swiftui-preview to show it')
    } catch (err) {
      // The pane is a bonus: never fail the model's call over it, but say the pane is stale.
      $.ui.toast(`SwiftUI Preview not updated: ${err instanceof Error ? err.message : String(err)}`)
    }

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const current = await read($, shot)
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text>{current ? `Preview saved to ${current.path}` : 'No preview yet.'}</Text>
    }
    const { Box, Button, Text, Image } = $.ui.resolve(e)
    if (!current) return <Text dimColor>No preview yet. Ask Claude to preview a view.</Text>
    const z = await read($, zoom)
    const fit = fitImage(current.width, current.height, current.scale, cell, e.props.bodyColumns, e.props.scroll.bodyRows - 1, z)
    const png = fit.height > current.height ? await pad($, current, fit.height - current.height) : undefined

    return (
      <Box flexDirection="column" alignItems="center">
        <Box gap={1}>
          <Text dimColor wrap="truncate">{current.label}</Text>
          <Button hotkey="o" onPress={() => void update($, zoom, v => stepZoom(v, -1))}>−</Button>
          <Button key="zoom" hotkey="0" onPress={() => void update($, zoom, () => 1)}>{`${z * 100}%`}</Button>
          <Button hotkey="i" onPress={() => void update($, zoom, v => stepZoom(v, 1))}>+</Button>
        </Box>
        <Image
          source={png ? { png } : { file: current.path, format: 'png', generation: current.generation }}
          columns={fit.columns}
          rows={fit.rows}
          alt={`SwiftUI preview: ${current.path}`}
        />
      </Box>
    )
  })
}
