import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'
import { type ManualTextRow, manualText, sourcePdfUrl } from '../lib/api'

// `?worker` (not `?url`) so vite bundles the worker through its own pipeline — that's where
// vite.config.ts's worker banner injects the Promise.withResolvers polyfill older browsers need.
pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker()

type Rect = { left: number; top: number; width: number; height: number }

const WINDOW = 3 // pages rendered on each side of the visible page
const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5, 2]
const DPR = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1

// Read-only in-app view of a cited manual: the whole document, scroll / zoom / jump by page /
// search the text, with the cited quote highlighted on its page. The PDF is the caller's own
// (active manual) via a short-TTL signed URL; the search index is the version's chunk text.
export function SourceSlideOver({
  versionId,
  page,
  quote,
  manualLabel,
  onClose,
}: {
  versionId: string
  page: number
  quote: string
  manualLabel: string
  onClose: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [detail, setDetail] = useState('')
  const [current, setCurrent] = useState(Math.max(1, page))
  const [zoomIdx, setZoomIdx] = useState(2) // → 1.0
  const [rows, setRows] = useState<ManualTextRow[]>([])
  const [q, setQ] = useState('')
  const [flash, setFlash] = useState(true)
  const [availW, setAvailW] = useState(0)

  const zoom = ZOOMS[zoomIdx]
  const numPages = pdf?.numPages ?? 0

  // Width available to a page = the scroll area minus its padding. Re-measured on resize
  // so pages render at display resolution (highlights stay pixel-aligned, no CSS scaling).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setAvailW(Math.max(0, el.clientWidth - 36))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [status])

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Load the PDF once (+ the chunk text for search).
  useEffect(() => {
    let dead = false
    setStatus('loading')
    ;(async () => {
      try {
        const [url, textRows] = await Promise.all([
          sourcePdfUrl(versionId),
          manualText(versionId).catch(() => [] as ManualTextRow[]), // search is best-effort
        ])
        const doc = await pdfjs.getDocument({ url }).promise
        if (dead) return
        setPdf(doc)
        setRows(textRows)
        setStatus('ready')
      } catch (e) {
        if (!dead) {
          setStatus('error')
          setDetail(e instanceof Error ? e.message : String(e))
        }
      }
    })()
    return () => {
      dead = true
    }
  }, [versionId])

  // Once pages exist, jump to the cited page and flash a confirmation.
  const jumpTo = useCallback((n: number) => {
    const land = () =>
      // instant: a page jump is navigational and must land even when the CSS
      // scroll-behavior:smooth would otherwise animate (and stall in a backgrounded tab).
      scrollRef.current
        ?.querySelector<HTMLElement>(`[data-page="${n}"]`)
        ?.scrollIntoView({ block: 'start', behavior: 'auto' })
    setCurrent(n)
    land()
    // re-land after the target page swaps its placeholder for a real canvas and the
    // layout above it settles.
    setTimeout(land, 140)
    setTimeout(land, 450)
  }, [])

  useEffect(() => {
    if (status !== 'ready') return
    const t = setTimeout(() => jumpTo(Math.max(1, page)), 40)
    const f = setTimeout(() => setFlash(false), 2400)
    return () => {
      clearTimeout(t)
      clearTimeout(f)
    }
  }, [status, page, jumpTo])

  // Zooming changes every page's height — keep the reader on the page they were looking at.
  const zoomInitDone = useRef(false)
  useEffect(() => {
    if (status !== 'ready') return
    if (!zoomInitDone.current) {
      zoomInitDone.current = true
      return
    }
    jumpTo(current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomIdx])

  // Track the most-visible page for the "page X of N" readout + the render window.
  useEffect(() => {
    const root = scrollRef.current
    if (status !== 'ready' || !root) return
    const io = new IntersectionObserver(
      (entries) => {
        let best: { n: number; ratio: number } | null = null
        for (const e of entries) {
          const n = Number((e.target as HTMLElement).dataset.page)
          if (!best || e.intersectionRatio > best.ratio) best = { n, ratio: e.intersectionRatio }
        }
        if (best && best.ratio > 0) setCurrent(best.n)
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    )
    root.querySelectorAll('[data-page]').forEach((el) => io.observe(el))
    return () => io.disconnect()
    // re-observe once the page elements actually mount (they need pdf + availW)
  }, [status, numPages, availW])

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (needle.length < 2) return []
    return rows
      .filter((r) => r.content.toLowerCase().includes(needle))
      .slice(0, 40)
      .map((r) => {
        const i = r.content.toLowerCase().indexOf(needle)
        const from = Math.max(0, i - 30)
        return {
          page: r.page,
          snippet: (from > 0 ? '…' : '') + r.content.slice(from, i + needle.length + 40).trim() + '…',
        }
      })
  }, [q, rows])

  return (
    <div className="slideover-scrim" onClick={onClose}>
      <aside
        className="slideover"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Source manual"
      >
        <header className="slideover-head">
          <div>
            <div className="slideover-title">Source · {manualLabel}</div>
            <div className="slideover-sub">
              {status === 'ready' ? `Page ${current} of ${numPages}` : 'Opening the manual…'}
            </div>
          </div>
          <button className="link" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="slideover-toolbar">
          <input
            className="slideover-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search this manual…"
            aria-label="Search this manual"
          />
          <div className="slideover-nav">
            <button
              className="secondary"
              disabled={current <= 1}
              onClick={() => jumpTo(current - 1)}
              aria-label="Previous page"
            >
              ‹
            </button>
            <button
              className="secondary"
              disabled={current >= numPages}
              onClick={() => jumpTo(current + 1)}
              aria-label="Next page"
            >
              ›
            </button>
            <span className="slideover-zoom">
              <button
                className="secondary"
                disabled={zoomIdx <= 0}
                onClick={() => setZoomIdx((z) => Math.max(0, z - 1))}
                aria-label="Zoom out"
              >
                −
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button
                className="secondary"
                disabled={zoomIdx >= ZOOMS.length - 1}
                onClick={() => setZoomIdx((z) => Math.min(ZOOMS.length - 1, z + 1))}
                aria-label="Zoom in"
              >
                +
              </button>
            </span>
          </div>
        </div>

        {q.trim().length >= 2 && (
          <div className="slideover-results">
            {results.length === 0 ? (
              <p className="slideover-note">No matches for “{q.trim()}”.</p>
            ) : (
              results.map((r, i) => (
                <button
                  key={i}
                  className="slideover-result"
                  onClick={() => {
                    jumpTo(r.page)
                    setQ('')
                  }}
                >
                  <span className="sr-page">p.{r.page}</span>
                  <span className="sr-snip">{r.snippet}</span>
                </button>
              ))
            )}
          </div>
        )}

        {quote.trim().length > 0 && flash && (
          <blockquote className="slideover-quote">
            <span className="slideover-found">Found on page {page}</span>“{quote}”
          </blockquote>
        )}

        <div className="slideover-pages" ref={scrollRef}>
          {status === 'loading' && <p className="slideover-note">Opening the manual…</p>}
          {status === 'error' && (
            <p className="slideover-note err">Couldn’t open the source. {detail}</p>
          )}
          {pdf &&
            availW > 0 &&
            Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
              <PdfPage
                key={n}
                pdf={pdf}
                n={n}
                zoom={zoom}
                availW={availW}
                active={Math.abs(n - current) <= WINDOW}
                quote={n === Math.max(1, page) ? quote : ''}
              />
            ))}
        </div>
      </aside>
    </div>
  )
}

// One page. Renders its canvas at display resolution (fit to `availW` × `zoom`, capped)
// only while `active` (inside the scroll window), and clears it otherwise so a long
// manual never holds N canvases. `dims` keeps a fixed placeholder size so the scrollbar
// and page anchors stay put even before/after a page renders.
function PdfPage({
  pdf,
  n,
  zoom,
  availW,
  active,
  quote,
}: {
  pdf: PDFDocumentProxy
  n: number
  zoom: number
  availW: number
  active: boolean
  quote: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [highlights, setHighlights] = useState<Rect[]>([])

  useEffect(() => {
    let dead = false
    let task: RenderTask | null = null
    const canvas = canvasRef.current
    // Page left the render window — free its bitmap immediately (not just on unmount), so
    // a long manual never holds more than ~2·WINDOW canvases.
    if (!active) {
      if (canvas) {
        canvas.width = 0
        canvas.height = 0
      }
      return
    }
    ;(async () => {
      const pg = await pdf.getPage(n)
      if (dead) return
      const base = pg.getViewport({ scale: 1 })
      // CSS size: fit the column, then apply zoom (allow overflow-x past 100% when zoomed).
      const cssW = Math.min(availW, base.width) * zoom
      const cssScale = cssW / base.width
      setDims({ w: cssW, h: base.height * cssScale })
      if (!canvas) return
      const viewport = pg.getViewport({ scale: cssScale * DPR })
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${cssW}px`
      canvas.style.height = `${base.height * cssScale}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      task = pg.render({ canvasContext: ctx, viewport })
      try {
        await task.promise
      } catch {
        return // render cancelled by a zoom / window change
      }
      if (dead) return
      // highlight rects are in CSS px (scale = cssScale, height = the CSS height)
      if (quote) {
        setHighlights(await locateQuote(pg, quote, cssScale, base.height * cssScale))
      }
    })()
    return () => {
      dead = true
      task?.cancel()
    }
  }, [pdf, n, zoom, availW, active, quote])

  return (
    <div className="pdf-page" data-page={n} style={{ width: dims?.w, minHeight: dims?.h ?? 480 }}>
      <canvas ref={canvasRef} hidden={!active} />
      {active &&
        highlights.map((r, i) => (
          <div
            key={i}
            className="pdf-highlight"
            style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
          />
        ))}
    </div>
  )
}

// Find the quote in the page's text items and return highlight rectangles in canvas px.
async function locateQuote(
  pg: PDFPageProxy,
  quote: string,
  scale: number,
  viewportHeight: number,
): Promise<Rect[]> {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const target = norm(quote)
  if (target.length < 8) return []

  const content = await pg.getTextContent()
  type Item = { str: string; x: number; y: number; w: number; h: number }
  const items: Item[] = []
  let joined = ''
  const map: { start: number; item: number }[] = []
  for (const it of content.items as Array<{ str: string; transform: number[]; width: number; height: number }>) {
    if (!it.str) continue
    const idx = items.length
    items.push({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width,
      h: it.height || 10,
    })
    map.push({ start: joined.length, item: idx })
    joined += it.str + ' '
  }
  const nJoined = norm(joined)
  const at = nJoined.indexOf(target)
  if (at < 0) {
    const anchor = target.slice(0, 40)
    const a2 = nJoined.indexOf(anchor)
    if (a2 < 0) return []
    return rectsForRange(a2, a2 + anchor.length)
  }
  return rectsForRange(at, at + target.length)

  function rectsForRange(s: number, e: number): Rect[] {
    const rects: Rect[] = []
    let cum = 0
    for (let i = 0; i < items.length; i++) {
      const raw = items[i].str + ' '
      const segStart = norm(joined.slice(0, cum)).length
      const segEnd = norm(joined.slice(0, cum + raw.length)).length
      cum += raw.length
      if (segEnd <= s || segStart >= e) continue
      const it = items[i]
      rects.push({
        left: it.x * scale,
        top: (viewportHeight / scale - it.y - it.h) * scale,
        width: Math.max(it.w, 4) * scale,
        height: Math.max(it.h, 8) * scale,
      })
    }
    return mergeRows(rects)
  }
}

// Merge highlight boxes that share a line into one bar.
function mergeRows(rects: Rect[]): Rect[] {
  const rows: Rect[] = []
  for (const r of rects.sort((a, b) => a.top - b.top || a.left - b.left)) {
    const last = rows[rows.length - 1]
    if (last && Math.abs(last.top - r.top) < r.height * 0.6) {
      const right = Math.max(last.left + last.width, r.left + r.width)
      last.left = Math.min(last.left, r.left)
      last.width = right - last.left
      last.height = Math.max(last.height, r.height)
    } else {
      rows.push({ ...r })
    }
  }
  return rows
}
