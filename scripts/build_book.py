#!/usr/bin/env python3
"""Parse content/chNN.txt into public/book.json and narrate every segment.

Each segment (sentence, table cell, list item, ...) gets its own TTS clip with word
timings. Clips are concatenated per chapter into public/audio/chNN.mp3 (edge-tts emits
CBR MPEG-2 Layer III, 24 kHz mono, 48 kbps: 144-byte frames of 24 ms, so byte
concatenation is a valid stream and duration = bytes / 6000 seconds).

Usage: python build_book.py [--no-audio] [--only ch03,ch04]
"""
import argparse
import asyncio
import hashlib
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
PUBLIC = ROOT / "public"
AUDIO = PUBLIC / "audio"
CACHE = ROOT / ".tts-cache"

VOICES = {"ml": "ml-IN-SobhanaNeural", "en": "en-US-AndrewMultilingualNeural"}
# Malayalam a touch slower: the narration is a teacher explaining, not a newsreader
RATES = {"ml-IN-SobhanaNeural": "-6%"}
BYTES_PER_SEC = 6000.0

# Optional premium Malayalam narration through Sarvam (bulbul). Enabled with --ml-engine sarvam and
# SARVAM_API_KEY in .env. Sarvam returns no word timings, so they are estimated inside each sentence.
SARVAM_MODEL = "bulbul:v4-flash"
SARVAM_SPEAKER = "chaitra_kn_narration"
SARVAM_PACE = 0.95


def load_env():
    env = {}
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env
ML_RE = re.compile(r"[ഀ-ൿ]")

# ---------------------------------------------------------------- inline tokens
INLINE_RE = re.compile(r"(\*\*.+?\*\*|\{[^{}]+\})")


def lang_of(text):
    return "ml" if ML_RE.search(text) else "en"


def tokenize(text):
    """Return tokens: {"r": [[text, flag], ...], "s": spoken or ""}.

    flag: 0 normal, 1 bold, 2 stressed syllable, 4 unstressed syllable of a stress word.
    """
    runs = []  # (text, flag) pieces in order, may contain spaces
    for part in INLINE_RE.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**"):
            runs.append((part[2:-2], 1))
        elif part.startswith("{") and part.endswith("}"):
            runs.append(("\x00STRESS\x00" + part[1:-1], 8))
        else:
            runs.append((part, 0))

    tokens = []
    cur = None

    def flush():
        nonlocal cur
        if cur and cur["r"]:
            tokens.append(cur)
        cur = None

    for chunk, flag in runs:
        if flag == 8:
            word = chunk.replace("\x00STRESS\x00", "")
            sylls = word.split("-")
            r = []
            for i, s in enumerate(sylls):
                stressed = s.isupper() and any(c.isalpha() for c in s) and len(sylls) > 1
                r.append([s, 2 if stressed else 4])
                if i < len(sylls) - 1:
                    r.append(["·", 4])
            spoken = "".join(sylls).lower() if any(s.isupper() for s in sylls) else "".join(sylls)
            # keep proper-noun capitalisation if the first syllable was capitalised normally
            if sylls and sylls[0][:1].isupper() and not sylls[0].isupper():
                spoken = spoken[:1].upper() + spoken[1:]
            if cur is None:
                cur = {"r": [], "s": ""}
            cur["r"].extend(r)
            cur["s"] += spoken
            continue
        pieces = re.split(r"(\s+)", chunk)
        for p in pieces:
            if p == "":
                continue
            if p.isspace():
                flush()
                continue
            if cur is None:
                cur = {"r": [], "s": ""}
            cur["r"].append([p, flag])
            cur["s"] += p
    flush()

    # "/" pause marks: shown, not spoken; add a comma to the previous spoken token
    for i, t in enumerate(tokens):
        if t["s"] == "/":
            t["s"] = ""
            for j in range(i - 1, -1, -1):
                if tokens[j]["s"]:
                    if not tokens[j]["s"][-1] in ",.;:?!":
                        tokens[j]["s"] += ","
                    break
    # merge adjacent runs with same flag for compactness
    for t in tokens:
        merged = []
        for txt, fl in t["r"]:
            if merged and merged[-1][1] == fl:
                merged[-1][0] += txt
            else:
                merged.append([txt, fl])
        t["r"] = merged
    return tokens


SENT_RE = re.compile(r"(?<=[.?!])\s+(?=\S)")


def split_sentences(text):
    out = []
    for s in SENT_RE.split(text.strip()):
        s = s.strip()
        if s:
            out.append(s)
    return out


# ---------------------------------------------------------------- block parser
class Chapter:
    def __init__(self, cid):
        self.cid = cid
        self.segs = []  # flat list in reading order

    def seg(self, text, kind="", autoplay=True, spoken=None):
        tokens = tokenize(text)
        spoken = spoken or " ".join(t["s"] for t in tokens if t["s"]).strip()
        sid = len(self.segs)
        s = {"id": sid, "lang": lang_of(text), "tokens": tokens, "spoken": spoken}
        if not autoplay:
            s["x"] = 1
        self.segs.append(s)
        return sid

    def segs_for(self, text, autoplay=True):
        return [self.seg(s, autoplay=autoplay) for s in split_sentences(text)]


def parse_table_row(line):
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    return cells


def parse_chapter(path):
    cid = path.stem
    ch = Chapter(cid)
    lines = path.read_text(encoding="utf-8").splitlines()
    meta = {"id": cid}
    root = []
    stack = [root]  # block containers (for DRILL)
    para = []
    en_lines = []
    lst = None  # (type, items)
    table = None

    def out():
        return stack[-1]

    def flush_para():
        nonlocal para
        if para:
            out().append({"t": "p", "s": ch.segs_for(" ".join(para))})
            para = []

    def flush_en():
        nonlocal en_lines
        if en_lines:
            out().append({"t": "en", "lines": [ch.segs_for(l) for l in en_lines]})
            en_lines = []

    def flush_list():
        nonlocal lst
        if lst:
            out().append({"t": lst[0], "items": [ch.segs_for(i) for i in lst[1]]})
            lst = None

    def flush_table():
        nonlocal table
        if table:
            head = [ch.segs_for(c) if c else [] for c in table[0]]
            rows = [[ch.segs_for(c) if c else [] for c in r] for r in table[1:]]
            out().append({"t": "table", "head": head, "rows": rows})
            table = None

    def flush_all():
        flush_para()
        flush_en()
        flush_list()
        flush_table()

    for raw in lines:
        line = raw.rstrip()
        s = line.strip()
        if not s:
            flush_all()
            continue
        if s.startswith("|"):
            if table is None:
                flush_all()
                table = []
            cells = parse_table_row(s)
            if all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
                continue  # markdown separator row
            table.append(cells)
            continue
        else:
            flush_table()

        if s.startswith("# ") and "title" not in meta:
            flush_all()
            parts = [p.strip() for p in s[2:].split("|")]
            meta["num"] = int(re.sub(r"\D", "", parts[0]) or 0)
            meta["title"] = parts[1] if len(parts) > 1 else parts[0]
            meta["subtitle"] = parts[2] if len(parts) > 2 else ""
            meta["titleSeg"] = ch.seg(meta["title"], spoken=f"Chapter {meta['num']}. {meta['title']}.")
            if meta["subtitle"]:
                meta["subtitleSeg"] = ch.seg(meta["subtitle"])
            continue
        if s.startswith("SUMMARY:"):
            flush_all()
            meta["summary"] = ch.segs_for(s[8:].strip())
            continue
        m = re.match(r"^(#{2,3})\s+(.*)$", s)
        if m:
            flush_all()
            level = len(m.group(1))
            parts = [p.strip() for p in m.group(2).split("|")]
            blk = {"t": f"h{level}", "s": [ch.seg(parts[0])]}
            if len(parts) > 1 and parts[1]:
                blk["sub"] = [ch.seg(parts[1])]
            if level == 2:
                blk["anchor"] = f"s{len([b for b in root if b.get('t') == 'h2']) + 1}"
            out().append(blk)
            continue
        if s.startswith("EN:"):
            flush_para()
            flush_list()
            en_lines.append(s[3:].strip())
            continue
        else:
            flush_en()
        m = re.match(r"^(TIP|NOTE|WARN):\s*(.*)$", s)
        if m:
            flush_all()
            out().append({"t": m.group(1).lower(), "s": ch.segs_for(m.group(2))})
            continue
        if s.startswith("DRILL:"):
            flush_all()
            parts = [p.strip() for p in s[6:].split("|")]
            title = parts[1] if len(parts) > 1 else parts[0]
            num = parts[0] if len(parts) > 1 else ""
            label = f"Drill {num}. {title}" if num else f"Drill. {title}"
            blk = {"t": "drill", "num": num, "s": [ch.seg(label)], "blocks": []}
            out().append(blk)
            stack.append(blk["blocks"])
            continue
        if s == "END":
            flush_all()
            if len(stack) > 1:
                stack.pop()
            continue
        if s.startswith("QUIZ:"):
            flush_all()
            parts = [p.strip() for p in s[5:].split("||")]
            if len(parts) < 4:
                print(f"  ! bad QUIZ in {cid}: {s[:60]}", file=sys.stderr)
                continue
            q, opts, expl = parts[0], parts[1:-1], parts[-1]
            correct = next((i for i, o in enumerate(opts) if o.startswith("*")), 0)
            opts = [o.lstrip("*").strip() for o in opts]
            blk = {
                "t": "quiz",
                "q": ch.segs_for(q),
                "opts": [ch.segs_for(o) for o in opts],
                "correct": correct,
                "expl": ch.segs_for(expl, autoplay=False),
            }
            out().append(blk)
            continue
        m = re.match(r"^(-|\d+\.)\s+(.*)$", s)
        if m:
            flush_para()
            kind = "ul" if m.group(1) == "-" else "ol"
            if lst and lst[0] != kind:
                flush_list()
            if lst is None:
                lst = (kind, [])
            lst[1].append(m.group(2))
            continue
        if lst:
            flush_list()
        para.append(s)
    flush_all()
    while len(stack) > 1:
        stack.pop()
    meta.setdefault("num", 0)
    meta.setdefault("title", cid)
    meta["blocks"] = root
    return meta, ch


# ---------------------------------------------------------------- TTS
def norm(w):
    w = unicodedata.normalize("NFC", w).lower()
    return re.sub(r"[^\wഀ-ൿ]", "", w)


def align(tokens, marks):
    """Map word-boundary marks to token indexes. Returns [[tokenIdx, start, end], ...]."""
    spoken_idx = [i for i, t in enumerate(tokens) if t["s"]]
    out = []
    p = 0
    for start, dur, text in marks:
        n = norm(text)
        if not n:
            continue
        hit = None
        for k in range(p, min(p + 4, len(spoken_idx))):
            tn = norm(tokens[spoken_idx[k]]["s"])
            if tn and (tn == n or tn.startswith(n) or n.startswith(tn) or n in tn):
                hit = k
                break
        if hit is None:
            # a token split into several spoken words ("real-time", "4,000"): extend it
            if out and n in norm(tokens[out[-1][0]]["s"]):
                out[-1][2] = round(start + dur, 3)
            continue
        ti = spoken_idx[hit]
        out.append([ti, round(start, 3), round(start + dur, 3)])
        p = hit + 1
    return out


async def synth(text, voice, sem):
    import edge_tts

    rate = RATES.get(voice, "+0%")
    key = hashlib.sha1(f"{voice}\n{rate}\n{text}".encode()).hexdigest()
    mp3 = CACHE / f"{key}.mp3"
    js = CACHE / f"{key}.json"
    if mp3.exists() and js.exists():
        return mp3.read_bytes(), json.loads(js.read_text())
    async with sem:
        for attempt in range(5):
            try:
                audio = bytearray()
                marks = []

                async def fetch():
                    c = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
                    async for chunk in c.stream():
                        if chunk["type"] == "audio":
                            audio.extend(chunk["data"])
                        elif chunk["type"] == "WordBoundary":
                            marks.append((chunk["offset"] / 1e7, chunk["duration"] / 1e7, chunk["text"]))

                await asyncio.wait_for(fetch(), timeout=90)  # a stuck connection must not hang the build
                if not audio:
                    raise RuntimeError("no audio")
                break
            except edge_tts.exceptions.NoAudioReceived:
                if attempt >= 1:  # text the voice cannot speak (e.g. "#", "-s"): leave it silent
                    print(f"  ! no audio for {text!r}; leaving it silent", file=sys.stderr)
                    audio, marks = bytearray(), []
                    break
                await asyncio.sleep(2)
            except Exception:  # network hiccups
                if attempt == 4:
                    raise
                await asyncio.sleep(2 + attempt * 3)
    audio = bytes(audio)
    audio = audio[: len(audio) - len(audio) % 144]
    mp3.write_bytes(audio)
    js.write_text(json.dumps(marks, ensure_ascii=False))
    return audio, marks


def estimate_marks(text, seconds):
    """Spread word timings over a clip in proportion to word length (pauses after punctuation)."""
    words = text.split()
    if not words:
        return []
    lead, tail = 0.12, 0.3
    span = max(0.1, seconds - lead - tail)
    weights = [len(w) + (3 if w[-1] in ",.;:?!" else 1) for w in words]
    total = sum(weights)
    t = lead
    marks = []
    for w, wt in zip(words, weights):
        d = span * wt / total
        marks.append((round(t, 3), round(d * 0.85, 3), w))
        t += d
    return marks


async def synth_sarvam(text, sem, key, ffmpeg):
    import aiohttp
    import base64

    vid = f"sarvam:{SARVAM_MODEL}:{SARVAM_SPEAKER}:{SARVAM_PACE}"
    h = hashlib.sha1(f"{vid}\n{text}".encode()).hexdigest()
    mp3 = CACHE / f"{h}.mp3"
    js = CACHE / f"{h}.json"
    if mp3.exists() and js.exists():
        return mp3.read_bytes(), json.loads(js.read_text())
    body = {
        "text": text,
        "language_code": "ml-IN",
        "model": SARVAM_MODEL,
        "speaker": SARVAM_SPEAKER,
        "pace": SARVAM_PACE,
        "speech_sample_rate": 24000,
        "output_audio_codec": "wav",
    }
    async with sem:
        for attempt in range(14):
            try:
                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=120)) as sess:
                    async with sess.post(
                        "https://api.sarvam.ai/text-to-speech",
                        json=body,
                        headers={"api-subscription-key": key},
                    ) as r:
                        if r.status == 429 or r.status >= 500:
                            raise RuntimeError(f"HTTP {r.status}")
                        data = await r.json()
                        if r.status != 200:
                            raise SystemExit(f"Sarvam error {r.status}: {str(data)[:300]}")
                wav = base64.b64decode(data["audios"][0])
                break
            except SystemExit:
                raise
            except Exception:
                if attempt == 13:
                    raise
                await asyncio.sleep(min(60, 4 + attempt * 6))  # back off on rate limits
    proc = await asyncio.create_subprocess_exec(
        ffmpeg, "-loglevel", "error", "-i", "pipe:0", "-ar", "24000", "-ac", "1", "-c:a", "libmp3lame",
        "-b:a", "48k", "-write_xing", "0", "-id3v2_version", "0", "-f", "mp3", "pipe:1",
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
    )
    audio, _ = await proc.communicate(wav)
    audio = audio[: len(audio) - len(audio) % 144]
    marks = estimate_marks(text, len(audio) / BYTES_PER_SEC)
    mp3.write_bytes(audio)
    js.write_text(json.dumps(marks, ensure_ascii=False))
    return audio, marks


ML_ENGINE = {"name": "edge"}


def synth_for(s, sem):
    if not s["spoken"]:
        return asyncio.sleep(0, (b"", []))
    if s["lang"] == "ml" and ML_ENGINE["name"] == "sarvam":
        return synth_sarvam(s["spoken"], ML_ENGINE["sem"], ML_ENGINE["key"], ML_ENGINE["ffmpeg"])
    return synth(s["spoken"], VOICES[s["lang"]], sem)


def sarvam_cached(text):
    vid = f"sarvam:{SARVAM_MODEL}:{SARVAM_SPEAKER}:{SARVAM_PACE}"
    h = hashlib.sha1(f"{vid}\n{text}".encode()).hexdigest()
    return (CACHE / f"{h}.mp3").exists()


async def narrate(meta, ch, sem):
    engine = ML_ENGINE["name"]
    if ML_ENGINE.get("cached_only"):
        # use Sarvam only for chapters it has fully narrated, so one chapter never mixes two voices
        full = all(sarvam_cached(s["spoken"]) for s in ch.segs if s["lang"] == "ml" and s["spoken"])
        ML_ENGINE["name"] = "sarvam" if full else "edge"
    try:
        results = await asyncio.gather(*[synth_for(s, sem) for s in ch.segs])
    finally:
        ML_ENGINE["name"] = engine
    meta["voice"] = "sarvam" if (ML_ENGINE.get("cached_only") and full) or (engine == "sarvam" and not ML_ENGINE.get("cached_only")) else "edge"
    buf = bytearray()
    for s, (audio, marks) in zip(ch.segs, results):
        start = len(buf) / BYTES_PER_SEC
        buf.extend(audio)
        end = len(buf) / BYTES_PER_SEC
        s["a"] = round(start, 3)
        s["b"] = round(end, 3)
        s["w"] = [[ti, round(start + t0, 3), round(start + t1, 3)] for ti, t0, t1 in align(s["tokens"], marks)]
    AUDIO.mkdir(parents=True, exist_ok=True)
    (AUDIO / f"{meta['id']}.mp3").write_bytes(bytes(buf))
    meta["duration"] = round(len(buf) / BYTES_PER_SEC, 2)
    meta["audio"] = f"audio/{meta['id']}.mp3?v={hashlib.sha1(bytes(buf)).hexdigest()[:8]}"


def finish(meta, ch):
    segs = []
    for s in ch.segs:
        d = {"id": s["id"], "l": s["lang"], "k": [[t["r"], 1 if t["s"] else 0] for t in s["tokens"]]}
        for k in ("a", "b", "w", "x"):
            if k in s:
                d[k] = s[k]
        segs.append(d)
    meta["segs"] = segs
    return meta


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--concurrency", type=int, default=6)
    ap.add_argument("--prefill", default="", help="only fill the audio cache for this language (ml or en)")
    ap.add_argument("--ml-engine", default="edge", choices=["edge", "sarvam"])
    ap.add_argument("--sarvam-concurrency", type=int, default=4)
    ap.add_argument("--sarvam-cached-only", action="store_true",
                    help="no new Sarvam requests: Sarvam for fully cached chapters, edge for the rest")
    args = ap.parse_args()
    if args.ml_engine == "sarvam":
        import imageio_ffmpeg

        key = load_env().get("SARVAM_API_KEY") or os.environ.get("SARVAM_API_KEY")
        if not key:
            raise SystemExit("SARVAM_API_KEY missing: add it to .env")
        ML_ENGINE.update(name="sarvam", key=key, ffmpeg=imageio_ffmpeg.get_ffmpeg_exe(),
                         sem=asyncio.Semaphore(args.sarvam_concurrency), cached_only=args.sarvam_cached_only)
    if args.prefill:
        CACHE.mkdir(exist_ok=True)
        sem = asyncio.Semaphore(args.concurrency)
        todo = []
        for f in sorted(CONTENT.glob("ch[0-9][0-9].txt")):
            _, ch = parse_chapter(f)
            todo += [s for s in ch.segs if s["lang"] == args.prefill and s["spoken"]]
        print(f"prefill {args.prefill}: {len(todo)} segments")
        await asyncio.gather(*[synth_for(s, sem) for s in todo])
        return
    CACHE.mkdir(exist_ok=True)
    only = set(filter(None, args.only.split(",")))
    files = sorted(CONTENT.glob("ch[0-9][0-9].txt"))
    sem = asyncio.Semaphore(args.concurrency)
    existing = {}
    bj = PUBLIC / "book.json"
    if bj.exists() and only:
        existing = {c["id"]: c for c in json.loads(bj.read_text())["chapters"]}
    chapters = []
    for f in files:
        if only and f.stem not in only and f.stem in existing:
            chapters.append(existing[f.stem])
            continue
        meta, ch = parse_chapter(f)
        if not args.no_audio:
            await narrate(meta, ch, sem)
        chapters.append(finish(meta, ch))
        words = sum(len(s["tokens"]) for s in ch.segs)
        print(f"{f.stem}: {len(ch.segs)} segments, {words} words, {meta.get('duration', 0) / 60:.1f} min")
    book = {
        "title": "Speak, Build, Earn",
        "subtitle": "English articulation, communication and tech skills for Malayali engineers, explained in Malayalam",
        "chapters": chapters,
    }
    PUBLIC.mkdir(exist_ok=True)
    bj.write_text(json.dumps(book, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"book.json: {bj.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    asyncio.run(main())
