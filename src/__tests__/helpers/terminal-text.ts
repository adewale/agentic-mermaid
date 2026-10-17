import { decodeHTML } from 'entities'

/** Remove only the encodings emitted by the terminal color serializer. */
export function withoutTerminalColor(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '').replace(/<span style="color:[^"]+">|<\/span>/g, '')
}

export function terminalText(value: string, colorMode: string): string {
  const plain = withoutTerminalColor(value)
  return colorMode === 'html' ? decodeHTML(plain) : plain
}
