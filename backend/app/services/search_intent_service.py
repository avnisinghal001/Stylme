from __future__ import annotations

import asyncio
import math
import re
import time
import unicodedata
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from typing import Any, Dict, Iterable, List, Optional

from app.core.serialization import mongo_json
from app.services.metadata_service import active_fields
from app.services.profile_personalization import (
    HEIGHT_BAND_CM,
    WEIGHT_BAND_KG,
    compatible_gender_keys,
    measurement_band,
)
from app.services.product_service import list_public_products
from app.services.taxonomy_reconciler_service import (
    FORBIDDEN_PRODUCT_TEXT_PATTERN,
    FASHION_SEARCH_EXCLUDED_PRODUCT_TYPES,
    GRAPH_KEY,
    INDIAN_CONTEXTS,
    baseline_context_signals,
    indirect_linguistic_signals,
    traverse_graph,
)


MODEL_KEY = "catalogue-token-filter-v2"
MODEL_CACHE_SECONDS = 300
_model_cache: tuple[float, Dict[str, Any]] | None = None
_graph_cache: tuple[float, Optional[Dict[str, Any]]] | None = None
_fields_cache: tuple[float, Dict[str, Dict[str, Any]]] | None = None
_brands_cache: tuple[float, List[Dict[str, Any]]] | None = None

# Python's default ``\w`` excludes combining marks, which splits words such as
# "महिला" into fragments.  Include the full Devanagari block while retaining
# normal Unicode word matching for English and transliterated Hindi.
TOKEN_RE = re.compile(r"[^\W_][\w\u0300-\u036f\u0900-\u097f]*", re.UNICODE)
PRICE_VALUE = r"([0-9][0-9,]*(?:\.[0-9]+)?\s*[kK]?)"
PRICE_MAX_PATTERNS = (
    re.compile(rf"(?:under|below|upto|up\s*to|less\s*than|lower\s*than|lesser\s*than|cheaper\s*than|not\s*more\s*than|at\s*most|within|max|budget)\s*(?:rs\.?|inr|₹)?\s*{PRICE_VALUE}", re.I),
    re.compile(rf"(?:rs\.?|inr|₹)?\s*{PRICE_VALUE}\s*(?:se\s*kam|ke\s*niche|से\s*कम|के\s*नीचे)", re.I),
)
PRICE_MIN_PATTERNS = (
    re.compile(rf"(?:above|over|more\s*than|higher\s*than|costlier\s*than|at\s*least|min|starting\s*from)\s*(?:rs\.?|inr|₹)?\s*{PRICE_VALUE}", re.I),
    re.compile(rf"(?:rs\.?|inr|₹)?\s*{PRICE_VALUE}\s*(?:se\s*zyada|se\s*jada|से\s*ज़्यादा|से\s*ज्यादा)", re.I),
)
PRICE_RANGE_PATTERNS = (
    re.compile(rf"(?:between|from)\s*(?:rs\.?|inr|₹)?\s*{PRICE_VALUE}\s*(?:and|to|se|से|-)\s*(?:rs\.?|inr|₹)?\s*{PRICE_VALUE}", re.I),
    re.compile(rf"(?:rs\.?|inr|₹)?\s*{PRICE_VALUE}\s*(?:-|to|se|से)\s*(?:rs\.?|inr|₹)?\s*{PRICE_VALUE}", re.I),
)
PRICE_CURRENCY_PATTERNS = (
    re.compile(rf"(?:rs\.?|inr|₹)\s*{PRICE_VALUE}", re.I),
    re.compile(rf"{PRICE_VALUE}\s*(?:rs\.?|inr)\b", re.I),
)
TRAILING_PINCODE_RE = re.compile(r"(?<![0-9])([1-9][0-9]{5})\s*$")

STOP_WORDS = {
    "a", "an", "and", "aur", "day", "days", "for", "i", "in", "ka", "ke", "ki", "ko", "look",
    "light", "looking", "me", "mera", "meri", "of", "outfit", "please", "show", "some",
    "something", "thing", "things", "the", "to", "want", "wear", "with", "wala", "wali", "वाला", "वाली",
    "liye", "के", "की", "का", "और", "मुझे", "दिखाओ", "लिए", "apparel", "best",
    "cloth", "clothes", "clothing", "fashion", "mood", "personality", "style", "styled",
    "vibe", "vibes", "while", "color", "colour", "rang", "रंग",
}
CONTROL_WORDS = {
    "under", "below", "upto", "up", "less", "than", "max", "budget", "above", "over",
    "more", "lower", "lesser", "cheaper", "higher", "costlier", "within", "at", "most",
    "least", "not", "min", "rs", "inr", "price", "age", "umar", "height", "lambai", "weight",
    "wazan", "cm", "kg", "se", "kam", "zyada", "jada", "niche", "to", "₹",
}
SPELLING_ALIASES = {
    "birthdy": "birthday",
    "brthday": "birthday",
    "burthday": "birthday",
    "cloths": "clothes",
    "clth": "cloth",
    "clths": "clothes",
    "happi": "happy",
    "styld": "styled",
    "styl": "style",
    "wer": "wear",
    "waer": "wear",
    "wera": "wear",
}

# Hand-authored seeds cover transliterated Hindi and common Indian-commerce
# phrasing. The trained token graph supplements these aliases from the 30k
# catalogue, so adding products improves recognition without changing code.
PHRASE_ALIASES: Dict[str, tuple[str, str]] = {
    "laal": ("color_family", "red"), "lal": ("color_family", "red"), "लाल": ("color_family", "red"),
    "kala": ("color_family", "black"), "kaala": ("color_family", "black"), "काला": ("color_family", "black"),
    "safed": ("color_family", "white"), "सफेद": ("color_family", "white"),
    "neela": ("color_family", "blue"), "nila": ("color_family", "blue"), "नीला": ("color_family", "blue"),
    "hara": ("color_family", "green"), "हरा": ("color_family", "green"),
    "peela": ("color_family", "yellow"), "pila": ("color_family", "yellow"), "पीला": ("color_family", "yellow"),
    "gulabi": ("color_family", "pink"), "गुलाबी": ("color_family", "pink"),
    "baingani": ("color_family", "violet"), "बैंगनी": ("color_family", "violet"),
    "shaadi": ("occasion", "wedding"), "shadi": ("occasion", "wedding"), "शादी": ("occasion", "wedding"),
    "wedding guest": ("occasion", "wedding-guest"), "mehmaan": ("occasion", "wedding-guest"),
    "tyohar": ("theme", "festive"), "festival wear": ("theme", "festive"), "त्योहार": ("theme", "festive"),
    "daftar": ("occasion", "office"), "work wear": ("occasion", "office"), "ऑफिस": ("occasion", "office"),
    "pooja": ("occasion", "puja"), "पूजा": ("occasion", "puja"),
    "roz": ("theme", "casual"), "daily wear": ("theme", "casual"), "रोज": ("theme", "casual"),
    "ladki": ("gender", "women"), "mahila": ("gender", "women"), "महिला": ("gender", "women"), "लड़की": ("gender", "women"),
    "ladka": ("gender", "men"), "purush": ("gender", "men"), "पुरुष": ("gender", "men"), "लड़का": ("gender", "men"),
    "bacche": ("category", "kids"), "bachche": ("category", "kids"), "बच्चे": ("category", "kids"),
    "kurta set": ("product_type", "kurta-sets"), "kurta sets": ("product_type", "kurta-sets"),
    "kurta": ("product_type", "kurtas"), "kurti": ("product_type", "kurtis"), "कुर्ता": ("product_type", "kurtas"),
    "saree": ("product_type", "sarees"), "sari": ("product_type", "sarees"), "साड़ी": ("product_type", "sarees"),
    "t shirt": ("product_type", "tshirts"), "tee": ("product_type", "tshirts"),
    "shirt": ("product_type", "shirts"), "jean": ("product_type", "jeans"), "denims": ("product_type", "jeans"),
    "dress": ("product_type", "dresses"), "sneaker": ("product_type", "casual-shoes"),
    "sneakers": ("product_type", "casual-shoes"), "running shoes": ("product_type", "sports-shoes"),
    "sports shoes": ("product_type", "sports-shoes"), "hoodie": ("product_type", "sweatshirts"),
    "gen alpha": ("generation", "gen-alpha"), "alpha kids": ("generation", "gen-alpha"),
    "gen z": ("generation", "gen-z"), "genz": ("generation", "gen-z"),
    "millennial": ("generation", "millennial"), "classic": ("style", "classic"),
    "trendy": ("trend_signal", "trending"), "trend": ("trend_signal", "trending"),
    "viral": ("trend_signal", "viral"), "ethnic": ("style", "ethnic"),
    "baggy": ("fit", "oversized"), "loose fit": ("fit", "loose"),
}

ONE_DAY_TERMS = (
    "one day", "1 day", "same day", "kal tak", "tomorrow", "swoopstyl", "एक दिन", "कल तक",
)
SORT_PHRASES = {
    "cheapest": "price-low", "lowest price": "price-low", "sasta": "price-low", "सस्ता": "price-low",
    "price high": "price-high", "costliest": "price-high",
    "newest": "newest", "latest": "newest", "new arrival": "newest", "naya": "newest", "नया": "newest",
    "best rated": "rating", "top rated": "rating", "highest rating": "rating",
}


def normalize_query(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold().replace("_", " ").replace("-", " ")
    return " ".join(normalized.split())


def tokenize(value: str) -> List[str]:
    return [token for token in TOKEN_RE.findall(normalize_query(value)) if token]


def _character_vector(value: str) -> Counter[str]:
    padded = f"^{normalize_query(value)}$"
    return Counter(padded[index:index + 2] for index in range(max(0, len(padded) - 1)))


def fuzzy_probability(left: str, right: str) -> float:
    """Blend edit similarity with bigram cosine similarity into [0, 1]."""
    left, right = normalize_query(left), normalize_query(right)
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    edit_score = SequenceMatcher(None, left, right).ratio()
    left_vector, right_vector = _character_vector(left), _character_vector(right)
    dot = sum(value * right_vector.get(key, 0) for key, value in left_vector.items())
    left_norm = math.sqrt(sum(value * value for value in left_vector.values()))
    right_norm = math.sqrt(sum(value * value for value in right_vector.values()))
    cosine = dot / (left_norm * right_norm) if left_norm and right_norm else 0.0
    prefix = 1.0 if left[0] == right[0] else 0.0
    return round(min(1.0, 0.62 * edit_score + 0.33 * cosine + 0.05 * prefix), 4)


def sparse_cosine_score(query_vector: Dict[str, float], product_features: Iterable[str]) -> float:
    """Reference implementation for the equivalent Mongo aggregation score."""
    features = set(product_features)
    matched = [weight for key, weight in query_vector.items() if key in features]
    if not matched:
        return 0.0
    query_norm = math.sqrt(sum(weight * weight for weight in query_vector.values()))
    product_norm = math.sqrt(len(matched))
    return round(sum(matched) / (query_norm * product_norm), 6) if query_norm else 0.0


def _best_fuzzy_match(token: str, vocabulary: Iterable[str]) -> tuple[Optional[str], float]:
    best, probability = None, 0.0
    for phrase in vocabulary:
        if " " in phrase or abs(len(phrase) - len(token)) > 3:
            continue
        if phrase[0] != token[0] and SequenceMatcher(None, token, phrase).ratio() < 0.92:
            continue
        score = fuzzy_probability(token, phrase)
        if score > probability:
            best, probability = phrase, score
    return best, probability


def _contains_phrase(query: str, phrase: str) -> bool:
    return bool(re.search(rf"(?<!\w){re.escape(phrase)}(?!\w)", query))


def _negated(query: str, phrase: str) -> bool:
    return bool(re.search(rf"(?:not|no|nahi|mat|बिना)\s+(?:\w+\s+){{0,1}}{re.escape(phrase)}(?!\w)", query))


def _price_number(value: str) -> int:
    cleaned = value.replace(",", "").replace(" ", "")
    multiplier = 1000 if cleaned.casefold().endswith("k") else 1
    if multiplier > 1:
        cleaned = cleaned[:-1]
    return int(float(cleaned) * multiplier)


def _number(match: Optional[re.Match], group: int = 1) -> Optional[int]:
    return _price_number(match.group(group)) if match else None


def _first_match(patterns: Iterable[re.Pattern], query: str):
    return next((match for pattern in patterns if (match := pattern.search(query))), None)


def _numeric_range(query: str, names: Iterable[str], minimum: float, maximum: float):
    prefix = "|".join(re.escape(name) for name in names)
    range_match = re.search(
        rf"(?:{prefix})\s*(?:is|=|:)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:-|to|se|से)\s*([0-9]+(?:\.[0-9]+)?)",
        query,
        re.I,
    )
    if range_match:
        low, high = float(range_match.group(1)), float(range_match.group(2))
        if minimum <= low <= high <= maximum:
            return low, high
    exact = re.search(rf"(?:{prefix})\s*(?:is|=|:)?\s*([0-9]+(?:\.[0-9]+)?)", query, re.I)
    if exact:
        value = float(exact.group(1))
        if minimum <= value <= maximum:
            return value, value
    return None, None


async def _intent_model(database) -> Dict[str, Any]:
    global _model_cache
    now = time.monotonic()
    if _model_cache and _model_cache[0] > now:
        return _model_cache[1]
    model = await database.search_intent_models.find_one({"key": MODEL_KEY}) or {
        "version": 2,
        "model_type": "taxonomy-graph-only",
        "training_rows": 0,
        "nodes": {},
        "thresholds": {"runtime_minimum_confidence": 0.52},
        "correlations": {},
    }
    _model_cache = (now + MODEL_CACHE_SECONDS, model)
    return model


async def _cached_fields(database) -> Dict[str, Dict[str, Any]]:
    global _fields_cache
    now = time.monotonic()
    if _fields_cache and _fields_cache[0] > now:
        return _fields_cache[1]
    fields = await active_fields(database)
    _fields_cache = (now + MODEL_CACHE_SECONDS, fields)
    return fields


async def _cached_brands(database) -> List[Dict[str, Any]]:
    global _brands_cache
    now = time.monotonic()
    if _brands_cache and _brands_cache[0] > now:
        return _brands_cache[1]
    brands = await database.brands.find(
        {"status": "active"}, {"name": 1, "aliases": 1}
    ).to_list(length=5000)
    _brands_cache = (now + MODEL_CACHE_SECONDS, brands)
    return brands


async def _reconciliation_graph(database) -> Optional[Dict[str, Any]]:
    global _graph_cache
    now = time.monotonic()
    # Do not negatively cache a missing graph. The reconciler can activate the
    # first graph while a serverless instance is warm, and search must observe
    # that activation immediately instead of waiting for the normal model TTL.
    if _graph_cache and _graph_cache[0] > now and _graph_cache[1] is not None:
        return _graph_cache[1]
    graph = await database.taxonomy_reconciler_graphs.find_one(
        {"key": GRAPH_KEY, "active": True},
        {"version": 1, "schema_version": 1, "nodes": 1, "edges": 1},
    )
    _graph_cache = (now + MODEL_CACHE_SECONDS, graph)
    return graph


async def compile_search_intent(
    database,
    raw_query: str,
    supplied_pincode: Optional[str] = None,
    supplied_swoopstyl: bool = False,
) -> Dict[str, Any]:
    query = normalize_query(raw_query)
    query_tokens = tokenize(query)
    fields, model, brands, reconciliation_graph = await asyncio.gather(
        _cached_fields(database),
        _intent_model(database),
        _cached_brands(database),
        _reconciliation_graph(database),
    )
    allowed = {
        field: {
            str(option.get("key"))
            for option in document.get("options") or []
            if isinstance(option, dict) and option.get("key") and option.get("active", True)
        }
        for field, document in fields.items()
    }
    candidates: Dict[tuple[str, str], Dict[str, Any]] = {}

    def add(
        field: str,
        value: str,
        score: float,
        source: str,
        phrase: str,
        support: int = 0,
        *,
        hard_eligible: bool = True,
    ):
        if value not in allowed.get(field, set()) or _negated(query, phrase):
            return
        key = (field, value)
        current = candidates.setdefault(
            key,
            {"score": 0.0, "evidence": [], "support": 0, "hardEligible": False},
        )
        current["score"] = max(float(current["score"]), score)
        current["support"] = max(int(current["support"]), support)
        current["hardEligible"] = bool(current["hardEligible"] or hard_eligible)
        evidence = {"source": source, "phrase": phrase, "score": round(score, 4)}
        if evidence not in current["evidence"]:
            current["evidence"].append(evidence)

    phrase_index: Dict[str, List[tuple[str, str, str]]] = defaultdict(list)
    for field, document in fields.items():
        if not document.get("filterable"):
            continue
        for option in document.get("options") or []:
            if not isinstance(option, dict) or not option.get("active", True):
                continue
            value = str(option.get("key") or "")
            terms = [value, str(option.get("label") or ""), *(str(alias) for alias in option.get("aliases") or [])]
            if value.endswith("s") and len(value) > 4:
                terms.append(value[:-1])
            for term in terms:
                phrase = normalize_query(term)
                if len(phrase) >= 2:
                    phrase_index[phrase].append((field, value, "taxonomy"))
    for phrase, (field, value) in PHRASE_ALIASES.items():
        phrase_index[normalize_query(phrase)].append((field, value, "alias"))

    for phrase in sorted(phrase_index, key=len, reverse=True):
        if not _contains_phrase(query, phrase):
            continue
        for field, value, source in phrase_index[phrase]:
            add(field, value, 1.0 if source == "alias" else 0.96, source, phrase)

    single_phrases = {
        phrase: labels
        for phrase, labels in phrase_index.items()
        if " " not in phrase and len(phrase) >= 4
    }
    learned_single_phrases = {
        normalize_query(str(phrase))
        for phrase in (model.get("nodes") or {})
        if " " not in str(phrase) and 4 <= len(str(phrase)) <= 32
    }
    context_single_phrases = {
        normalize_query(phrase)
        for phrase in INDIAN_CONTEXTS
        if " " not in phrase and len(phrase) >= 4
    }
    fuzzy_vocabulary = (
        set(single_phrases)
        | learned_single_phrases
        | context_single_phrases
        | {word for word in STOP_WORDS | CONTROL_WORDS if len(word) >= 4}
    )
    corrections: List[Dict[str, Any]] = []
    correction_map: Dict[str, str] = {
        token: SPELLING_ALIASES[token]
        for token in query_tokens
        if token in SPELLING_ALIASES
    }
    corrections.extend(
        {
            "from": token,
            "to": correction,
            "probability": 0.99,
            "method": "commerce-spelling-alias",
        }
        for token, correction in correction_map.items()
    )
    for token in query_tokens:
        if token in correction_map or token in fuzzy_vocabulary or token in STOP_WORDS or len(token) < 4:
            continue
        best_phrase, probability = _best_fuzzy_match(token, fuzzy_vocabulary)
        if best_phrase and probability >= 0.79:
            correction_map[token] = best_phrase
            corrections.append(
                {
                    "from": token,
                    "to": best_phrase,
                    "probability": probability,
                    "method": "edit-bigram-cosine",
                }
            )
            for field, value, _ in single_phrases.get(best_phrase, []):
                add(
                    field,
                    value,
                    0.7 + 0.25 * probability,
                    "fuzzy",
                    token,
                )

    semantic_tokens = [correction_map.get(token, token) for token in query_tokens]
    corrected_query = " ".join(semantic_tokens)
    linguistic_signals = indirect_linguistic_signals(corrected_query)
    query_features = set(semantic_tokens)
    for width in (2, 3):
        query_features.update(
            " ".join(semantic_tokens[index:index + width])
            for index in range(len(semantic_tokens) - width + 1)
        )
    # Learned correlations are allowed to classify concrete product traits.
    # Subjective merchandising facets such as generation, occasion and mood
    # must still be explicitly present in the shopper's words.
    learned_fields = {
        "category", "product_type", "color", "color_family", "material",
        "pattern", "fit", "silhouette",
    }
    learned_minimum = float((model.get("thresholds") or {}).get("runtime_minimum_confidence") or 0.52)
    for feature in query_features:
        if feature in STOP_WORDS or feature in CONTROL_WORDS:
            continue
        for edge in (model.get("nodes") or {}).get(feature, []):
            confidence = float(edge.get("confidence") or 0)
            support = int(edge.get("support") or 0)
            field = str(edge.get("field"))
            if field not in learned_fields or confidence < learned_minimum:
                continue
            add(
                field,
                str(edge.get("value")),
                confidence,
                "catalogue-correlation",
                feature,
                support,
                hard_eligible=False,
            )

    # Always merge conservative code-shipped contexts so a newly deployed API
    # benefits before the next cron rebuild. The persisted graph adds deeper
    # catalogue paths when it is available.
    semantic_signals = baseline_context_signals(corrected_query, fields)
    semantic_signals.extend(
        traverse_graph(reconciliation_graph, corrected_query, depth=4, limit=30)
    )
    strongest_signal: Dict[tuple[str, str], Dict[str, Any]] = {}
    for signal in semantic_signals:
        key = (str(signal.get("field") or ""), str(signal.get("value") or ""))
        if float(signal.get("score") or 0) > float(
            (strongest_signal.get(key) or {}).get("score") or 0
        ):
            strongest_signal[key] = signal
    for (field, value), signal in strongest_signal.items():
        path = signal.get("path") or []
        source_phrase = next(
            (
                str(item).removeprefix("baseline:")
                for item in path
                if str(item).startswith("baseline:")
            ),
            value,
        )
        add(
            field,
            value,
            float(signal.get("score") or 0),
            "context-graph",
            source_phrase,
            hard_eligible=False,
        )

    graph_signals = [
        {
            "from": "query-context",
            "to": f"{field}:{value}",
            "boost": round(float(signal.get("score") or 0), 4),
            "depth": int(signal.get("depth") or 0),
        }
        for (field, value), signal in strongest_signal.items()
    ]
    for (field, value), candidate in list(candidates.items()):
        source_key = f"{field}:{value}"
        for edge in (model.get("correlations") or {}).get(source_key, []):
            target = (str(edge.get("field")), str(edge.get("value")))
            if target not in candidates:
                continue
            boost = min(0.1, max(0.0, float(edge.get("weight") or 0)) * 0.025)
            candidates[target]["score"] = min(1.0, float(candidates[target]["score"]) + boost)
            graph_signals.append({
                "from": source_key,
                "to": f"{target[0]}:{target[1]}",
                "boost": round(boost, 4),
                "support": int(edge.get("support") or 0),
            })

    selected: Dict[str, List[tuple[str, Dict[str, Any]]]] = defaultdict(list)
    for (field, value), candidate in candidates.items():
        if float(candidate["score"]) < 0.68:
            continue
        selected[field].append((value, candidate))
    for field, items in list(selected.items()):
        maximum = int((fields.get(field, {}).get("validation") or {}).get("maxSelections") or 3)
        explicit = [item for item in items if item[1].get("hardEligible")]
        if explicit:
            items = explicit
            if field in {"category", "product_type"}:
                maximum = 1
        else:
            # Learned associations are useful hints, not permission to create
            # an over-constrained intersection of several correlated labels.
            maximum = 1
        selected[field] = sorted(items, key=lambda item: (item[1]["score"], item[1]["support"]), reverse=True)[:maximum]

    brand_matches = []
    for brand in brands:
        for raw_candidate in [brand.get("name"), *(brand.get("aliases") or [])]:
            phrase = normalize_query(str(raw_candidate or ""))
            if len(phrase) >= 3 and _contains_phrase(query, phrase):
                brand_matches.append((len(phrase), str(brand.get("name")), phrase))
                break
    matched_brands = [max(brand_matches)[1]] if brand_matches else []

    range_match = _first_match(PRICE_RANGE_PATTERNS, corrected_query)
    if range_match:
        minimum, maximum = sorted((_number(range_match, 1) or 0, _number(range_match, 2) or 0))
    else:
        maximum = _number(_first_match(PRICE_MAX_PATTERNS, corrected_query))
        minimum = _number(_first_match(PRICE_MIN_PATTERNS, corrected_query))
        if minimum is None and maximum is None:
            # A currency marker makes the number unambiguously monetary. Treat
            # a bare "Rs 5600" commerce query as a useful budget ceiling.
            maximum = _number(_first_match(PRICE_CURRENCY_PATTERNS, corrected_query))
    min_age, max_age = _numeric_range(corrected_query, ("age", "umar", "उम्र"), 0, 110)
    min_height, max_height = _numeric_range(corrected_query, ("height", "height cm", "lambai", "लंबाई", "ऊंचाई"), 40, 260)
    min_weight, max_weight = _numeric_range(corrected_query, ("weight", "weight kg", "wazan", "वजन"), 2, 400)
    pincode_match = TRAILING_PINCODE_RE.search(corrected_query)
    candidate_pincode = supplied_pincode or (pincode_match.group(1) if pincode_match else None)
    delivery_requested = supplied_swoopstyl or any(
        _contains_phrase(corrected_query, term) for term in ONE_DAY_TERMS
    )
    swoopstyl = bool(delivery_requested and candidate_pincode)
    # A six-digit number only acquires geographic meaning when the shopper has
    # enabled SwoopStyl. This prevents ordinary numbers from leaking into the
    # delivery filter and ensures only the final query token can be a pincode.
    pincode = candidate_pincode if swoopstyl else None
    inferred_sort = next((value for phrase, value in SORT_PHRASES.items() if _contains_phrase(corrected_query, phrase)), "recommended")

    def selected_values(field: str, *, hard_only: bool = False) -> List[str]:
        return [
            value
            for value, candidate in selected.get(field, [])
            if not hard_only or candidate.get("hardEligible")
        ]

    direct: Dict[str, Any] = {
        "brand": matched_brands,
        "category": selected_values("category", hard_only=True),
        "productType": selected_values("product_type", hard_only=True),
        "gender": selected_values("gender", hard_only=True),
        "size": selected_values("size", hard_only=True),
        "colour": list(dict.fromkeys([
            *selected_values("color", hard_only=True),
            *selected_values("color_family", hard_only=True),
        ])),
    }
    metadata = {
        field: [value for value, _ in values]
        for field, values in selected.items()
        if fields.get(field, {}).get("storage") == "product_metadata"
    }
    recognized_tokens = {
        token
        for values in selected.values()
        for _, candidate in values
        for evidence in candidate["evidence"]
        for token in tokenize(str(evidence["phrase"]))
    }
    for _, _, phrase in brand_matches:
        recognized_tokens.update(tokenize(phrase))
    for phrase in (*ONE_DAY_TERMS, *SORT_PHRASES):
        if _contains_phrase(query, phrase):
            recognized_tokens.update(tokenize(phrase))
    residual = []
    for original_token in query_tokens:
        semantic_token = correction_map.get(original_token, original_token)
        if (
            original_token in recognized_tokens
            or semantic_token in recognized_tokens
            or original_token in STOP_WORDS
            or semantic_token in STOP_WORDS
            or original_token in CONTROL_WORDS
            or semantic_token in CONTROL_WORDS
            or semantic_token.isdigit()
            or (len(semantic_token) == 6 and semantic_token[0] != "0")
        ):
            continue
        residual.append(semantic_token)
    has_structured = any(direct.values()) or bool(metadata) or swoopstyl or any(
        value is not None for value in (minimum, maximum, min_age, max_age, min_height, max_height, min_weight, max_weight)
    )
    lexical_query = " ".join(dict.fromkeys(residual))[:100]
    if not has_structured and not lexical_query:
        lexical_query = query[:100]

    scored_nodes = [
        {
            "field": field,
            "value": value,
            "score": round(float(candidate["score"]), 4),
            "support": candidate["support"],
            "hardEligible": bool(candidate.get("hardEligible")),
            "evidence": candidate["evidence"],
        }
        for field, values in selected.items()
        for value, candidate in values
    ]
    ranking_vector = [
        {
            "field": node["field"],
            "value": node["value"],
            "weight": node["score"],
        }
        for node in scored_nodes
        if node["score"] >= 0.5
    ]
    confidence = round(sum(node["score"] for node in scored_nodes) / len(scored_nodes), 4) if scored_nodes else (0.55 if lexical_query else 0.0)
    hard_filters = {
        **direct,
        "metadata": metadata,
        "minPrice": minimum,
        "maxPrice": maximum,
        "minAge": min_age,
        "maxAge": max_age,
        "minHeightCm": min_height,
        "maxHeightCm": max_height,
        "minWeightKg": min_weight,
        "maxWeightKg": max_weight,
        "pincode": pincode,
        "swoopstyl": swoopstyl,
        "sort": inferred_sort,
    }
    query_params: Dict[str, Any] = {
        "q": raw_query,
        "intent": "1",
        "intentSource": "hybrid-taxonomy-vector-v3",
        **{key: value for key, value in direct.items() if value},
        "softMeta": [f"{field}:{value}" for field, values in metadata.items() for value in values],
        "sort": inferred_sort,
    }
    if lexical_query:
        query_params["lexical"] = lexical_query
    for key, value in hard_filters.items():
        if key not in {"metadata", "sort"} and value is not None and value is not False and key not in direct:
            query_params[key] = value
    return mongo_json({
        "version": 3,
        "originalQuery": raw_query,
        "normalizedQuery": query,
        "lexicalQuery": lexical_query,
        "hardFilters": hard_filters,
        "queryParams": query_params,
        "confidence": confidence,
        "nodes": scored_nodes,
        "rankingVector": ranking_vector,
        "corrections": corrections,
        "graphSignals": graph_signals[:40],
        "linguisticSignals": linguistic_signals,
        "parser": "multilingual-hybrid-taxonomy-vector-v3",
        "retrieval": {
            "strategy": "mongo-text-plus-sparse-cosine",
            "graphVersion": (reconciliation_graph or {}).get("version"),
            "dimensions": len(ranking_vector),
            "malformedQueryRecovery": bool(corrections),
            "indirectIntent": bool(linguistic_signals),
        },
        "model": {
            "version": int(model.get("version", 2)),
            "algorithm": model.get("model_type"),
            "documentCount": int(model.get("training_rows", 0)),
        },
    })


async def parse_search_intent(database, raw_query: str, supplied_pincode: Optional[str] = None):
    return await compile_search_intent(database, raw_query, supplied_pincode)


def _explicit_or(explicit: List[str], inferred: List[str]) -> List[str]:
    return list(dict.fromkeys(explicit or inferred))


def _resolved_gender(
    explicit: List[str],
    inferred: List[str],
    profile_gender: List[str],
    profile_age: Optional[float] = None,
) -> List[str]:
    """Current filters win, then the words in the query, then the saved profile."""
    if explicit or inferred:
        return list(dict.fromkeys(explicit or inferred))
    age = round(profile_age) if profile_age is not None else None
    return compatible_gender_keys(profile_gender, age)


def _profile_fallback(explicit: Any, inferred: Any, profile_value: Any) -> Any:
    if explicit is not None:
        return explicit
    if inferred is not None:
        return inferred
    return profile_value


def _use_profile_measurements(
    current_gender: List[str], profile_gender: List[str], profile_age: Optional[float]
) -> bool:
    if not current_gender:
        return True
    compatible_profile_gender = compatible_gender_keys(
        profile_gender,
        round(profile_age) if profile_age is not None else None,
    )
    return bool(set(current_gender) & set(compatible_profile_gender))


async def advanced_search(database, payload) -> Dict[str, Any]:
    intent = await compile_search_intent(
        database,
        payload.query,
        payload.pincode,
        supplied_swoopstyl=payload.swoopstyl,
    )
    inferred = intent["hardFilters"]
    metadata = {key: list(dict.fromkeys(values)) for key, values in payload.metadata.items() if values}
    soft_metadata = {
        key: values
        for key, values in (inferred.get("metadata") or {}).items()
        if key not in metadata
    }
    profile_height_band = measurement_band(payload.profile_height_cm, HEIGHT_BAND_CM) or {}
    profile_weight_band = measurement_band(payload.profile_weight_kg, WEIGHT_BAND_KG) or {}
    current_gender = payload.gender or inferred.get("gender") or []
    use_profile_measurements = _use_profile_measurements(
        current_gender,
        payload.profile_gender,
        payload.profile_age,
    )
    profile_age = payload.profile_age if use_profile_measurements else None
    profile_height_min = profile_height_band.get("min") if use_profile_measurements else None
    profile_height_max = profile_height_band.get("max") if use_profile_measurements else None
    profile_weight_min = profile_weight_band.get("min") if use_profile_measurements else None
    profile_weight_max = profile_weight_band.get("max") if use_profile_measurements else None
    swoopstyl_enabled = bool(payload.swoopstyl or inferred.get("swoopstyl"))
    resolved = {
        "query": payload.query,
        "lexicalQuery": payload.lexical_query if payload.lexical_query is not None else intent.get("lexicalQuery") or "",
        "brand": _explicit_or(payload.brand, inferred.get("brand") or []),
        "category": _explicit_or(payload.category, inferred.get("category") or []),
        "productType": _explicit_or(payload.product_type, inferred.get("productType") or []),
        "colour": _explicit_or(payload.colour, inferred.get("colour") or []),
        "size": _explicit_or(payload.size, inferred.get("size") or []),
        "gender": _resolved_gender(
            payload.gender,
            inferred.get("gender") or [],
            payload.profile_gender,
            payload.profile_age,
        ),
        "metadata": metadata,
        "minPrice": payload.min_price if payload.min_price is not None else inferred.get("minPrice"),
        "maxPrice": payload.max_price if payload.max_price is not None else inferred.get("maxPrice"),
        "minAge": _profile_fallback(payload.min_age, inferred.get("minAge"), profile_age),
        "maxAge": _profile_fallback(payload.max_age, inferred.get("maxAge"), profile_age),
        "minHeightCm": _profile_fallback(payload.min_height_cm, inferred.get("minHeightCm"), profile_height_min),
        "maxHeightCm": _profile_fallback(payload.max_height_cm, inferred.get("maxHeightCm"), profile_height_max),
        "minWeightKg": _profile_fallback(payload.min_weight_kg, inferred.get("minWeightKg"), profile_weight_min),
        "maxWeightKg": _profile_fallback(payload.max_weight_kg, inferred.get("maxWeightKg"), profile_weight_max),
        "sort": payload.sort if payload.sort != "recommended" else inferred.get("sort") or "recommended",
        "pincode": (payload.pincode or inferred.get("pincode")) if swoopstyl_enabled else None,
        "swoopStyl": swoopstyl_enabled,
        "page": payload.page,
        "pageSize": payload.page_size,
        "intentParsed": True,
    }
    soft_filter_weights: Dict[str, Dict[str, float]] = defaultdict(dict)
    blocked_ranking_fields = {
        *(field for field in metadata),
        *( ["category"] if resolved["category"] else [] ),
        *( ["product_type"] if resolved["productType"] else [] ),
        *( ["gender"] if resolved["gender"] else [] ),
        *( ["size"] if resolved["size"] else [] ),
        *( ["color", "color_family"] if resolved["colour"] else [] ),
    }
    for signal in intent.get("rankingVector") or []:
        field = str(signal.get("field") or "")
        value = str(signal.get("value") or "")
        weight = float(signal.get("weight") or 0)
        if not field or not value or field in blocked_ranking_fields or weight < 0.5:
            continue
        soft_filter_weights[field][value] = max(
            soft_filter_weights[field].get(value, 0.0), weight
        )
    sort_map = {
        "recommended": ("relevance", "desc"),
        "newest": ("newest", "desc"),
        "price-low": ("price_low", "asc"),
        "price-high": ("price_high", "desc"),
        "rating": ("rating", "desc"),
    }
    sort_by, order = sort_map[resolved["sort"]]
    async def fetch_page():
        return await list_public_products(
            database,
            page=payload.page,
            page_size=payload.page_size,
            search=resolved["lexicalQuery"] or None,
            category=resolved["category"],
            product_type=resolved["productType"],
            brand_id=None,
            brand=resolved["brand"],
            colour=resolved["colour"],
            size=resolved["size"],
            gender=resolved["gender"],
            metadata_filters=[f"{field}:{value}" for field, values in metadata.items() for value in values],
            min_price_paise=round(resolved["minPrice"] * 100) if resolved["minPrice"] is not None else None,
            max_price_paise=round(resolved["maxPrice"] * 100) if resolved["maxPrice"] is not None else None,
            min_age=resolved["minAge"],
            max_age=resolved["maxAge"],
            min_height_cm=resolved["minHeightCm"],
            max_height_cm=resolved["maxHeightCm"],
            min_weight_kg=resolved["minWeightKg"],
            max_weight_kg=resolved["maxWeightKg"],
            sort_by=sort_by,
            order=order,
            pincode=resolved["pincode"],
            swoopstyl=resolved["swoopStyl"],
            radius_km=payload.radius_km,
            soft_metadata_filters=soft_metadata,
            soft_filter_weights=dict(soft_filter_weights),
            require_soft_match=bool(soft_filter_weights and not resolved["lexicalQuery"]),
            excluded_product_types=sorted(FASHION_SEARCH_EXCLUDED_PRODUCT_TYPES),
            excluded_text_pattern=FORBIDDEN_PRODUCT_TEXT_PATTERN,
        )

    page = await fetch_page()
    intent["softFilters"] = {
        "metadata": soft_metadata,
        "weights": dict(soft_filter_weights),
        "mode": "candidate-or-plus-cosine-ranking",
    }
    query_params: Dict[str, Any] = {
        "q": payload.query,
        "intent": "1",
        "intentSource": "hybrid-taxonomy-vector-v3",
        "sort": resolved["sort"],
    }
    if resolved["lexicalQuery"]:
        query_params["lexical"] = resolved["lexicalQuery"]
    for key in ("brand", "category", "productType", "colour", "size", "gender"):
        if resolved[key]:
            query_params[key] = resolved[key]
    query_params["meta"] = [f"{field}:{value}" for field, values in metadata.items() for value in values]
    query_params["softMeta"] = [f"{field}:{value}" for field, values in soft_metadata.items() for value in values]
    for key in ("minPrice", "maxPrice", "minAge", "maxAge", "minHeightCm", "maxHeightCm", "minWeightKg", "maxWeightKg", "pincode"):
        if resolved[key] is not None:
            query_params[key] = resolved[key]
    if resolved["swoopStyl"]:
        query_params["swoopstyl"] = "true"
    if payload.page > 1:
        query_params["page"] = payload.page
    reconciliation = None
    original_result_count = int(page.get("total") or 0)
    fallback_count = 0
    fallback_level = None
    if original_result_count == 0:
        # A fallback shelf is part of the resolved search strategy, not a
        # page-one decoration. Re-run the same deterministic fallback for every
        # requested page so totals, items and navigation remain stable.
        from app.services.taxonomy_reconciler_service import fallback_for_empty_search

        try:
            fallback_page, reconciliation = await fallback_for_empty_search(
                database, payload, resolved_query=resolved
            )
            if fallback_page:
                page = fallback_page
                fallback_count = int(page.get("total") or 0)
                fallback_level = reconciliation.get("level")
        except Exception:
            reconciliation = {"used": False, "strategy": "fallback-unavailable"}

    if payload.page == 1:
        from app.services.taxonomy_reconciler_service import record_search_outcome

        try:
            await record_search_outcome(
                database,
                raw_query=payload.query,
                result_count=original_result_count,
                source="advanced-search",
                intent=intent,
                resolved_query=resolved,
                fallback_count=fallback_count,
                fallback_level=fallback_level,
            )
        except Exception:
            # Search availability must not depend on analytics/reconciliation writes.
            pass
    response = {
        **page,
        "intent": intent,
        "resolvedQuery": resolved,
        "queryParams": query_params,
    }
    if original_result_count == 0:
        response["originalResultCount"] = 0
        response["reconciliation"] = reconciliation or {
            "used": False,
            "strategy": "unavailable",
        }
    return mongo_json(response)
