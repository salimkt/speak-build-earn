import type { Chapter, Seg } from './types'

export interface EngineState {
  chapterId?: string
  playing: boolean
  time: number
  duration: number
  segId: number
  /** token index inside the current segment, -1 when between words */
  word: number
  /** shadow mode: performance.now() deadline while waiting for the learner to repeat */
  waitUntil: number
  waitTotal: number
}

type Listener = (s: EngineState) => void

/** Drives one <audio> element per chapter and works out which sentence and word is being read. */
export class Engine {
  audio: HTMLAudioElement
  chapter?: Chapter
  private timeline: Seg[] = []
  private listeners = new Set<Listener>()
  private tickListeners = new Set<Listener>()
  private raf = 0
  private waitTimer = 0
  private explicitSeg = -1
  private lastSeg = -1
  shadow = false
  loop = false
  onEnded?: () => void
  state: EngineState = { playing: false, time: 0, duration: 0, segId: -1, word: -1, waitUntil: 0, waitTotal: 0 }

  constructor() {
    this.audio = new Audio()
    this.audio.preload = 'auto'
    this.audio.addEventListener('play', () => this.update({ playing: true }, true))
    this.audio.addEventListener('pause', () => this.update({ playing: false }, true))
    this.audio.addEventListener('loadedmetadata', () => this.update({ duration: this.audio.duration }, true))
    this.audio.addEventListener('ended', () => {
      this.update({ playing: false }, true)
      this.onEnded?.()
    })
    this.audio.addEventListener('timeupdate', () => {
      if (this.audio.paused) this.tick()
    })
    this.audio.addEventListener('seeked', () => this.tick())
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  /** Called on every animation frame while playing (for the word cursor). */
  onTick(fn: Listener) {
    this.tickListeners.add(fn)
    return () => void this.tickListeners.delete(fn)
  }

  private update(patch: Partial<EngineState>, notify: boolean) {
    this.state = { ...this.state, ...patch }
    for (const fn of this.tickListeners) fn(this.state)
    if (notify) for (const fn of this.listeners) fn(this.state)
  }

  load(ch: Chapter, base: string, startTime = 0) {
    if (this.chapter?.id === ch.id) return
    this.cancelWait()
    this.chapter = ch
    this.timeline = ch.segs.filter((s) => s.a !== undefined && s.b !== undefined && s.b > s.a)
    this.audio.src = base + (ch.audio ?? `audio/${ch.id}.mp3`)
    this.lastSeg = -1
    this.explicitSeg = -1
    const start = () => {
      this.audio.currentTime = startTime
      this.tick()
    }
    if (startTime > 0) this.audio.addEventListener('loadedmetadata', start, { once: true })
    this.update({ chapterId: ch.id, time: startTime, duration: ch.duration ?? 0, segId: -1, word: -1, playing: false }, true)
  }

  get rate() {
    return this.audio.playbackRate
  }
  set rate(r: number) {
    this.audio.playbackRate = r
    this.audio.defaultPlaybackRate = r
  }

  async play() {
    this.cancelWait()
    try {
      await this.audio.play()
    } catch {
      /* autoplay blocked until a user gesture */
    }
    this.startLoop()
  }

  pause() {
    this.cancelWait()
    this.audio.pause()
  }

  toggle() {
    if (this.state.waitUntil || !this.audio.paused) this.pause()
    else this.play()
  }

  seg(id: number) {
    return this.chapter?.segs[id]
  }

  /** Jump to a sentence (optionally to one of its words) and play. */
  seekSeg(id: number, token?: number, autoplay = true) {
    const s = this.seg(id)
    if (!s || s.a === undefined) return
    let t = s.a
    if (token !== undefined && s.w) {
      const hit = s.w.find((w) => w[0] >= token)
      if (hit) t = Math.max(s.a, hit[1] - 0.05)
    }
    this.explicitSeg = id
    this.lastSeg = id
    this.cancelWait()
    this.audio.currentTime = t
    this.update({ segId: id, time: t, word: -1 }, true)
    if (autoplay) this.play()
  }

  step(dir: 1 | -1) {
    const tl = this.timeline.filter((s) => !s.x || s.id === this.state.segId)
    if (!tl.length) return
    const cur = this.state.segId
    let idx = tl.findIndex((s) => s.id === cur)
    if (idx < 0) idx = dir > 0 ? -1 : tl.length
    if (dir < 0 && cur >= 0) {
      const s = this.seg(cur)
      // like a music player: "previous" restarts the sentence if we're well into it
      if (s?.a !== undefined && this.audio.currentTime - s.a > 1.2) return this.seekSeg(cur, undefined, !this.audio.paused)
    }
    const next = tl[Math.min(tl.length - 1, Math.max(0, idx + dir))]
    this.seekSeg(next.id, undefined, !this.audio.paused || !!this.state.waitUntil)
  }

  scrub(t: number) {
    this.cancelWait()
    this.explicitSeg = -1
    this.audio.currentTime = t
    this.tick()
  }

  private cancelWait() {
    if (this.waitTimer) clearTimeout(this.waitTimer)
    this.waitTimer = 0
    if (this.state.waitUntil) this.update({ waitUntil: 0, waitTotal: 0 }, true)
  }

  private startLoop() {
    cancelAnimationFrame(this.raf)
    const loop = () => {
      this.tick()
      if (!this.audio.paused) this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  private find(t: number): Seg | undefined {
    const tl = this.timeline
    let lo = 0
    let hi = tl.length - 1
    let ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (tl[mid].a! <= t) {
        ans = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return ans >= 0 ? tl[ans] : undefined
  }

  private tick() {
    // while the learner repeats a sentence, keep the cursor on that sentence
    if (this.state.waitUntil) return
    const t = this.audio.currentTime
    const playing = !this.audio.paused
    const prev = this.lastSeg >= 0 ? this.seg(this.lastSeg) : undefined

    // sentence finished: apply loop / shadow behaviour before moving on
    if (playing && prev && prev.b !== undefined && t >= prev.b - 0.03 && t < prev.b + 0.6) {
      if (this.loop) {
        this.audio.currentTime = prev.a!
        return
      }
      if (this.shadow && !this.state.waitUntil) {
        this.audio.pause()
        const total = Math.min(12, (prev.b - prev.a!) / this.rate + 0.8)
        const until = performance.now() + total * 1000
        this.update({ waitUntil: until, waitTotal: total }, true)
        this.waitTimer = window.setTimeout(() => {
          this.waitTimer = 0
          this.update({ waitUntil: 0, waitTotal: 0 }, true)
          this.advanceFrom(prev)
          this.play()
        }, total * 1000)
        return
      }
    }

    let seg = this.find(t)
    if (seg && seg.b !== undefined && t >= seg.b) seg = undefined
    // skip segments excluded from continuous play unless the learner tapped them
    if (playing && seg?.x && seg.id !== this.explicitSeg) {
      const next = this.timeline.find((s) => s.a! >= seg!.b! && !s.x)
      if (next) this.audio.currentTime = next.a!
      else this.audio.currentTime = this.audio.duration || t
      return
    }
    const segId = seg ? seg.id : this.state.segId
    if (seg && seg.id !== this.explicitSeg && this.explicitSeg >= 0 && seg.id !== this.lastSeg) this.explicitSeg = -1
    let word = -1
    if (seg?.w?.length) {
      for (const w of seg.w) {
        if (w[1] <= t + 0.02) word = w[0]
        else break
      }
    }
    if (seg) this.lastSeg = seg.id
    const changed = segId !== this.state.segId
    this.update({ time: t, segId, word }, changed || !playing)
  }

  private advanceFrom(prev: Seg) {
    const next = this.timeline.find((s) => s.a! >= prev.b! - 0.001 && !s.x)
    if (next) {
      this.audio.currentTime = next.a!
      this.lastSeg = next.id
    } else this.audio.currentTime = prev.b!
  }
}
