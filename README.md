# Speak, Build, Earn

A narrated, interactive book that teaches English articulation, workplace communication and
high-paying tech skills (including the Forward Deployed Engineer role) to Malayali engineers,
with explanations in Malayalam.

**Read it:** https://salimkt.github.io/speak-build-earn/

- Every sentence is narrated: Malayalam explanations by a Malayalam neural voice, English
  examples by a native US-English voice.
- The highlighted word follows the voice. Tap any word to hear it from there.
- **Shadow** mode pauses after each sentence so you can repeat it; **Repeat** loops a sentence.
- Speed control, quizzes, progress saved on your device, light and dark themes, works on phones.

## How it is built

- `content/chNN.txt`: the book, in a small line-based format (see `content/FORMAT.md`).
- `scripts/build_book.py`: parses the chapters into `public/book.json` and narrates every
  segment with [edge-tts](https://github.com/rany2/edge-tts), keeping word timings, then joins
  the clips into one MP3 per chapter (`public/audio/`).
- `src/`: React + Vite reader. Highlighting is driven from the audio clock on each animation
  frame and applied straight to the DOM, so long chapters stay smooth.

```bash
python3 -m venv .venv && .venv/bin/pip install edge-tts
.venv/bin/python scripts/build_book.py      # rebuild book.json and audio (cached per sentence)
npm install && npm run dev
```

Pushing to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`.
