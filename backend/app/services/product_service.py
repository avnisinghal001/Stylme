from __future__ import annotations

import math
import re
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import HTTPException
from pymongo import UpdateOne

from app.core.serialization import mongo_json
from app.core.text import normalize_name, slugify


PRICE_CEILING_RE = re.compile(
    r"\b(?:under|below|upto|up\s+to|less\s+than|max(?:imum)?)\s*(?:rs\.?|inr|₹)?\s*([0-9][0-9,]*)",
    re.IGNORECASE,
)
SEARCH_STOP_WORDS = {
    "a", "an", "and", "for", "i", "in", "look", "looking", "me", "need",
    "of", "outfit", "please", "show", "some", "something", "the", "to", "want",
    "wear", "with",
}


def _public_media(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {
            "id": item.get("id"),
            "type": item.get("type", "image"),
            "url": item.get("url"),
            "displayUrl": item.get("display_url") or item.get("displayUrl") or item.get("url"),
            "alt": item.get("alt", ""),
            "position": item.get("position", 0),
            "provider": item.get("provider"),
            "providerId": item.get("provider_id") or item.get("providerId"),
            "width": item.get("width"),
            "height": item.get("height"),
            "size": item.get("size"),
            "mime": item.get("mime"),
            "sha256": item.get("sha256"),
        }
        for item in items
    ]


def _public_palette(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {
            "colorId": item.get("color_id") or item.get("colorId"),
            "hex": item.get("hex"),
            "families": item.get("families") or item.get("familyKeys") or [],
            "confidence": item.get("confidence"),
            "source": item.get("source"),
        }
        for item in items
    ]


def _public_variant(item: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": item.get("id"),
        "sku": item.get("sku"),
        "sizeKey": item.get("sizeKey") or item.get("size_key"),
        "colorId": item.get("color_id") or item.get("colorId"),
        "measurements": item.get("measurements") or {},
        "fitRange": item.get("fitRange") or item.get("fit_range") or {},
        "ageRange": item.get("ageRange") or item.get("age_range") or {},
        "attributes": item.get("attributes") or {},
    }


def _public_offer(offer: Dict[str, Any], detailed: bool = False) -> Dict[str, Any]:
    sellers = offer.get("_seller") or []
    seller = sellers[0] if sellers else None
    result = {
        "id": offer.get("_id"),
        "sellerId": offer.get("seller_id"),
        "brandId": offer.get("brand_id"),
        "offerCode": offer.get("offer_code"),
        "currency": offer.get("currency", "INR"),
        "mrpPaise": offer.get("mrp_paise"),
        "salePricePaise": offer.get("sale_price_paise"),
        "discountPercent": offer.get("discount_percent"),
        "seller": (
            {
                "id": seller.get("_id"),
                "displayName": seller.get("display_name"),
                "slug": seller.get("slug"),
            }
            if seller
            else None
        ),
        "availableSizeKeys": offer.get("available_size_keys") or [],
        "availableColorIds": offer.get("available_color_ids") or [],
        "availableColorFamilyKeys": offer.get("available_color_family_keys") or [],
        "fitBounds": offer.get("fit_bounds") or {},
        "ageBounds": offer.get("age_bounds") or {},
    }
    if detailed:
        result.update(
            {
                "offerDetails": offer.get("offer_details") or {},
                "variants": [_public_variant(item) for item in offer.get("variants") or []],
                "inventory": [
                    {
                        "variantId": item.get("variantId"),
                        "locationId": item.get("location_id"),
                        "available": bool(item.get("active"))
                        and int(item.get("availableQty", 0)) > 0,
                    }
                    for item in offer.get("inventory") or []
                ],
            }
        )
    return mongo_json(result)


def public_product(product: Dict[str, Any], detailed: bool = False) -> Dict[str, Any]:
    brands = product.get("_brand") or []
    brand = brands[0] if brands else None
    offers = product.get("_offers") or []
    best_offer = offers[0] if offers else None
    result = {
        "id": product.get("_id"),
        "slug": product.get("slug"),
        "title": product.get("title"),
        "description": product.get("description") if detailed else None,
        "brand": (
            {"id": brand.get("_id"), "name": brand.get("name"), "slug": brand.get("slug")}
            if brand
            else None
        ),
        "categoryKey": product.get("category_key"),
        "productTypeKey": product.get("product_type_key"),
        "genderKeys": product.get("gender_keys") or [],
        "coverImageUrl": product.get("cover_image_url"),
        "media": _public_media(product.get("media") or []),
        "colorPalette": _public_palette(product.get("color_palette") or []),
        "rating": product.get("rating") or {"average": 0, "count": 0},
        "metadata": product.get("metadata") or {},
        "price": (
            {
                "currency": best_offer.get("currency", "INR"),
                "mrpPaise": best_offer.get("mrp_paise"),
                "salePricePaise": best_offer.get("sale_price_paise"),
                "discountPercent": best_offer.get("discount_percent"),
            }
            if best_offer
            else None
        ),
        "offers": [_public_offer(offer, detailed=detailed) for offer in offers],
        "createdAt": product.get("created_at"),
        "updatedAt": product.get("updated_at"),
    }
    if product.get("_hybridScore") is not None:
        result["searchScore"] = round(float(product["_hybridScore"]), 6)
        result["matchedVectorDimensions"] = int(product.get("_vectorMatches") or 0)
    if detailed:
        result.update(
            {
                "metadata": product.get("metadata") or {},
                "source": product.get("source"),
                "sourceUrl": product.get("source_url"),
            }
        )
    return mongo_json(result)


def product_lookups(offer_filters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    offer_match: Dict[str, Any] = {
        "$expr": {"$eq": ["$product_id", "$$productId"]},
        "status": "active",
        "inventory": {"$elemMatch": {"active": True, "availableQty": {"$gt": 0}}},
    }
    offer_match.update(offer_filters or {})
    return [
        {
            "$lookup": {
                "from": "brands",
                "localField": "brand_id",
                "foreignField": "_id",
                "as": "_brand",
            }
        },
        {
            "$lookup": {
                "from": "seller_offers",
                "let": {"productId": "$_id"},
                "pipeline": [
                    {
                        "$match": {
                            **offer_match,
                        }
                    },
                    {
                        "$lookup": {
                            "from": "sellers",
                            "localField": "seller_id",
                            "foreignField": "_id",
                            "as": "_seller",
                        }
                    },
                    {"$match": {"_seller.status": "approved"}},
                    {"$sort": {"sale_price_paise": 1}},
                ],
                "as": "_offers",
            }
        },
        {"$match": {"_offers.0": {"$exists": True}}},
    ]


async def _eligible_product_ids_for_offer_filters(
    database,
    offer_filters: Dict[str, Any],
) -> List[ObjectId]:
    """Resolve offer-level filters once instead of joining every product.

    The public catalogue read flag handles the common unfiltered path. When a
    request includes price, size, colour, or fit constraints, this query keeps
    the original "one matching approved offer" semantics while reducing the
    later product lookup to the matching product IDs only.
    """

    approved_seller_ids = await database.sellers.distinct(
        "_id", {"status": "approved"}
    )
    if not approved_seller_ids:
        return []
    offer_query: Dict[str, Any] = {
        "status": "active",
        "seller_id": {"$in": approved_seller_ids},
        "inventory": {
            "$elemMatch": {"active": True, "availableQty": {"$gt": 0}}
        },
    }
    offer_query.update(offer_filters)
    return await database.seller_offers.distinct("product_id", offer_query)


async def refresh_catalogue_projection_for_products(
    database,
    product_ids: List[ObjectId],
) -> None:
    """Refresh sellability after an offer or seller workflow mutation."""

    unique_product_ids = list(dict.fromkeys(product_ids))
    if not unique_product_ids:
        return
    approved_seller_ids = await database.sellers.distinct(
        "_id", {"status": "approved"}
    )
    rows = await database.seller_offers.aggregate(
        [
            {
                "$match": {
                    "product_id": {"$in": unique_product_ids},
                    "seller_id": {"$in": approved_seller_ids},
                    "status": "active",
                    "inventory": {
                        "$elemMatch": {
                            "active": True,
                            "availableQty": {"$gt": 0},
                        }
                    },
                }
            },
            {
                "$group": {
                    "_id": "$product_id",
                    "minimum_price": {"$min": "$sale_price_paise"},
                }
            },
        ]
    ).to_list(length=len(unique_product_ids))
    minimum_prices = {row["_id"]: row["minimum_price"] for row in rows}
    operations = []
    for product_id in unique_product_ids:
        minimum_price = minimum_prices.get(product_id)
        if minimum_price is None:
            operations.append(
                UpdateOne(
                    {"_id": product_id},
                    {
                        "$set": {"catalogue_eligible": False},
                        "$unset": {"catalogue_min_price_paise": ""},
                    },
                )
            )
        else:
            operations.append(
                UpdateOne(
                    {"_id": product_id},
                    {
                        "$set": {
                            "catalogue_eligible": True,
                            "catalogue_min_price_paise": minimum_price,
                        }
                    },
                )
            )
    if operations:
        await database.products.bulk_write(operations, ordered=False)


def _lexical_search(search: str) -> tuple[List[str], Optional[int]]:
    inferred_maximum = None
    price_match = PRICE_CEILING_RE.search(search)
    if price_match:
        inferred_maximum = int(price_match.group(1).replace(",", "")) * 100
        search = PRICE_CEILING_RE.sub(" ", search)
    terms = [
        token
        for token in re.findall(r"[a-z0-9]+", search.casefold())
        if len(token) > 1 and token not in SEARCH_STOP_WORDS
    ]
    return list(dict.fromkeys(terms))[:12], inferred_maximum


async def _list_swoopstyl_products(
    database,
    *,
    query: Dict[str, Any],
    offer_filters: Dict[str, Any],
    page: int,
    page_size: int,
    pincode: str,
    radius_km: float,
    search_active: bool,
    soft_metadata_filters: Optional[Dict[str, List[str]]] = None,
    soft_filter_weights: Optional[Dict[str, Dict[str, float]]] = None,
    profile_signals: Optional[Dict[str, bool]] = None,
) -> Dict[str, Any]:
    pincode_geo = await database.pincode_geos.find_one(
        {"country_code": "IN", "pincode": pincode, "resolved": True},
        {"geo_point": 1, "place": 1},
    )
    if not pincode_geo or not pincode_geo.get("geo_point"):
        raise HTTPException(
            status_code=422,
            detail="This pincode is not available in the current SwoopStyl zone map",
        )

    locations = await database.seller_locations.aggregate(
        [
            {
                "$geoNear": {
                    "near": pincode_geo["geo_point"],
                    "key": "geo_point",
                    "distanceField": "_distance_meters",
                    "maxDistance": radius_km * 1000,
                    "spherical": True,
                    "query": {
                        "status": "active",
                        "geocode_resolved": True,
                        "swoopstyl_enabled": True,
                        "handling_hours": {"$lte": 24},
                    },
                }
            },
            {
                "$match": {
                    "$expr": {
                        "$lt": [
                            {"$ifNull": ["$current_committed_load", 0]},
                            {"$ifNull": ["$daily_capacity", 0]},
                        ]
                    }
                }
            },
            {"$limit": 2000},
        ]
    ).to_list(length=2000)
    if not locations:
        return {
            "items": [], "page": page, "pageSize": page_size, "total": 0,
            "totalPages": 0,
            "swoopStyl": {"pincode": pincode, "radiusKm": radius_km, "eligibleLocations": 0},
        }

    seller_ids = list({location["seller_id"] for location in locations})
    approved_seller_ids = set(
        await database.sellers.distinct(
            "_id", {"_id": {"$in": seller_ids}, "status": "approved"}
        )
    )
    location_map: Dict[ObjectId, Dict[str, Any]] = {}
    for location in locations:
        if location.get("seller_id") not in approved_seller_ids:
            continue
        distance_km = float(location.get("_distance_meters", 0)) / 1000
        effective_radius = min(
            radius_km,
            float(location.get("radius_km_override") or radius_km),
        )
        if distance_km <= effective_radius:
            location_map[location["_id"]] = {**location, "_distance_km": distance_km}
    if not location_map:
        return {
            "items": [], "page": page, "pageSize": page_size, "total": 0,
            "totalPages": 0,
            "swoopStyl": {"pincode": pincode, "radiusKm": radius_km, "eligibleLocations": 0},
        }

    location_ids = list(location_map)
    qualifying_inventory = {
        "$elemMatch": {
            "location_id": {"$in": location_ids},
            "active": True,
            "availableQty": {"$gt": 0},
        }
    }
    eligible_offer_filters = {
        **offer_filters,
        "seller_id": {"$in": list(approved_seller_ids)},
        "location_ids": {"$in": location_ids},
        "inventory": qualifying_inventory,
    }
    offer_query = {"status": "active", **eligible_offer_filters}
    offers = await database.seller_offers.find(offer_query).to_list(length=50_000)

    best_by_product: Dict[ObjectId, Dict[str, Any]] = {}
    active_profile_signals = {
        key for key, enabled in (profile_signals or {}).items() if enabled
    }
    for offer in offers:
        candidates = []
        for inventory in offer.get("inventory") or []:
            location_id = inventory.get("location_id")
            location = location_map.get(location_id)
            if (
                not location
                or inventory.get("active") is not True
                or int(inventory.get("availableQty", 0)) <= 0
            ):
                continue
            capacity = max(1, int(location.get("daily_capacity", 1)))
            current_load = max(0, int(location.get("current_committed_load", 0)))
            capacity_score = max(0.0, min(1.0, (capacity - current_load) / capacity))
            stock_score = min(1.0, int(inventory.get("availableQty", 0)) / 25)
            readiness_score = max(
                0.0, 1 - float(location.get("handling_hours", 24)) / 24
            )
            distance_km = float(location["_distance_km"])
            distance_score = max(0.0, 1 - distance_km / radius_km)
            relevance_score = 1.0 if search_active else 0.7
            confirmed_signals = sum(
                (
                    signal == "age"
                    and (offer.get("age_bounds") or {}).get("applicable") is True
                )
                or (
                    signal in {"height", "weight"}
                    and (offer.get("fit_bounds") or {}).get("applicable") is True
                )
                for signal in active_profile_signals
            )
            profile_fit_match = (
                confirmed_signals / len(active_profile_signals)
                if active_profile_signals
                else 0.0
            )
            if active_profile_signals:
                relevance_score = 0.65 + 0.35 * profile_fit_match
            score = (
                0.60 * distance_score
                + 0.20 * relevance_score
                + 0.10 * capacity_score
                + 0.05 * stock_score
                + 0.05 * readiness_score
            )
            candidates.append(
                (
                    confirmed_signals,
                    score,
                    distance_km,
                    location,
                    inventory,
                    profile_fit_match,
                )
            )
        if not candidates:
            continue
        fit_tier, score, distance_km, location, inventory, profile_fit_match = max(
            candidates, key=lambda item: (item[0], item[1], -item[2])
        )
        product_id = offer["product_id"]
        candidate = {
            "score": score,
            "distanceKm": distance_km,
            "location": location,
            "inventory": inventory,
            "offer": offer,
            "fitTier": fit_tier,
            "profileFitMatch": profile_fit_match,
        }
        current = best_by_product.get(product_id)
        if not current or (fit_tier, score, -distance_km) > (
            current["fitTier"], current["score"], -current["distanceKm"]
        ):
            best_by_product[product_id] = candidate

    profile_fields = {
        field: set(values)
        for field, values in (soft_metadata_filters or {}).items()
        if values
    }
    semantic_weights = {
        str(field): {
            str(value): max(0.0, min(1.0, float(weight)))
            for value, weight in values.items()
            if str(value) and float(weight) > 0
        }
        for field, values in (soft_filter_weights or {}).items()
        if isinstance(values, dict) and values
    }
    if (profile_fields or semantic_weights) and best_by_product:
        profile_rows = await database.products.find(
            {"_id": {"$in": list(best_by_product)}},
            {
                "category_key": 1,
                "product_type_key": 1,
                "gender_keys": 1,
                "metadata": 1,
                "color_palette": 1,
            },
        ).to_list(length=len(best_by_product))
        profile_by_product = {row["_id"]: row for row in profile_rows}
        base_relevance = 1.0 if search_active else 0.7
        for product_id, ranked in best_by_product.items():
            product_profile = profile_by_product.get(product_id) or {}
            metadata = product_profile.get("metadata") or {}
            color_families = {
                family
                for swatch in product_profile.get("color_palette") or []
                for family in swatch.get("families") or []
            }
            if profile_fields:
                matched_fields = sum(
                    bool(
                        (color_families if field == "color_family" else set(metadata.get(field) or []))
                        & expected
                    )
                    for field, expected in profile_fields.items()
                )
                match_ratio = matched_fields / len(profile_fields)
                profile_relevance = 0.65 + 0.35 * match_ratio
                ranked["score"] = max(
                    0.0,
                    min(
                        1.0,
                        float(ranked["score"])
                        + 0.20 * (profile_relevance - base_relevance),
                    ),
                )
                ranked["profileMatch"] = match_ratio
            if semantic_weights:
                query_norm_squared = 0.0
                dot_product = 0.0
                matched_dimensions = 0
                for field, values in semantic_weights.items():
                    if field == "category":
                        product_values = {str(product_profile.get("category_key") or "")}
                    elif field == "product_type":
                        product_values = {str(product_profile.get("product_type_key") or "")}
                    elif field == "gender":
                        product_values = set(product_profile.get("gender_keys") or [])
                    elif field == "color_family":
                        product_values = color_families
                    else:
                        product_values = set(metadata.get(field) or [])
                    for value, weight in values.items():
                        query_norm_squared += weight * weight
                        if value in product_values:
                            dot_product += weight
                            matched_dimensions += 1
                semantic_score = (
                    dot_product
                    / (math.sqrt(query_norm_squared) * math.sqrt(matched_dimensions))
                    if query_norm_squared and matched_dimensions
                    else 0.0
                )
                ranked["logisticsScore"] = float(ranked["score"])
                ranked["semanticScore"] = max(0.0, min(1.0, semantic_score))
                ranked["matchedVectorDimensions"] = matched_dimensions
                ranked["score"] = (
                    0.70 * ranked["logisticsScore"]
                    + 0.30 * ranked["semanticScore"]
                )

    ordered_ids = [
        product_id
        for product_id, _ in sorted(
            best_by_product.items(),
            key=lambda item: (
                -item[1]["fitTier"],
                -item[1]["score"],
                item[1]["distanceKm"],
                str(item[0]),
            ),
        )
    ]
    if not ordered_ids:
        return {
            "items": [], "page": page, "pageSize": page_size, "total": 0,
            "totalPages": 0,
            "swoopStyl": {"pincode": pincode, "radiusKm": radius_km, "eligibleLocations": len(location_map)},
        }
    valid_ids = set(
        await database.products.distinct(
            "_id", {**query, "_id": {"$in": ordered_ids}}
        )
    )
    ordered_ids = [product_id for product_id in ordered_ids if product_id in valid_ids]
    total = len(ordered_ids)
    page_ids = ordered_ids[(page - 1) * page_size : page * page_size]
    rows = await database.products.aggregate(
        [
            {"$match": {"_id": {"$in": page_ids}}},
            *product_lookups(eligible_offer_filters),
        ]
    ).to_list(length=page_size)
    row_map = {row["_id"]: row for row in rows}
    items = []
    for product_id in page_ids:
        row = row_map.get(product_id)
        if not row:
            continue
        ranked = best_by_product[product_id]
        location = ranked["location"]
        item = public_product(row)
        item.update(
            {
                "swoopStylEligible": True,
                "deliveryLabel": f"{ranked['distanceKm']:.1f} km away · one-day zone",
                "searchScore": round(ranked["score"], 6),
                "matchedVectorDimensions": int(ranked.get("matchedVectorDimensions", 0)),
                "swoopStyl": {
                    "pincode": pincode,
                    "distanceKm": round(ranked["distanceKm"], 2),
                    "score": round(ranked["score"], 4),
                    "locationId": str(location["_id"]),
                    "sellerId": str(location["seller_id"]),
                    "availableQty": int(ranked["inventory"].get("availableQty", 0)),
                    "handlingHours": int(location.get("handling_hours", 24)),
                    "profileMatch": round(ranked.get("profileMatch", 0.0), 4),
                    "profileFitMatch": round(ranked.get("profileFitMatch", 0.0), 4),
                    "fitTier": int(ranked.get("fitTier", 0)),
                    "logisticsScore": round(ranked.get("logisticsScore", ranked["score"]), 4),
                    "semanticScore": round(ranked.get("semanticScore", 0.0), 4),
                },
            }
        )
        items.append(item)
    return {
        "items": items,
        "page": page,
        "pageSize": page_size,
        "total": total,
        "totalPages": math.ceil(total / page_size) if total else 0,
        "swoopStyl": {
            "pincode": pincode,
            "radiusKm": radius_km,
            "eligibleLocations": len(location_map),
            "rankingWeights": {
                "distance": 0.60,
                "relevance": 0.20,
                "capacity": 0.10,
                "stock": 0.05,
                "readiness": 0.05,
            },
            "hybridBlend": {
                "logistics": 0.70,
                "taxonomyVector": 0.30,
            },
            "fitOrdering": "confirmed-bands-before-wildcard",
        },
    }


def _normalize_option(value: str) -> str:
    return slugify(value)


async def _resolve_metadata_option(database, field_key: str, value: str) -> Optional[str]:
    field = await database.metadata_fields.find_one({"key": field_key, "status": "active"})
    if not field:
        return None
    normalized = _normalize_option(value)
    for option in field.get("options") or []:
        if not isinstance(option, dict) or not option.get("active", True):
            continue
        candidates = [option.get("key"), option.get("label"), *(option.get("aliases") or [])]
        if any(_normalize_option(str(candidate)) == normalized for candidate in candidates if candidate):
            return option.get("key")
    return None


async def list_public_products(
    database,
    *,
    page: int,
    page_size: int,
    search: Optional[str],
    category: List[str],
    product_type: List[str],
    brand_id: Optional[str],
    brand: List[str],
    colour: List[str],
    size: List[str],
    gender: List[str],
    metadata_filters: List[str],
    min_price_paise: Optional[int],
    max_price_paise: Optional[int],
    min_age: Optional[float],
    max_age: Optional[float],
    min_height_cm: Optional[float],
    max_height_cm: Optional[float],
    min_weight_kg: Optional[float],
    max_weight_kg: Optional[float],
    sort_by: str,
    order: str,
    pincode: Optional[str],
    swoopstyl: bool,
    radius_km: float,
    soft_metadata_filters: Optional[Dict[str, List[str]]] = None,
    soft_filter_weights: Optional[Dict[str, Dict[str, float]]] = None,
    require_soft_match: bool = False,
    hybrid_candidate_limit: int = 800,
    excluded_product_types: Optional[List[str]] = None,
    excluded_text_pattern: Optional[str] = None,
) -> Dict[str, Any]:
    query: Dict[str, Any] = {
        "status": "active",
        "visibility": "public",
        "catalogue_eligible": True,
    }
    product_and: List[Dict[str, Any]] = []
    if excluded_product_types:
        product_and.append(
            {"product_type_key": {"$nin": list(dict.fromkeys(excluded_product_types))}}
        )
    if excluded_text_pattern:
        product_and.append(
            {
                "$nor": [
                    {
                        field: {
                            "$regex": excluded_text_pattern,
                            "$options": "i",
                        }
                    }
                    for field in ("title", "description", "search_text")
                ]
            }
        )
    search_terms: List[str] = []
    if search:
        search_terms, inferred_maximum = _lexical_search(search.strip()[:100])
        if max_price_paise is None and inferred_maximum is not None:
            max_price_paise = inferred_maximum
        if search_terms:
            query["$text"] = {"$search": " ".join(search_terms)}
    if category:
        resolved_categories = [await _resolve_metadata_option(database, "category", value) for value in category]
        if any(not value for value in resolved_categories):
            return {"items": [], "page": page, "pageSize": page_size, "total": 0, "totalPages": 0}
        query["category_key"] = {"$in": list(dict.fromkeys(resolved_categories))}
    if product_type:
        resolved_product_types = [
            await _resolve_metadata_option(database, "product_type", value)
            for value in product_type
        ]
        if any(not value for value in resolved_product_types):
            return {"items": [], "page": page, "pageSize": page_size, "total": 0, "totalPages": 0}
        query["product_type_key"] = {"$in": list(dict.fromkeys(resolved_product_types))}
    if brand_id:
        if not ObjectId.is_valid(brand_id):
            raise HTTPException(status_code=422, detail="Invalid brandId")
        query["brand_id"] = ObjectId(brand_id)
    elif brand:
        brand_ids = []
        for raw_brand in brand:
            brand_value = raw_brand.strip()
            if ObjectId.is_valid(brand_value):
                brand_ids.append(ObjectId(brand_value))
                continue
            normalized_brand = normalize_name(brand_value)
            brand_document = await database.brands.find_one(
                {"status": "active", "$or": [{"normalized_name": normalized_brand}, {"name": {"$regex": f"^{re.escape(brand_value)}$", "$options": "i"}}, {"aliases": {"$regex": f"^{re.escape(brand_value)}$", "$options": "i"}}]},
                {"_id": 1},
            )
            if not brand_document:
                return {"items": [], "page": page, "pageSize": page_size, "total": 0, "totalPages": 0}
            brand_ids.append(brand_document["_id"])
        query["brand_id"] = {"$in": list(dict.fromkeys(brand_ids))}

    fields = None
    if gender or metadata_filters or soft_metadata_filters or soft_filter_weights:
        fields = {
            field["key"]: field
            for field in await database.metadata_fields.find(
                {"status": "active", "filterable": True}
            ).to_list(length=500)
        }

    def allowed_values(field_key: str) -> set[str]:
        field = (fields or {}).get(field_key)
        return {
            str(option.get("key"))
            for option in (field or {}).get("options") or []
            if isinstance(option, dict) and option.get("active", True)
        }

    if gender:
        clean_gender = list(dict.fromkeys(value.strip() for value in gender if value.strip()))
        unknown_gender = sorted(set(clean_gender) - allowed_values("gender"))
        if unknown_gender:
            raise HTTPException(
                status_code=422,
                detail={"message": "Unknown gender filters", "values": unknown_gender},
            )
        product_and.append(
            {
                "$or": [
                    {"gender_keys": {"$in": clean_gender}},
                    {"gender_keys": {"$exists": False}},
                    {"gender_keys": {"$size": 0}},
                ]
            }
        )

    resolved_metadata: Dict[str, List[str]] = {}
    resolved_offer_metadata: Dict[str, List[str]] = {}
    for entry in metadata_filters:
        if ":" not in entry:
            raise HTTPException(status_code=422, detail="Metadata filters must use key:value")
        field_key, value = (part.strip() for part in entry.split(":", 1))
        field = (fields or {}).get(field_key)
        if not field or field.get("storage") not in {"product_metadata", "offer"}:
            raise HTTPException(status_code=422, detail=f"Unknown metadata filter: {field_key}")
        if value not in allowed_values(field_key):
            raise HTTPException(status_code=422, detail=f"Unknown {field_key} option: {value}")
        target = resolved_metadata if field.get("storage") == "product_metadata" else resolved_offer_metadata
        target.setdefault(field_key, []).append(value)
    for field_key, values in resolved_metadata.items():
        product_and.append({f"metadata.{field_key}": {"$in": list(dict.fromkeys(values))}})
    ranking_weights: Dict[str, Dict[str, float]] = {
        str(field): {
            str(value): max(0.0, min(float(weight), 1.0))
            for value, weight in values.items()
            if str(value) and float(weight) > 0
        }
        for field, values in (soft_filter_weights or {}).items()
        if isinstance(values, dict)
    }
    for field, values in (soft_metadata_filters or {}).items():
        target = ranking_weights.setdefault(str(field), {})
        for value in values:
            target.setdefault(str(value), 1.0)

    candidate_conditions: List[Dict[str, Any]] = []
    for field_key, weighted_values in ranking_weights.items():
        clean_values = [
            value for value in weighted_values if value in allowed_values(field_key)
        ]
        if not clean_values:
            continue
        if field_key == "category":
            candidate_conditions.append({"category_key": {"$in": clean_values}})
        elif field_key == "product_type":
            candidate_conditions.append({"product_type_key": {"$in": clean_values}})
        elif field_key == "gender":
            candidate_conditions.append({"gender_keys": {"$in": clean_values}})
        elif field_key == "color_family":
            candidate_conditions.append({"color_palette.families": {"$in": clean_values}})
        elif (fields or {}).get(field_key, {}).get("storage") == "product_metadata":
            candidate_conditions.append(
                {f"metadata.{field_key}": {"$in": clean_values}}
            )
    if require_soft_match and candidate_conditions:
        product_and.append({"$or": candidate_conditions})
    if product_and:
        query["$and"] = product_and

    offer_filters: Dict[str, Any] = {}
    for field_key, values in resolved_offer_metadata.items():
        unique_values = list(dict.fromkeys(values))
        if field_key == "size":
            offer_filters["available_size_keys"] = {"$in": unique_values}
        elif field_key == "color_family":
            offer_filters["available_color_family_keys"] = {"$in": unique_values}
        elif field_key == "color":
            color_ids = await database.colors.distinct(
                "_id", {"status": "active", "key": {"$in": unique_values}}
            )
            offer_filters["available_color_ids"] = {"$in": color_ids}
    if min_price_paise is not None or max_price_paise is not None:
        price_filter: Dict[str, int] = {}
        if min_price_paise is not None:
            price_filter["$gte"] = min_price_paise
        if max_price_paise is not None:
            price_filter["$lte"] = max_price_paise
        offer_filters["sale_price_paise"] = price_filter
    if colour:
        color_values = list(dict.fromkeys(value.strip() for value in colour if value.strip()))
        normalized_colors = [value.casefold() for value in color_values]
        exact_names = "|".join(re.escape(value) for value in color_values)
        color_query = {
            "status": "active",
            "$or": [
                {"key": {"$in": normalized_colors}},
                {"normalized_name": {"$in": normalized_colors}},
                {"name": {"$regex": f"^(?:{exact_names})$", "$options": "i"}},
                {"aliases": {"$regex": f"^(?:{exact_names})$", "$options": "i"}},
                {"family_keys": {"$in": normalized_colors}},
            ],
        }
        color_ids = await database.colors.distinct("_id", color_query)
        if not color_ids:
            return {"items": [], "page": page, "pageSize": page_size, "total": 0, "totalPages": 0}
        offer_filters["available_color_ids"] = {"$in": color_ids}
    if size:
        size_values = list(dict.fromkeys(value.strip() for value in size if value.strip()))
        allowed_sizes = allowed_values("size") if fields is not None else set()
        if fields is None:
            size_field = await database.metadata_fields.find_one(
                {"key": "size", "status": "active", "filterable": True}
            )
            allowed_sizes = {
                str(option.get("key"))
                for option in (size_field or {}).get("options") or []
                if isinstance(option, dict) and option.get("active", True)
            }
        unknown_sizes = sorted(set(size_values) - allowed_sizes) if allowed_sizes else []
        if unknown_sizes:
            raise HTTPException(status_code=422, detail={"message": "Unknown size options", "values": unknown_sizes})
        offer_filters["available_size_keys"] = {"$in": size_values}

    offer_and: List[Dict[str, Any]] = []

    def add_overlap(
        applicable_path: str,
        minimum_path: str,
        maximum_path: str,
        requested_minimum: Optional[float],
        requested_maximum: Optional[float],
    ) -> None:
        if requested_minimum is None and requested_maximum is None:
            return
        constrained: List[Dict[str, Any]] = [{applicable_path: True}]
        if requested_minimum is not None:
            constrained.append({maximum_path: {"$gte": requested_minimum}})
        if requested_maximum is not None:
            constrained.append({minimum_path: {"$lte": requested_maximum}})
        offer_and.append(
            {
                "$or": [
                    {applicable_path: {"$ne": True}},
                    {"$and": constrained},
                ]
            }
        )

    add_overlap(
        "age_bounds.applicable", "age_bounds.minAge", "age_bounds.maxAge",
        min_age, max_age,
    )
    add_overlap(
        "fit_bounds.applicable", "fit_bounds.minHeightCm", "fit_bounds.maxHeightCm",
        min_height_cm, max_height_cm,
    )
    add_overlap(
        "fit_bounds.applicable", "fit_bounds.minWeightKg", "fit_bounds.maxWeightKg",
        min_weight_kg, max_weight_kg,
    )
    if offer_and:
        offer_filters["$and"] = offer_and

    if swoopstyl:
        if not pincode:
            raise HTTPException(
                status_code=422, detail="pincode is required when SwoopStyl is enabled"
            )
        return await _list_swoopstyl_products(
            database,
            query=query,
            offer_filters=offer_filters,
            page=page,
            page_size=page_size,
            pincode=pincode,
            radius_km=radius_km,
            search_active=bool(search_terms),
            soft_metadata_filters=soft_metadata_filters,
            soft_filter_weights=ranking_weights,
            profile_signals={
                "age": min_age is not None or max_age is not None,
                "height": min_height_cm is not None or max_height_cm is not None,
                "weight": min_weight_kg is not None or max_weight_kg is not None,
            },
        )

    if offer_filters:
        eligible_product_ids = await _eligible_product_ids_for_offer_filters(
            database, offer_filters
        )
        if not eligible_product_ids:
            return {
                "items": [],
                "page": page,
                "pageSize": page_size,
                "total": 0,
                "totalPages": 0,
            }
        query["_id"] = {"$in": eligible_product_ids}

    pipeline: List[Dict[str, Any]] = [{"$match": query}]
    vector_dot_terms: List[Dict[str, Any]] = []
    vector_match_terms: List[Dict[str, Any]] = []
    query_vector_norm_squared = 0.0
    for field_key, weighted_values in ranking_weights.items():
        field = (fields or {}).get(field_key)
        clean_values = [
            value for value in weighted_values if value in allowed_values(field_key)
        ]
        if not field or not clean_values:
            continue
        if field_key == "category":
            product_values: Any = ["$category_key"]
        elif field_key == "product_type":
            product_values = ["$product_type_key"]
        elif field_key == "gender":
            product_values = {"$ifNull": ["$gender_keys", []]}
        elif field.get("storage") == "product_metadata":
            product_values = {"$ifNull": [f"$metadata.{field_key}", []]}
        elif field_key == "color_family":
            product_values = {
                "$reduce": {
                    "input": {"$ifNull": ["$color_palette", []]},
                    "initialValue": [],
                    "in": {
                        "$setUnion": [
                            "$$value",
                            {"$ifNull": ["$$this.families", []]},
                        ]
                    },
                }
            }
        else:
            continue
        for value in clean_values:
            weight = float(weighted_values[value])
            matched = {"$in": [value, product_values]}
            vector_dot_terms.append({"$cond": [matched, weight, 0.0]})
            vector_match_terms.append({"$cond": [matched, 1.0, 0.0]})
            query_vector_norm_squared += weight * weight

    initial_scores: Dict[str, Any] = {}
    if vector_dot_terms:
        initial_scores.update(
            {
                "_intentScore": {"$add": vector_dot_terms},
                "_vectorMatches": {"$add": vector_match_terms},
            }
        )
    if search_terms:
        initial_scores["_textScore"] = {"$meta": "textScore"}
    if initial_scores:
        pipeline.append({"$set": initial_scores})
    if vector_dot_terms:
        pipeline.append(
            {
                "$set": {
                    "_vectorScore": {
                        "$cond": [
                            {"$gt": ["$_vectorMatches", 0]},
                            {
                                "$divide": [
                                    "$_intentScore",
                                    {
                                        "$multiply": [
                                            math.sqrt(query_vector_norm_squared),
                                            {"$sqrt": "$_vectorMatches"},
                                        ]
                                    },
                                ]
                            },
                            0.0,
                        ]
                    }
                }
            }
        )
    if vector_dot_terms or search_terms:
        vector_component: Any = {"$ifNull": ["$_vectorScore", 0.0]}
        text_component: Any = {
            "$min": [1.0, {"$divide": [{"$ifNull": ["$_textScore", 0.0]}, 10.0]}]
        }
        vector_weight = 0.78 if vector_dot_terms and search_terms else (1.0 if vector_dot_terms else 0.0)
        text_weight = 0.22 if vector_dot_terms and search_terms else (1.0 if search_terms else 0.0)
        pipeline.append(
            {
                "$set": {
                    "_hybridScore": {
                        "$add": [
                            {"$multiply": [vector_component, vector_weight]},
                            {"$multiply": [text_component, text_weight]},
                        ]
                    }
                }
            }
        )
    fit_signal_scores: List[Dict[str, Any]] = []
    if min_age is not None or max_age is not None:
        fit_signal_scores.append(
            {"$cond": [{"$eq": ["$$offer.age_bounds.applicable", True]}, 1, 0]}
        )
    if min_height_cm is not None or max_height_cm is not None:
        fit_signal_scores.append(
            {"$cond": [{"$eq": ["$$offer.fit_bounds.applicable", True]}, 1, 0]}
        )
    if min_weight_kg is not None or max_weight_kg is not None:
        fit_signal_scores.append(
            {"$cond": [{"$eq": ["$$offer.fit_bounds.applicable", True]}, 1, 0]}
        )
    hybrid_prelimited = bool(
        vector_dot_terms
        and not offer_filters
        and not fit_signal_scores
        and sort_by in {"relevance", "createdAt"}
    )
    effective_candidate_limit = min(
        5000,
        max(100, int(hybrid_candidate_limit), page * page_size + page_size),
    )
    if hybrid_prelimited:
        pipeline.extend(
            [
                {"$sort": {"_hybridScore": -1, "rating.count": -1, "_id": -1}},
                {"$limit": effective_candidate_limit},
            ]
        )
    direction = -1 if order.lower() == "desc" else 1
    sort_map = {
        "createdAt": {"created_at": direction, "_id": direction},
        "newest": {"created_at": -1, "_id": -1},
        "price": {"_minimumPrice": direction, "_id": -1},
        "price_low": {"_minimumPrice": 1, "_id": -1},
        "price_high": {"_minimumPrice": -1, "_id": -1},
        "rating": {"rating.average": -1, "rating.count": -1},
        "title": {"title": direction},
        "relevance": (
            {
                **({"_profileFitScore": -1} if fit_signal_scores else {}),
                **({"_hybridScore": -1} if vector_dot_terms or search_terms else {}),
                "rating.count": -1,
                "rating.average": -1,
            }
        ),
    }
    effective_sort = "relevance" if search_terms and sort_by == "createdAt" else sort_by
    sort_spec = sort_map.get(effective_sort, sort_map["createdAt"])
    offer_projection = [
        *product_lookups(offer_filters),
        {
            "$set": {
                "_minimumPrice": {
                    "$arrayElemAt": ["$_offers.sale_price_paise", 0]
                },
                **(
                    {
                        "_profileFitScore": {
                            "$max": {
                                "$map": {
                                    "input": "$_offers",
                                    "as": "offer",
                                    "in": {"$add": fit_signal_scores},
                                }
                            }
                        }
                    }
                    if fit_signal_scores
                    else {}
                ),
            }
        },
    ]
    offer_price_sort = effective_sort in {"price", "price_low", "price_high"}
    can_page_before_offer_join = not fit_signal_scores and not (
        offer_filters and offer_price_sort
    )
    if can_page_before_offer_join:
        price_direction = (
            1
            if effective_sort == "price_low"
            else -1 if effective_sort == "price_high" else direction
        )
        indexed_sort_spec = (
            {
                "catalogue_min_price_paise": price_direction,
                "_id": -1,
            }
            if offer_price_sort
            else sort_spec
        )
        pipeline.append(
            {
                "$facet": {
                    "items": [
                        {"$sort": indexed_sort_spec},
                        {"$skip": (page - 1) * page_size},
                        {"$limit": page_size},
                        *offer_projection,
                    ],
                    "count": [{"$count": "value"}],
                }
            }
        )
    else:
        pipeline.extend(offer_projection)
        pipeline.append(
            {
                "$facet": {
                    "items": [
                        {"$sort": sort_spec},
                        {"$skip": (page - 1) * page_size},
                        {"$limit": page_size},
                    ],
                    "count": [{"$count": "value"}],
                }
            }
        )
    rows = await database.products.aggregate(pipeline).to_list(length=1)
    facet = rows[0] if rows else {"items": [], "count": []}
    total = facet["count"][0]["value"] if facet["count"] else 0
    return {
        "items": [public_product(item) for item in facet["items"]],
        "page": page,
        "pageSize": page_size,
        "total": total,
        "totalPages": math.ceil(total / page_size) if total else 0,
        "retrieval": {
            "strategy": (
                "top-k-hybrid"
                if hybrid_prelimited
                else (
                    "indexed-catalogue-read"
                    if can_page_before_offer_join
                    else "filtered-hybrid"
                )
            ),
            "candidateLimit": effective_candidate_limit if hybrid_prelimited else None,
            "candidateLimitApplied": hybrid_prelimited,
        },
    }


async def get_public_product(database, slug_or_id: str) -> Optional[Dict[str, Any]]:
    identity: Dict[str, Any] = {"slug": slug_or_id}
    if ObjectId.is_valid(slug_or_id):
        identity = {"$or": [{"_id": ObjectId(slug_or_id)}, {"slug": slug_or_id}]}
    query = {"status": "active", "visibility": "public", **identity}
    rows = await database.products.aggregate(
        [{"$match": query}, *product_lookups(), {"$limit": 1}]
    ).to_list(length=1)
    return public_product(rows[0], detailed=True) if rows else None


async def related_public_products(database, slug_or_id: str, limit: int = 8):
    identity: Dict[str, Any] = {"slug": slug_or_id}
    if ObjectId.is_valid(slug_or_id):
        identity = {"$or": [{"_id": ObjectId(slug_or_id)}, {"slug": slug_or_id}]}
    source = await database.products.find_one(identity, {"category_key": 1})
    if not source:
        raise HTTPException(status_code=404, detail="Product not found")
    rows = await database.products.aggregate(
        [
            {
                "$match": {
                    "_id": {"$ne": source["_id"]},
                    "status": "active",
                    "visibility": "public",
                    "catalogue_eligible": True,
                    "category_key": source.get("category_key"),
                }
            },
            {
                "$sort": {
                    "rating.average": -1,
                    "rating.count": -1,
                    "_id": -1,
                }
            },
            {"$limit": limit},
            *product_lookups(),
        ]
    ).to_list(length=limit)
    return {"items": [public_product(row) for row in rows]}
