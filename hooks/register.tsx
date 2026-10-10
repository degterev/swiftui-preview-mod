import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Shot } from '../types'
import { CELL_SCRIPT, SIZE_ARGS, fitImage, parseRendered, parseSize, variantLabel } from './lib'
import type { Cell } from './lib'

const PANE = 'swiftui-preview'
const TITLE = 'SwiftUI Preview'
const shot = atom({ plugin: 'swiftui-preview', key: 'shot' } as const, null)

// The terminal's cell in screen points; a guess until measured.
let cell: Cell = { width: 8, height: 17 }
async function measureCell($: EngineInterface) {
  const run = await $.process.run(['python3', '-c', CELL_SCRIPT]).catch(() => undefined)
  const [x, y] = (run?.stdout ?? '').split(' ').map(Number)
  // ponytail: assumes a 2x (Retina) display; read the backing scale if a 1x screen shows up
  if (x && y) cell = { width: x / 2, height: y / 2 }
}

// The snapshot padded to the pane box's aspect, kept for the renders that follow.
let padded = { key: '', file: '' }
async function pad($: EngineInterface, path: string, width: number, height: number) {
  const key = `${path}@${width}x${height}`
  if (padded.key !== key) {
    const file = path.replace(/\.png$/, ` ${width}x${height}.png`)
    const run = await $.process.run(['sips', '--padToHeightWidth', String(height), String(width), path, '--out', file]).catch(() => undefined)
    padded = { key, file: run?.exitCode === 0 ? file : path }
  }

  return padded.file
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
      const size = parseSize((await $.process.run([...SIZE_ARGS, rendered.path])).stdout)
      if (!size) throw new Error(`no size for ${rendered.path}`)
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
    const { Box, Text, Image } = $.ui.resolve(e)
    if (!current) return <Text dimColor>No preview yet. Ask Claude to preview a view.</Text>
    const fit = fitImage(current.width, current.height, current.scale, cell, e.props.bodyColumns, e.props.scroll.bodyRows - 1)
    const isPadded = fit.width !== current.width || fit.height !== current.height
    const file = isPadded ? await pad($, current.path, fit.width, fit.height) : current.path

    return (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate">{current.label}</Text>
        <Image
          source={{ file, format: 'png', generation: current.generation }}
          columns={fit.columns}
          rows={fit.rows}
          alt={`SwiftUI preview: ${current.path}`}
        />
      </Box>
    )
  })
}
