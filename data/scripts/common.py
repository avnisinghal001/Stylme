"""Shared, dependency-free helpers for the StylMe data pipeline."""

from __future__ import annotations

import hashlib
import json
import math
import re
import unicodedata
from collections.abc import Iterable
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


DATA_ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = DATA_ROOT / "raw"
PROCESSED_DIR = DATA_ROOT / "processed"
CONFIG_DIR = DATA_ROOT / "config"

RICH_JSON_COLUMNS = (
    "images",
    "delivery_options",
    "product_details",
    "breadcrumbs",
    "product_specifications",
    "amount_of_stars",
    "what_customers_said",
    "sizes",
    "videos",
    "variations",
    "best_offer",
    "more_offers",
)

LEGAL_SUFFIXES = re.compile(
    r"\b(?:pvt\.?\s*ltd\.?|private\s+limited|ltd\.?|limited|llp|inc\.?|"
    r"incorporated|corp\.?|corporation|company|co\.?)\b",
    re.IGNORECASE,
)
PINCODE_RE = re.compile(r"(?<!\d)([1-9][0-9]{5})(?!\d)")
PRODUCT_ID_RE = re.compile(r"/([0-9]{4,})/buy(?:[/?#]|$)", re.IGNORECASE)
TOKEN_RE = re.compile(r"[a-z0-9]+(?:['-][a-z0-9]+)?")


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def safe_json(value: Any, default: Any) -> Any:
    if value is None or value == "":
        return default
    if isinstance(value, (dict, list, int, float, bool)):
        return value
    try:
        parsed = json.loads(str(value))
    except (TypeError, ValueError, json.JSONDecodeError):
        return default
    return default if parsed is None else parsed


def normalize_text(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    text = text.replace("&", " and ")
    text = re.sub(r"[®™©]", "", text)
    text = text.casefold()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def normalize_entity_name(value: Any, *, remove_legal_suffixes: bool = False) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    if remove_legal_suffixes:
        text = LEGAL_SUFFIXES.sub(" ", text)
    return normalize_text(text)


def slugify(value: Any, fallback: str = "item") -> str:
    normalized = normalize_text(value)
    return normalized.replace(" ", "-") or fallback


def stable_hash(value: str, seed: str = "stylme-v1") -> int:
    digest = hashlib.blake2b(f"{seed}:{value}".encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big", signed=False)


def sha256_json(value: Any) -> str:
    return hashlib.sha256(json_dumps(value).encode("utf-8")).hexdigest()


def parse_money_paise(value: Any) -> int | None:
    if value is None:
        return None
    cleaned = str(value).strip().strip('"').replace(",", "")
    cleaned = re.sub(r"[^0-9.\-]", "", cleaned)
    if not cleaned or cleaned in {"-", ".", "-."}:
        return None
    try:
        return int((Decimal(cleaned) * 100).quantize(Decimal("1")))
    except (InvalidOperation, ValueError):
        return None


def parse_float(value: Any, default: float | None = None) -> float | None:
    try:
        result = float(str(value).strip())
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def parse_int(value: Any, default: int | None = None) -> int | None:
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return default


def extract_pincode(value: Any) -> str | None:
    match = PINCODE_RE.search(str(value or ""))
    return match.group(1) if match else None


def extract_product_id(url: Any) -> str | None:
    match = PRODUCT_ID_RE.search(str(url or ""))
    return match.group(1) if match else None


def category_from_url(url: Any) -> str:
    try:
        parts = [part for part in urlparse(str(url or "")).path.split("/") if part]
    except ValueError:
        return "uncategorized"
    return slugify(parts[0] if parts else "uncategorized", "uncategorized")


def canonicalize_myntra_image(url: Any) -> str | None:
    value = str(url or "").strip()
    if not value:
        return None
    value = value.replace("http://", "https://", 1)
    marker = "/assets/"
    if "assets.myntassets.com/" in value and marker in value:
        value = "https://assets.myntassets.com/assets/" + value.split(marker, 1)[1]
    try:
        parsed = urlparse(value)
    except ValueError:
        return None
    if parsed.scheme != "https" or not parsed.netloc:
        return None
    return value


def canonical_images(value: Any, *, json_encoded: bool = False) -> list[str]:
    if json_encoded:
        candidates = safe_json(value, [])
        if not isinstance(candidates, list):
            candidates = []
    else:
        candidates = re.split(r";\s*", str(value or ""))
    output: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        url = canonicalize_myntra_image(candidate)
        if not url or url in seen:
            continue
        seen.add(url)
        output.append(url)
    return output


def detect_gender_keys(*values: Any) -> list[str]:
    text = f" {' '.join(normalize_text(v) for v in values)} "
    found: list[str] = []
    rules = (
        ("women", (" women ", " woman ", " female ", " ladies ")),
        ("men", (" men ", " man ", " male ", " gentlemen ")),
        ("girls", (" girls ", " girl ")),
        ("boys", (" boys ", " boy ")),
        ("kids", (" kids ", " kid ", " infant ", " baby ", " toddler ")),
        ("unisex", (" unisex ",)),
    )
    for key, needles in rules:
        if any(needle in text for needle in needles):
            found.append(key)
    if "unisex" in found:
        return ["unisex"]
    if {"women", "men"}.issubset(found):
        return ["unisex"]
    return found or ["unspecified"]


def tokenize(*values: Any) -> list[str]:
    return TOKEN_RE.findall(" ".join(normalize_text(value) for value in values))


def compact_counter(counter: dict[str, int], limit: int = 100) -> list[dict[str, Any]]:
    items = sorted(counter.items(), key=lambda item: (-item[1], item[0]))[:limit]
    return [{"value": key, "count": count} for key, count in items]


def unique_preserving_order(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result
