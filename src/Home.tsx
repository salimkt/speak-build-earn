import type { Book } from './types'
import { fmtMinutes, type Progress } from './store'
import { segText } from './types'

export function Home({ book, progress, go }: { book: Book; progress: Progress; go: (h: string) => void }) {
  const total = book.chapters.reduce((a, c) => a + (c.duration ?? 0), 0)
  const last = book.chapters.find((c) => c.id === progress.last)
  const pct = (id: string, d?: number) => (d ? Math.min(100, Math.round(((progress.max[id] ?? 0) / d) * 100)) : 0)

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-kicker">A narrated, interactive book · Malayalam explanations</div>
        <h1>
          Speak, <em>Build</em>, Earn
        </h1>
        <p className="hero-sub" lang="ml">
          ഇംഗ്ലീഷ് ഉച്ചാരണം, ജോലിസ്ഥലത്തെ ആശയവിനിമയം, കൂടുതൽ ശമ്പളം കിട്ടുന്ന tech skills: എല്ലാം മലയാളത്തിൽ വിശദീകരിച്ച്.
        </p>
        <div className="hero-stats">
          <span>
            <b>{book.chapters.length}</b> chapters
          </span>
          <span>
            <b>{fmtMinutes(total)}</b> of narration
          </span>
          <span>
            <b>2</b> voices: Malayalam and native English
          </span>
        </div>
        <div className="hero-actions">
          {last ? (
            <button className="btn primary" onClick={() => go(`#/c/${last.num}`)}>
              Continue chapter {last.num}: {last.title}
            </button>
          ) : (
            <button className="btn primary" onClick={() => go(`#/c/${book.chapters[0]?.num ?? 1}`)}>
              Start reading
            </button>
          )}
        </div>
        <ul className="how">
          <li>
            <b>Listen and follow.</b> The highlighted word moves with the voice.
          </li>
          <li>
            <b>Tap any word.</b> Narration jumps to that exact word.
          </li>
          <li>
            <b>Shadow.</b> Turn on Shadow and the book pauses after each sentence so you can repeat it.
          </li>
        </ul>
      </section>

      <section className="toc-grid" aria-label="Chapters">
        {book.chapters.map((c) => {
          const p = pct(c.id, c.duration)
          const summary = c.summary?.map((id) => segText(c.segs[id])).join(' ')
          return (
            <button key={c.id} className="card" onClick={() => go(`#/c/${c.num}`)}>
              <span className="card-num">{String(c.num).padStart(2, '0')}</span>
              <span className="card-body">
                <span className="card-title">{c.title}</span>
                {c.subtitle && (
                  <span className="card-sub" lang="ml">
                    {c.subtitle}
                  </span>
                )}
                {summary && (
                  <span className="card-summary" lang="ml">
                    {summary}
                  </span>
                )}
                <span className="card-meta">
                  <span>{fmtMinutes(c.duration)}</span>
                  {p > 0 && <span className="card-pct">{p >= 95 ? 'Done' : `${p}%`}</span>}
                </span>
                <span className="card-bar">
                  <span style={{ width: `${p}%` }} />
                </span>
              </span>
            </button>
          )
        })}
      </section>
      <footer className="foot">
        Narration by Microsoft neural voices. Made for Malayali engineers who want to speak clearly and earn more.
      </footer>
    </div>
  )
}
