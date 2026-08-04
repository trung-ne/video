"""Language-aware lexical fidelity checks for expressive TTS.

The gate deliberately measures both recall (did the model read the script?) and
precision (did it invent spoken words?).  It is independent of timestamp
alignment: callers can reject a WAV before it reaches production artifacts.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
import re
import unicodedata
from typing import Iterable

WORD_RE = re.compile(r"[\w]+(?:['’\-][\w]+)*", re.UNICODE)
JAPANESE_RE = re.compile(r"[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]")
_SUDACHI_TOKENIZER = None
_SUDACHI_FAILED = False


def _kana(value: str) -> str:
    """Normalize Katakana/Hiragana so equivalent ASR spellings compare equal."""
    out = []
    for char in value:
        code = ord(char)
        out.append(chr(code - 0x60) if 0x30A1 <= code <= 0x30F6 else char)
    return "".join(out)


def _sudachi():
    """Return the core-dictionary tokenizer, if this environment has it."""
    global _SUDACHI_TOKENIZER, _SUDACHI_FAILED
    if _SUDACHI_TOKENIZER is not None or _SUDACHI_FAILED:
        return _SUDACHI_TOKENIZER
    try:
        from sudachipy import Dictionary
        _SUDACHI_TOKENIZER = Dictionary(dict="core").create()
    except Exception:
        _SUDACHI_FAILED = True
    return _SUDACHI_TOKENIZER


def require_japanese_tokenizer() -> None:
    if _sudachi() is None:
        raise RuntimeError("Japanese production fidelity requires SudachiPy with dictionary core (pip install sudachipy sudachidict_core)")


def _japanese_reading_units(value: str) -> list[str]:
    tokenizer = _sudachi()
    if tokenizer is None:
        # Diagnostic/test fallback only. tts_router.py refuses this path for a
        # Japanese production run, because Kanji and ASR kana would otherwise
        # create false mismatches.
        return [_kana(char) for char in value if JAPANESE_RE.match(char) or char.isalnum()]
    readings: list[str] = []
    for morpheme in tokenizer.tokenize(value):
        reading = morpheme.reading_form()
        surface = morpheme.surface()
        normalized = _kana(reading if reading and reading != "*" else surface)
        readings.extend(char for char in normalized if JAPANESE_RE.match(char) or char.isalnum())
    return readings


def units(text: str, language: str | None) -> list[str]:
    value = unicodedata.normalize("NFC", text or "").lower()
    language = (language or "").lower()
    # Japanese has no reliable whitespace boundary. Character-level units keep
    # deterministic mapping between canonical Kanji and Whisper kana chunks.
    if language.startswith("ja"):
        return _japanese_reading_units(value)
    return [token for token in WORD_RE.findall(value) if token]


@dataclass(frozen=True)
class FidelityMetrics:
    expectedUnits: int
    observedUnits: int
    matchedUnits: int
    insertions: int
    deletions: int
    substitutions: int
    precision: float
    recall: float
    editRate: float
    maxContiguousInsertion: int

    def as_dict(self) -> dict:
        return asdict(self)


def compare(expected: Iterable[str], observed: Iterable[str]) -> FidelityMetrics:
    """Levenshtein comparison with explicit insertion/deletion/substitution counts."""
    left, right = list(expected), list(observed)
    rows, cols = len(left), len(right)
    table = [[0] * (cols + 1) for _ in range(rows + 1)]
    for i in range(rows + 1): table[i][0] = i
    for j in range(cols + 1): table[0][j] = j
    for i in range(1, rows + 1):
        for j in range(1, cols + 1):
            table[i][j] = min(
                table[i - 1][j] + 1,
                table[i][j - 1] + 1,
                table[i - 1][j - 1] + (left[i - 1] != right[j - 1]),
            )

    i, j = rows, cols
    insertions = deletions = substitutions = matches = 0
    max_insertions = run_insertions = 0
    while i or j:
        if i and j and table[i][j] == table[i - 1][j - 1] + (left[i - 1] != right[j - 1]):
            if left[i - 1] == right[j - 1]: matches += 1
            else: substitutions += 1
            run_insertions = 0
            i, j = i - 1, j - 1
        elif j and table[i][j] == table[i][j - 1] + 1:
            insertions += 1
            run_insertions += 1
            max_insertions = max(max_insertions, run_insertions)
            j -= 1
        else:
            deletions += 1
            run_insertions = 0
            i -= 1
    # substitutions are both an expected miss and an observed false positive.
    precision_den = matches + insertions + substitutions
    recall_den = matches + deletions + substitutions
    return FidelityMetrics(
        expectedUnits=rows, observedUnits=cols, matchedUnits=matches,
        insertions=insertions, deletions=deletions, substitutions=substitutions,
        precision=round(matches / precision_den, 6) if precision_den else 1.0,
        recall=round(matches / recall_den, 6) if recall_den else 1.0,
        editRate=round((insertions + deletions + substitutions) / max(1, rows), 6),
        maxContiguousInsertion=max_insertions,
    )


def passes(metrics: FidelityMetrics, min_precision: float, min_recall: float, max_edit_rate: float) -> bool:
    return (
        metrics.precision >= min_precision
        and metrics.recall >= min_recall
        and metrics.editRate <= max_edit_rate
        and metrics.maxContiguousInsertion == 0
    )
