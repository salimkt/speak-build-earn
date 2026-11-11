# Book source format (one file per chapter: `chNN.txt`)

Every line of text is shown in the reader app AND narrated. Text containing any Malayalam
character is read by a Malayalam neural voice; text with no Malayalam characters is read by a
native US-English voice. So: write Malayalam explanations in Malayalam script (English technical
words inside them are fine), and write English examples as pure English lines so the learner
hears native pronunciation.

## Line types

```
# 3 | Stress, rhythm and intonation | ഇംഗ്ലീഷിന്റെ "സംഗീതം"     <- chapter: number | English title | Malayalam subtitle (first line, once)
SUMMARY: ഈ അധ്യായത്തിൽ ...                                         <- 1–2 sentence Malayalam summary (once, after the title)
## 3.1 Word stress | വാക്കിലെ ഊന്നൽ                                 <- section (English | Malayalam; Malayalam part optional)
### Noun vs verb                                                    <- sub-heading

Plain paragraph text. A blank line ends a paragraph. Lines in one paragraph join.

EN: An English example sentence, shown as an example card, read by the English voice.
EN: Consecutive EN: lines form one card.

TIP: helpful hint (callout)
NOTE: side note (callout)
WARN: common mistake / caution (callout)

- bullet item
1. numbered item

| Header A | Header B | Header C |      <- table: first row = header. One row per line.
| cell | cell | cell |                   <- each cell is narrated on its own (language auto-detected)

DRILL: 2.1 | Minimal pairs: V and W      <- starts a drill box (number | title)
...any lines (paragraphs, EN:, bullets, tables) ...
END                                       <- ends the drill box

QUIZ: question text || option A || *correct option || option C || explanation shown after answering
                                          <- one line; mark exactly ONE option with a leading *; the LAST part is the explanation
```

## Inline markup
- `**bold**` for emphasis.
- `{de-VEL-op-ment}` = word-stress notation: syllables joined by `-`, the STRESSED syllable in CAPS.
  Shown with the stressed syllable highlighted; the narrator says the normal word ("development").
  Use it for pronunciation teaching instead of writing raw CAPS syllables.
- `/` inside an EN: line marks a pause (thought group). It is shown, not spoken.
- No HTML. No emoji. No other markdown (no links, no images, no code blocks).

## Writing rules
- Sentences end with `.`, `?` or `!` so narration splits cleanly. Keep sentences short (narration
  and highlighting work per sentence and per word).
- Write numbers so they read naturally: "30 days", "USD 4,000 a month".
- Do not write words that TTS will misread as symbols: write "to" not "→", "versus" not "vs" in
  spoken lines (tables may use short labels).
