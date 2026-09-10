import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFPageProxy } from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'
import { sourcePdfUrl } from '../lib/api'

// `?worker` (not `?url`) so vite bundles the worker through its own pipeline —
// that's where vite.config.ts's `worker.rollupOptions.output.banner` injects the
// Promise.withResolvers polyfill the worker needs on older browsers.
pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker()

type Rect = { left: number; top: number; width: number; height: number }

// Slide-over showing the cited source page rendered with pdf.js, the quoted passage
// highlighted where it can be located in the page's text.
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
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const holderRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [detail, setDetail] = useState('')
  const [highlights, setHighlights] = useState<Rect[]>([])
  const [buffer, setBuffer] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [fit, setFit] = useState(1)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const url = await sourcePdfUrl(versionId)
        const pdf = await pdfjs.getDocument({ url }).promise
        const p = Math.min(Math.max(page, 1), pdf.numPages)
        const pg = await pdf.getPage(p)
        if (cancelled) return

        const scale = 2
        const viewport = pg.getViewport({ scale })
        const canvas = canvasRef.current!
        const ctx = canvas.getContext('2d')!
        canvas.width = viewport.width
        canvas.height = viewport.height
        setBuffer({ w: viewport.width, h: viewport.height })
        const avail = holderRef.current?.clientWidth ?? 480
        setFit(Math.min(1, avail / viewport.width))
        await pg.render({ canvasContext: ctx, viewport }).promise
        if (cancelled) return

        setHighlights(await locateQuote(pg, quote, scale, viewport.height))
        setStatus('ready')
      } catch (e) {
        if (!cancelled) {
          setStatus('error')
          setDetail(e instanceof Error ? e.message : String(e))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [versionId, page, quote])

  return (
    <div className="slideover-scrim" onClick={onClose}>
      <aside className="slideover" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Source">
        <header className="slideover-head">
          <div>
            <div className="slideover-title">Source · page {page}</div>
            <div className="slideover-sub">{manualLabel}</div>
          </div>
          <button className="link" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {quote.trim().length > 0 && (
          <blockquote className="slideover-quote">“{quote}”</blockquote>
        )}

        <div className="slideover-page" ref={holderRef}>
          {status === 'loading' && <p className="slideover-note">Rendering page…</p>}
          {status === 'error' && (
            <p className="slideover-note err">
              Couldn’t render the source page. {detail}
            </p>
          )}
          <div
            className="pdf-fit"
            style={{
              width: buffer.w * fit || undefined,
              height: buffer.h * fit || undefined,
            }}
            hidden={status !== 'ready'}
          >
            <div
              className="pdf-frame"
              style={{ width: buffer.w, transform: `scale(${fit})`, transformOrigin: 'top left' }}
            >
              <canvas ref={canvasRef} />
              {highlights.map((r, i) => (
                <div
                  key={i}
                  className="pdf-highlight"
                  style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
                />
              ))}
            </div>
          </div>
          {status === 'ready' && highlights.length === 0 && (
            <p className="slideover-note">
              (Passage is on this page; exact position couldn’t be pinpointed.)
            </p>
          )}
        </div>
      </aside>
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
    // try a shorter anchor (first 40 chars) for near-verbatim quotes
    const anchor = target.slice(0, 40)
    const a2 = nJoined.indexOf(anchor)
    if (a2 < 0) return []
    return rectsForRange(a2, a2 + anchor.length)
  }
  return rectsForRange(at, at + target.length)

  function rectsForRange(s: number, e: number): Rect[] {
    // norm() collapses whitespace, so indices roughly track joined; walk items by
    // cumulative raw length and take any that overlap [s, e] in normalized space.
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
