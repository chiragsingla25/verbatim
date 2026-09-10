import { describe, expect, it } from 'vitest'
import { instrumentBadge } from './instrument'

describe('instrumentBadge', () => {
  it('derives initials from significant words, skipping filler', () => {
    expect(instrumentBadge('Perceived Stress Scale').initials).toBe('PS')
    expect(instrumentBadge('Patient Health Questionnaire').initials).toBe('PHQ')
    expect(instrumentBadge('The Alcohol Use Disorders Identification Test').initials).toBe('AUD')
  })

  it('is deterministic — same name always gets the same tint', () => {
    const a = instrumentBadge('AUDIT')
    const b = instrumentBadge('AUDIT')
    expect(a.tint).toBe(b.tint)
    expect(a.tint).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('handles null / empty', () => {
    expect(instrumentBadge(null).initials).toBe('M')
    expect(instrumentBadge('  ').initials).toBe('M')
  })

  it('handles a single-word name', () => {
    expect(instrumentBadge('AUDIT').initials).toBe('AUD')
  })
})
