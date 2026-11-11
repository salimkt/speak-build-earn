import { useEffect, useRef, useState } from 'react'
import type { Engine, EngineState } from './engine'
import type { Chapter } from './types'
import { fmtTime, type Prefs } from './store'

const RATES = [0.75, 0.85, 1, 1.15, 1.3, 1.5]

function Icon({ d, size = 22 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} fill="currentColor" />
    </svg>
  )
}
const I = {
  play: 'M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  prev: 'M6 5h2v14H6zM19 6.2v11.6a1 1 0 0 1-1.55.83L9.5 13.2a1.4 1.4 0 0 1 0-2.4l7.95-5.43A1 1 0 0 1 19 6.2z',
  next: 'M16 5h2v14h-2zM5 6.2v11.6a1 1 0 0 0 1.55.83l7.95-5.43a1.4 1.4 0 0 0 0-2.4L6.55 5.37A1 1 0 0 0 5 6.2z',
  loop: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
  mic: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z',
}

export function useEngineState(engine: Engine) {
  const [s, set] = useState<EngineState>(engine.state)
  useEffect(() => engine.subscribe(set), [engine])
  return s
}

interface Props {
  engine: Engine
  ch?: Chapter
  prefs: Prefs
  setPrefs: (fn: (p: Prefs) => Prefs) => void
}

export function Player({ engine, ch, prefs, setPrefs }: Props) {
  const s = useEngineState(engine)
  const bar = useRef<HTMLDivElement>(null)
  const fill = useRef<HTMLDivElement>(null)
  const time = useRef<HTMLSpanElement>(null)
  const [waitLeft, setWaitLeft] = useState(0)
  const duration = s.duration || ch?.duration || 0

  // smooth progress without re-rendering React on every frame
  useEffect(
    () =>
      engine.onTick((st) => {
        const d = st.duration || ch?.duration || 0
        if (fill.current) fill.current.style.transform = `scaleX(${d ? Math.min(1, st.time / d) : 0})`
        if (time.current) time.current.textContent = fmtTime(st.time)
      }),
    [engine, ch],
  )

  useEffect(() => {
    if (!s.waitUntil) return setWaitLeft(0)
    let raf = 0
    const loop = () => {
      setWaitLeft(Math.max(0, (s.waitUntil - performance.now()) / 1000))
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [s.waitUntil])

  const seekFromPointer = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect()
    engine.scrub(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration)
  }

  if (!ch) return null
  const busy = s.playing || !!s.waitUntil
  const cycleRate = () => {
    const i = RATES.indexOf(prefs.rate)
    setPrefs((p) => ({ ...p, rate: RATES[(i + 1) % RATES.length] }))
  }

  return (
    <div className={`player ${busy ? 'on' : ''}`} role="region" aria-label="Narration player">
      {s.waitUntil > 0 && (
        <div className="your-turn" style={{ ['--p' as string]: String(waitLeft / (s.waitTotal || 1)) }}>
          <Icon d={I.mic} size={16} /> Your turn: repeat the sentence aloud
          <span className="your-turn-bar" />
        </div>
      )}
      <div
        className="progress"
        ref={bar}
        onPointerDown={(e) => {
          ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
          seekFromPointer(e.clientX)
        }}
        onPointerMove={(e) => e.buttons && seekFromPointer(e.clientX)}
        role="slider"
        aria-label="Chapter position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(s.time)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') engine.scrub(Math.min(duration, engine.audio.currentTime + 10))
          if (e.key === 'ArrowLeft') engine.scrub(Math.max(0, engine.audio.currentTime - 10))
        }}
      >
        <div className="progress-fill" ref={fill} />
      </div>
      <div className="player-row">
        <div className="player-info">
          <div className="player-ch">
            {ch.num}. {ch.title}
          </div>
          <div className="player-time">
            <span ref={time}>{fmtTime(s.time)}</span> / {fmtTime(duration)}
          </div>
        </div>
        <div className="controls">
          <button className="ctl" onClick={() => engine.step(-1)} aria-label="Previous sentence" title="Previous sentence (←)">
            <Icon d={I.prev} />
          </button>
          <button className="ctl big" onClick={() => engine.toggle()} aria-label={busy ? 'Pause' : 'Play'} title="Play / pause (space)">
            <Icon d={busy ? I.pause : I.play} size={28} />
          </button>
          <button className="ctl" onClick={() => engine.step(1)} aria-label="Next sentence" title="Next sentence (→)">
            <Icon d={I.next} />
          </button>
        </div>
        <div className="modes">
          <button className="chip" onClick={cycleRate} aria-label="Playback speed" title="Speed">
            {prefs.rate}×
          </button>
          <button
            className={`chip ${prefs.loop ? 'active' : ''}`}
            onClick={() => setPrefs((p) => ({ ...p, loop: !p.loop, shadow: p.loop ? p.shadow : false }))}
            aria-pressed={prefs.loop}
            title="Repeat the current sentence"
          >
            <Icon d={I.loop} size={16} /> <span className="chip-label">Repeat</span>
          </button>
          <button
            className={`chip ${prefs.shadow ? 'active' : ''}`}
            onClick={() => setPrefs((p) => ({ ...p, shadow: !p.shadow, loop: p.shadow ? p.loop : false }))}
            aria-pressed={prefs.shadow}
            title="Shadowing: pause after each sentence so you can repeat it"
          >
            <Icon d={I.mic} size={16} /> <span className="chip-label">Shadow</span>
          </button>
        </div>
      </div>
    </div>
  )
}
