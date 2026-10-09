export type Shot = {
  path: string
  width: number
  height: number
  label: string
  generation: number
}

declare module 'claude-code' {
  interface PluginState {
    'swiftui-preview': { shot: Shot | null }
  }
}
