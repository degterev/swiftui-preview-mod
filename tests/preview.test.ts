import { expect, test } from 'claude-code/testing'

import { fitImage, parseRendered, parseSize, stepZoom, variantLabel } from '../hooks/lib'

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

test('reads PNG size from sips', async () => {
  const out = '/T/Settings.png\n  pixelWidth: 689\n  pixelHeight: 1500\n  dpiWidth: 216.000\n'
  expect(parseSize(out)).toEqual({ width: 689, height: 1500, scale: 3 })
  expect(parseSize('  pixelWidth: 600\n  pixelHeight: 200\n  dpiWidth: 144.000')?.scale).toBe(2)
  // sips reports an untagged PNG as 72 dpi.
  expect(parseSize('  pixelWidth: 600\n  pixelHeight: 200\n  dpiWidth: 72.000')?.scale).toBe(3)
  expect(parseSize('Error: file not found')).toBeUndefined()
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
  // A 390×44 pt bar takes 3 rows (51 pt): padded to 1170×154 px, not stretched to fill them.
  expect(fitImage(1170, 132, 3, cell, 80, 50)).toEqual({ columns: 49, rows: 3, width: 1170, height: 154 })
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
