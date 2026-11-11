import { useEffect, useState } from 'react'

export interface Prefs {
  rate: number
  fontScale: number
  theme: 'auto' | 'light' | 'dark'
  autoScroll: boolean
  shadow: boolean
  loop: boolean
}

export interface Progress {
  last?: string
  /** last audio position per chapter id */
  pos: Record<string, number>
  /** furthest position reached per chapter id */
  max: Record<string, number>
  /** quiz answers: `${chapterId}:${blockIndexPath}` -> option index */
  quiz: Record<string, number>
}

const DEFAULT_PREFS: Prefs = { rate: 1, fontScale: 1, theme: 'auto', autoScroll: true, shadow: false, loop: false }
const DEFAULT_PROGRESS: Progress = { pos: {}, max: {}, quiz: {} }

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

export function usePersisted<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => read(key, fallback))
  useEffect(() => write(key, value), [key, value])
  return [value, setValue] as const
}

export const usePrefs = () => usePersisted<Prefs>('sbe.prefs', DEFAULT_PREFS)
export const useProgress = () => usePersisted<Progress>('sbe.progress', DEFAULT_PROGRESS)

export function fmtTime(sec: number) {
  if (!isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

export function fmtMinutes(sec?: number) {
  if (!sec) return ''
  const m = Math.round(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`
}
