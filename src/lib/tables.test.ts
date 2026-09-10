import { describe, expect, it } from 'vitest'
import { parseMarkdownTable } from './tables'

describe('parseMarkdownTable', () => {
  it('parses a well-formed pipe table', () => {
    const t = parseMarkdownTable(
      ['| Score | Zone |', '| --- | --- |', '| 0-7 | I |', '| 8-15 | II |'].join('\n'),
    )
    expect(t).toEqual({
      headers: ['Score', 'Zone'],
      rows: [
        ['0-7', 'I'],
        ['8-15', 'II'],
      ],
    })
  })

  it('tolerates missing outer pipes and ragged rows', () => {
    const t = parseMarkdownTable(['a | b | c', '---|---|---', '1 | 2', '4 | 5 | 6 | 7'].join('\n'))
    expect(t?.headers).toEqual(['a', 'b', 'c'])
    expect(t?.rows).toEqual([
      ['1', '2', ''],
      ['4', '5', '6'],
    ])
  })

  it('returns null without a separator row', () => {
    expect(parseMarkdownTable('| a | b |\n| 1 | 2 |')).toBeNull()
  })

  it('returns null for Docling-flattened table text (no pipes)', () => {
    expect(
      parseMarkdownTable('Background, PAGES = 1. Coding and Scoring, PAGES = 2, 4, 5.'),
    ).toBeNull()
  })

  it('returns null for plain prose', () => {
    expect(parseMarkdownTable('The AUDIT total score ranges from 0 to 40.')).toBeNull()
  })
})
