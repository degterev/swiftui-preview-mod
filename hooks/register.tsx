import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Shot } from '../types'
import { CELL_SCRIPT, fitImage, parseRendered, pngSize } from './lib'
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
      const { base64 } = await $.fs.read(rendered.path, { as: 'bytes' })
      const size = pngSize(base64)
      await measureCell($)
      await update($, shot, () => ({ ...rendered, ...size, generation: Date.now() }) satisfies Shot)
      await $.ui.open({ id: PANE, title: TITLE })
    } catch {
      // The pane is a bonus: never fail the model's call over it.
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
    const fit = fitImage(current.width, current.height, cell, e.props.bodyColumns, e.props.scroll.bodyRows - 1)

    return (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate">{current.label}</Text>
        <Image
          source={{ file: current.path, format: 'png', generation: current.generation }}
          columns={fit.columns}
          rows={fit.rows}
          alt={`SwiftUI preview: ${current.path}`}
        />
      </Box>
    )
  })
}
