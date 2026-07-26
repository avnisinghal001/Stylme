from __future__ import annotations

import hashlib
import json
import math
import re
import unicodedata
import uuid
from collections import Counter, defaultdict, deque
from datetime import datetime, timedelta, timezone
from itertools import combinations
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import httpx
from bson import ObjectId
from fastapi import HTTPException
from pymongo import ReturnDocument, UpdateOne
from pymongo.errors import BulkWriteError, DuplicateKeyError

from app.core.config import settings
from app.core.serialization import mongo_json
from app.services.audit_service import write_audit
from app.services.indian_search_demand import INDIAN_LANGUAGE_CONTEXTS


GRAPH_KEY = "search-taxonomy-reconciler"
GRAPH_SCHEMA_VERSION = 2
MAX_GRAPH_DEPTH = 4
MAX_PERSISTED_EDGES = 40_000
RUN_LOCK_KEY = "taxonomy-reconciler"
MAX_RETAG_PROPOSALS_PER_PRODUCT = 12
MAX_RETAG_PROPOSALS_PER_FIELD = 2
MIN_RETAG_COOCCURRENCE_WEIGHT = 0.86
MIN_RETAG_COOCCURRENCE_SUPPORT = 50
RETAGGABLE_PRODUCT_METADATA_FIELDS = {
    "aesthetic",
    "dress_code",
    "festival",
    "fit",
    "generation",
    "material",
    "mood",
    "occasion",
    "pattern",
    "season",
    "silhouette",
    "style",
    "surface_detail",
    "theme",
    "trend_signal",
}
EXPLICIT_ONLY_FIELDS = {
    "gender", "generation", "festival", "mood", "cultural_theme",
    "personalization_segment", "body_fit_preference",
}
FORBIDDEN_PRODUCT_TYPES = {
    "baby-sleeping-bag", "bath-robe", "boxers", "bra", "briefs", "camisoles",
    "corset", "innerwear-vests", "lingerie-accessories", "lingerie-set",
    "lounge-pants", "lounge-shorts", "lounge-tshirts", "night-suits",
    "nightdress", "pyjamas", "robe", "shapewear", "sleepsuit", "slips",
    "socks", "stockings", "swim-bottoms", "swim-tops", "swimwear",
    "swimwear-accessories", "swimwear-cover-up-bottom", "swimwear-cover-up-top",
    "thermal-bottoms", "thermal-set", "thermal-tops", "trunk",
}
NON_FASHION_PRODUCT_TYPES = {
    "appliance-covers", "art-and-craft", "bath-accessories", "beauty-gift-set",
    "dining-essentials", "electric-toothbrush", "eye-cream", "facial-kit",
    "hand-and-feet-cream", "hand-wash-and-sanitizer", "https", "key-chain",
    "mask-and-peel", "massager", "outdoor-masks", "stationery", "tablet-sleeve",
    "teether",
}
FASHION_SEARCH_EXCLUDED_PRODUCT_TYPES = FORBIDDEN_PRODUCT_TYPES | NON_FASHION_PRODUCT_TYPES
FORBIDDEN_PRODUCT_TEXT_PATTERN = (
    r"(?<![a-z0-9])(?:bra|bralette|panty|panties|lingerie|underwear|undergarment|"
    r"briefs?|trunks?|boxers?|shapewear|innerwear|camisoles?|corsets?|sleepwear|"
    r"nightwear|nightdress|swimwear|bikini|stockings?|socks?|thermals?)(?![a-z0-9])"
)
SENSITIVE_EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
SENSITIVE_PHONE = re.compile(r"(?<!\d)(?:\+?91[-\s]?)?[6-9]\d{9}(?!\d)")
SENSITIVE_CARD = re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")
WORD_RE = re.compile(r"[^\W_]+", re.UNICODE)

# These are contextual search concepts, not demographic claims. Every target is
# filtered against the live taxonomy before it can enter the graph.
INDIAN_CONTEXTS: Dict[str, Sequence[Tuple[str, str, float]]] = {
    "udaipur": (
        ("style", "ethnic", 0.88), ("aesthetic", "desi-fusion", 0.82),
        ("dress_code", "ethnic-festive", 0.8), ("season", "summer", 0.72),
        ("material", "cotton", 0.68),
    ),
    "jaipur": (
        ("style", "ethnic", 0.88), ("aesthetic", "desi-fusion", 0.82),
        ("dress_code", "ethnic-festive", 0.78), ("material", "cotton", 0.7),
    ),
    "goa": (
        ("occasion", "travel", 0.86), ("dress_code", "casual", 0.82),
        ("season", "summer", 0.86), ("fit", "relaxed", 0.72),
    ),
    "manali": (
        ("season", "winter", 0.9), ("occasion", "travel", 0.78),
        ("dress_code", "casual", 0.72),
    ),
    "delhi": (
        ("style", "contemporary", 0.84), ("dress_code", "smart-casual", 0.82),
        ("season", "all-season", 0.76),
    ),
    "new delhi": (
        ("style", "contemporary", 0.84), ("dress_code", "smart-casual", 0.82),
        ("season", "all-season", 0.76),
    ),
    "mumbai": (
        ("season", "summer", 0.88), ("material", "cotton", 0.84),
        ("material", "linen", 0.8), ("dress_code", "smart-casual", 0.76),
    ),
    "bengaluru": (
        ("season", "all-season", 0.88), ("dress_code", "smart-casual", 0.84),
        ("style", "contemporary", 0.8),
    ),
    "bangalore": (
        ("season", "all-season", 0.88), ("dress_code", "smart-casual", 0.84),
        ("style", "contemporary", 0.8),
    ),
    "hyderabad": (
        ("season", "summer", 0.86), ("material", "cotton", 0.8),
        ("style", "contemporary", 0.78), ("aesthetic", "desi-fusion", 0.74),
    ),
    "chennai": (
        ("season", "summer", 0.92), ("material", "cotton", 0.88),
        ("material", "linen", 0.82), ("fit", "relaxed", 0.74),
    ),
    "kolkata": (
        ("season", "summer", 0.84), ("material", "cotton", 0.82),
        ("style", "contemporary", 0.76), ("aesthetic", "desi-fusion", 0.74),
    ),
    "pune": (
        ("season", "all-season", 0.84), ("dress_code", "smart-casual", 0.82),
        ("occasion", "college", 0.72), ("style", "contemporary", 0.74),
    ),
    "ahmedabad": (
        ("season", "summer", 0.88), ("material", "cotton", 0.84),
        ("aesthetic", "desi-fusion", 0.78),
    ),
    "lucknow": (
        ("style", "ethnic", 0.86), ("material", "cotton", 0.8),
        ("surface_detail", "chikankari", 0.84), ("aesthetic", "desi-fusion", 0.76),
    ),
    "chandigarh": (
        ("dress_code", "smart-casual", 0.84), ("style", "contemporary", 0.8),
        ("season", "all-season", 0.74),
    ),
    "surat": (
        ("style", "contemporary", 0.8), ("aesthetic", "desi-fusion", 0.78),
        ("season", "summer", 0.76),
    ),
    "kochi": (
        ("season", "summer", 0.9), ("season", "monsoon", 0.82),
        ("material", "cotton", 0.86), ("fit", "relaxed", 0.76),
    ),
    "varanasi": (
        ("style", "ethnic", 0.86), ("material", "silk", 0.8),
        ("dress_code", "ethnic-festive", 0.76),
    ),
    "shimla": (
        ("season", "winter", 0.94), ("material", "wool", 0.88),
        ("occasion", "travel", 0.82),
    ),
    "rishikesh": (
        ("occasion", "travel", 0.9), ("dress_code", "casual", 0.84),
        ("material", "cotton", 0.78), ("fit", "relaxed", 0.76),
    ),
    "agra": (
        ("occasion", "travel", 0.86), ("dress_code", "smart-casual", 0.78),
        ("season", "summer", 0.7),
    ),
    "college": (
        ("generation", "gen-z", 0.86), ("occasion", "college", 0.84),
        ("dress_code", "campus", 0.84), ("trend_signal", "trending", 0.72),
    ),
    "office": (
        ("occasion", "office", 0.9), ("style", "smart-casual", 0.84),
        ("dress_code", "formal", 0.9),
    ),
    "diwali": (
        ("festival", "diwali", 0.98), ("dress_code", "ethnic-festive", 0.94),
        ("style", "ethnic", 0.88),
    ),
    "navratri": (
        ("festival", "navratri", 0.98), ("dress_code", "ethnic-festive", 0.94),
        ("style", "ethnic", 0.88),
    ),
    "wedding guest": (
        ("occasion", "wedding", 0.96), ("dress_code", "wedding-guest", 0.94),
        ("style", "ethnic", 0.78),
    ),
    "sangeet": (
        ("occasion", "sangeet", 0.96), ("occasion", "wedding", 0.86),
        ("dress_code", "bridal-party", 0.82),
    ),
    "haldi": (
        ("occasion", "haldi", 0.96), ("occasion", "wedding", 0.84),
        ("color_family", "yellow", 0.82),
    ),
    "date night": (
        ("occasion", "date-night", 0.9), ("dress_code", "smart-casual", 0.78),
    ),
    "birthday": (
        ("occasion", "party", 0.96), ("theme", "party", 0.94),
        ("mood", "playful", 0.84), ("dress_code", "cocktail", 0.72),
        ("silhouette", "midi", 0.7),
    ),
    "birthday party": (
        ("occasion", "party", 0.98), ("theme", "party", 0.96),
        ("mood", "playful", 0.88), ("dress_code", "cocktail", 0.78),
    ),
    "happy": (
        ("mood", "playful", 0.92), ("pattern", "floral", 0.78),
        ("color_family", "yellow", 0.72), ("color_family", "pink", 0.7),
    ),
    "joyful": (
        ("mood", "playful", 0.9), ("pattern", "floral", 0.78),
        ("color_family", "yellow", 0.72),
    ),
    "funky": (
        ("mood", "bold", 0.88), ("mood", "playful", 0.84),
        ("aesthetic", "indie", 0.82), ("style", "streetwear", 0.74),
        ("pattern", "colourblocked", 0.9), ("color_family", "multicolor", 0.84),
    ),
    "minimal": (
        ("style", "minimalist", 0.98), ("theme", "minimal", 0.98),
        ("pattern", "solid", 0.82), ("fit", "straight", 0.76),
        ("aesthetic", "clean-girl", 0.74),
    ),
    "minimalist": (
        ("style", "minimalist", 0.99), ("theme", "minimal", 0.96),
        ("pattern", "solid", 0.82), ("fit", "straight", 0.76),
    ),
    # Indirect language is intentionally resolved to existing controlled
    # values. These phrases describe activities or desired effects; they are
    # ranking evidence, not proof of a shopper's identity.
    "fast moving": (
        ("style", "sporty", 0.96), ("occasion", "workout", 0.84),
        ("fit", "relaxed", 0.76), ("material", "nylon", 0.68),
    ),
    "move fast": (
        ("style", "sporty", 0.94), ("occasion", "workout", 0.82),
        ("fit", "relaxed", 0.76),
    ),
    "on the go": (
        ("style", "sporty", 0.9), ("occasion", "travel", 0.84),
        ("fit", "relaxed", 0.8), ("material", "cotton", 0.7),
    ),
    "always on the go": (
        ("style", "sporty", 0.94), ("occasion", "travel", 0.86),
        ("fit", "relaxed", 0.82),
    ),
    "running around": (
        ("style", "sporty", 0.92), ("occasion", "workout", 0.84),
        ("fit", "relaxed", 0.78),
    ),
    "lots of walking": (
        ("occasion", "travel", 0.88), ("style", "sporty", 0.82),
        ("fit", "relaxed", 0.82),
    ),
    "dance all night": (
        ("occasion", "party", 0.94), ("mood", "playful", 0.86),
        ("fit", "relaxed", 0.72),
    ),
    "command the room": (
        ("mood", "power-dressing", 0.96), ("dress_code", "formal", 0.88),
        ("fit", "tailored", 0.88),
    ),
    "boss mode": (
        ("mood", "power-dressing", 0.96), ("theme", "workwear", 0.88),
        ("fit", "tailored", 0.84),
    ),
    "important meeting": (
        ("occasion", "office", 0.94), ("dress_code", "formal", 0.92),
        ("mood", "power-dressing", 0.86), ("fit", "tailored", 0.84),
    ),
    "turn heads": (
        ("mood", "bold", 0.96), ("occasion", "party", 0.84),
        ("pattern", "colourblocked", 0.78), ("surface_detail", "sequinned", 0.74),
    ),
    "stand out": (
        ("mood", "bold", 0.94), ("trend_signal", "trending", 0.82),
        ("pattern", "colourblocked", 0.76),
    ),
    "make a statement": (
        ("mood", "bold", 0.96), ("style", "streetwear", 0.8),
        ("trend_signal", "trending", 0.8),
    ),
    "keep it simple": (
        ("style", "minimalist", 0.96), ("theme", "minimal", 0.94),
        ("pattern", "solid", 0.84),
    ),
    "nothing loud": (
        ("style", "minimalist", 0.92), ("theme", "minimal", 0.9),
        ("pattern", "solid", 0.82),
    ),
    "clean look": (
        ("style", "minimalist", 0.9), ("aesthetic", "clean-girl", 0.88),
        ("pattern", "solid", 0.8),
    ),
    "easy going": (
        ("mood", "relaxed", 0.92), ("dress_code", "casual", 0.88),
        ("fit", "relaxed", 0.84),
    ),
    "chill day": (
        ("mood", "relaxed", 0.94), ("theme", "casual", 0.9),
        ("fit", "relaxed", 0.84),
    ),
    "laid back": (
        ("mood", "relaxed", 0.94), ("dress_code", "casual", 0.88),
        ("fit", "loose", 0.8),
    ),
    "comfortable all day": (
        ("fit", "relaxed", 0.94), ("material", "cotton", 0.86),
        ("occasion", "everyday", 0.84),
    ),
    "soft and dreamy": (
        ("mood", "romantic", 0.92), ("aesthetic", "soft-girl", 0.9),
        ("material", "chiffon", 0.76),
    ),
    "gentle vibe": (
        ("mood", "romantic", 0.88), ("aesthetic", "soft-girl", 0.86),
        ("pattern", "floral", 0.72),
    ),
    "hot weather": (
        ("season", "summer", 0.96), ("material", "cotton", 0.9),
        ("material", "linen", 0.86), ("fit", "relaxed", 0.74),
    ),
    "humid weather": (
        ("season", "summer", 0.94), ("material", "cotton", 0.9),
        ("material", "linen", 0.84), ("fit", "relaxed", 0.76),
    ),
    "rainy day": (
        ("season", "monsoon", 0.96), ("style", "sporty", 0.68),
    ),
    "cold weather": (
        ("season", "winter", 0.96), ("material", "wool", 0.9),
        ("fit", "regular", 0.7),
    ),
    "camera ready": (
        ("trend_signal", "trending", 0.9), ("mood", "bold", 0.82),
        ("style", "contemporary", 0.78),
    ),
    "reel ready": (
        ("trend_signal", "viral", 0.92), ("generation", "gen-z", 0.84),
        ("style", "contemporary", 0.78),
    ),
    "family function": (
        ("style", "ethnic", 0.9), ("dress_code", "ethnic-festive", 0.88),
        ("mood", "traditional", 0.8),
    ),
    # Recipient words are strong ranking preferences but remain soft: they
    # should bring the requested department first without becoming an
    # irreversible demographic filter.
    "for her": (("gender", "women", 0.96),),
    "for him": (("gender", "men", 0.96),),
}
INDIAN_CONTEXTS.update(INDIAN_LANGUAGE_CONTEXTS)

INDIRECT_CONTEXT_ROLES = {
    "fast moving": "activity-verb", "move fast": "activity-verb",
    "on the go": "activity-phrase", "always on the go": "activity-phrase",
    "running around": "activity-verb", "lots of walking": "activity-verb",
    "dance all night": "activity-verb", "command the room": "desired-effect",
    "boss mode": "desired-effect", "important meeting": "occasion-noun",
    "turn heads": "desired-effect", "stand out": "desired-effect",
    "make a statement": "desired-effect", "keep it simple": "style-directive",
    "nothing loud": "style-directive", "clean look": "style-description",
    "easy going": "mood-description", "chill day": "mood-description",
    "laid back": "mood-description", "comfortable all day": "comfort-constraint",
    "soft and dreamy": "mood-description", "gentle vibe": "mood-description",
    "hot weather": "weather-constraint", "humid weather": "weather-constraint",
    "rainy day": "weather-constraint", "cold weather": "weather-constraint",
    "camera ready": "desired-effect", "reel ready": "desired-effect",
    "family function": "occasion-noun", "for her": "recipient-pronoun",
    "for him": "recipient-pronoun",
}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def normalize_query(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold().replace("_", " ").replace("-", " ")
    return " ".join(value.split())


def indirect_linguistic_signals(value: str) -> List[Dict[str, str]]:
    """Describe indirect shopper language without making demographic claims."""
    normalized = normalize_query(value)
    matched_phrases: List[str] = []
    signals: List[Dict[str, str]] = []
    for phrase in sorted(INDIRECT_CONTEXT_ROLES, key=len, reverse=True):
        if any(phrase in existing for existing in matched_phrases):
            continue
        if not re.search(rf"(?<!\w){re.escape(phrase)}(?!\w)", normalized):
            continue
        matched_phrases.append(phrase)
        signals.append({"phrase": phrase, "role": INDIRECT_CONTEXT_ROLES[phrase]})
    return signals


def redact_query(value: str) -> str:
    value = SENSITIVE_EMAIL.sub("[email]", value)
    value = SENSITIVE_PHONE.sub("[phone]", value)
    value = SENSITIVE_CARD.sub("[number]", value)
    return value.strip()[:300]


def query_hash(value: str) -> str:
    return hashlib.sha256(normalize_query(redact_query(value)).encode()).hexdigest()


def taxonomy_node(field: str, value: str) -> str:
    return f"tax::{field}::{value}"


def phrase_node(kind: str, phrase: str) -> str:
    digest = hashlib.sha256(f"{kind}:{normalize_query(phrase)}".encode()).hexdigest()[:20]
    return f"{kind}::{digest}"


def _option(option: Any) -> Optional[Dict[str, Any]]:
    if isinstance(option, str) and option:
        return {"key": option, "label": option.replace("-", " ").title(), "aliases": []}
    if not isinstance(option, dict) or not option.get("key") or option.get("active") is False:
        return None
    return {
        "key": str(option["key"]),
        "label": str(option.get("label") or option["key"]),
        "aliases": [str(value) for value in option.get("aliases") or [] if str(value).strip()],
    }


async def taxonomy_snapshot(database) -> Tuple[str, Dict[str, Dict[str, Any]], List[Dict[str, Any]]]:
    fields = await database.metadata_fields.find(
        {"status": "active", "$or": [{"filterable": True}, {"searchable": True}, {"gemini_allowed": True}]},
        {
            "_id": 0, "key": 1, "label": 1, "storage": 1, "storage_path": 1,
            "data_type": 1, "validation": 1, "gemini_allowed": 1, "options": 1,
        },
    ).sort("key", 1).to_list(length=500)
    output: List[Dict[str, Any]] = []
    lookup: Dict[str, Dict[str, Any]] = {}
    for field in fields:
        options = [value for raw in field.get("options") or [] if (value := _option(raw))]
        clean = {
            "key": str(field["key"]),
            "label": str(field.get("label") or field["key"]),
            "storage": field.get("storage"),
            "storagePath": field.get("storage_path"),
            "dataType": field.get("data_type"),
            "validation": field.get("validation") or {},
            "aiAllowed": bool(field.get("gemini_allowed")),
            "options": options,
        }
        output.append(clean)
        lookup[clean["key"]] = clean
    digest = hashlib.sha256(json.dumps(output, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return digest, lookup, output


def _add_node(nodes: Dict[str, Dict[str, Any]], key: str, **values: Any) -> None:
    current = nodes.setdefault(key, {"key": key})
    for name, value in values.items():
        if value not in (None, "", []):
            current[name] = value


def _add_edge(
    edges: Dict[Tuple[str, str], Dict[str, Any]],
    source: str,
    target: str,
    *,
    weight: float,
    relation: str,
    evidence_source: str,
    support: int = 0,
    rationale: Optional[str] = None,
) -> None:
    if not source or not target or source == target:
        return
    left, right = sorted((source, target))
    candidate = {
        "source": left,
        "target": right,
        "weight": round(max(0.01, min(float(weight), 1.0)), 4),
        "relation": relation,
        "evidenceSource": evidence_source,
        "support": max(0, int(support)),
    }
    if rationale:
        candidate["rationale"] = rationale[:240]
    current = edges.get((left, right))
    if current is None or candidate["weight"] > current["weight"]:
        edges[(left, right)] = candidate


def build_deterministic_graph(
    fields: Dict[str, Dict[str, Any]],
    search_model: Optional[Dict[str, Any]],
) -> Tuple[Dict[str, Dict[str, Any]], Dict[Tuple[str, str], Dict[str, Any]]]:
    nodes: Dict[str, Dict[str, Any]] = {}
    edges: Dict[Tuple[str, str], Dict[str, Any]] = {}
    allowed: Dict[str, set[str]] = {}
    for field, document in fields.items():
        allowed[field] = {
            option["key"] for option in document.get("options") or []
            if field != "product_type" or option["key"] not in FORBIDDEN_PRODUCT_TYPES
        }
        for option in document.get("options") or []:
            if field == "product_type" and option["key"] in FORBIDDEN_PRODUCT_TYPES:
                continue
            target = taxonomy_node(field, option["key"])
            terms = list(dict.fromkeys([option["key"], option["label"], *option.get("aliases", [])]))
            _add_node(
                nodes, target, kind="taxonomy", field=field, value=option["key"],
                label=option["label"], terms=[normalize_query(term) for term in terms if normalize_query(term)],
            )
            for term in terms:
                phrase = normalize_query(term)
                if len(phrase) < 2:
                    continue
                source = phrase_node("term", phrase)
                _add_node(nodes, source, kind="term", label=phrase)
                _add_edge(
                    edges, source, target, weight=1.0, relation="names",
                    evidence_source="taxonomy",
                )

    learned = search_model or {}
    for term, raw_edges in (learned.get("nodes") or {}).items():
        phrase = normalize_query(str(term))
        if not phrase:
            continue
        source = phrase_node("term", phrase)
        valid: List[Tuple[str, Dict[str, Any]]] = []
        for edge in raw_edges or []:
            field, value = str(edge.get("field") or ""), str(edge.get("value") or "")
            if value not in allowed.get(field, set()):
                continue
            target = taxonomy_node(field, value)
            confidence = float(edge.get("confidence") or 0)
            support = int(edge.get("support") or 0)
            _add_node(nodes, source, kind="term", label=phrase)
            _add_edge(
                edges, source, target, weight=confidence,
                relation="catalogue-correlation", evidence_source="catalogue-model",
                support=support,
            )
            valid.append((target, edge))
        for (left, left_edge), (right, right_edge) in combinations(valid, 2):
            if left.split("::", 2)[1] == right.split("::", 2)[1]:
                continue
            _add_edge(
                edges, left, right,
                weight=math.sqrt(float(left_edge.get("confidence") or 0) * float(right_edge.get("confidence") or 0)),
                relation="catalogue-cooccurrence", evidence_source="catalogue-model",
                support=min(int(left_edge.get("support") or 0), int(right_edge.get("support") or 0)),
            )

    for concept, targets in INDIAN_CONTEXTS.items():
        source = phrase_node("concept", concept)
        term = phrase_node("term", concept)
        _add_node(nodes, source, kind="concept", label=concept, market="IN")
        _add_node(nodes, term, kind="term", label=concept)
        _add_edge(edges, term, source, weight=1.0, relation="means", evidence_source="india-baseline")
        for field, value, weight in targets:
            if value in allowed.get(field, set()):
                _add_edge(
                    edges, source, taxonomy_node(field, value), weight=weight,
                    relation="india-context", evidence_source="india-baseline",
                )
    return nodes, edges


def _ai_schema(targets: Sequence[str]) -> Dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "edges": {
                "type": "array",
                "maxItems": 120,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "concept": {"type": "string"},
                        "target": {"type": "string", "enum": list(targets)},
                        "weight": {"type": "number", "minimum": 0.5, "maximum": 0.95},
                        "relation": {"type": "string", "enum": ["india-context", "occasion-context", "climate-context", "usage-context"]},
                        "rationale": {"type": "string"},
                    },
                    "required": ["concept", "target", "weight", "relation", "rationale"],
                },
            }
        },
        "required": ["edges"],
    }


def _response_text(payload: Dict[str, Any]) -> str:
    for output in payload.get("output") or []:
        if output.get("type") != "message":
            continue
        for content in output.get("content") or []:
            if content.get("type") == "refusal":
                return ""
            if content.get("type") == "output_text" and content.get("text"):
                return str(content["text"])
    return ""


async def ai_graph_edges(
    taxonomy: List[Dict[str, Any]],
    failures: Sequence[Dict[str, Any]],
    target_nodes: Sequence[str],
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    if not settings.OPENAI_API_KEY or not failures or not target_nodes:
        return [], {"used": False, "reason": "missing-key-or-work"}
    compact_taxonomy = [
        {
            "field": field["key"],
            "values": [{"key": option["key"], "label": option["label"]} for option in field["options"]],
        }
        for field in taxonomy
        if field.get("aiAllowed") or field.get("storage") == "product_metadata"
    ]
    failed_queries = [str(row.get("normalized_query") or "")[:300] for row in failures[:30]]
    body = {
        "model": settings.TAXONOMY_RECONCILER_MODEL,
        "store": False,
        "reasoning": {"effort": "low"},
        "max_output_tokens": 4_000,
        "input": [
            {
                "role": "developer",
                "content": [{
                    "type": "input_text",
                    "text": (
                        "Build conservative Indian fashion-search context edges. Success means every edge helps an Indian shopper's failed query reach an existing taxonomy value. "
                        "Interpret intent rather than requiring literal tag words. Decompose each query into product/entity nouns, activity and movement verbs, descriptive adjectives/adverbs, occasion or weather constraints, desired social effect, recipient pronouns, price, and delivery language. "
                        "Map indirect needs to practical fashion attributes: for example, fast-moving or always-on-the-go language can suggest sporty, workout/travel, breathable material, and relaxed fit; command-the-room language can suggest power-dressing and tailored/formal; nothing-loud language can suggest minimalist and solid. "
                        "Use only target keys provided in the schema, prefer two to five complementary high-confidence edges, and return no edge when evidence is weak or ambiguous. Product nouns may receive the strongest weight; contextual adjectives and verbs should rank rather than over-constrain. "
                        "Pronouns may describe an intended recipient but must never prove identity or create a hard demographic assumption. Never infer religion, caste, health, sexuality, identity, or socioeconomic status. "
                        "Do not treat a city as proof that a product belongs to a culture; connect cities only to climate, travel, common occasion, or broad merchandising context. AI edges are proposals, never direct product writes."
                    ),
                }],
            },
            {
                "role": "user",
                "content": [{
                    "type": "input_text",
                    "text": json.dumps({"market": "IN", "failedQueries": failed_queries, "taxonomy": compact_taxonomy}, separators=(",", ":")),
                }],
            },
        ],
        "text": {
            "format": {
                "type": "json_schema", "name": "taxonomy_graph_enrichment",
                "strict": True, "schema": _ai_schema(target_nodes),
            }
        },
    }
    endpoint = f"{settings.OPENAI_BASE_URL.rstrip('/')}/responses"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(90.0)) as client:
            response = await client.post(
                endpoint,
                headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}", "Content-Type": "application/json"},
                json=body,
            )
            response.raise_for_status()
            payload = response.json()
        parsed = json.loads(_response_text(payload) or "{}")
        allowed = set(target_nodes)
        clean = []
        for edge in parsed.get("edges") or []:
            concept = normalize_query(str(edge.get("concept") or ""))[:80]
            target = str(edge.get("target") or "")
            if len(concept) < 2 or target not in allowed:
                continue
            clean.append({
                "concept": concept,
                "target": target,
                "weight": max(0.5, min(float(edge.get("weight") or 0.5), 0.95)),
                "relation": str(edge.get("relation") or "usage-context"),
                "rationale": str(edge.get("rationale") or "")[:240],
            })
        return clean, {
            "used": True,
            "model": payload.get("model") or settings.TAXONOMY_RECONCILER_MODEL,
            "responseId": payload.get("id"),
            "edgeCount": len(clean),
        }
    except (httpx.HTTPError, ValueError, TypeError, json.JSONDecodeError) as exc:
        return [], {"used": False, "reason": "provider-error", "errorType": type(exc).__name__}


def _edge_priority(edge: Dict[str, Any]) -> Tuple[int, float, int]:
    source = edge.get("evidenceSource")
    priority = {"taxonomy": 0, "india-baseline": 1, "openai": 2, "catalogue-model": 3}.get(source, 4)
    return priority, -float(edge.get("weight") or 0), -int(edge.get("support") or 0)


async def build_or_load_graph(
    database,
    failures: Sequence[Dict[str, Any]],
    *,
    use_ai: bool,
    rebuild: bool,
) -> Dict[str, Any]:
    taxonomy_hash, fields, taxonomy = await taxonomy_snapshot(database)
    failure_material = [row.get("query_hash") for row in failures]
    failure_hash = hashlib.sha256(json.dumps(failure_material, sort_keys=True).encode()).hexdigest()
    active = await database.taxonomy_reconciler_graphs.find_one({"key": GRAPH_KEY, "active": True})
    ai_expected = bool(use_ai and settings.OPENAI_API_KEY and failures)
    if (
        active and not rebuild and active.get("taxonomy_hash") == taxonomy_hash
        and active.get("failure_hash") == failure_hash
        and int(active.get("schema_version") or 0) == GRAPH_SCHEMA_VERSION
        and (not ai_expected or bool((active.get("ai") or {}).get("used")))
    ):
        return active

    search_model = await database.search_intent_models.find_one({"status": "active"})
    nodes, edges = build_deterministic_graph(fields, search_model)
    target_nodes = sorted(key for key, node in nodes.items() if node.get("kind") == "taxonomy")
    ai_edges: List[Dict[str, Any]] = []
    ai_meta: Dict[str, Any] = {"used": False, "reason": "disabled"}
    if use_ai:
        ai_edges, ai_meta = await ai_graph_edges(taxonomy, failures, target_nodes)
    for edge in ai_edges:
        concept = edge["concept"]
        concept_key = phrase_node("concept", concept)
        term_key = phrase_node("term", concept)
        _add_node(nodes, concept_key, kind="concept", label=concept, market="IN")
        _add_node(nodes, term_key, kind="term", label=concept)
        _add_edge(edges, term_key, concept_key, weight=1.0, relation="means", evidence_source="openai")
        _add_edge(
            edges, concept_key, edge["target"], weight=edge["weight"],
            relation=edge["relation"], evidence_source="openai",
            rationale=edge["rationale"],
        )

    selected_edges = sorted(edges.values(), key=_edge_priority)[:MAX_PERSISTED_EDGES]
    referenced = {edge["source"] for edge in selected_edges} | {edge["target"] for edge in selected_edges}
    selected_nodes = [nodes[key] for key in sorted(referenced) if key in nodes]
    latest = active or await database.taxonomy_reconciler_graphs.find_one(
        {"key": GRAPH_KEY}, sort=[("version", -1)]
    )
    previous_version = int((latest or {}).get("version") or 0)
    document = {
        "key": GRAPH_KEY,
        "schema_version": GRAPH_SCHEMA_VERSION,
        "version": previous_version + 1,
        "active": False,
        "market": "IN",
        "max_depth": MAX_GRAPH_DEPTH,
        "taxonomy_hash": taxonomy_hash,
        "failure_hash": failure_hash,
        "taxonomy": taxonomy,
        "nodes": selected_nodes,
        "edges": selected_edges,
        "ai": ai_meta,
        "statistics": {
            "nodes": len(selected_nodes), "edges": len(selected_edges),
            "taxonomyNodes": sum(node.get("kind") == "taxonomy" for node in selected_nodes),
            "failedQueries": len(failures),
        },
        "created_at": utcnow(),
    }
    inserted = await database.taxonomy_reconciler_graphs.insert_one(document)
    try:
        await database.taxonomy_reconciler_graphs.update_many(
            {"key": GRAPH_KEY, "active": True, "_id": {"$ne": inserted.inserted_id}},
            {"$set": {"active": False}},
        )
        await database.taxonomy_reconciler_graphs.update_one(
            {"_id": inserted.inserted_id}, {"$set": {"active": True}}
        )
        document["active"] = True
    except Exception:
        if active:
            await database.taxonomy_reconciler_graphs.update_one(
                {"_id": active["_id"]}, {"$set": {"active": True}}
            )
        await database.taxonomy_reconciler_graphs.delete_one({"_id": inserted.inserted_id})
        raise
    return document


def _graph_start_lookup(
    nodes: Dict[str, Dict[str, Any]],
) -> Dict[str, List[str]]:
    lookup: Dict[str, List[str]] = defaultdict(list)
    for key, node in nodes.items():
        if node.get("kind") not in {"term", "concept"} or not node.get("label"):
            continue
        label = normalize_query(str(node["label"]))
        if label:
            lookup[label].append(key)
    return lookup


def traverse_graph(
    graph: Optional[Dict[str, Any]],
    raw_query: str,
    *,
    depth: int = 4,
    limit: int = 20,
    graph_nodes: Optional[Dict[str, Dict[str, Any]]] = None,
    graph_adjacency: Optional[
        Dict[str, List[Tuple[str, Dict[str, Any]]]]
    ] = None,
    start_lookup: Optional[Dict[str, List[str]]] = None,
) -> List[Dict[str, Any]]:
    if not graph:
        return []
    maximum = max(1, min(int(depth), MAX_GRAPH_DEPTH))
    normalized = normalize_query(redact_query(raw_query))
    if graph_nodes is None or graph_adjacency is None:
        graph_nodes, graph_adjacency = _retag_graph_indexes(graph)
    start_lookup = start_lookup or _graph_start_lookup(graph_nodes)
    query_terms = normalized.split()
    starts = list(dict.fromkeys(
        key
        for start in range(len(query_terms))
        for end in range(start + 1, len(query_terms) + 1)
        for key in start_lookup.get(" ".join(query_terms[start:end]), [])
    ))
    queue = deque((key, 0, 1.0, [key]) for key in starts)
    best: Dict[str, float] = {key: 1.0 for key in starts}
    results: Dict[str, Dict[str, Any]] = {}
    while queue:
        current, current_depth, score, path = queue.popleft()
        node = graph_nodes.get(current) or {}
        explicit_taxonomy = any(
            term and re.search(rf"(?<!\w){re.escape(normalize_query(str(term)))}(?!\w)", normalized)
            for term in [node.get("value"), node.get("label"), *(node.get("terms") or [])]
        )
        if (
            node.get("kind") == "taxonomy"
            and node.get("field") in EXPLICIT_ONLY_FIELDS
            and not explicit_taxonomy
        ):
            # Do not infer identity-like or highly subjective facets through
            # city/style co-occurrence, and do not use them as bridge nodes.
            continue
        if node.get("kind") == "taxonomy" and current_depth > 0:
            candidate = {
                "node": current,
                "field": node.get("field"),
                "value": node.get("value"),
                "label": node.get("label"),
                "score": round(score, 4),
                "depth": current_depth,
                "path": path,
            }
            if score > float((results.get(current) or {}).get("score") or 0):
                results[current] = candidate
        if current_depth >= maximum:
            continue
        for target, edge in graph_adjacency.get(current, []):
            next_score = score * float(edge.get("weight") or 0) * (0.94 if current_depth else 1.0)
            if next_score < 0.28 or next_score <= best.get(target, 0):
                continue
            best[target] = next_score
            queue.append((target, current_depth + 1, next_score, [*path, target]))
    return sorted(results.values(), key=lambda item: (-item["score"], item["depth"], item["field"], item["value"]))[:limit]


def _safe_context(intent: Optional[Dict[str, Any]], resolved: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    intent = intent or {}
    resolved = resolved or {}
    return {
        "intent": {
            "confidence": intent.get("confidence"),
            "lexicalQuery": redact_query(str(intent.get("lexicalQuery") or "")),
            "hardFilters": intent.get("hardFilters") or {},
            "nodes": (intent.get("nodes") or [])[:20],
            "parser": intent.get("parser"),
        },
        "resolvedQuery": {
            key: resolved.get(key)
            for key in (
                "brand", "category", "productType", "colour", "size", "gender", "metadata",
                "minPrice", "maxPrice", "sort", "swoopStyl",
            )
            if resolved.get(key) not in (None, "", [], {}, False)
        },
    }


async def record_search_outcome(
    database,
    *,
    raw_query: str,
    result_count: int,
    source: str,
    intent: Optional[Dict[str, Any]] = None,
    resolved_query: Optional[Dict[str, Any]] = None,
    fallback_count: int = 0,
    fallback_level: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    sanitized = redact_query(raw_query)
    normalized = normalize_query(sanitized)
    if not normalized:
        return None
    digest = query_hash(sanitized)
    now = utcnow()
    if result_count > 0:
        return await database.search_query_failures.find_one_and_update(
            {"query_hash": digest},
            {
                "$set": {"status": "recovered", "recovered_at": now, "last_result_count": result_count, "updated_at": now},
                "$inc": {"successful_retries": 1},
            },
            return_document=ReturnDocument.AFTER,
        )
    context = _safe_context(intent, resolved_query)
    return await database.search_query_failures.find_one_and_update(
        {"query_hash": digest},
        {
            "$set": {
                "query": sanitized,
                "normalized_query": normalized,
                "source": source,
                "status": "open",
                "last_seen_at": now,
                "last_result_count": 0,
                "last_fallback_count": max(0, int(fallback_count)),
                "last_fallback_level": fallback_level,
                "context": context,
                "expires_at": now + timedelta(days=settings.TAXONOMY_RECONCILER_QUERY_RETENTION_DAYS),
                "updated_at": now,
            },
            "$setOnInsert": {"query_hash": digest, "first_seen_at": now, "successful_retries": 0},
            "$inc": {"occurrences": 1, "zero_result_count": 1},
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )


def _soft_signals(signals: Sequence[Dict[str, Any]], fields: Dict[str, Dict[str, Any]]) -> Dict[str, List[str]]:
    output: Dict[str, List[str]] = defaultdict(list)
    for signal in signals:
        field, value = signal.get("field"), signal.get("value")
        if (fields.get(str(field)) or {}).get("storage") != "product_metadata":
            continue
        if value not in output[str(field)] and len(output[str(field)]) < 3:
            output[str(field)].append(str(value))
    return dict(output)


def baseline_context_signals(raw_query: str, fields: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized = normalize_query(redact_query(raw_query))
    signals = []
    for concept, targets in INDIAN_CONTEXTS.items():
        if not re.search(rf"(?<!\w){re.escape(concept)}(?!\w)", normalized):
            continue
        for field, value, weight in targets:
            allowed = {option["key"] for option in (fields.get(field) or {}).get("options") or []}
            if value in allowed:
                signals.append({
                    "node": taxonomy_node(field, value), "field": field, "value": value,
                    "label": value.replace("-", " ").title(), "score": weight,
                    "depth": 2, "path": [f"baseline:{concept}", taxonomy_node(field, value)],
                })
    return sorted(signals, key=lambda item: (-item["score"], item["field"], item["value"]))


async def fallback_for_empty_search(
    database,
    payload,
    resolved_query: Optional[Dict[str, Any]] = None,
) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
    from app.services.product_service import list_public_products

    graph = await database.taxonomy_reconciler_graphs.find_one({"key": GRAPH_KEY, "active": True})
    signals = traverse_graph(graph, payload.query, depth=MAX_GRAPH_DEPTH, limit=20)
    _, fields, _ = await taxonomy_snapshot(database)
    if not signals:
        signals = baseline_context_signals(payload.query, fields)
    soft = _soft_signals(signals, fields)
    resolved = resolved_query or {}

    def chosen(key: str, payload_key: Optional[str] = None):
        if key in resolved:
            return resolved[key]
        return getattr(payload, payload_key or key, None)

    category = chosen("category") or []
    product_type = chosen("productType", "product_type") or []
    brand = chosen("brand") or []
    colour = chosen("colour") or []
    size = chosen("size") or []
    gender = chosen("gender") or []
    metadata = chosen("metadata") or {}
    min_price = chosen("minPrice", "min_price")
    max_price = chosen("maxPrice", "max_price")
    min_age, max_age = chosen("minAge", "min_age"), chosen("maxAge", "max_age")
    min_height = chosen("minHeightCm", "min_height_cm")
    max_height = chosen("maxHeightCm", "max_height_cm")
    min_weight = chosen("minWeightKg", "min_weight_kg")
    max_weight = chosen("maxWeightKg", "max_weight_kg")
    swoopstyl = bool(chosen("swoopStyl", "swoopstyl"))
    pincode = chosen("pincode") if swoopstyl else None

    base = {
        "database": database, "page": payload.page, "page_size": payload.page_size,
        "search": None, "brand_id": None, "sort_by": "relevance", "order": "desc",
        "radius_km": payload.radius_km, "soft_metadata_filters": soft,
        "excluded_product_types": sorted(FASHION_SEARCH_EXCLUDED_PRODUCT_TYPES),
        "excluded_text_pattern": FORBIDDEN_PRODUCT_TEXT_PATTERN,
    }
    levels = [
        {
            "name": "drop-lexical-keep-explicit",
            "category": category, "product_type": product_type, "brand": brand,
            "colour": colour, "size": size, "gender": gender,
            "metadata_filters": [f"{field}:{value}" for field, values in metadata.items() for value in values],
            "min_price_paise": round(min_price * 100) if min_price is not None else None,
            "max_price_paise": round(max_price * 100) if max_price is not None else None,
            "min_age": min_age, "max_age": max_age,
            "min_height_cm": min_height, "max_height_cm": max_height,
            "min_weight_kg": min_weight, "max_weight_kg": max_weight,
            "pincode": pincode, "swoopstyl": swoopstyl,
        },
        {
            "name": "drop-merchandising-filters",
            "category": category, "product_type": product_type, "brand": [],
            "colour": [], "size": [], "gender": gender, "metadata_filters": [],
            "min_price_paise": round(min_price * 100) if min_price is not None else None,
            "max_price_paise": round(max_price * 100) if max_price is not None else None,
            "min_age": None, "max_age": None, "min_height_cm": None, "max_height_cm": None,
            "min_weight_kg": None, "max_weight_kg": None,
            "pincode": pincode, "swoopstyl": swoopstyl,
        },
        {
            "name": "keep-price-and-gender",
            "category": [], "product_type": [], "brand": [], "colour": [], "size": [],
            "gender": gender, "metadata_filters": [],
            "min_price_paise": round(min_price * 100) if min_price is not None else None,
            "max_price_paise": round(max_price * 100) if max_price is not None else None,
            "min_age": None, "max_age": None, "min_height_cm": None, "max_height_cm": None,
            "min_weight_kg": None, "max_weight_kg": None, "pincode": None, "swoopstyl": False,
        },
        {
            "name": "broad-eligible-inventory",
            "category": [], "product_type": [], "brand": [], "colour": [], "size": [],
            "gender": [], "metadata_filters": [], "min_price_paise": None, "max_price_paise": None,
            "min_age": None, "max_age": None, "min_height_cm": None, "max_height_cm": None,
            "min_weight_kg": None, "max_weight_kg": None, "pincode": None, "swoopstyl": False,
        },
    ]
    for level, options in enumerate(levels, start=1):
        result = await list_public_products(**base, **{key: value for key, value in options.items() if key != "name"})
        if int(result.get("total") or 0) > 0:
            return result, {
                "used": True, "level": level, "strategy": options["name"],
                "graphVersion": (graph or {}).get("version"), "maxGraphDepth": MAX_GRAPH_DEPTH,
                "signals": signals[:10], "deliveryPromiseRelaxed": bool(swoopstyl and level >= 3),
            }
    return None, {
        "used": False, "level": None, "strategy": "no-eligible-inventory",
        "graphVersion": (graph or {}).get("version"), "maxGraphDepth": MAX_GRAPH_DEPTH,
        "signals": signals[:10],
    }


def _allowed_taxonomy_values(
    fields: Dict[str, Dict[str, Any]],
) -> Dict[str, set[str]]:
    return {
        field: {
            str(option["key"])
            for option in document.get("options") or []
            if option.get("key") is not None
        }
        for field, document in fields.items()
    }


def _product_nodes(
    product: Dict[str, Any],
    fields: Dict[str, Dict[str, Any]],
    allowed_values: Optional[Dict[str, set[str]]] = None,
) -> set[str]:
    allowed_values = allowed_values or _allowed_taxonomy_values(fields)
    nodes = set()
    for field, raw in (
        ("category", product.get("category_key")),
        ("product_type", product.get("product_type_key")),
        ("gender", product.get("gender_keys") or []),
    ):
        values = raw if isinstance(raw, list) else [raw]
        allowed = allowed_values.get(field) or set()
        nodes.update(taxonomy_node(field, str(value)) for value in values if value in allowed)
    for field, raw in (product.get("metadata") or {}).items():
        values = raw if isinstance(raw, list) else [raw]
        allowed = allowed_values.get(field) or set()
        nodes.update(taxonomy_node(field, str(value)) for value in values if value in allowed)
    return nodes


def _retag_graph_indexes(
    graph: Dict[str, Any],
) -> Tuple[
    Dict[str, Dict[str, Any]],
    Dict[str, List[Tuple[str, Dict[str, Any]]]],
]:
    nodes = {node["key"]: node for node in graph.get("nodes") or []}
    adjacent: Dict[str, List[Tuple[str, Dict[str, Any]]]] = defaultdict(list)
    for edge in graph.get("edges") or []:
        adjacent[edge["source"]].append((edge["target"], edge))
        adjacent[edge["target"]].append((edge["source"], edge))
    return nodes, adjacent


def proposals_for_product(
    product: Dict[str, Any],
    graph: Dict[str, Any],
    target_signals: Dict[str, Dict[str, Any]],
    fields: Dict[str, Dict[str, Any]],
    *,
    graph_nodes: Optional[Dict[str, Dict[str, Any]]] = None,
    graph_adjacency: Optional[
        Dict[str, List[Tuple[str, Dict[str, Any]]]]
    ] = None,
    allowed_values: Optional[Dict[str, set[str]]] = None,
) -> List[Dict[str, Any]]:
    allowed_values = allowed_values or _allowed_taxonomy_values(fields)
    existing = _product_nodes(product, fields, allowed_values)
    if graph_nodes is None or graph_adjacency is None:
        graph_nodes, graph_adjacency = _retag_graph_indexes(graph)
    text = normalize_query(" ".join(str(product.get(key) or "") for key in ("title", "description", "search_text")))
    output = []
    for target, signal in target_signals.items():
        if target in existing:
            continue
        node = graph_nodes.get(target) or {}
        field, value = str(node.get("field") or ""), str(node.get("value") or "")
        field_document = fields.get(field) or {}
        if field not in RETAGGABLE_PRODUCT_METADATA_FIELDS:
            continue
        if field_document.get("storage") != "product_metadata" or not field_document.get("aiAllowed"):
            continue
        current = list((product.get("metadata") or {}).get(field) or [])
        maximum = int((field_document.get("validation") or {}).get("maxSelections") or 3)
        if len(current) >= maximum:
            continue
        direct_terms = [term for term in node.get("terms") or [] if len(term) >= 3]
        direct = next((term for term in direct_terms if re.search(rf"(?<!\w){re.escape(term)}(?!\w)", text)), None)
        best_edge = None
        for neighbour, edge in graph_adjacency.get(target, []):
            if neighbour not in existing or edge.get("relation") != "catalogue-cooccurrence":
                continue
            if best_edge is None or float(edge.get("weight") or 0) > float(best_edge.get("weight") or 0):
                best_edge = edge
        if not direct and (
            not best_edge
            or float(best_edge.get("weight") or 0) < MIN_RETAG_COOCCURRENCE_WEIGHT
            or int(best_edge.get("support") or 0) < MIN_RETAG_COOCCURRENCE_SUPPORT
        ):
            continue
        confidence = 0.98 if direct else min(0.93, float(best_edge.get("weight") or 0) * 0.96)
        evidence = (
            {"type": "direct-lexical", "term": direct}
            if direct else
            {
                "type": "catalogue-cooccurrence",
                "from": next((value for value in (best_edge["source"], best_edge["target"]) if value in existing), None),
                "weight": best_edge.get("weight"), "support": best_edge.get("support"),
            }
        )
        output.append({
            "field": field, "value": value, "confidence": round(confidence, 4),
            "auto_eligible": bool(direct) or bool(
                best_edge and float(best_edge.get("weight") or 0) >= 0.94 and int(best_edge.get("support") or 0) >= 20
            ),
            "evidence": evidence,
            "query_hashes": signal.get("queryHashes") or [],
            "query_score": signal.get("score"),
        })
    ranked = sorted(
        output,
        key=lambda item: (
            not item["auto_eligible"],
            -item["confidence"],
            item["field"],
            item["value"],
        ),
    )
    selected = []
    field_counts: Counter[str] = Counter()
    for item in ranked:
        if field_counts[item["field"]] >= MAX_RETAG_PROPOSALS_PER_FIELD:
            continue
        selected.append(item)
        field_counts[item["field"]] += 1
        if len(selected) >= MAX_RETAG_PROPOSALS_PER_PRODUCT:
            break
    return selected


async def _acquire_lock(database, owner: str, now: datetime) -> bool:
    expires_at = now + timedelta(seconds=settings.TAXONOMY_RECONCILER_LOCK_SECONDS)
    try:
        document = await database.workflow_locks.find_one_and_update(
            {"key": RUN_LOCK_KEY, "$or": [{"expires_at": {"$lte": now}}, {"owner": owner}]},
            {"$set": {"owner": owner, "expires_at": expires_at, "updated_at": now}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        return bool(document and document.get("owner") == owner)
    except DuplicateKeyError:
        return False


async def _release_lock(database, owner: str) -> None:
    await database.workflow_locks.delete_one({"key": RUN_LOCK_KEY, "owner": owner})


def _target_signals(
    graph: Dict[str, Any],
    failures: Sequence[Dict[str, Any]],
    depth: int,
    fields: Dict[str, Dict[str, Any]],
) -> Dict[str, Dict[str, Any]]:
    targets: Dict[str, Dict[str, Any]] = {}
    graph_nodes, graph_adjacency = _retag_graph_indexes(graph)
    start_lookup = _graph_start_lookup(graph_nodes)
    for failure in failures:
        raw_query = str(failure.get("query") or "")
        signals = [
            *baseline_context_signals(raw_query, fields),
            *[
                signal
                for signal in traverse_graph(
                    graph,
                    raw_query,
                    depth=min(depth, 2),
                    limit=20,
                    graph_nodes=graph_nodes,
                    graph_adjacency=graph_adjacency,
                    start_lookup=start_lookup,
                )
                if int(signal.get("depth") or 0) <= 2
                and float(signal.get("score") or 0) >= 0.68
            ],
        ]
        strongest: Dict[str, Dict[str, Any]] = {}
        for signal in signals:
            node = str(signal.get("node") or "")
            if node and float(signal.get("score") or 0) > float(
                (strongest.get(node) or {}).get("score") or 0
            ):
                strongest[node] = signal
        for signal in strongest.values():
            current = targets.setdefault(signal["node"], {"score": 0.0, "queryHashes": []})
            current["score"] = max(float(current["score"]), float(signal["score"]))
            if failure.get("query_hash") not in current["queryHashes"]:
                current["queryHashes"].append(failure.get("query_hash"))
    return targets


async def _scan_product_batch(database, limit: int) -> List[Dict[str, Any]]:
    state = await database.taxonomy_reconciler_state.find_one({"key": "product-cursor"}) or {}
    query: Dict[str, Any] = {
        "status": "active",
        "visibility": "public",
        "product_type_key": {"$nin": sorted(FASHION_SEARCH_EXCLUDED_PRODUCT_TYPES)},
        "$nor": [
            {field: {"$regex": FORBIDDEN_PRODUCT_TEXT_PATTERN, "$options": "i"}}
            for field in ("title", "description", "search_text")
        ],
    }
    cursor = state.get("last_product_id")
    if cursor:
        query["_id"] = {"$gt": cursor}
    projection = {
        "title": 1, "description": 1, "search_text": 1, "category_key": 1,
        "product_type_key": 1, "gender_keys": 1, "metadata": 1,
    }
    products = await database.products.find(query, projection).sort("_id", 1).limit(limit).to_list(length=limit)
    if not products and cursor:
        query.pop("_id", None)
        products = await database.products.find(query, projection).sort("_id", 1).limit(limit).to_list(length=limit)
    if products:
        await database.taxonomy_reconciler_state.update_one(
            {"key": "product-cursor"},
            {"$set": {"last_product_id": products[-1]["_id"], "updated_at": utcnow()}},
            upsert=True,
        )
    return products


async def stage_retag_proposals(
    database,
    *,
    graph: Dict[str, Any],
    failures: Sequence[Dict[str, Any]],
    max_products: int,
    depth: int,
    run_id: str,
) -> Dict[str, int]:
    _, fields, _ = await taxonomy_snapshot(database)
    targets = _target_signals(graph, failures, depth, fields)
    products = await _scan_product_batch(database, max_products)
    graph_nodes, graph_adjacency = _retag_graph_indexes(graph)
    allowed_values = _allowed_taxonomy_values(fields)
    documents = []
    proposed = 0
    for product in products:
        for proposal in proposals_for_product(
            product,
            graph,
            targets,
            fields,
            graph_nodes=graph_nodes,
            graph_adjacency=graph_adjacency,
            allowed_values=allowed_values,
        ):
            proposal_key = f"{product['_id']}:{proposal['field']}:{proposal['value']}"
            documents.append({
                "proposal_key": proposal_key,
                "product_id": product["_id"],
                "field": proposal["field"],
                "value": proposal["value"],
                "confidence": proposal["confidence"],
                "auto_eligible": proposal["auto_eligible"],
                "evidence": proposal["evidence"],
                "query_hashes": proposal["query_hashes"],
                "query_score": proposal["query_score"],
                "graph_version": graph["version"],
                "run_id": run_id,
                "status": "proposed",
                "created_at": utcnow(),
                "updated_at": utcnow(),
            })
            proposed += 1
    if documents:
        proposal_keys = [document["proposal_key"] for document in documents]
        existing_keys = {
            row["proposal_key"]
            for row in await database.taxonomy_retag_proposals.find(
                {"proposal_key": {"$in": proposal_keys}},
                {"_id": 0, "proposal_key": 1},
            ).to_list(length=len(proposal_keys))
        }
        new_documents = [
            document
            for document in documents
            if document["proposal_key"] not in existing_keys
        ]
        if new_documents:
            try:
                await database.taxonomy_retag_proposals.insert_many(
                    new_documents,
                    ordered=False,
                )
            except BulkWriteError as exc:
                errors = (exc.details or {}).get("writeErrors") or []
                if any(error.get("code") != 11000 for error in errors):
                    raise
    return {"productsScanned": len(products), "targetTags": len(targets), "proposalsStaged": proposed}


async def apply_retag_proposals(
    database,
    *,
    proposal_ids: Optional[Sequence[str]] = None,
    minimum_confidence: float,
    limit: int,
    include_auto: bool,
    actor: Optional[Dict[str, Any]],
    run_id: Optional[str] = None,
) -> Dict[str, Any]:
    _, fields, _ = await taxonomy_snapshot(database)
    query: Dict[str, Any]
    if proposal_ids:
        object_ids = [ObjectId(value) for value in proposal_ids if ObjectId.is_valid(value)]
        if len(object_ids) != len(proposal_ids):
            raise HTTPException(status_code=422, detail="Invalid proposal id")
        query = {"_id": {"$in": object_ids}, "status": {"$in": ["proposed", "approved"]}}
    else:
        query = {
            "status": "proposed",
            "auto_eligible": True,
            "confidence": {"$gte": minimum_confidence},
        } if include_auto else {"status": "approved", "confidence": {"$gte": minimum_confidence}}
    proposals = await database.taxonomy_retag_proposals.find(query).sort("confidence", -1).limit(limit).to_list(length=limit)
    product_ids = list(dict.fromkeys(proposal["product_id"] for proposal in proposals))
    products = (
        await database.products.find(
            {"_id": {"$in": product_ids}},
            {"metadata": 1},
        ).to_list(length=len(product_ids))
        if product_ids
        else []
    )
    products_by_id = {product["_id"]: product for product in products}
    pending_values: Dict[Any, Dict[str, List[str]]] = defaultdict(
        lambda: defaultdict(list)
    )
    accepted_proposals: Dict[Any, List[Dict[str, Any]]] = defaultdict(list)
    applied_ids: List[Any] = []
    stale_ids: List[Any] = []
    for proposal in proposals:
        field, value = proposal.get("field"), proposal.get("value")
        document = fields.get(str(field)) or {}
        allowed = {option["key"] for option in document.get("options") or []}
        if document.get("storage") != "product_metadata" or value not in allowed:
            stale_ids.append(proposal["_id"])
            continue
        product = products_by_id.get(proposal["product_id"])
        if not product:
            stale_ids.append(proposal["_id"])
            continue
        raw_current = (product.get("metadata") or {}).get(field) or []
        current = list(raw_current) if isinstance(raw_current, list) else [raw_current]
        pending = pending_values[proposal["product_id"]][str(field)]
        maximum = int((document.get("validation") or {}).get("maxSelections") or 3)
        if value in current or value in pending:
            stale_ids.append(proposal["_id"])
            continue
        if len(current) + len(pending) >= maximum:
            stale_ids.append(proposal["_id"])
            continue
        pending.append(value)
        accepted_proposals[proposal["product_id"]].append(proposal)
        applied_ids.append(proposal["_id"])
    updated_at = utcnow()
    product_writes = []
    for product_id, field_values in pending_values.items():
        accepted = accepted_proposals[product_id]
        if not accepted:
            continue
        product_writes.append(UpdateOne(
            {"_id": product_id},
            {
                "$addToSet": {
                    f"metadata.{field}": {"$each": values}
                    for field, values in field_values.items()
                    if values
                },
                "$set": {
                    "system_metadata.reconciliation.last_run_id": run_id,
                    "system_metadata.reconciliation.last_graph_version": max(
                        int(proposal.get("graph_version") or 0)
                        for proposal in accepted
                    ),
                    "system_metadata.reconciliation.updated_at": updated_at,
                },
            },
        ))
    if product_writes:
        await database.products.bulk_write(product_writes, ordered=False)
    now = utcnow()
    if applied_ids:
        await database.taxonomy_retag_proposals.update_many(
            {"_id": {"$in": applied_ids}},
            {"$set": {"status": "applied", "applied_at": now, "applied_by_user_id": (actor or {}).get("_id"), "updated_at": now}},
        )
        await database.available_filter_cache.delete_many({})
    if stale_ids:
        await database.taxonomy_retag_proposals.update_many(
            {"_id": {"$in": stale_ids}},
            {"$set": {"status": "stale", "updated_at": now}},
        )
    if applied_ids or stale_ids:
        await write_audit(
            database,
            action="taxonomy_retags_bulk_applied",
            entity_type="taxonomy_reconciliation_run",
            entity_id=run_id or "manual",
            actor=actor,
            changes={"applied": len(applied_ids), "stale": len(stale_ids), "minimumConfidence": minimum_confidence},
        )
    return {"selected": len(proposals), "applied": len(applied_ids), "stale": len(stale_ids)}


async def run_reconciler(database, request, *, requested_by: str, actor: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    run_id = f"trr_{uuid.uuid4().hex}"
    started_at = utcnow()
    if not await _acquire_lock(database, run_id, started_at):
        raise HTTPException(status_code=409, detail="A taxonomy reconciliation run is already active")
    run = {
        "run_id": run_id, "status": "running", "requested_by": requested_by,
        "configuration": request.model_dump(by_alias=False), "started_at": started_at,
    }
    await database.taxonomy_reconciliation_runs.insert_one(run)
    try:
        failures = await database.search_query_failures.find(
            {"status": {"$in": ["open", "processed"]}}
        ).sort([("occurrences", -1), ("last_seen_at", -1)]).limit(request.max_queries).to_list(length=request.max_queries)
        graph = await build_or_load_graph(
            database, failures, use_ai=request.use_ai, rebuild=request.rebuild_graph,
        )
        staged = await stage_retag_proposals(
            database, graph=graph, failures=failures, max_products=request.max_products,
            depth=request.graph_depth, run_id=run_id,
        )
        applied = {"selected": 0, "applied": 0, "stale": 0}
        if request.apply:
            applied = await apply_retag_proposals(
                database, minimum_confidence=settings.TAXONOMY_RECONCILER_AUTO_APPLY_CONFIDENCE,
                limit=request.max_products, include_auto=True, actor=actor, run_id=run_id,
            )
        now = utcnow()
        if failures:
            await database.search_query_failures.update_many(
                {"_id": {"$in": [row["_id"] for row in failures]}},
                {"$set": {"status": "processed", "last_run_id": run_id, "last_graph_version": graph["version"], "processed_at": now, "updated_at": now}},
            )
        summary = {
            "queriesProcessed": len(failures), "graphVersion": graph["version"],
            "graph": graph.get("statistics") or {}, "ai": graph.get("ai") or {},
            **staged, **{f"retags{key[0].upper()}{key[1:]}": value for key, value in applied.items()},
            "applyRequested": bool(request.apply),
        }
        await database.taxonomy_reconciliation_runs.update_one(
            {"run_id": run_id},
            {"$set": {"status": "completed", "summary": summary, "completed_at": now, "updated_at": now}},
        )
        await write_audit(
            database, action="taxonomy_reconciliation_completed",
            entity_type="taxonomy_reconciliation_run", entity_id=run_id,
            actor=actor, changes=summary,
        )
        return mongo_json({"runId": run_id, "status": "completed", "summary": summary})
    except Exception as exc:
        await database.taxonomy_reconciliation_runs.update_one(
            {"run_id": run_id},
            {"$set": {"status": "failed", "error": {"type": type(exc).__name__, "message": str(exc)[:500]}, "completed_at": utcnow(), "updated_at": utcnow()}},
        )
        raise
    finally:
        await _release_lock(database, run_id)
