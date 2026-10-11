import { expect, test } from 'claude-code/testing'

import { fitImage, padTop, parseRendered, pngInfo, stepZoom, variantLabel } from '../hooks/lib'

test('reads the snapshot path and label from RenderPreview', async () => {
  const text = JSON.stringify({
    displayName: 'Settings',
    errors: [],
    previewSnapshotPath: '/var/folders/x/T/ActionArtifacts/default/RenderPreview/Settings.png',
    renderedDestination: { deviceModelName: 'iPhone 18 Pro' },
  })
  expect(parseRendered(text)).toEqual({
    path: '/var/folders/x/T/ActionArtifacts/default/RenderPreview/Settings.png',
    label: 'Settings · iPhone 18 Pro',
  })
  expect(parseRendered('Error: tabIdentifier is required')).toBeUndefined()
  expect(parseRendered(JSON.stringify({ errors: [{ message: 'build failed' }] }))).toBeUndefined()
  expect(parseRendered(undefined)).toBeUndefined()
})

function adler32(bytes: number[]) {
  let a = 1
  let b = 0
  for (const x of bytes) (a = (a + x) % 65521), (b = (b + a) % 65521)

  return b * 65536 + a
}

// A 2×1 RGBA PNG: an opaque red pixel and a transparent one, its rows in a stored deflate block.
function tinyPng(dpi?: number) {
  const raw = [0, 255, 0, 0, 255, 0, 0, 0, 0]
  const be = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
  const chunk = (type: string, data: number[]) => [...be(data.length), ...[...type].map(c => c.charCodeAt(0)), ...data, 0, 0, 0, 0]
  const ppm = dpi ? Math.round(dpi / 0.0254) : 0

  return Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10,
    ...chunk('IHDR', [...be(2), ...be(1), 8, 6, 0, 0, 0]),
    ...(dpi ? chunk('pHYs', [...be(ppm), ...be(ppm), 1]) : []),
    ...chunk('IDAT', [0x78, 0x01, 1, raw.length, 0, raw.length ^ 0xffff, 0xff, ...raw, ...be(adler32(raw))]),
    ...chunk('IEND', []),
  ])
}

test('reads PNG size and scale', async () => {
  expect(pngInfo(tinyPng(216))).toEqual({ width: 2, height: 1, scale: 3 })
  expect(pngInfo(tinyPng(144))?.scale).toBe(2)
  expect(pngInfo(tinyPng(72))?.scale).toBe(3)
  expect(pngInfo(tinyPng())?.scale).toBe(3)
  expect(pngInfo(new TextEncoder().encode('Error: file not found'))).toBeUndefined()
})

test('pads a PNG with transparent rows on top', async () => {
  const png = padTop(tinyPng(216), 2)!
  expect(pngInfo(png)).toEqual({ width: 2, height: 3, scale: 3 })
  // Every block is stored, so the rows are read straight out of them.
  const view = new DataView(png.buffer)
  const at = png.findIndex((_, i) => String.fromCharCode(...png.subarray(i, i + 4)) === 'IDAT') + 4
  const rows: number[] = []
  let i = at + 2
  for (let isFinal = false; !isFinal; i += 5 + view.getUint16(i + 1, true)) {
    isFinal = (png[i]! & 1) === 1
    rows.push(...png.subarray(i + 5, i + 5 + view.getUint16(i + 1, true)))
  }
  expect(rows).toEqual([...new Array(18).fill(0), 0, 255, 0, 0, 255, 0, 0, 0, 0])
  expect(view.getUint32(i)).toBe(adler32(rows))
})

test('shows components 1:1 in points and fits whole screens, keeping the aspect', async () => {
  const cell = { width: 8, height: 17.15 } // 16×34.3 px cells on a 2x display
  // Badge, 146×355 px @3x = 49×118 pt: 6 columns, never enlarged to the pane's 80.
  expect(fitImage(146, 355, 3, cell, 80, 50)).toMatchObject({ columns: 6, rows: 7 })
  // A capped 689×1500 device screen fills the pane's 50 rows.
  expect(fitImage(689, 1500, 3, cell, 80, 50)).toMatchObject({ columns: 49, rows: 50 })
  // A narrow pane shrinks it, aspect kept.
  expect(fitImage(689, 1500, 3, cell, 30, 50)).toMatchObject({ columns: 30, rows: 31 })
  // An iPad component, 600×200 px @2x = 300×100 pt: 38 columns.
  expect(fitImage(600, 200, 2, cell, 80, 50).columns).toBe(38)
  // A tall capped snapshot never takes more rows than the pane has.
  expect(fitImage(400, 1500, 3, cell, 80, 50).rows).toBeLessThanOrEqual(50)
  // Nor when `c * rowsPerColumn` rounds a hair above the pane's rows.
  expect(fitImage(660, 1500, 3, { width: 6, height: 15 }, 255, 30).rows).toBe(30)
  // A 390×44 pt bar takes 3 rows (51 pt): padded to 154 px tall, not stretched to fill them.
  expect(fitImage(1170, 132, 3, cell, 80, 50)).toEqual({ columns: 49, rows: 3, height: 154 })
})

test('labels the variant and locale a render asked for', async () => {
  expect(variantLabel({ previewVariantOverrides: { 'Color Scheme': 'Dark Appearance', 'Dynamic Type': 'AX 3' }, previewLocalizationOverride: 'uk' }))
    .toEqual(['Dark Appearance', 'AX 3', 'uk'])
  expect(variantLabel({})).toEqual([])
})

test('zooms in past the pane height but never its width', async () => {
  const cell = { width: 8, height: 17.15 }
  // Badge at 200%: 12 columns instead of 6.
  expect(fitImage(146, 355, 3, cell, 80, 50, 2).columns).toBe(12)
  // A whole screen at 150% takes 74 columns and 76 rows; the pane scrolls.
  expect(fitImage(689, 1500, 3, cell, 80, 50, 1.5)).toMatchObject({ columns: 74, rows: 76 })
  // At 50% it takes half the pane's 49 columns.
  expect(fitImage(689, 1500, 3, cell, 80, 50, 0.5).columns).toBe(25)
  // Never wider than the pane.
  expect(fitImage(689, 1500, 3, cell, 60, 50, 4).columns).toBe(60)
  expect([stepZoom(1, 1), stepZoom(1, -1), stepZoom(4, 1), stepZoom(0.5, -1)]).toEqual([1.5, 0.75, 4, 0.5])
})
