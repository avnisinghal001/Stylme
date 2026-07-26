#!/usr/bin/env python3
"""Build a deterministic, registry-bound StylMe catalogue from both CSVs."""

from __future__ import annotations

import argparse
import csv
import heapq
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

from color_utils import ColorCatalog, ColorMatch
from common import (
    CONFIG_DIR,
    PROCESSED_DIR,
    RAW_DIR,
    canonical_images,
    category_from_url,
    detect_gender_keys,
    extract_pincode,
    extract_product_id,
    json_dumps,
    normalize_entity_name,
    normalize_text,
    parse_float,
    parse_int,
    parse_money_paise,
    safe_json,
    sha256_json,
    slugify,
    stable_hash,
    tokenize,
    unique_preserving_order,
)
from entity_registry import EntityRegistry
from taxonomy_registry import load_registry_from_mongo


PIPELINE_VERSION = "stylme-data-v2"
DEFAULT_SEED = "stylme-curated-50000-v2"
DEFAULT_TARGET = 50_000

CURATED_POLICY = "curated-youth-festive"
EXCLUDED_PRODUCT_TYPES = {
    "baby-sleeping-bag",
    "bath-robe",
    "boxers",
    "bra",
    "briefs",
    "camisoles",
    "corset",
    "innerwear-vests",
    "lingerie-accessories",
    "lingerie-set",
    "lounge-pants",
    "lounge-shorts",
    "lounge-tshirts",
    "night-suits",
    "nightdress",
    "pyjamas",
    "robe",
    "shapewear",
    "sleepsuit",
    "slips",
    "socks",
    "stockings",
    "swim-bottoms",
    "swim-tops",
    "swimwear",
    "swimwear-accessories",
    "swimwear-cover-up-bottom",
    "swimwear-cover-up-top",
    "thermal-bottoms",
    "thermal-set",
    "thermal-tops",
    "trunk",
}
FORBIDDEN_TEXT = re.compile(
    r"(?<![a-z0-9])(?:bra|bralette|panty|panties|lingerie|underwear|undergarment|"
    r"briefs?|trunks?|boxers?|shapewear|innerwear|camisoles?|corsets?|sleepwear|"
    r"nightwear|nightdress|swimwear|bikini|stockings?|socks?|thermals?)(?![a-z0-9])",
    re.IGNORECASE,
)
FESTIVE_TERMS = (
    "saree", "kurta", "kurti", "lehenga", "ethnic", "anarkali", "dupatta",
    "salwar", "churidar", "sherwani", "bandhgala", "nehru", "festive", "wedding",
    "bridal", "zari", "sequinned", "sequin", "mirror work", "gota patti", "chikankari",
)
GEN_Z_TERMS = (
    "oversized", "crop", "co ord", "co-ord", "cargo", "graphic", "streetwear",
    "street", "wide leg", "baggy", "parachute", "y2k", "halter", "off shoulder",
)
GEN_ALPHA_TERMS = ("baby", "kid", "junior", "toddler", "boys", "girls", "children")


def is_policy_excluded(product_type: str, *context: Any) -> bool:
    key = slugify(product_type)
    if key in EXCLUDED_PRODUCT_TYPES:
        return True
    text = " ".join([key.replace("-", " "), *(normalize_text(value) for value in context)])
    return bool(FORBIDDEN_TEXT.search(text))


def priority_multiplier(product_type: str, *context: Any) -> float:
    text = " ".join([product_type.replace("-", " "), *(normalize_text(value) for value in context)])
    multiplier = 1.0
    if any(term in text for term in FESTIVE_TERMS):
        multiplier *= 4.5
    if any(term in text for term in GEN_Z_TERMS):
        multiplier *= 3.5
    if any(term in text for term in GEN_ALPHA_TERMS):
        multiplier *= 2.5
    if any(term in text for term in ("dress", "co ord", "lehenga", "saree", "kurta set")):
        multiplier *= 1.8
    return min(multiplier, 12.0)

CSV_COLUMNS = [
    "schema_version",
    "source",
    "source_product_id",
    "source_url",
    "product_key",
    "brand_key",
    "brand_name",
    "title",
    "normalized_title",
    "slug",
    "description",
    "status",
    "visibility",
    "category_key",
    "product_type_key",
    "gender_keys_json",
    "product_metadata_json",
    "media_json",
    "cover_image_url",
    "color_palette_json",
    "rating_json",
    "source_details_json",
    "search_text",
    "product_simulation_mode",
    "product_system_metadata_json",
    "seller_key",
    "seller_name",
    "seller_status",
    "seller_metadata_json",
    "location_key",
    "location_name",
    "location_address",
    "location_pincode",
    "location_place_json",
    "location_geo_json",
    "location_daily_capacity",
    "location_current_load",
    "location_cutoff_local",
    "location_handling_hours",
    "offer_code",
    "currency",
    "mrp_paise",
    "sale_price_paise",
    "discount_percent",
    "offer_details_json",
    "variants_json",
    "inventory_json",
    "fit_bounds_json",
    "age_bounds_json",
    "available_size_keys_json",
    "available_color_keys_json",
    "available_color_family_keys_json",
    "offer_simulation_mode",
    "offer_metadata_json",
    "quality_flags_json",
]


CATEGORY_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("footwear", ("shoe", "heel", "sandal", "flat", "boot", "loafer", "slipper", "flip-flop", "sneaker")),
    ("jewellery", ("jewellery", "earring", "necklace", "bracelet", "ring", "bangle", "pendant", "anklet", "rakhi", "mangalsutra", "nosepin", "brooch")),
    ("beauty", ("lip", "makeup", "face-", "hair-", "perfume", "deodorant", "serum", "moistur", "cleanser", "shampoo", "nail-", "body-", "eyeshadow", "kajal", "eyeliner", "foundation", "highlighter", "blush", "concealer", "compact", "sunscreen", "toner", "mascara", "skin-care", "shaving", "hygiene", "beauty-accessory")),
    ("home", ("bedsheet", "bedding", "duvet", "lamp", "carpet", "towel", "doormat", "floor-mat", "pillow", "cushion", "blanket", "curtain", "cookware", "kitchen", "dinnerware", "serveware", "drinkware", "cutlery", "mug", "bottle", "storage", "bath-rug", "bathroom", "mattress", "table-cover", "placemat", "tray", "coaster", "decal")),
    ("electronics", ("headphone", "earphone", "speaker", "power-bank", "charger", "smart-home", "camera-access", "computer-access", "tablet-access")),
    ("kids", ("toy", "learning-and-development", "activity-games", "baby-utensil", "baby-care", "school-supplies")),
    ("accessories", ("watch", "sunglass", "backpack", "rucksack", "wallet", "belt", "bag", "clutch", "mobile-access", "cap", "hat", "scarf", "stole", "tie", "pocket-square", "cufflink", "frame", "travel-accessory", "headband", "muffler", "glove", "umbrella", "handkerchief", "suspender", "accessory-gift")),
    ("apparel", ("tshirt", "t-shirt", "shirt", "jean", "kurta", "kurti", "saree", "dress", "trouser", "top", "short", "bra", "brief", "trunk", "boxer", "pant", "palazzo", "legging", "jegging", "tights", "sweatshirt", "sweater", "jacket", "coat", "blazer", "shrug", "skirt", "lehenga", "night", "lingerie", "camisole", "clothing", "swimwear", "blouse", "dupatta", "vest", "suit", "sherwani", "dhoti", "tunics", "thermal", "romper", "shawl", "churidar", "salwar", "pyjama", "co-ord", "stocking", "socks")),
)

FOOTWEAR_TERMS = ("shoe", "heel", "sandal", "flat", "boot", "loafer", "slipper", "flip-flop", "sneaker")
APPAREL_TERMS = CATEGORY_RULES[-1][1]

FIT_RANGES: dict[str, dict[str, int]] = {
    "XXS": {"minHeightCm": 145, "maxHeightCm": 160, "minWeightKg": 35, "maxWeightKg": 47},
    "XS": {"minHeightCm": 148, "maxHeightCm": 165, "minWeightKg": 40, "maxWeightKg": 53},
    "S": {"minHeightCm": 150, "maxHeightCm": 170, "minWeightKg": 47, "maxWeightKg": 61},
    "M": {"minHeightCm": 153, "maxHeightCm": 176, "minWeightKg": 56, "maxWeightKg": 72},
    "L": {"minHeightCm": 156, "maxHeightCm": 182, "minWeightKg": 66, "maxWeightKg": 84},
    "XL": {"minHeightCm": 158, "maxHeightCm": 187, "minWeightKg": 78, "maxWeightKg": 98},
    "XXL": {"minHeightCm": 158, "maxHeightCm": 191, "minWeightKg": 90, "maxWeightKg": 116},
    "2XL": {"minHeightCm": 158, "maxHeightCm": 191, "minWeightKg": 90, "maxWeightKg": 116},
    "3XL": {"minHeightCm": 158, "maxHeightCm": 193, "minWeightKg": 105, "maxWeightKg": 135},
}


def category_group(product_type: str, *context: Any) -> str:
    text = " ".join([product_type, *(normalize_text(value).replace(" ", "-") for value in context)])
    for group, needles in CATEGORY_RULES:
        if any(needle in text for needle in needles):
            return group
    return "other"


def outfit_role(category: str, product_type: str) -> str:
    if category == "accessories":
        return "accessory"
    if category in {"footwear", "jewellery", "beauty", "home", "electronics", "kids", "other"}:
        return category
    text = product_type.lower()
    if any(term in text for term in ("jacket", "coat", "blazer", "shrug", "cardigan")):
        return "outerwear"
    if any(term in text for term in ("bra", "brief", "trunk", "vest", "innerwear", "lingerie")):
        return "innerwear"
    if any(term in text for term in ("jean", "trouser", "pant", "short", "skirt", "palazzo", "legging")):
        return "bottom"
    if any(term in text for term in ("tshirt", "t-shirt", "shirt", "top", "blouse", "sweatshirt")):
        return "top"
    return "one-piece"


def load_metadata_seed(
    *, taxonomy_from_mongo: bool = False, env_file: Path | None = None,
    mongo_uri_key: str = "MONGODB_URL",
) -> tuple[dict[str, Any], dict[str, Any]]:
    local = json.loads((CONFIG_DIR / "metadata_fields.seed.json").read_text())
    if not taxonomy_from_mongo:
        return local, {
            "source": "local",
            "remoteFieldCount": 0,
            "mergedFieldCount": len(local.get("fields", [])),
        }
    return load_registry_from_mongo(
        local,
        env_file=env_file or CONFIG_DIR.parents[1] / ".env",
        uri_key=mongo_uri_key,
    )


def option_text(option: str) -> str:
    return normalize_text(option.replace("-", " "))


def extract_metadata(text_values: list[Any], metadata_seed: dict[str, Any], outfit_role: str) -> dict[str, list[str]]:
    text = f" {' '.join(normalize_text(value) for value in text_values)} "
    output: dict[str, list[str]] = {}
    for field in metadata_seed["fields"]:
        if field["storage"] != "product_metadata":
            continue
        found: list[str] = []
        for option in field.get("options", []):
            term = option_text(option)
            if term and re.search(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])", text):
                found.append(option)
        if found:
            output[field["key"]] = unique_preserving_order(found)

    product_type_text = text
    if any(token in product_type_text for token in (" kurta ", " saree ", " lehenga ", " ethnic ", " dupatta ")):
        output.setdefault("style", []).append("ethnic")
    if any(token in product_type_text for token in (" oversized ", " cargo ", " streetwear ", " graphic ")):
        output.setdefault("style", []).append("streetwear")
    if any(token in product_type_text for token in (" sport ", " activewear ", " track ", " running ", " gym ")):
        output.setdefault("style", []).append("sporty")
    if any(token in product_type_text for token in (" wedding ", " bridal ", " festive ", " diwali ", " navratri ")):
        output.setdefault("theme", []).append("festive")
    output["outfit_role"] = [outfit_role]
    return {key: unique_preserving_order(values) for key, values in sorted(output.items())}


def personalize_metadata(
    metadata: dict[str, list[str]],
    *,
    metadata_seed: dict[str, Any],
    category: str,
    product_type: str,
    gender_keys: list[str],
    text_values: list[Any],
) -> dict[str, list[str]]:
    """Add deterministic, controlled personalization facets from explicit product signals."""
    options = {
        field["key"]: set(field.get("options", []))
        for field in metadata_seed.get("fields", [])
        if field.get("storage") == "product_metadata"
    }
    output = {key: list(values) for key, values in metadata.items() if key in options}
    text = " ".join(
        [product_type.replace("-", " "), category, *(normalize_text(value) for value in text_values)]
    )
    is_kids = category == "kids" or bool({"boys", "girls", "kids"} & set(gender_keys)) or any(
        term in text for term in GEN_ALPHA_TERMS
    )
    is_festive = any(term in text for term in FESTIVE_TERMS)
    is_gen_z = any(term in text for term in GEN_Z_TERMS)
    is_formal = any(term in text for term in ("formal", "blazer", "suit", "trouser", "shirt"))
    is_dress = "dress" in text or any(term in text for term in ("gown", "jumpsuit", "romper"))

    def add(key: str, *values: str) -> None:
        allowed = options.get(key, set())
        accepted = [value for value in values if value in allowed]
        if accepted:
            output[key] = unique_preserving_order([*output.get(key, []), *accepted])

    if is_kids:
        add("generation", "gen-alpha")
        add("personalization_segment", "family-celebration", "everyday-elevated")
        add("aesthetic", "preppy")
    elif is_gen_z:
        add("generation", "gen-z")
        add("personalization_segment", "trend-led", "creator-core", "campus-ready")
        add("aesthetic", "y2k", "street-luxe")
    elif is_festive:
        add("generation", "gen-z", "millennial")
        add("personalization_segment", "festive-first", "family-celebration")
        add("aesthetic", "desi-fusion")
    elif is_formal:
        add("generation", "gen-z", "millennial")
        add("personalization_segment", "work-to-party", "everyday-elevated")
        add("aesthetic", "old-money", "quiet-luxury")
    else:
        add("generation", "gen-z", "timeless")
        add("personalization_segment", "everyday-elevated", "comfort-first")
        add("aesthetic", "indie", "preppy")

    if is_festive:
        add("style", "ethnic", "contemporary")
        add("theme", "festive")
        add("occasion", "wedding-guest")
        add("dress_code", "ethnic-festive", "wedding-guest")
    elif is_dress:
        add("theme", "party")
        add("occasion", "party", "date-night")
        add("personalization_segment", "work-to-party", "trend-led")
        add("dress_code", "cocktail", "smart-casual")
    elif is_formal:
        add("theme", "formal", "workwear")
        add("occasion", "office")
        add("dress_code", "formal", "smart-casual")
    elif is_kids:
        add("theme", "casual")
        add("occasion", "everyday")
        add("dress_code", "casual")
    else:
        add("theme", "casual")
        add("occasion", "college", "everyday")
        add("dress_code", "campus", "casual")

    if any(term in text for term in ("oversized", "loose", "relaxed", "baggy")):
        add("body_fit_preference", "oversized", "relaxed")
    elif any(term in text for term in ("bodycon", "slim", "skinny", "fitted")):
        add("body_fit_preference", "body-skimming", "structured")
    elif is_festive or any(term in text for term in ("maxi", "flared", "a line", "anarkali")):
        add("body_fit_preference", "flowy")
    elif any(term in text for term in ("stretch", "knit", "jersey")):
        add("body_fit_preference", "stretch-friendly")
    else:
        add("body_fit_preference", "relaxed")

    lexical_rules = {
        "garment_length": {
            "cropped": ("crop", "cropped"),
            "mini": ("mini",),
            "knee-length": ("knee length",),
            "midi": ("midi",),
            "maxi": ("maxi",),
            "ankle-length": ("ankle length",),
            "floor-length": ("floor length",),
        },
        "neckline": {
            "round-neck": ("round neck",),
            "v-neck": ("v neck",),
            "square-neck": ("square neck",),
            "sweetheart": ("sweetheart",),
            "halter": ("halter",),
            "off-shoulder": ("off shoulder",),
            "one-shoulder": ("one shoulder",),
            "mandarin-collar": ("mandarin collar",),
            "shirt-collar": ("shirt collar",),
            "boat-neck": ("boat neck",),
        },
        "sleeve": {
            "sleeveless": ("sleeveless",),
            "short-sleeve": ("short sleeve", "half sleeve"),
            "three-quarter-sleeve": ("three quarter sleeve", "3/4 sleeve"),
            "long-sleeve": ("long sleeve", "full sleeve"),
            "puff-sleeve": ("puff sleeve",),
            "bell-sleeve": ("bell sleeve",),
        },
        "surface_detail": {
            "zari": ("zari",),
            "sequinned": ("sequin", "sequinned"),
            "mirror-work": ("mirror work",),
            "gota-patti": ("gota patti",),
            "chikankari": ("chikankari",),
            "embroidery": ("embroidered", "embroidery"),
            "beadwork": ("beadwork", "beaded"),
            "lace": ("lace",),
            "ruffles": ("ruffle",),
            "smocking": ("smock",),
            "pleats": ("pleat",),
            "applique": ("applique",),
        },
    }
    padded_text = f" {text} "
    for field, rules in lexical_rules.items():
        for value, terms in rules.items():
            if any(re.search(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])", padded_text) for term in terms):
                add(field, value)

    return {key: unique_preserving_order(values) for key, values in sorted(output.items())}


def rich_specs(row: dict[str, str]) -> dict[str, str]:
    result: dict[str, str] = {}
    values = safe_json(row.get("product_specifications"), [])
    if not isinstance(values, list):
        return result
    for item in values:
        if not isinstance(item, dict):
            continue
        key = normalize_text(item.get("specification_name"))
        value = str(item.get("specification_value") or "").strip()
        if key and value:
            result[key.replace(" ", "_")] = value
    return result


def rich_category(row: dict[str, str]) -> tuple[str, str, list[str]]:
    breadcrumbs = safe_json(row.get("breadcrumbs"), [])
    names = [str(item.get("name") or "").strip() for item in breadcrumbs if isinstance(item, dict)]
    names = [name for name in names if name]
    brand_norm = normalize_text(row.get("title"))
    generic = {"clothing", "men", "women", "boys", "girls", "kids", "unisex"}
    category_candidates = [
        name
        for name in names
        if normalize_text(name) not in generic
        and normalize_text(name) != brand_norm
        and not normalize_text(name).startswith("more by ")
    ]
    product_type = slugify(
        category_candidates[-1] if category_candidates else category_from_url(row.get("url")),
        "uncategorized",
    )
    category = category_group(product_type, *names, row.get("product_description"))
    return category, product_type, names


def measurements_by_size(row: dict[str, str]) -> dict[str, dict[str, str]]:
    grouped: dict[str, dict[str, str]] = defaultdict(dict)
    sizes = safe_json(row.get("sizes"), [])
    if not isinstance(sizes, list):
        return grouped
    for entry in sizes:
        if not isinstance(entry, dict):
            continue
        size = str(entry.get("size") or "").strip().upper()
        name = str(entry.get("value_name") or "").strip()
        value = str(entry.get("value") or "").strip()
        if size and name and value:
            grouped[size][name] = value
    return grouped


def fit_range_for_size(size: str, product_type: str) -> dict[str, Any]:
    normalized = size.upper().replace(" ", "")
    if normalized in FIT_RANGES:
        return {
            "applicable": True,
            **FIT_RANGES[normalized],
            "source": "simulated_size_standard",
            "confidence": 0.55,
            "reason": None,
        }
    if any(term in product_type.lower() for term in APPAREL_TERMS) and normalized.isdigit():
        numeric_size = int(normalized)
        if 24 <= numeric_size <= 52:
            midpoint_weight = 38 + (numeric_size - 24) * 2.7
            return {
                "applicable": True,
                "minHeightCm": 150,
                "maxHeightCm": 190,
                "minWeightKg": max(35, round(midpoint_weight - 8)),
                "maxWeightKg": round(midpoint_weight + 8),
                "source": "simulated_numeric_size_standard",
                "confidence": 0.4,
                "reason": None,
            }
    return {
        "applicable": False,
        "minHeightCm": None,
        "maxHeightCm": None,
        "minWeightKg": None,
        "maxWeightKg": None,
        "source": "not_applicable",
        "confidence": 1.0,
        "reason": "product_variant_is_not_body_fit_sized",
    }


def infer_size_labels(product_type: str, gender_keys: list[str], source_id: str) -> list[str]:
    text = product_type.lower()
    if any(term in text for term in FOOTWEAR_TERMS):
        base = ["6", "7", "8", "9", "10"]
    elif any(term in text for term in APPAREL_TERMS):
        base = ["XS", "S", "M", "L", "XL", "XXL"]
    else:
        return ["ONE_SIZE"]
    offset = stable_hash(source_id, "size-window") % 2
    return base[offset : offset + 5]


def build_variants(
    *,
    source_id: str,
    product_type: str,
    gender_keys: list[str],
    measurements: dict[str, dict[str, str]],
    colors: list[ColorMatch],
    location_key: str,
    seed: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any], dict[str, Any], list[str]]:
    size_labels = list(measurements)[:10] or infer_size_labels(product_type, gender_keys, source_id)
    color_values = colors or []
    if not color_values:
        raise ValueError("At least one color is required")
    variants: list[dict[str, Any]] = []
    inventory: list[dict[str, Any]] = []
    product_text = product_type.casefold()
    is_wearable = any(term in product_text for term in (*APPAREL_TERMS, *FOOTWEAR_TERMS))
    if is_wearable and ({"boys", "girls", "kids"} & set(gender_keys)):
        age_range = {
            "applicable": True, "minAge": 0, "maxAge": 14,
            "source": "simulated_audience_standard", "confidence": 0.55,
        }
    elif is_wearable:
        age_range = {
            "applicable": True, "minAge": 13, "maxAge": 110,
            "source": "simulated_audience_standard", "confidence": 0.45,
        }
    else:
        age_range = {
            "applicable": False, "minAge": None, "maxAge": None,
            "source": "not_applicable", "confidence": 1.0,
        }
    for size in size_labels:
        for color in color_values[:4]:
            variant_id = f"v-{slugify(size)}-{color.key}"
            fit_range = fit_range_for_size(size, product_type)
            variants.append(
                {
                    "id": variant_id,
                    "sku": f"{source_id}-{slugify(size).upper()}-{slugify(color.key).upper()}",
                    "sizeKey": size,
                    "colorKey": color.key,
                    "fitRange": fit_range,
                    "ageRange": dict(age_range),
                    "measurements": measurements.get(size, {}),
                    "attributes": {},
                    "source": "source_size_chart" if measurements else "simulated_size_standard",
                }
            )
            quantity = 3 + stable_hash(f"{source_id}:{variant_id}", seed) % 48
            inventory.append(
                {
                    "variantId": variant_id,
                    "locationKey": location_key,
                    "availableQty": quantity,
                    "active": True,
                    "source": "simulated",
                }
            )
    fit_ranges = [variant["fitRange"] for variant in variants if variant["fitRange"]["applicable"]]
    if fit_ranges:
        fit_bounds = {
            "applicable": True,
            "minHeightCm": min(value["minHeightCm"] for value in fit_ranges),
            "maxHeightCm": max(value["maxHeightCm"] for value in fit_ranges),
            "minWeightKg": min(value["minWeightKg"] for value in fit_ranges),
            "maxWeightKg": max(value["maxWeightKg"] for value in fit_ranges),
            "source": "simulated_size_standard",
        }
    else:
        fit_bounds = {
            "applicable": False,
            "minHeightCm": None,
            "maxHeightCm": None,
            "minWeightKg": None,
            "maxWeightKg": None,
            "source": "not_applicable",
            "reason": "offer_has_no_body_fit_sized_variants",
        }
    age_bounds = {
        "applicable": age_range["applicable"],
        "minAge": age_range["minAge"],
        "maxAge": age_range["maxAge"],
        "source": age_range["source"],
    }
    return variants, inventory, fit_bounds, age_bounds, size_labels


def allocate_quotas(
    counts: dict[str, int], target: int, *, multipliers: dict[str, float] | None = None
) -> dict[str, int]:
    eligible = {key: count for key, count in counts.items() if count > 0}
    if sum(eligible.values()) < target:
        raise ValueError("Not enough unique records to satisfy target")
    quotas = {key: min(count, 5) for key, count in eligible.items()}
    if sum(quotas.values()) > target:
        quotas = {key: 0 for key in eligible}
    remaining = target - sum(quotas.values())
    while remaining > 0:
        candidates = {key: count - quotas[key] for key, count in eligible.items() if count > quotas[key]}
        weights = {
            key: math.sqrt(value) * (multipliers or {}).get(key, 1.0)
            for key, value in candidates.items()
        }
        total_weight = sum(weights.values())
        if not weights:
            break
        allocations: list[tuple[float, str, int]] = []
        assigned = 0
        for key, weight in weights.items():
            exact = remaining * weight / total_weight
            take = min(candidates[key], int(exact))
            allocations.append((exact - take, key, take))
            assigned += take
        for _, key, take in allocations:
            quotas[key] += take
        remaining -= assigned
        if remaining <= 0:
            break
        for _, key, _ in sorted(allocations, reverse=True):
            if remaining <= 0:
                break
            if quotas[key] < eligible[key]:
                quotas[key] += 1
                remaining -= 1
    if sum(quotas.values()) != target:
        raise ValueError(f"Quota allocation produced {sum(quotas.values())}, expected {target}")
    return quotas


def sample_large(
    path: Path,
    *,
    target: int,
    excluded_ids: set[str],
    category_counts: dict[str, int],
    seed: str,
    progress_every: int,
    require_image: bool = False,
    allowed_categories: set[str] | None = None,
    curated_policy: bool = False,
) -> list[dict[str, str]]:
    type_multipliers = {
        product_type: priority_multiplier(product_type)
        for product_type in category_counts
    } if curated_policy else None
    quotas = allocate_quotas(category_counts, target, multipliers=type_multipliers)
    heaps: dict[str, list[tuple[int, str, dict[str, str]]]] = defaultdict(list)
    global_heap: list[tuple[int, str, dict[str, str]]] = []
    seen: set[int] = set()
    records = 0
    with path.open("r", encoding="utf-8-sig", errors="replace", newline="") as fh:
        for row in csv.DictReader(fh):
            records += 1
            product_id = extract_product_id(row.get("purl"))
            if not product_id or product_id in excluded_ids:
                continue
            category = category_from_url(row.get("purl"))
            # category_counts is the authoritative allow-list for filtered builds.
            # Do not let the global fallback reservoir re-introduce an excluded
            # product type (for example beauty or home in an apparel-only run).
            if category not in quotas:
                continue
            if curated_policy and is_policy_excluded(category, row.get("name"), row.get("purl")):
                continue
            if allowed_categories and category_group(category, row.get("name")) not in allowed_categories:
                continue
            if require_image and not canonical_images(row.get("img")):
                continue
            numeric_id = int(product_id)
            if numeric_id in seen:
                continue
            seen.add(numeric_id)
            multiplier = priority_multiplier(category, row.get("name")) if curated_policy else 1.0
            score = int(stable_hash(product_id, seed) / multiplier)
            item = (-score, product_id, row)
            quota = quotas.get(category, 0)
            if quota:
                heap = heaps[category]
                if len(heap) < quota:
                    heapq.heappush(heap, item)
                elif score < -heap[0][0]:
                    heapq.heapreplace(heap, item)
            if len(global_heap) < target:
                heapq.heappush(global_heap, item)
            elif score < -global_heap[0][0]:
                heapq.heapreplace(global_heap, item)
            if progress_every and records % progress_every == 0:
                selected_so_far = sum(len(heap) for heap in heaps.values())
                print(
                    f"sampled {records:,} records; {len(seen):,} unique; {selected_so_far:,}/{target:,} stratified slots",
                    file=sys.stderr,
                    flush=True,
                )
    selected: dict[str, tuple[int, dict[str, str]]] = {}
    for heap in heaps.values():
        for negative_score, product_id, row in heap:
            selected[product_id] = (-negative_score, row)
    if len(selected) < target:
        for negative_score, product_id, row in sorted(global_heap, reverse=True):
            selected.setdefault(product_id, (-negative_score, row))
            if len(selected) == target:
                break
    if len(selected) != target:
        raise RuntimeError(f"Selected {len(selected)} large rows; expected {target}")
    return [row for _, row in sorted(selected.values(), key=lambda item: item[0])]


def count_large_candidates(
    path: Path,
    *,
    excluded_ids: set[str],
    allowed_categories: set[str] | None,
    require_image: bool,
    curated_policy: bool,
    progress_every: int = 0,
) -> dict[str, int]:
    """Profile exact eligible rows so forbidden product types never receive quotas."""
    counts: dict[str, int] = defaultdict(int)
    seen: set[int] = set()
    records = 0
    with path.open("r", encoding="utf-8-sig", errors="replace", newline="") as fh:
        for row in csv.DictReader(fh):
            records += 1
            product_id = extract_product_id(row.get("purl"))
            if not product_id or product_id in excluded_ids:
                continue
            product_type = category_from_url(row.get("purl"))
            if allowed_categories and category_group(product_type, row.get("name")) not in allowed_categories:
                continue
            if curated_policy and is_policy_excluded(product_type, row.get("name"), row.get("purl")):
                continue
            if require_image and not canonical_images(row.get("img")):
                continue
            numeric_id = int(product_id)
            if numeric_id in seen:
                continue
            seen.add(numeric_id)
            counts[product_type] += 1
            if progress_every and records % progress_every == 0:
                print(
                    f"profiled {records:,} records; {len(seen):,} policy-eligible unique rows",
                    file=sys.stderr,
                    flush=True,
                )
    return dict(counts)


class BuildContext:
    def __init__(self, seed: str, color_catalog: ColorCatalog, metadata_seed: dict[str, Any]) -> None:
        self.seed = seed
        self.colors = color_catalog
        self.metadata_seed = metadata_seed
        self.brands = EntityRegistry("brand")
        self.sellers = EntityRegistry("seller", remove_legal_suffixes=True)
        self.locations: dict[str, dict[str, Any]] = {}
        self.seller_brand_keys: dict[str, set[str]] = defaultdict(set)
        self.used_colors: dict[str, dict[str, Any]] = {item["key"]: item for item in color_catalog.seed_records()}
        self.location_pool: list[tuple[str, str]] = []

    def register_color(self, color: ColorMatch) -> None:
        self.used_colors[color.key] = color.as_dict()

    def register_location(
        self,
        *,
        seller_key: str,
        address: str,
        pincode: str,
        fabricated: bool,
    ) -> str:
        normalized_address = normalize_entity_name(address, remove_legal_suffixes=False)
        suffix = f"{pincode}-{stable_hash(normalized_address, 'location'):08x}"
        location_key = f"location:{seller_key.split(':', 1)[1]}:{suffix}"
        if location_key not in self.locations:
            capacity = 60 + stable_hash(location_key, "capacity") % 241
            load = stable_hash(location_key, "load") % max(1, int(capacity * 0.65))
            self.locations[location_key] = {
                "key": location_key,
                "seller_key": seller_key,
                "name": "Primary fulfilment location",
                "address_line": address,
                "pincode": pincode,
                "place": {},
                "geo_point": None,
                "geocode_resolved": False,
                "timezone": "Asia/Kolkata",
                "daily_capacity": capacity,
                "current_committed_load": load,
                "capacity_date": None,
                "cutoff_local": "14:00",
                "handling_hours": 6,
                "swoopstyl_enabled": True,
                "radius_km_override": None,
                "status": "active",
                "simulation_mode": True,
                "metadata": {
                    "pipeline": {
                        "fabricated": fabricated,
                        "geocodePending": True,
                        "source": "myntra_csv" if not fabricated else "deterministic_fabrication",
                    }
                },
            }
        return location_key

    def fabricated_seller_location(self, brand_key: str) -> tuple[str, str]:
        index = stable_hash(brand_key, "fabricated-seller") % 96
        name = f"StylMe Fulfilment Partner {index + 1:03d}"
        seller_key = self.sellers.register(
            name,
            source="deterministic_fabrication",
            metadata={"pipeline": {"fabricated": True, "simulationMode": True}},
        )
        if not self.location_pool:
            pincode, address = "560001", "Simulated fulfilment location, Bengaluru, Karnataka 560001"
        else:
            pool_index = stable_hash(seller_key, "fabricated-location") % len(self.location_pool)
            pincode, source_address = self.location_pool[pool_index]
            address = f"Simulated marketplace location near source area, {pincode}"
            if not source_address:
                address = f"Simulated fulfilment location, {pincode}"
        location_key = self.register_location(
            seller_key=seller_key,
            address=address,
            pincode=pincode,
            fabricated=True,
        )
        return seller_key, location_key


def price_fields(mrp: int | None, sale: int | None, raw_discount: Any) -> tuple[int, int, float, list[str]]:
    flags: list[str] = []
    mrp_value = max(0, mrp or sale or 0)
    sale_value = max(0, sale or mrp_value)
    if mrp_value <= 0:
        mrp_value = sale_value = 100
        flags.append("fabricated_minimum_price")
    if sale_value > mrp_value:
        mrp_value = sale_value
        flags.append("mrp_raised_to_sale_price")
    derived = round((mrp_value - sale_value) * 100 / mrp_value, 2) if mrp_value else 0.0
    raw = parse_float(raw_discount)
    if raw is None or raw < 0 or raw > 100 or abs(raw - derived) > 2:
        flags.append("discount_recomputed")
    return mrp_value, sale_value, derived, flags


def rating_payload(average: Any, count: Any, breakdown: Any = None, summary: Any = None) -> dict[str, Any]:
    value = parse_float(average, 0.0) or 0.0
    value = max(0.0, min(5.0, value))
    return {
        "average": round(value, 2),
        "count": max(0, parse_int(count, 0) or 0),
        "breakdown": breakdown if isinstance(breakdown, dict) else {},
        "customerSummary": summary if isinstance(summary, list) else [],
    }


def media_payload(urls: list[str], title: str) -> list[dict[str, Any]]:
    return [
        {"id": f"media-{index + 1}", "type": "image", "url": url, "alt": title, "position": index}
        for index, url in enumerate(urls[:12])
    ]


def palette_payload(colors: list[ColorMatch]) -> list[dict[str, Any]]:
    return [
        {
            "colorKey": color.key,
            "name": color.name,
            "hex": color.hex,
            "primaryFamilyKey": color.primary_family_key,
            "familyKeys": list(color.family_keys),
            "source": color.source,
            "confidence": color.confidence,
        }
        for color in colors
    ]


def build_row(
    *,
    context: BuildContext,
    source: str,
    source_id: str,
    source_url: str,
    brand_name: str,
    title: str,
    description: str,
    category_key: str,
    product_type_key: str,
    gender_keys: list[str],
    metadata: dict[str, list[str]],
    image_urls: list[str],
    colors: list[ColorMatch],
    rating: dict[str, Any],
    source_details: dict[str, Any],
    measurements: dict[str, dict[str, str]],
    seller_name: str | None,
    seller_address: str | None,
    seller_pincode: str | None,
    mrp: int | None,
    sale: int | None,
    raw_discount: Any,
    offer_details: dict[str, Any],
    quality_flags: list[str],
) -> dict[str, Any]:
    brand_key = context.brands.register(brand_name, source=source)
    if seller_name and seller_address and seller_pincode:
        seller_key = context.sellers.register(
            seller_name,
            source=source,
            metadata={"pipeline": {"fabricated": False, "simulationMode": True}},
        )
        location_key = context.register_location(
            seller_key=seller_key,
            address=seller_address,
            pincode=seller_pincode,
            fabricated=False,
        )
    else:
        seller_key, location_key = context.fabricated_seller_location(brand_key)
        quality_flags.append("fabricated_seller_location")
    context.seller_brand_keys[seller_key].add(brand_key)

    resolved_colors = colors or [context.colors.get("unspecified", source="missing", confidence=0.0)]
    resolved_colors = resolved_colors[:4]
    for color in resolved_colors:
        context.register_color(color)
    if resolved_colors[0].key == "unspecified":
        quality_flags.append("color_needs_image_or_ai_review")

    variants, inventory, fit_bounds, age_bounds, size_labels = build_variants(
        source_id=source_id,
        product_type=product_type_key,
        gender_keys=gender_keys,
        measurements=measurements,
        colors=resolved_colors,
        location_key=location_key,
        seed=context.seed,
    )
    if not measurements:
        quality_flags.append("variants_simulated")
    if fit_bounds["applicable"]:
        quality_flags.append("fit_range_simulated")
    else:
        quality_flags.append("fit_range_not_applicable")

    text_signal = normalize_text(" ".join((title, description, category_key, product_type_key)))
    metadata = personalize_metadata(
        metadata,
        metadata_seed=context.metadata_seed,
        category=category_key,
        product_type=product_type_key,
        gender_keys=gender_keys,
        text_values=[title, description],
    )
    rating_average = float(rating.get("average") or 0)
    rating_count = int(rating.get("count") or 0)
    if rating_average >= 4.5 and rating_count >= 500:
        metadata["trend_signal"] = ["viral", "trending"]
    elif rating_average >= 4.2 and rating_count >= 1000:
        metadata["trend_signal"] = ["trending"]
    elif any(term in text_signal for term in ("oversized", "co ord", "cargo", "viral", "trending")):
        metadata["trend_signal"] = ["emerging"]
    else:
        metadata["trend_signal"] = ["evergreen"]
    quality_flags.append("taxonomy_personalized_v2")

    mrp_value, sale_value, discount, price_flags = price_fields(mrp, sale, raw_discount)
    quality_flags.extend(price_flags)
    product_key = f"product:{source}:{source_id}"
    product_slug = f"{slugify(title, 'product')}-{source_id}"
    brand_display = context.brands.records[brand_key]["name"]
    seller_display = context.sellers.records[seller_key]["name"]
    location = context.locations[location_key]
    search_parts = [
        title,
        brand_display,
        category_key,
        product_type_key,
        *gender_keys,
        *(value for values in metadata.values() for value in values),
        *(color.name for color in resolved_colors),
        *(family for color in resolved_colors for family in color.family_keys),
    ]
    system_metadata = {
        "pipeline": {
            "version": PIPELINE_VERSION,
            "seed": context.seed,
            "source": source,
            "sourceProductId": source_id,
            "fieldSources": {
                "title": "source",
                "price": "source",
                "metadata": "deterministic_lexical",
                "colors": resolved_colors[0].source,
                "variants": "source_size_chart" if measurements else "deterministic_fabrication",
                "fitRange": "deterministic_fabrication" if fit_bounds else "unavailable",
                "inventory": "deterministic_fabrication",
            },
            "aiEnrichmentStatus": "pending",
        }
    }
    return {
        "schema_version": 1,
        "source": source,
        "source_product_id": source_id,
        "source_url": source_url,
        "product_key": product_key,
        "brand_key": brand_key,
        "brand_name": brand_display,
        "title": title,
        "normalized_title": normalize_text(title) or f"product {source_id}",
        "slug": product_slug,
        "description": description,
        "status": "active",
        "visibility": "public",
        "category_key": category_key,
        "product_type_key": product_type_key,
        "gender_keys_json": json_dumps(gender_keys),
        "product_metadata_json": json_dumps(metadata),
        "media_json": json_dumps(media_payload(image_urls, title)),
        "cover_image_url": image_urls[0] if image_urls else "",
        "color_palette_json": json_dumps(palette_payload(resolved_colors)),
        "rating_json": json_dumps(rating),
        "source_details_json": json_dumps(source_details),
        "search_text": " ".join(unique_preserving_order(tokenize(*search_parts))),
        "product_simulation_mode": "false",
        "product_system_metadata_json": json_dumps(system_metadata),
        "seller_key": seller_key,
        "seller_name": seller_display,
        "seller_status": "approved",
        "seller_metadata_json": json_dumps(context.sellers.records[seller_key].get("metadata", {})),
        "location_key": location_key,
        "location_name": location["name"],
        "location_address": location["address_line"],
        "location_pincode": location["pincode"],
        "location_place_json": json_dumps(location["place"]),
        "location_geo_json": json_dumps(location["geo_point"]),
        "location_daily_capacity": location["daily_capacity"],
        "location_current_load": location["current_committed_load"],
        "location_cutoff_local": location["cutoff_local"],
        "location_handling_hours": location["handling_hours"],
        "offer_code": f"offer-{source}-{source_id}",
        "currency": "INR",
        "mrp_paise": mrp_value,
        "sale_price_paise": sale_value,
        "discount_percent": discount,
        "offer_details_json": json_dumps(offer_details),
        "variants_json": json_dumps(variants),
        "inventory_json": json_dumps(inventory),
        "fit_bounds_json": json_dumps(fit_bounds),
        "age_bounds_json": json_dumps(age_bounds),
        "available_size_keys_json": json_dumps(size_labels),
        "available_color_keys_json": json_dumps([color.key for color in resolved_colors]),
        "available_color_family_keys_json": json_dumps(
            unique_preserving_order(family for color in resolved_colors for family in color.family_keys)
        ),
        "offer_simulation_mode": "true",
        "offer_metadata_json": json_dumps(
            {"pipeline": {"inventoryFabricated": True, "fitRangeFabricated": bool(fit_bounds["applicable"])}}
        ),
        "quality_flags_json": json_dumps(sorted(set(quality_flags))),
    }


def process_rich(
    context: BuildContext,
    path: Path,
    *,
    allowed_categories: set[str] | None = None,
    require_image: bool = False,
    curated_policy: bool = False,
) -> tuple[list[dict[str, Any]], set[str]]:
    rows: list[dict[str, Any]] = []
    source_ids: set[str] = set()
    raw_rows: list[dict[str, str]] = []
    with path.open("r", encoding="utf-8-sig", errors="replace", newline="") as fh:
        raw_rows = list(csv.DictReader(fh))

    eligible_raw: list[dict[str, str]] = []
    for raw in raw_rows:
        category, product_type, names = rich_category(raw)
        images = canonical_images(raw.get("images"), json_encoded=True)
        if allowed_categories and category not in allowed_categories:
            continue
        if curated_policy and is_policy_excluded(
            product_type,
            raw.get("product_description"),
            raw.get("url"),
            *names,
        ):
            continue
        if require_image and not images:
            continue
        eligible_raw.append(raw)

    for raw in eligible_raw:
        pincode = extract_pincode(raw.get("seller_information"))
        address = str(raw.get("seller_information") or "").strip()
        if pincode and address:
            context.location_pool.append((pincode, address))
    context.location_pool = sorted(set(context.location_pool))

    for raw in eligible_raw:
        source_id = str(raw.get("product_id") or "").strip()
        if not source_id:
            continue
        source_ids.add(source_id)
        title = str(raw.get("product_description") or "").strip() or f"Myntra Product {source_id}"
        brand = str(raw.get("title") or "").strip() or "Unbranded"
        details = safe_json(raw.get("product_details"), {})
        description = str(details.get("description") or title).strip() if isinstance(details, dict) else title
        category, product_type, breadcrumb_names = rich_category(raw)
        specs = rich_specs(raw)
        gender_keys = detect_gender_keys(title, breadcrumb_names, raw.get("url"))
        metadata = extract_metadata(
            [title, description, " ".join(specs.values()), *breadcrumb_names],
            context.metadata_seed,
            outfit_role(category, product_type),
        )
        colors = context.colors.extract_from_text(title, description, *specs.values())
        images = canonical_images(raw.get("images"), json_encoded=True)
        flags: list[str] = []
        if not description or description == title:
            flags.append("description_needs_ai_enrichment")
        seller_name = str(raw.get("seller_name") or "").strip() or None
        seller_address = str(raw.get("seller_information") or "").strip() or None
        seller_pincode = extract_pincode(seller_address)
        row = build_row(
            context=context,
            source="myntra_detailed",
            source_id=source_id,
            source_url=str(raw.get("url") or ""),
            brand_name=brand,
            title=title,
            description=description,
            category_key=category,
            product_type_key=product_type,
            gender_keys=gender_keys,
            metadata=metadata,
            image_urls=images,
            colors=colors,
            rating=rating_payload(
                raw.get("rating"),
                raw.get("ratings_count"),
                safe_json(raw.get("amount_of_stars"), {}),
                safe_json(raw.get("what_customers_said"), []),
            ),
            source_details={
                "breadcrumbs": breadcrumb_names,
                "specifications": specs,
                "deliveryOptions": safe_json(raw.get("delivery_options"), []),
                "videos": safe_json(raw.get("videos"), []),
                "variationsCount": len(safe_json(raw.get("variations"), [])),
            },
            measurements=measurements_by_size(raw),
            seller_name=seller_name,
            seller_address=seller_address,
            seller_pincode=seller_pincode,
            mrp=parse_money_paise(raw.get("initial_price")),
            sale=parse_money_paise(raw.get("final_price")),
            raw_discount=raw.get("discount"),
            offer_details={
                "bestOffer": safe_json(raw.get("best_offer"), {}),
                "moreOffers": safe_json(raw.get("more_offers"), []),
                "sourceDeliveryOptions": safe_json(raw.get("delivery_options"), []),
            },
            quality_flags=flags,
        )
        rows.append(row)
    return rows, source_ids


def process_large_row(context: BuildContext, raw: dict[str, str]) -> dict[str, Any]:
    source_url = str(raw.get("purl") or "")
    source_id = extract_product_id(source_url) or str(raw.get("id") or "")
    title = str(raw.get("name") or "").strip() or f"Myntra Product {source_id}"
    brand = str(raw.get("seller") or "").strip() or "Unbranded"
    product_type = category_from_url(source_url)
    category = category_group(product_type, title)
    gender_keys = detect_gender_keys(title, source_url)
    metadata = extract_metadata(
        [title, source_url],
        context.metadata_seed,
        outfit_role(category, product_type),
    )
    colors = context.colors.extract_from_text(title, source_url)
    return build_row(
        context=context,
        source="myntra_large",
        source_id=source_id,
        source_url=source_url,
        brand_name=brand,
        title=title,
        description=title,
        category_key=category,
        product_type_key=product_type,
        gender_keys=gender_keys,
        metadata=metadata,
        image_urls=canonical_images(raw.get("img")),
        colors=colors,
        rating=rating_payload(raw.get("rating"), raw.get("ratingTotal")),
        source_details={"sourceRowId": raw.get("id"), "asin": raw.get("asin")},
        measurements={},
        # The large CSV `seller` column is actually the consumer-facing brand label.
        seller_name=None,
        seller_address=None,
        seller_pincode=None,
        mrp=parse_money_paise(raw.get("mrp")),
        sale=parse_money_paise(raw.get("price")),
        raw_discount=raw.get("discount"),
        offer_details={},
        quality_flags=["description_needs_ai_enrichment", "fulfilment_not_in_source"],
    )


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for record in records:
            fh.write(json_dumps(record) + "\n")


def enrich_metadata_seed(
    base: dict[str, Any], rows: list[dict[str, Any]], colors: ColorCatalog
) -> dict[str, Any]:
    category_values = sorted({row["category_key"] for row in rows})
    product_types = sorted({row["product_type_key"] for row in rows})
    size_values = sorted({value for row in rows for value in json.loads(row["available_size_keys_json"])})
    color_values = sorted({value for row in rows for value in json.loads(row["available_color_keys_json"])})
    family_values = [item["key"] for item in colors.families]
    dynamic = {
        "category": category_values,
        "product_type": product_types,
        "size": size_values,
        "color": color_values,
        "color_family": family_values,
    }
    output = json.loads(json.dumps(base))
    output["version"] = int(output["version"]) + 1
    for field in output["fields"]:
        if field["key"] in dynamic:
            field["options"] = sorted(set(field.get("options", [])) | set(dynamic[field["key"]]))
        field["schemaVersion"] = output["version"]
        field.setdefault("status", "active")
        field.setdefault("metadata", {"pipeline": {"generated": field["key"] in dynamic}})
    return output


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rich", type=Path, default=RAW_DIR / "myntra-product.csv")
    parser.add_argument("--large", type=Path, default=RAW_DIR / "myntra202305041052.csv")
    parser.add_argument("--profile", type=Path, default=PROCESSED_DIR / "source_profile.json")
    parser.add_argument("--output", type=Path, default=PROCESSED_DIR / "processed.csv")
    parser.add_argument("--target", type=int, default=DEFAULT_TARGET)
    parser.add_argument("--seed", default=DEFAULT_SEED)
    parser.add_argument("--progress-every", type=int, default=500_000)
    parser.add_argument(
        "--category",
        action="append",
        choices=[group for group, _ in CATEGORY_RULES] + ["other"],
        help="Repeat to include only selected top-level categories; omitted means all.",
    )
    parser.add_argument(
        "--require-image",
        action="store_true",
        help="Exclude source rows without a canonical product image.",
    )
    parser.add_argument(
        "--policy",
        choices=[CURATED_POLICY],
        help="Apply the strict no-intimates policy and youth/festive weighted selection.",
    )
    parser.add_argument(
        "--taxonomy-from-mongo",
        action="store_true",
        help="Merge the active Mongo metadata registry before classifying products.",
    )
    parser.add_argument(
        "--env-file",
        type=Path,
        default=CONFIG_DIR.parents[1] / ".env",
        help="Environment file used only when --taxonomy-from-mongo is enabled.",
    )
    parser.add_argument(
        "--mongo-uri-key",
        default="MONGODB_URL",
        help="Environment variable containing the MongoDB URI used for taxonomy reads.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.target < 1:
        raise SystemExit("--target must be positive")
    color_catalog = ColorCatalog()
    metadata_seed, taxonomy_source = load_metadata_seed(
        taxonomy_from_mongo=args.taxonomy_from_mongo,
        env_file=args.env_file,
        mongo_uri_key=args.mongo_uri_key,
    )
    context = BuildContext(args.seed, color_catalog, metadata_seed)
    allowed_categories = set(args.category or [])
    curated_policy = args.policy == CURATED_POLICY
    rich_rows, rich_ids = process_rich(
        context,
        args.rich,
        allowed_categories=allowed_categories or None,
        require_image=args.require_image,
        curated_policy=curated_policy,
    )
    if len(rich_rows) > args.target:
        rich_rows = sorted(rich_rows, key=lambda row: stable_hash(row["source_product_id"], args.seed))[: args.target]
    remaining = args.target - len(rich_rows)
    if curated_policy:
        filtered_category_counts = count_large_candidates(
            args.large,
            excluded_ids=rich_ids,
            allowed_categories=allowed_categories or None,
            require_image=args.require_image,
            curated_policy=True,
            progress_every=args.progress_every,
        )
    else:
        profile = json.loads(args.profile.read_text())
        category_counts = profile["large_source"].get("unique_category_counts")
        if not category_counts:
            raise SystemExit("Profile lacks unique_category_counts; rerun profile_sources.py")
        filtered_category_counts = {
            key: int(value)
            for key, value in category_counts.items()
            if not allowed_categories or category_group(key) in allowed_categories
        }
    if sum(filtered_category_counts.values()) < remaining:
        raise SystemExit(
            f"Selected policy exposes only {sum(filtered_category_counts.values()):,} "
            f"eligible unique large-source rows; remaining target is {remaining:,}"
        )
    large_raw = sample_large(
        args.large,
        target=remaining,
        excluded_ids=rich_ids,
        category_counts=filtered_category_counts,
        seed=args.seed,
        progress_every=args.progress_every,
        require_image=args.require_image,
        allowed_categories=allowed_categories or None,
        curated_policy=curated_policy,
    )
    large_rows = [process_large_row(context, row) for row in large_raw]
    rows = rich_rows + large_rows
    rows.sort(
        key=lambda row: (
            row["source"],
            0 if row["source_product_id"].isdigit() else 1,
            int(row["source_product_id"]) if row["source_product_id"].isdigit() else 0,
            row["source_product_id"],
        )
    )
    if len(rows) != args.target:
        raise RuntimeError(f"Built {len(rows)} rows; expected {args.target}")
    excluded_rows = [
        row["product_key"]
        for row in rows
        if is_policy_excluded(row["product_type_key"], row["title"], row["source_url"])
    ]
    if curated_policy and excluded_rows:
        raise RuntimeError(f"Policy leak detected for {len(excluded_rows)} rows")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS, extrasaction="raise")
        writer.writeheader()
        writer.writerows(rows)

    seed_dir = args.output.parent / "seed"
    brands = context.brands.export()
    sellers = context.sellers.export()
    for seller in sellers:
        seller["brand_keys"] = sorted(context.seller_brand_keys.get(seller["key"], set()))
        seller["status"] = "approved"
        seller["simulation_mode"] = True
    locations = [context.locations[key] for key in sorted(context.locations)]
    colors = [context.used_colors[key] for key in sorted(context.used_colors)]
    metadata_output = enrich_metadata_seed(metadata_seed, rows, color_catalog)
    write_jsonl(seed_dir / "brands.jsonl", brands)
    write_jsonl(seed_dir / "sellers.jsonl", sellers)
    write_jsonl(seed_dir / "seller_locations.jsonl", locations)
    write_jsonl(seed_dir / "colors.jsonl", colors)
    write_jsonl(
        seed_dir / "dedupe_review.jsonl",
        context.brands.review_candidates + context.sellers.review_candidates,
    )
    (seed_dir / "metadata_fields.json").write_text(json.dumps(metadata_output, ensure_ascii=False, indent=2) + "\n")
    app_configs = [
        {
            "key": "catalogue",
            "value": {"revision": metadata_output["version"], "pipelineVersion": PIPELINE_VERSION, "datasetRows": len(rows)},
            "version": metadata_output["version"],
            "metadata": {"pipeline": {"seed": args.seed}},
        },
        {
            "key": "swoopstyl",
            "value": {
                "enabled": True,
                "maxRadiusKm": 100,
                "bands": [
                    {"key": "near", "maxKm": 25},
                    {"key": "local", "maxKm": 60},
                    {"key": "extended", "maxKm": 100},
                ],
                "cutoffLocal": "14:00",
                "maxHandlingHours": 8,
                "minAvailableQty": 1,
                "minCapacityHeadroom": 1,
                "weights": {"distance": 0.6, "relevance": 0.2, "capacity": 0.1, "stock": 0.05, "readiness": 0.05},
            },
            "version": 1,
            "metadata": {"pipeline": {"seeded": True}},
        },
    ]
    (seed_dir / "app_configs.json").write_text(json.dumps(app_configs, ensure_ascii=False, indent=2) + "\n")

    metadata_rows = [json.loads(row["product_metadata_json"]) for row in rows]
    cohort_counts = {
        "festive": sum("festive-first" in item.get("personalization_segment", []) for item in metadata_rows),
        "genZ": sum("gen-z" in item.get("generation", []) for item in metadata_rows),
        "genAlpha": sum("gen-alpha" in item.get("generation", []) for item in metadata_rows),
        "deepPersonalization": sum(
            bool(item.get("personalization_segment"))
            and bool(item.get("aesthetic"))
            and bool(item.get("dress_code"))
            and bool(item.get("body_fit_preference"))
            for item in metadata_rows
        ),
    }
    summary = {
        "pipelineVersion": PIPELINE_VERSION,
        "seed": args.seed,
        "categoryFilter": sorted(allowed_categories),
        "cataloguePolicy": args.policy,
        "requireImage": args.require_image,
        "taxonomyRegistry": taxonomy_source,
        "forbiddenProductCount": len(excluded_rows),
        "cohortCounts": cohort_counts,
        "rowCount": len(rows),
        "sourceCounts": {
            "myntra_detailed": len(rich_rows),
            "myntra_large": len(large_rows),
        },
        "entityCounts": {
            "brands": len(brands),
            "sellers": len(sellers),
            "sellerLocations": len(locations),
            "colors": len(colors),
            "metadataFields": len(metadata_output["fields"]),
            "dedupeReviewCandidates": len(context.brands.review_candidates) + len(context.sellers.review_candidates),
        },
        "output": str(args.output),
        "outputSha256": sha256_json(rows),
    }
    (args.output.parent / "build_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
