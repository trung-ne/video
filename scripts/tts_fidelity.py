"""Language-aware lexical fidelity policy for production TTS.

Canonical subtitle text is never rewritten here.  This module only builds
comparison units, produces an auditable token diff, and decides whether an ASR
observation is a pass, warning, or hard failure for the selected language.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
import re
import unicodedata
from typing import Any, Iterable

WORD_RE = re.compile(r"[\w]+(?:['’\-][\w]+)*", re.UNICODE)
JAPANESE_RE = re.compile(r"[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]")
NUMBER_RE = re.compile(r"(?<!\w)[+-]?\d+(?:[.,]\d+)*(?:%|％)?", re.UNICODE)
NORMALIZATION_VERSION = "multilingual-v2"
POLICY_VERSION = "language-policy-v2"
_SUDACHI_TOKENIZER = None
_SUDACHI_FAILED = False

_NUMBER_WORDS = {
    "en": {"zero":"0","one":"1","two":"2","three":"3","four":"4","five":"5","six":"6","seven":"7","eight":"8","nine":"9","ten":"10",
           "eleven":"11","twelve":"12","thirteen":"13","fourteen":"14","fifteen":"15","sixteen":"16","seventeen":"17","eighteen":"18","nineteen":"19","twenty":"20",
           "thirty":"30","forty":"40","fifty":"50","sixty":"60","seventy":"70","eighty":"80","ninety":"90"},
    "vi": {"không":"0","một":"1","hai":"2","ba":"3","bốn":"4","năm":"5","sáu":"6","bảy":"7","tám":"8","chín":"9","mười":"10"},
    "ko": {"영":"0","일":"1","이":"2","삼":"3","사":"4","오":"5","육":"6","칠":"7","팔":"8","구":"9","십":"10"},
}

_CONTRACTIONS = {
    "can't": ["can", "not"], "cannot": ["can", "not"], "won't": ["will", "not"],
    "don't": ["do", "not"], "doesn't": ["does", "not"], "didn't": ["did", "not"],
    "isn't": ["is", "not"], "aren't": ["are", "not"], "wasn't": ["was", "not"],
    "weren't": ["were", "not"], "it's": ["it", "is"], "that's": ["that", "is"],
    "they're": ["they", "are"], "we're": ["we", "are"], "you're": ["you", "are"],
}
_UNIT_ALIASES = {
    "dollar": "usd", "dollars": "usd", "usd": "usd",
    "yen": "jpy", "jpy": "jpy", "won": "krw", "krw": "krw", "vnd": "vnd",
    "percent": "percent", "percentage": "percent",
    "tỉ": "tỷ",
}


def _kana(value: str) -> str:
    out = []
    for char in value:
        code = ord(char)
        out.append(chr(code - 0x60) if 0x30A1 <= code <= 0x30F6 else char)
    return "".join(out)


def _sudachi():
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
        return [_kana(char) for char in value if JAPANESE_RE.match(char) or char.isalnum()]
    readings: list[str] = []
    for morpheme in tokenizer.tokenize(value):
        reading = morpheme.reading_form()
        surface = morpheme.surface()
        normalized = _kana(reading if reading and reading != "*" else surface)
        readings.extend(char for char in normalized if JAPANESE_RE.match(char) or char.isalnum())
    return readings


def normalize_token(token: str, language: str | None) -> str:
    language = (language or "").lower()
    value = unicodedata.normalize("NFKC", token or "").lower().replace(",", "")
    if language == "en":
        value = {"'s":"s", "’s":"s"}.get(value, value)
    value = _UNIT_ALIASES.get(value, value)
    return _NUMBER_WORDS.get(language, {}).get(value, value)


def _collapse_english_numbers(tokens: list[str]) -> list[str]:
    values = {word: int(number) for word, number in _NUMBER_WORDS["en"].items()}
    scales = {"hundred": 100, "thousand": 1_000, "million": 1_000_000, "billion": 1_000_000_000}
    result: list[str] = []
    index = 0
    while index < len(tokens):
        if tokens[index] not in values and tokens[index] not in scales:
            result.append(normalize_token(tokens[index], "en")); index += 1; continue
        total = current = 0
        while index < len(tokens) and (tokens[index] in values or tokens[index] in scales or tokens[index] == "and"):
            token = tokens[index]
            if token == "and": index += 1; continue
            if token in values: current += values[token]
            elif token == "hundred": current = max(1, current) * 100
            else: total += max(1, current) * scales[token]; current = 0
            index += 1
        result.append(str(total + current))
    return result


def _collapse_vietnamese_numbers(tokens: list[str]) -> list[str]:
    values = {"không": 0, "một": 1, "mốt": 1, "hai": 2, "ba": 3, "bốn": 4,
              "tư": 4, "năm": 5, "lăm": 5, "sáu": 6, "bảy": 7, "tám": 8, "chín": 9}
    # Whisper often emits Vietnamese grouped digits as `2 .000`; treat their
    # tokenized form as the same number as `2000` before number-word parsing.
    compact: list[str] = []
    for token in tokens:
        if compact and token.isdigit() and len(token) == 3 and compact[-1].isdigit():
            compact[-1] += token
        else:
            compact.append(token)
    tokens = compact
    result: list[str] = []
    index = 0
    while index < len(tokens):
        # "cuối năm 2025" uses năm as the calendar-word, not the digit five.
        if (tokens[index] == "năm" and index and tokens[index - 1] == "cuối") or \
           (tokens[index] not in values and tokens[index] not in {"mười", "mươi"}):
            result.append(normalize_token(tokens[index], "vi")); index += 1; continue
        total = current = 0
        while index < len(tokens):
            token = tokens[index]
            if token in values: current += values[token]
            elif token == "mười": current += 10
            elif token == "mươi": current = max(1, current) * 10
            elif token == "trăm":
                # "không trăm" is an explicit zero hundreds component;
                # treating it as one hundred corrupts spoken years such as 2025.
                previous = tokens[index - 1] if index else ""
                current = current * 100 if current or previous == "không" else 100
            elif token in {"linh", "lẻ"}: pass
            elif token in {"nghìn", "ngàn", "triệu"}:
                scale = {"nghìn": 1_000, "ngàn": 1_000, "triệu": 1_000_000}[token]
                total += max(1, current) * scale; current = 0
            else: break
            index += 1
        result.append(str(total + current))
    return result


def _parse_korean_number(token: str) -> int | None:
    digits = {"영": 0, "공": 0, "일": 1, "이": 2, "삼": 3, "사": 4, "오": 5,
              "육": 6, "칠": 7, "팔": 8, "구": 9}
    if not token or any(char not in digits and char not in "십백천만억" for char in token):
        return None
    total = section = number = 0
    for char in token:
        if char in digits: number = digits[char]
        elif char in "십백천":
            section += max(1, number) * {"십": 10, "백": 100, "천": 1_000}[char]; number = 0
        else:
            section += number; number = 0
            total += max(1, section) * {"만": 10_000, "억": 100_000_000}[char]; section = 0
    return total + section + number


def _canonical_currency_order(tokens: list[str]) -> list[str]:
    result = list(tokens)
    currencies = {"usd", "eur", "gbp", "jpy", "krw"}
    for index in range(len(result) - 1):
        if re.fullmatch(r"[+-]?\d+(?:\.\d+)?", result[index]) and result[index + 1] in currencies:
            result[index], result[index + 1] = result[index + 1], result[index]
    return result


def units(text: str, language: str | None) -> list[str]:
    value = unicodedata.normalize("NFC", text or "").lower()
    language = (language or "").lower()
    if language == "vi":
        value = value.replace("phần trăm", " percent ").replace("đô la", " usd ").replace("đồng", " vnd ")
    elif language == "ko":
        value = value.replace("퍼센트", " percent ").replace("달러", " usd ")
    value = value.replace("%", " percent ").replace("％", " percent ")
    value = value.replace("$", " usd ").replace("€", " eur ").replace("£", " gbp ")
    value = value.replace("₩", " krw ").replace("¥", " jpy ").replace("￥", " jpy ")
    if language.startswith("ja"):
        return _japanese_reading_units(value)
    raw = WORD_RE.findall(value)
    if language == "en":
        expanded = [part for token in raw for part in _CONTRACTIONS.get(token, [token])]
        return _canonical_currency_order(_collapse_english_numbers(expanded))
    if language == "vi":
        return _canonical_currency_order(_collapse_vietnamese_numbers(raw))
    if language == "ko":
        # Korean spacing is not semantic. Hangul syllables are comparison units,
        # while Latin terms and digit groups remain intact.
        converted: list[str] = []
        for index, token in enumerate(raw):
            parsed = _parse_korean_number(token)
            next_is_unit = index + 1 < len(raw) and normalize_token(raw[index + 1], language) in {"percent", "usd", "jpy", "krw"}
            converted.append(str(parsed) if parsed is not None and (len(token) > 1 or next_is_unit) else token)
        compact = "".join(converted)
        return _canonical_currency_order([normalize_token(token, language) for token in re.findall(r"[가-힣]|[a-z]+|\d+(?:\.\d+)?", compact)])
    return _canonical_currency_order([normalize_token(token, language) for token in raw if token])


@dataclass(frozen=True)
class FidelityPolicy:
    language: str
    mode: str
    model: str
    escalationModel: str
    minPrecision: float
    minRecall: float
    maxEditRate: float
    maxContiguousInsertion: int = 1
    maxContiguousDeletion: int = 1
    lowConfidenceThreshold: float = 0.82
    escalationMargin: float = 0.04
    policyVersion: str = POLICY_VERSION
    normalizationVersion: str = NORMALIZATION_VERSION

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


DEFAULT_POLICIES = {
    "en": ("hard", "medium", "large-v3", .98, .98, .03),
    "ja": ("hard", "medium", "large-v3", .97, .97, .03),
    "ko": ("hard", "medium", "large-v3", .97, .97, .04),
    "vi": ("soft", "small", "medium", .95, .95, .06),
}


def resolve_policy(env: dict[str, str], language: str) -> FidelityPolicy:
    language = language.lower()
    mode, model, escalation, precision, recall, edit = DEFAULT_POLICIES[language]
    suffix = language.upper()
    def setting(name: str, default: str) -> str:
        return env.get(f"{name}_{suffix}", env.get(name, default)).strip()
    return FidelityPolicy(
        language=language,
        mode=setting("TTS_ALIGNMENT_POLICY", mode).lower(),
        model=setting("TTS_ALIGNMENT_MODEL", model),
        escalationModel=setting("TTS_ALIGNMENT_ESCALATION_MODEL", escalation),
        minPrecision=float(setting("TTS_ALIGNMENT_MIN_PRECISION", str(precision))),
        minRecall=float(setting("TTS_ALIGNMENT_MIN_RECALL", str(recall))),
        maxEditRate=float(setting("TTS_ALIGNMENT_MAX_EDIT_RATE", str(edit))),
        maxContiguousInsertion=int(setting("TTS_ALIGNMENT_MAX_CONTIGUOUS_INSERTION", "1")),
        maxContiguousDeletion=int(setting("TTS_ALIGNMENT_MAX_CONTIGUOUS_DELETION", "1")),
        lowConfidenceThreshold=float(setting("TTS_ALIGNMENT_LOW_CONFIDENCE", ".82")),
        escalationMargin=float(setting("TTS_ALIGNMENT_ESCALATION_MARGIN", ".04")),
    )


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
    maxContiguousDeletion: int

    def as_dict(self) -> dict:
        return asdict(self)


def token_diff(expected: Iterable[str], observed: Iterable[str]) -> list[dict[str, Any]]:
    left, right = list(expected), list(observed)
    rows, cols = len(left), len(right)
    table = [[0] * (cols + 1) for _ in range(rows + 1)]
    for i in range(rows + 1): table[i][0] = i
    for j in range(cols + 1): table[0][j] = j
    for i in range(1, rows + 1):
        for j in range(1, cols + 1):
            table[i][j] = min(table[i-1][j] + 1, table[i][j-1] + 1, table[i-1][j-1] + (left[i-1] != right[j-1]))
    operations: list[dict[str, Any]] = []
    i, j = rows, cols
    while i or j:
        if i and j and table[i][j] == table[i-1][j-1] + (left[i-1] != right[j-1]):
            if left[i-1] != right[j-1]: operations.append({"type":"substitution", "expected":left[i-1], "observed":right[j-1], "expectedIndex":i-1, "observedIndex":j-1})
            i, j = i-1, j-1
        elif j and table[i][j] == table[i][j-1] + 1:
            operations.append({"type":"insertion", "expected":None, "observed":right[j-1], "observedIndex":j-1}); j -= 1
        else:
            operations.append({"type":"deletion", "expected":left[i-1], "observed":None, "expectedIndex":i-1}); i -= 1
    return list(reversed(operations))


def compare(expected: Iterable[str], observed: Iterable[str]) -> FidelityMetrics:
    left, right = list(expected), list(observed)
    diff = token_diff(left, right)
    insertions = sum(item["type"] == "insertion" for item in diff)
    deletions = sum(item["type"] == "deletion" for item in diff)
    substitutions = sum(item["type"] == "substitution" for item in diff)
    matches = max(0, len(left) - deletions - substitutions)
    max_insertions = max_deletions = run_i = run_d = 0
    for item in diff:
        run_i = run_i + 1 if item["type"] == "insertion" else 0
        run_d = run_d + 1 if item["type"] == "deletion" else 0
        max_insertions, max_deletions = max(max_insertions, run_i), max(max_deletions, run_d)
    precision_den = matches + insertions + substitutions
    recall_den = matches + deletions + substitutions
    return FidelityMetrics(len(left), len(right), matches, insertions, deletions, substitutions,
        round(matches / precision_den, 6) if precision_den else 1.0,
        round(matches / recall_den, 6) if recall_den else 1.0,
        round((insertions + deletions + substitutions) / max(1, len(left)), 6), max_insertions, max_deletions)


def passes(metrics: FidelityMetrics, min_precision: float, min_recall: float, max_edit_rate: float) -> bool:
    return metrics.precision >= min_precision and metrics.recall >= min_recall and metrics.editRate <= max_edit_rate and metrics.maxContiguousInsertion == 0


def extract_critical_claims(text: str, explicit: Iterable[str] | None = None) -> list[str]:
    claims = [unicodedata.normalize("NFKC", value).lower().replace(",", "") for value in NUMBER_RE.findall(text or "")]
    claims.extend(unicodedata.normalize("NFC", str(value)).lower().strip() for value in (explicit or []) if str(value).strip())
    return list(dict.fromkeys(claims))


def _numeric_claims(text: str, language: str) -> list[str]:
    sequence = units(text, language)
    units_of_measure = {"percent", "usd", "eur", "gbp", "jpy", "krw", "vnd"}
    claims: list[str] = []
    for index, token in enumerate(sequence):
        if not re.fullmatch(r"[+-]?\d+(?:\.\d+)?", token):
            continue
        parts = [token]
        if index and sequence[index - 1] in units_of_measure:
            parts.insert(0, sequence[index - 1])
        if index + 1 < len(sequence) and sequence[index + 1] in units_of_measure:
            parts.append(sequence[index + 1])
        claims.append(" ".join(parts))
    return list(dict.fromkeys(claims))


def critical_claim_diff(expected_text: str, observed_text: str, language: str, explicit: Iterable[str] | None = None) -> list[dict[str, str]]:
    observed_sequence = units(observed_text, language)
    expected_numeric = _numeric_claims(expected_text, language)
    observed_numeric = _numeric_claims(observed_text, language)
    missing: list[dict[str, str]] = []
    for claim in expected_numeric:
        if claim not in observed_numeric:
            missing.append({"type":"missing", "claim":claim})
    for claim in (explicit or []):
        claim = unicodedata.normalize("NFC", str(claim)).lower().strip()
        claim_units = units(claim, language)
        contiguous = any(observed_sequence[index:index + len(claim_units)] == claim_units
                         for index in range(len(observed_sequence) - len(claim_units) + 1))
        if claim_units and not contiguous:
            missing.append({"type":"missing", "claim":claim})
    for claim in observed_numeric:
        if claim not in expected_numeric:
            missing.append({"type":"unexpected", "claim":claim})
    return missing


def mean_confidence(words: Iterable[dict[str, Any]]) -> float:
    values = [float(item.get("confidence", 0) or 0) for item in words]
    return round(sum(values) / len(values), 6) if values else 0.0


def evaluate(expected_text: str, observed_text: str, language: str, detected_language: str,
             words: list[dict[str, Any]], policy: FidelityPolicy, explicit_claims: Iterable[str] | None = None) -> dict[str, Any]:
    expected, observed = units(expected_text, language), units(observed_text, language)
    metrics = compare(expected, observed)
    diff = token_diff(expected, observed)
    critical = critical_claim_diff(expected_text, observed_text, language, explicit_claims)
    wrong_language = bool(detected_language) and detected_language.lower().split("-")[0] != language.lower().split("-")[0]
    # Policy-aware evaluation lets small isolated insertions/substitutions be
    # governed by the language thresholds. Contiguous phrase errors are handled
    # separately below. Keep ``passes`` strict for legacy callers.
    threshold_pass = (
        metrics.precision >= policy.minPrecision
        and metrics.recall >= policy.minRecall
        and metrics.editRate <= policy.maxEditRate
    )
    hard_structure = metrics.maxContiguousInsertion > policy.maxContiguousInsertion or metrics.maxContiguousDeletion > policy.maxContiguousDeletion
    if wrong_language: classification = "wrong_language"
    elif critical: classification = "critical_claim_mismatch"
    elif metrics.deletions: classification = "tts_omission"
    elif metrics.insertions: classification = "tts_insertion"
    elif metrics.substitutions: classification = "asr_uncertain"
    else: classification = "exact"
    hard_failure = wrong_language or bool(critical) or hard_structure
    if threshold_pass and not hard_failure: policy_result = "pass"
    elif policy.mode == "soft" and not hard_failure: policy_result = "warn"
    else: policy_result = "fail"
    confidence = mean_confidence(words)
    near_threshold = (metrics.precision >= policy.minPrecision - policy.escalationMargin and metrics.recall >= policy.minRecall - policy.escalationMargin and metrics.editRate <= policy.maxEditRate + policy.escalationMargin)
    return {"passed": policy_result != "fail", "policyResult":policy_result, "classification":classification,
            "tokenDiff":diff, "criticalClaimDiff":critical, "metrics":metrics.as_dict(), "asrConfidence":confidence,
            "needsEscalation": confidence < policy.lowConfidenceThreshold or (
                policy_result != "pass" and (near_threshold or classification in {"asr_uncertain", "wrong_language"})
            )}


def diff_signature(result: dict[str, Any]) -> set[tuple[str, str, str]]:
    return {(str(item.get("type")), str(item.get("expected")), str(item.get("observed"))) for item in result.get("tokenDiff", [])}
