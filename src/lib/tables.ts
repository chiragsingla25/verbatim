// Parse a pipe-delimited Markdown table into headers + rows, or null if the text isn't one.
// The v1 corpus stores tables FLATTENED by Docling (linearised "rowLabel, col = value"
// text), so this returns null for everything currently ingested — the answer card falls
// back to a styled <pre> excerpt. It's here so a future re-ingest that stores real
// grid text (ingest-v2) renders as a table with no further change.
export type ParsedTable = { headers: string[]; rows: string[][] }

export function parseMarkdownTable(text: string): ParsedTable | null {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('|'))
  if (lines.length < 2) return null

  const cells = (line: string): string[] =>
    line
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim())

  const headers = cells(lines[0])
  // second line must be a separator row: each cell only -, :, spaces
  if (!/^[\s|:-]+$/.test(lines[1]) || !lines[1].includes('-')) return null

  const rows = lines.slice(2).map(cells).filter((r) => r.some((c) => c.length > 0))
  if (headers.length === 0 || rows.length === 0) return null

  // normalise row width to the header count
  const width = headers.length
  const norm = rows.map((r) =>
    r.length === width ? r : [...r.slice(0, width), ...Array(Math.max(0, width - r.length)).fill('')],
  )
  return { headers, rows: norm }
}
