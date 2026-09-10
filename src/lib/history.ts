// Pure row → HistoryEntry transform for the /history screen. Kept free of the supabase
// client so it's unit-testable; api.ts owns the actual query_log queries.
import { type AnswerKind, type Citation, citationSchema } from './schema'

export type HistoryEntry = {
  id: string
  question: string
  answer: string
  abstained: boolean
  kind: AnswerKind
  citations: Citation[]
  versionId: string
  sessionId: string
  turn: number
  at: string
  // From the embedded manual_versions row — a fallback label when the version is no
  // longer visible to the caller (archived / removed). manualActive gates "Re-ask".
  manualLabel: string
  manualActive: boolean
}

// The embedded manual_versions shape, shared by both history queries.
export type EmbeddedManual = {
  title: string | null
  status?: string | null
  instrument: { name: string | null } | null
} | null

export type RawHistoryRow = {
  id: string
  question: string
  answer: string | null
  abstained: boolean
  citations: unknown
  version_id: string
  session_id: string
  turn: number
  kind: string | null
  at: string
  manual_versions: EmbeddedManual
}

export function manualLabel(mv: EmbeddedManual): string {
  if (!mv) return 'Archived / removed manual'
  return [mv.instrument?.name ?? 'Manual', mv.title].filter(Boolean).join(' · ')
}

// ── conversations (v1.2) ────────────────────────────────────────────────────

export type SessionSummary = {
  sessionId: string
  versionId: string
  manualLabel: string
  manualActive: boolean
  title: string
  turnCount: number
  startedAt: string
  lastAt: string
}

export type RawSessionRow = {
  id: string
  version_id: string
  title: string | null
  turn_count: number
  started_at: string
  last_at: string
  manual_versions: EmbeddedManual
}

export function toSessionSummary(r: RawSessionRow): SessionSummary {
  return {
    sessionId: r.id,
    versionId: r.version_id,
    manualLabel: manualLabel(r.manual_versions),
    manualActive: r.manual_versions?.status === 'active',
    title: r.title?.trim() || '(untitled)',
    turnCount: r.turn_count,
    startedAt: r.started_at,
    lastAt: r.last_at,
  }
}

export function toHistoryEntry(r: RawHistoryRow): HistoryEntry {
  // query_log.citations is a raw jsonb column — validate it at the DB boundary rather
  // than trusting the shape (.claude/rules/src.md).
  const parsed = citationSchema.array().safeParse(r.citations)
  return {
    id: r.id,
    question: r.question,
    answer: r.answer ?? '',
    abstained: r.abstained,
    kind: (r.kind as AnswerKind | null) ?? (r.abstained ? 'abstained' : 'grounded'),
    citations: parsed.success ? parsed.data : [],
    versionId: r.version_id,
    sessionId: r.session_id,
    turn: r.turn,
    at: r.at,
    manualLabel: manualLabel(r.manual_versions),
    manualActive: r.manual_versions?.status === 'active',
  }
}
