import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Blocks, SegView, type Ctx } from './Blocks'
import type { Engine } from './engine'
import type { Book, Chapter } from './types'
import { fmtMinutes } from './store'

interface Props {
  book: Book
  ch: Chapter
  engine: Engine
  autoScroll: boolean
  quiz: Record<string, number>
  onAnswer: (key: string, opt: number) => void
  go: (hash: string) => void
}

/**
 * Renders a chapter and keeps the reading cursor on the word being narrated.
 * Highlighting is done by toggling classes directly on the DOM (several times a second),
 * so React never re-renders the whole chapter while audio plays.
 */
export function Reader({ book, ch, engine, autoScroll, quiz, onAnswer, go }: Props) {
  const root = useRef<HTMLElement>(null)
  const userScrollAt = useRef(0)
  const autoScrollRef = useRef(autoScroll)
  autoScrollRef.current = autoScroll

  const playSeg = useCallback((id: number) => engine.seekSeg(id), [engine])
  const ctx: Ctx = useMemo(() => ({ ch, quiz, onAnswer, onPlaySeg: playSeg }), [ch, quiz, onAnswer, playSeg])

  // the moving cursor
  useEffect(() => {
    const el = root.current
    if (!el) return
    let segEl: HTMLElement | null = null
    let wordEl: HTMLElement | null = null
    let segId = -1
    let word = -1
    const apply = () => {
      const s = engine.state
      if (s.chapterId !== ch.id) return
      if (s.segId !== segId) {
        segEl?.classList.remove('cur')
        segId = s.segId
        segEl = segId >= 0 ? el.querySelector<HTMLElement>(`[data-seg="${segId}"]`) : null
        segEl?.classList.add('cur')
        word = -2
        if (segEl && autoScrollRef.current && Date.now() - userScrollAt.current > 4000 && (s.playing || s.waitUntil)) {
          const r = segEl.getBoundingClientRect()
          const vh = window.innerHeight
          if (r.top < vh * 0.18 || r.bottom > vh * 0.68) {
            segEl.scrollIntoView({ block: 'center', behavior: 'smooth' })
          }
        }
      }
      if (s.word !== word) {
        wordEl?.classList.remove('now')
        word = s.word
        wordEl = segEl && word >= 0 ? segEl.querySelector<HTMLElement>(`[data-w="${word}"]`) : null
        wordEl?.classList.add('now')
      }
      el.classList.toggle('is-playing', s.playing || !!s.waitUntil)
    }
    apply()
    const off = engine.onTick(apply)
    return () => {
      off()
      segEl?.classList.remove('cur')
      wordEl?.classList.remove('now')
    }
  }, [engine, ch])

  // remember manual scrolling so auto-scroll doesn't fight the reader
  useEffect(() => {
    const mark = () => (userScrollAt.current = Date.now())
    window.addEventListener('wheel', mark, { passive: true })
    window.addEventListener('touchmove', mark, { passive: true })
    return () => {
      window.removeEventListener('wheel', mark)
      window.removeEventListener('touchmove', mark)
    }
  }, [])

  const onClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button, a')) return
    if (window.getSelection()?.toString()) return // the learner is selecting text
    const segEl = target.closest<HTMLElement>('[data-seg]')
    if (!segEl) return
    const wEl = target.closest<HTMLElement>('[data-w]')
    userScrollAt.current = 0
    engine.seekSeg(Number(segEl.dataset.seg), wEl ? Number(wEl.dataset.w) : undefined)
  }

  const idx = book.chapters.findIndex((c) => c.id === ch.id)
  const prev = book.chapters[idx - 1]
  const next = book.chapters[idx + 1]
  const sections = ch.blocks.filter((b) => b.t === 'h2') as { t: 'h2'; s: number[]; anchor?: string }[]

  return (
    <article className="reader" ref={root} onClick={onClick}>
      <header className="ch-head">
        <div className="ch-num">Chapter {ch.num}</div>
        <h1>
          <SegView seg={ch.segs[ch.titleSeg]} />
        </h1>
        {ch.subtitleSeg !== undefined && (
          <div className="ch-sub">
            <SegView seg={ch.segs[ch.subtitleSeg]} />
          </div>
        )}
        {ch.summary && (
          <p className="ch-summary">
            {ch.summary.map((id) => (
              <SegView key={id} seg={ch.segs[id]} />
            ))}
          </p>
        )}
        <div className="ch-meta">
          <span>{fmtMinutes(ch.duration)} listen</span>
          <span>{sections.length} sections</span>
          <span className="hint">Tap any word to hear it from there</span>
        </div>
      </header>

      <Blocks blocks={ch.blocks} path="" ctx={ctx} />

      <nav className="ch-nav">
        {prev ? (
          <button onClick={() => go(`#/c/${prev.num}`)}>
            <small>Previous</small>
            {prev.num}. {prev.title}
          </button>
        ) : (
          <span />
        )}
        {next ? (
          <button className="next" onClick={() => go(`#/c/${next.num}`)}>
            <small>Next</small>
            {next.num}. {next.title}
          </button>
        ) : (
          <button className="next" onClick={() => go('#/')}>
            <small>Finished</small>Back to contents
          </button>
        )}
      </nav>
    </article>
  )
}
