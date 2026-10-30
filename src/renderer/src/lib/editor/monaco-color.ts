export function monacoColor(value: string): string {
  // CSS minification shortens hex colors; Monaco requires six or eight digits.
  return value
    .trim()
    .replace(
      /^#([\da-f]{3,4})$/i,
      (_match, hex: string) => `#${[...hex].map((digit) => digit + digit).join('')}`,
    )
}
