# swiftui-preview

A Claude Code mod that shows SwiftUI previews right in the terminal, rendered by Xcode itself.

Claude calls Xcode's `RenderPreview` MCP tool on a `#Preview`; the mod shows the snapshot in a
**SwiftUI Preview** pane — components 1:1 in points like Xcode's canvas at 100%, whole screens
fit to the pane. Variants (dark mode, Dynamic Type, orientation), localizations and
`#Preview(arguments:)` come from `RenderPreview` itself.

## Requirements

- Xcode 27 with MCP on: Settings › Intelligence › Model Context Protocol ›
  "Allow External Agents to Use Xcode Tools" = Always (or `sudo xcrun mcp-server enable`)
- The project open in Xcode
- A terminal that draws images (Ghostty, kitty)

## Install

```
claude mcp add xcode -s user -- xcrun mcpbridge
```

then, at a Claude Code prompt:

```
/plugin install swiftui-preview --marketplace degterev/swiftui-preview-mod
```

Answer `y` to add the marketplace, then pick a scope.

## Use

Ask Claude: "show SettingsView in dark mode at AX3". If the file has no `#Preview`, Claude adds one.
`/swiftui-preview` reopens the pane with the last render.
