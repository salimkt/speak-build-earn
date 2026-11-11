import { Fragment, memo, useState } from 'react'
import type { Block, Chapter, Run, Seg } from './types'

function RunView({ r }: { r: Run }) {
  const [text, flag] = r
  if (flag === 1) return <strong>{text}</strong>
  if (flag === 2) return <span className="st">{text}</span>
  if (flag === 4) return <span className="ss">{text}</span>
  return <>{text}</>
}

/** One narrated sentence. Every spoken word carries data-w so it can be highlighted and tapped. */
export const SegView = memo(function SegView({ seg }: { seg?: Seg }) {
  if (!seg) return null
  return (
    <span className="seg" data-seg={seg.id} lang={seg.l === 'ml' ? 'ml' : 'en'}>
      {seg.k.map(([runs, spoken], i) => (
        <Fragment key={i}>
          <span className={spoken ? 'w' : 'w mute'} data-w={i}>
            {runs.map((r, j) => (
              <RunView key={j} r={r} />
            ))}
          </span>{' '}
        </Fragment>
      ))}
    </span>
  )
})

function Segs({ ids, ch }: { ids: number[]; ch: Chapter }) {
  return (
    <>
      {ids.map((id) => (
        <SegView key={id} seg={ch.segs[id]} />
      ))}
    </>
  )
}

const CALLOUT_LABEL: Record<string, string> = { tip: 'Tip', note: 'Note', warn: 'Watch out' }

interface Ctx {
  ch: Chapter
  quiz: Record<string, number>
  onAnswer: (key: string, opt: number) => void
  onPlaySeg: (id: number) => void
}

function Quiz({ b, path, ctx }: { b: Extract<Block, { t: 'quiz' }>; path: string; ctx: Ctx }) {
  const key = `${ctx.ch.id}:${path}`
  const saved = ctx.quiz[key]
  const [picked, setPicked] = useState<number | undefined>(saved)
  const answered = picked !== undefined
  return (
    <div className={`quiz ${answered ? (picked === b.correct ? 'ok' : 'bad') : ''}`}>
      <div className="quiz-tag">Quick check</div>
      <p className="quiz-q">
        <Segs ids={b.q} ch={ctx.ch} />
      </p>
      <div className="quiz-opts">
        {b.opts.map((o, i) => {
          const state = !answered ? '' : i === b.correct ? 'right' : i === picked ? 'wrong' : 'dim'
          return (
            <button
              key={i}
              className={`opt ${state}`}
              disabled={answered}
              onClick={() => {
                setPicked(i)
                ctx.onAnswer(key, i)
                if (b.expl[0] !== undefined) ctx.onPlaySeg(b.expl[0])
              }}
            >
              <span className="opt-letter">{String.fromCharCode(65 + i)}</span>
              <span className="opt-text">
                <Segs ids={o} ch={ctx.ch} />
              </span>
            </button>
          )
        })}
      </div>
      {answered && (
        <div className="quiz-expl">
          <b>{picked === b.correct ? 'Correct.' : 'Not quite.'}</b> <Segs ids={b.expl} ch={ctx.ch} />
          <button
            className="link"
            onClick={() => {
              setPicked(undefined)
              ctx.onAnswer(key, -1)
            }}
          >
            Try again
          </button>
        </div>
      )}
    </div>
  )
}

function BlockView({ b, path, ctx }: { b: Block; path: string; ctx: Ctx }) {
  const { ch } = ctx
  switch (b.t) {
    case 'h2':
      return (
        <h2 id={b.anchor} className="sec">
          <Segs ids={b.s} ch={ch} />
          {b.sub && (
            <span className="sub">
              <Segs ids={b.sub} ch={ch} />
            </span>
          )}
        </h2>
      )
    case 'h3':
      return (
        <h3>
          <Segs ids={b.s} ch={ch} />
          {b.sub && (
            <span className="sub">
              {' '}
              <Segs ids={b.sub} ch={ch} />
            </span>
          )}
        </h3>
      )
    case 'p':
      return (
        <p>
          <Segs ids={b.s} ch={ch} />
        </p>
      )
    case 'en':
      return (
        <div className="say">
          <span className="say-tag">Say it</span>
          {b.lines.map((l, i) => (
            <p key={i}>
              <Segs ids={l} ch={ch} />
            </p>
          ))}
        </div>
      )
    case 'tip':
    case 'note':
    case 'warn':
      return (
        <div className={`callout ${b.t}`}>
          <span className="callout-tag">{CALLOUT_LABEL[b.t]}</span>
          <p>
            <Segs ids={b.s} ch={ch} />
          </p>
        </div>
      )
    case 'ul':
    case 'ol': {
      const L = b.t
      return (
        <L>
          {b.items.map((it, i) => (
            <li key={i}>
              <Segs ids={it} ch={ch} />
            </li>
          ))}
        </L>
      )
    }
    case 'table':
      return (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {b.head.map((c, i) => (
                  <th key={i}>
                    <Segs ids={c} ch={ch} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>
                      <Segs ids={c} ch={ch} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'drill':
      return (
        <section className="drill">
          <div className="drill-head">
            <span className="drill-tag">Practice</span>
            <h4>
              <Segs ids={b.s} ch={ch} />
            </h4>
          </div>
          <Blocks blocks={b.blocks} path={`${path}.`} ctx={ctx} />
        </section>
      )
    case 'quiz':
      return <Quiz b={b} path={path} ctx={ctx} />
  }
}

export function Blocks({ blocks, path, ctx }: { blocks: Block[]; path: string; ctx: Ctx }) {
  return (
    <>
      {blocks.map((b, i) => (
        <BlockView key={i} b={b} path={`${path}${i}`} ctx={ctx} />
      ))}
    </>
  )
}

export type { Ctx }
