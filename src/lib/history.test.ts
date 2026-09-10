import { describe, expect, it } from 'vitest'
import { manualLabel, type RawHistoryRow, toHistoryEntry } from './history'

const base: RawHistoryRow = {
  id: 'q1',
  question: 'What items are reverse-scored?',
  answer: 'Items 4, 5, 7, and 8.',
  abstained: false,
  citations: [{ chunkId: 'c1', page: 1, quote: 'reversing responses' }],
  version_id: 'v1',
  session_id: 's1',
  turn: 1,
  at: '2026-09-09T10:00:00Z',
  manual_versions: { title: 'PSS-10', status: 'active', instrument: { name: 'PSS' } },
}

describe('manualLabel', () => {
  it('joins instrument name and title', () => {
    expect(manualLabel({ title: 'PSS-10', instrument: { name: 'PSS' } })).toBe('PSS · PSS-10')
  })
  it('falls back when the embed is null (archived / not visible)', () => {
    expect(manualLabel(null)).toBe('Archived / removed manual')
  })
  it('drops an empty title cleanly (no trailing separator)', () => {
    expect(manualLabel({ title: null, instrument: { name: 'PSS' } })).toBe('PSS')
    expect(manualLabel({ title: '', instrument: { name: null } })).toBe('Manual')
  })
})

describe('toHistoryEntry', () => {
  it('maps a well-formed row', () => {
    const e = toHistoryEntry(base)
    expect(e).toMatchObject({
      id: 'q1',
      answer: 'Items 4, 5, 7, and 8.',
      abstained: false,
      versionId: 'v1',
      manualLabel: 'PSS · PSS-10',
      manualActive: true,
    })
    expect(e.citations).toEqual([{ chunkId: 'c1', page: 1, quote: 'reversing responses' }])
  })

  it('drops citations that fail schema validation instead of passing loose dicts through', () => {
    expect(toHistoryEntry({ ...base, citations: [{ chunkId: 'c1', page: 2 }] }).citations).toEqual([])
    expect(toHistoryEntry({ ...base, citations: 'not-an-array' }).citations).toEqual([])
    expect(toHistoryEntry({ ...base, citations: null }).citations).toEqual([])
  })

  it('coerces a null answer to an empty string', () => {
    expect(toHistoryEntry({ ...base, answer: null }).answer).toBe('')
  })

  it('marks the manual inactive when archived or embed-null, gating Re-ask', () => {
    expect(toHistoryEntry({ ...base, manual_versions: { ...base.manual_versions!, status: 'archived' } }).manualActive).toBe(false)
    const removed = toHistoryEntry({ ...base, manual_versions: null })
    expect(removed.manualActive).toBe(false)
    expect(removed.manualLabel).toBe('Archived / removed manual')
  })
})
