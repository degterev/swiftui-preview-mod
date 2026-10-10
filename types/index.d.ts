export type Shot = {
  path: string
  width: number
  height: number
  /** Pixels per point: 3 for an iPhone, 2 for an iPad. */
  scale: number
  label: string
  generation: number
}

declare module 'claude-code' {
  interface PluginState {
    'swiftui-preview': { shot: Shot | null }
  }
}
