import { useCallback, useEffect, useMemo, useState } from 'react'
import { Engine } from './engine'
import { Home } from './Home'
import { Player } from './Player'
import { Reader } from './Reader'
import { usePrefs, useProgress } from './store'
import type { Book, Chapter } from './types'

const BASE = import.meta.env.BASE_URL

function useHash() {
  const [hash, setHash] = useState(() => window.location.hash || '#/')
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const go = useCallback((h: string) => {
    if (h !== window.location.hash) window.location.hash = h
  }, [])
  return [hash, go] as const
}

export default function App() {
  const [book, setBook] = useState<Book>()
  const [error, setError] = useState('')
  const [hash, go] = useHash()
  const [prefs, setPrefs] = usePrefs()
  const [progress, setProgress] = useProgress()
  const [menu, setMenu] = useState(false)
  const [settings, setSettings] = useState(false)
  const engine = useMemo(() => new Engine(), [])

  useEffect(() => {
    fetch(`${BASE}book.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setBook)
      .catch((e) => setError(String(e)))
  }, [])

  const m = hash.match(/^#\/c\/(\d+)/)
  const ch: Chapter | undefined = m && book ? book.chapters.find((c) => c.num === Number(m[1])) : undefined
  const playerCh = book?.chapters.find((c) => c.id === engine.state.chapterId) ?? ch

  // load the chapter's narration when a chapter opens (keep playing one if it's the same)
  useEffect(() => {
    if (!ch) return
    if (engine.state.chapterId !== ch.id) {
      const wasPlaying = engine.state.playing
      engine.load(ch, BASE, progress.pos[ch.id] ?? 0)
      if (wasPlaying) engine.play()
    }
    setProgress((p) => ({ ...p, last: ch.id }))
    window.scrollTo({ top: 0 })
    setMenu(false)
    document.title = `${ch.num}. ${ch.title} · Speak, Build, Earn`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ch?.id])

  useEffect(() => {
    if (!ch) document.title = 'Speak, Build, Earn'
  }, [ch])

  // preferences -> engine
  useEffect(() => {
    engine.rate = prefs.rate
    engine.shadow = prefs.shadow
    engine.loop = prefs.loop
  }, [engine, prefs.rate, prefs.shadow, prefs.loop])

  // theme + font size
  useEffect(() => {
    const r = document.documentElement
    if (prefs.theme === 'auto') r.removeAttribute('data-theme')
    else r.setAttribute('data-theme', prefs.theme)
    r.style.setProperty('--fs', String(prefs.fontScale))
  }, [prefs.theme, prefs.fontScale])

  // save position every few seconds
  useEffect(() => {
    let last = 0
    return engine.onTick((s) => {
      if (!s.chapterId || Math.abs(s.time - last) < 3) return
      last = s.time
      setProgress((p) => ({
        ...p,
        pos: { ...p.pos, [s.chapterId!]: s.time },
        max: { ...p.max, [s.chapterId!]: Math.max(p.max[s.chapterId!] ?? 0, s.time) },
      }))
    })
  }, [engine, setProgress])

  // continue into the next chapter when one finishes
  useEffect(() => {
    engine.onEnded = () => {
      if (!book) return
      const cur = book.chapters.findIndex((c) => c.id === engine.state.chapterId)
      const next = book.chapters[cur + 1]
      if (!next) return
      setProgress((p) => ({ ...p, pos: { ...p.pos, [next.id]: 0 } }))
      engine.load(next, BASE, 0)
      engine.play()
      go(`#/c/${next.num}`)
    }
  }, [engine, book, go, setProgress])

  // lock-screen / headset controls
  useEffect(() => {
    if (!('mediaSession' in navigator) || !playerCh) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `${playerCh.num}. ${playerCh.title}`,
      artist: 'Speak, Build, Earn',
      album: playerCh.subtitle,
    })
    navigator.mediaSession.setActionHandler('play', () => engine.play())
    navigator.mediaSession.setActionHandler('pause', () => engine.pause())
    navigator.mediaSession.setActionHandler('previoustrack', () => engine.step(-1))
    navigator.mediaSession.setActionHandler('nexttrack', () => engine.step(1))
  }, [engine, playerCh])

  // keyboard: space play/pause, arrows move by sentence
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable]') || !engine.chapter) return
      if (e.key === ' ' && !t.closest('button')) {
        e.preventDefault()
        engine.toggle()
      } else if (e.key === 'ArrowRight' && !t.closest('[role=slider]')) engine.step(1)
      else if (e.key === 'ArrowLeft' && !t.closest('[role=slider]')) engine.step(-1)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [engine])

  const onAnswer = useCallback(
    (key: string, opt: number) =>
      setProgress((p) => {
        const quiz = { ...p.quiz }
        if (opt < 0) delete quiz[key]
        else quiz[key] = opt
        return { ...p, quiz }
      }),
    [setProgress],
  )

  if (error) return <div className="state">Could not load the book ({error}). Please refresh.</div>
  if (!book) return <div className="state">Loading the book…</div>

  const sections = ch ? (ch.blocks.filter((b) => b.t === 'h2') as { t: 'h2'; s: number[]; anchor?: string }[]) : []

  return (
    <div className={`app ${ch ? 'in-chapter' : ''} ${menu ? 'menu-open' : ''}`}>
      <header className="topbar">
        {ch && (
          <button className="icon-btn only-mobile" onClick={() => setMenu(true)} aria-label="Open contents">
            <svg width="22" height="22" viewBox="0 0 24 24">
              <path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <a className="brand" href="#/" onClick={() => setMenu(false)}>
          <span className="brand-mark" aria-hidden="true" />
          Speak, Build, Earn
        </a>
        <div className="topbar-right">
          <button className="icon-btn" onClick={() => setSettings((v) => !v)} aria-label="Reading settings" aria-expanded={settings}>
            <span className="aa">Aa</span>
          </button>
        </div>
        {settings && (
          <div className="settings" role="dialog" aria-label="Reading settings">
            <div className="set-row">
              <span>Text size</span>
              <div className="seg-ctl">
                {[0.9, 1, 1.12, 1.25].map((f) => (
                  <button key={f} className={prefs.fontScale === f ? 'active' : ''} onClick={() => setPrefs((p) => ({ ...p, fontScale: f }))}>
                    <span style={{ fontSize: `${f * 15}px` }}>A</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="set-row">
              <span>Theme</span>
              <div className="seg-ctl">
                {(['auto', 'light', 'dark'] as const).map((t) => (
                  <button key={t} className={prefs.theme === t ? 'active' : ''} onClick={() => setPrefs((p) => ({ ...p, theme: t }))}>
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <label className="set-row">
              <span>Follow the voice (auto-scroll)</span>
              <input type="checkbox" checked={prefs.autoScroll} onChange={(e) => setPrefs((p) => ({ ...p, autoScroll: e.target.checked }))} />
            </label>
            <button className="link" onClick={() => setSettings(false)}>
              Done
            </button>
          </div>
        )}
      </header>

      <div className="layout">
        {ch && (
          <>
            <div className="scrim" onClick={() => setMenu(false)} />
            <aside className="sidebar" aria-label="Contents">
              <div className="side-title">Contents</div>
              <ol className="side-chapters">
                {book.chapters.map((c) => (
                  <li key={c.id} className={c.id === ch.id ? 'active' : ''}>
                    <a href={`#/c/${c.num}`}>
                      <span className="n">{c.num}</span>
                      <span>{c.title}</span>
                    </a>
                    {c.id === ch.id && sections.length > 0 && (
                      <ol className="side-sections">
                        {sections.map((s) => (
                          <li key={s.anchor}>
                            <button
                              onClick={() => {
                                document.getElementById(s.anchor!)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                                setMenu(false)
                              }}
                            >
                              {ch.segs[s.s[0]].k.map(([r]) => r.map((x) => x[0]).join('')).join(' ')}
                            </button>
                          </li>
                        ))}
                      </ol>
                    )}
                  </li>
                ))}
              </ol>
            </aside>
          </>
        )}
        <main className="main">
          {ch ? (
            <Reader
              key={ch.id}
              book={book}
              ch={ch}
              engine={engine}
              autoScroll={prefs.autoScroll}
              quiz={progress.quiz}
              onAnswer={onAnswer}
              go={go}
            />
          ) : (
            <Home book={book} progress={progress} go={go} />
          )}
        </main>
      </div>
      {(ch || engine.chapter) && <Player engine={engine} ch={playerCh} prefs={prefs} setPrefs={setPrefs} />}
    </div>
  )
}
