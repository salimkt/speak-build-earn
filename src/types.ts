/** A run of display text with a style flag: 0 normal, 1 bold, 2 stressed syllable, 4 unstressed syllable. */
export type Run = [string, number]
/** A token: its display runs and whether it is spoken (1) or only shown (0). */
export type Token = [Run[], number]

export interface Seg {
  id: number
  l: 'ml' | 'en'
  k: Token[]
  /** start / end time in the chapter audio (seconds) */
  a?: number
  b?: number
  /** word timings: [tokenIndex, start, end] */
  w?: [number, number, number][]
  /** excluded from continuous play (e.g. quiz explanation) */
  x?: 1
}

export type Block =
  | { t: 'h2'; s: number[]; sub?: number[]; anchor?: string }
  | { t: 'h3'; s: number[]; sub?: number[] }
  | { t: 'p'; s: number[] }
  | { t: 'en'; lines: number[][] }
  | { t: 'tip' | 'note' | 'warn'; s: number[] }
  | { t: 'ul' | 'ol'; items: number[][] }
  | { t: 'table'; head: number[][]; rows: number[][][] }
  | { t: 'drill'; num: string; s: number[]; blocks: Block[] }
  | { t: 'quiz'; q: number[]; opts: number[][]; correct: number; expl: number[] }

export interface Chapter {
  id: string
  num: number
  title: string
  subtitle: string
  titleSeg: number
  subtitleSeg?: number
  summary?: number[]
  duration?: number
  audio?: string
  blocks: Block[]
  segs: Seg[]
}

export interface Book {
  title: string
  subtitle: string
  chapters: Chapter[]
}

export function segText(seg: Seg): string {
  return seg.k.map(([runs]) => runs.map((r) => r[0]).join('')).join(' ')
}
