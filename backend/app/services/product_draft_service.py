from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from bson import ObjectId
from fastapi import HTTPException
from pymongo import ReturnDocument

from app.core.serialization import mongo_json
from app.schemas.product import ProductDraftCreate
from app.services.audit_service import write_audit
from app.services.metadata_service import validate_product_metadata


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:90] or "product"


def _oid(value: str, label: str) -> ObjectId:
    if not ObjectId.is_valid(value):
        raise HTTPException(status_code=422, detail=f"Invalid {label}")
    return ObjectId(value)


async def seller_for_actor(database, actor, requested_seller_id: Optional[str]):
    roles = set(actor.get("roles") or [])
    if "owner" in roles or "admin" in roles:
        if not requested_seller_id:
            raise HTTPException(status_code=422, detail="sellerId is required for admin drafts")
        seller = await database.sellers.find_one(
            {"_id": _oid(requested_seller_id, "sellerId"), "status": "approved"}
        )
    else:
        seller = actor.get("_seller") or await database.sellers.find_one(
            {"user_id": actor["_id"], "status": "approved"}
        )
        if requested_seller_id and seller and str(seller["_id"]) != requested_seller_id:
            raise HTTPException(status_code=403, detail="Cannot create another seller's draft")
    if not seller:
        raise HTTPException(status_code=403, detail="An approved seller is required")
    return seller


async def validate_draft_payload(database, seller, payload: ProductDraftCreate) -> Dict[str, Any]:
    brand_id = _oid(payload.brand_id, "brandId")
    if brand_id not in (seller.get("brand_ids") or []):
        raise HTTPException(status_code=403, detail="Seller does not manage this brand")
    if not await database.brands.find_one({"_id": brand_id, "status": "active"}, {"_id": 1}):
        raise HTTPException(status_code=422, detail="Brand is unavailable")

    metadata = await validate_product_metadata(
        database,
        category_key=payload.category_key,
        product_type_key=payload.product_type_key,
        gender_keys=payload.gender_keys,
        metadata=payload.metadata,
    )

    variant_ids = [variant.id for variant in payload.offer.variants]
    skus = [variant.sku for variant in payload.offer.variants]
    if len(variant_ids) != len(set(variant_ids)) or len(skus) != len(set(skus)):
        raise HTTPException(status_code=422, detail="Variant IDs and SKUs must be unique")

    color_ids = {_oid(variant.color_id, "variant colorId") for variant in payload.offer.variants}
    color_count = await database.colors.count_documents(
        {"_id": {"$in": list(color_ids)}, "status": "active"}
    )
    if color_count != len(color_ids):
        raise HTTPException(status_code=422, detail="One or more variant colors are invalid")

    inventory_variant_ids = {item.variant_id for item in payload.offer.inventory}
    if not inventory_variant_ids.issubset(set(variant_ids)):
        raise HTTPException(status_code=422, detail="Inventory references an unknown variant")
    if any(
        variant_id not in inventory_variant_ids
        for variant_id in variant_ids
    ):
        raise HTTPException(status_code=422, detail="Every variant requires inventory")

    location_ids = {_oid(item.location_id, "inventory locationId") for item in payload.offer.inventory}
    location_count = await database.seller_locations.count_documents(
        {
            "_id": {"$in": list(location_ids)},
            "seller_id": seller["_id"],
            "status": "active",
        }
    )
    if location_count != len(location_ids):
        raise HTTPException(
            status_code=422,
            detail="Inventory locations must be active locations owned by the seller",
        )

    document = payload.model_dump(mode="json", by_alias=False)
    document["seller_id"] = seller["_id"]
    document["brand_id"] = brand_id
    document["metadata"] = metadata
    document["media"] = sorted(document["media"], key=lambda item: item["position"])
    return document


def draft_public(document: Dict[str, Any]) -> Dict[str, Any]:
    try:
        canonical = _draft_payload(document).model_dump(mode="json", by_alias=True)
    except Exception:
        canonical = {}
    return mongo_json(
        {
            "id": document.get("_id"),
            "sellerId": document.get("seller_id"),
            "brandId": document.get("brand_id"),
            "title": canonical.get("title", document.get("title")),
            "description": canonical.get("description", document.get("description")),
            "categoryKey": canonical.get("categoryKey", document.get("category_key")),
            "productTypeKey": canonical.get("productTypeKey", document.get("product_type_key")),
            "genderKeys": canonical.get("genderKeys", document.get("gender_keys") or []),
            "metadata": canonical.get("metadata", document.get("metadata") or {}),
            "media": canonical.get("media", document.get("media") or []),
            "offer": canonical.get("offer", document.get("offer") or {}),
            "status": document.get("status"),
            "rejectionReason": document.get("rejection_reason"),
            "aiProposal": document.get("ai_proposal"),
            "createdAt": document.get("created_at"),
            "updatedAt": document.get("updated_at"),
            "submittedAt": document.get("submitted_at"),
        }
    )


async def assert_draft_access(database, draft_id: str, actor, *, admin_only=False):
    draft = await database.product_drafts.find_one({"_id": _oid(draft_id, "draft id")})
    if not draft:
        raise HTTPException(status_code=404, detail="Product draft not found")
    roles = set(actor.get("roles") or [])
    if admin_only and not ({"owner", "admin"} & roles):
        raise HTTPException(status_code=403, detail="Admin approval is required")
    if not ({"owner", "admin"} & roles):
        seller = actor.get("_seller") or await database.sellers.find_one(
            {"user_id": actor["_id"]}, {"_id": 1}
        )
        if not seller or seller["_id"] != draft.get("seller_id"):
            raise HTTPException(status_code=403, detail="Draft belongs to another seller")
    return draft


def _draft_payload(document: Dict[str, Any]) -> ProductDraftCreate:
    return ProductDraftCreate.model_validate(
        {
            "seller_id": str(document["seller_id"]),
            "brand_id": str(document["brand_id"]),
            "title": document["title"],
            "description": document["description"],
            "category_key": document["category_key"],
            "product_type_key": document["product_type_key"],
            "gender_keys": document.get("gender_keys") or [],
            "metadata": document.get("metadata") or {},
            "media": document.get("media") or [],
            "offer": document["offer"],
        }
    )


async def revalidate_draft(database, draft: Dict[str, Any]) -> Tuple[Any, ProductDraftCreate]:
    seller = await database.sellers.find_one(
        {"_id": draft["seller_id"], "status": "approved"}
    )
    if not seller:
        raise HTTPException(status_code=422, detail="Draft seller is not approved")
    payload = _draft_payload(draft)
    await validate_draft_payload(database, seller, payload)
    return seller, payload


def _fit_bounds(variants: List[Dict[str, Any]]) -> Dict[str, Any]:
    applicable = [variant["fitRange"] for variant in variants if variant["fitRange"]["applicable"]]
    if not applicable:
        return {
            "applicable": False,
            "minHeightCm": None,
            "maxHeightCm": None,
            "minWeightKg": None,
            "maxWeightKg": None,
        }
    return {
        "applicable": True,
        "minHeightCm": min(item["minHeightCm"] for item in applicable),
        "maxHeightCm": max(item["maxHeightCm"] for item in applicable),
        "minWeightKg": min(item["minWeightKg"] for item in applicable),
        "maxWeightKg": max(item["maxWeightKg"] for item in applicable),
    }


def _age_bounds(variants: List[Dict[str, Any]]) -> Dict[str, Any]:
    applicable = [
        variant["ageRange"]
        for variant in variants
        if (variant.get("ageRange") or {}).get("applicable")
    ]
    if not applicable:
        return {"applicable": False, "minAge": None, "maxAge": None}
    return {
        "applicable": True,
        "minAge": min(item["minAge"] for item in applicable),
        "maxAge": max(item["maxAge"] for item in applicable),
    }


async def publish_draft(database, draft: Dict[str, Any], actor) -> Dict[str, Any]:
    seller, payload = await revalidate_draft(database, draft)
    now = utcnow()
    draft_id = draft["_id"]
    source = draft.get("source") or "manual_seller"
    source_product_id = f"draft:{draft_id}"
    media = draft.get("media") or []
    offer_input = payload.offer
    color_ids = list({_oid(item.color_id, "colorId") for item in offer_input.variants})
    colors = await database.colors.find({"_id": {"$in": color_ids}}).to_list(length=250)
    color_map = {color["_id"]: color for color in colors}

    variants = []
    for item in offer_input.variants:
        fit = item.fit_range.model_dump(mode="json", by_alias=True)
        age = item.age_range.model_dump(mode="json", by_alias=True)
        variants.append(
            {
                "id": item.id,
                "sku": item.sku,
                "sizeKey": item.size_key,
                "color_id": _oid(item.color_id, "colorId"),
                "measurements": item.measurements,
                "fitRange": fit,
                "ageRange": age,
                "attributes": item.attributes,
                "source": "seller_confirmed",
            }
        )
    inventory = [
        {
            "variantId": item.variant_id,
            "location_id": _oid(item.location_id, "locationId"),
            "availableQty": item.available_qty,
            "active": item.active,
            "source": "seller_confirmed",
        }
        for item in offer_input.inventory
    ]
    location_ids = list({item["location_id"] for item in inventory})
    available_color_family_keys = sorted(
        {
            family
            for color in colors
            for family in (color.get("family_keys") or [])
        }
    )
    palette = [
        {
            "color_id": color["_id"],
            "hex": color.get("hex"),
            "families": color.get("family_keys") or [],
            "confidence": 1,
            "source": "seller_confirmed",
        }
        for color in colors
    ]
    metadata_text = " ".join(
        str(item) for values in (draft.get("metadata") or {}).values() for item in (values if isinstance(values, list) else [values])
    )
    product_document = {
        "source": source,
        "source_product_id": source_product_id,
        "source_url": None,
        "brand_id": draft["brand_id"],
        "title": draft["title"],
        "normalized_title": draft["title"].casefold().strip(),
        "slug": f"{_slug(draft['title'])}-{str(draft_id)[-8:]}",
        "description": draft["description"],
        "status": "active",
        "visibility": "public",
        "category_key": draft["category_key"],
        "product_type_key": draft["product_type_key"],
        "gender_keys": draft.get("gender_keys") or [],
        "metadata": draft.get("metadata") or {},
        "media": media,
        "cover_image_url": str(media[0]["url"]) if media else None,
        "color_palette": palette,
        "rating": {"average": 0, "count": 0, "breakdown": {}},
        "source_details": {},
        "search_text": " ".join(
            [draft["title"], draft["description"], draft["category_key"], draft["product_type_key"], metadata_text]
        ),
        "simulation_mode": False,
        "catalogue_eligible": any(
            item.get("active") is True and int(item.get("availableQty", 0)) > 0
            for item in inventory
        ),
        "catalogue_min_price_paise": offer_input.sale_price_paise,
        "created_by_user_id": draft.get("created_by_user_id"),
        "system_metadata": {"workflow": {"draftId": str(draft_id)}},
        "updated_at": now,
    }
    product_update = {
        "$set": product_document,
        "$setOnInsert": {"created_at": now},
    }
    client = database.client
    async with await client.start_session() as session:
        async with session.start_transaction():
            product = await database.products.find_one_and_update(
                {"source": source, "source_product_id": source_product_id},
                product_update,
                upsert=True,
                return_document=ReturnDocument.AFTER,
                session=session,
            )
            mrp = offer_input.mrp_paise
            sale = offer_input.sale_price_paise
            offer_document = {
                "product_id": product["_id"],
                "seller_id": seller["_id"],
                "brand_id": draft["brand_id"],
                "offer_code": f"MANUAL-{str(draft_id).upper()}",
                "status": "active",
                "currency": offer_input.currency,
                "mrp_paise": mrp,
                "sale_price_paise": sale,
                "discount_percent": round((mrp - sale) * 100 / mrp, 2) if mrp else 0,
                "offer_details": offer_input.offer_details,
                "variants": variants,
                "inventory": inventory,
                "fit_bounds": _fit_bounds(variants),
                "age_bounds": _age_bounds(variants),
                "available_size_keys": sorted({item["sizeKey"] for item in variants}),
                "available_color_ids": color_ids,
                "available_color_family_keys": available_color_family_keys,
                "location_ids": location_ids,
                "simulation_mode": False,
                "created_by_user_id": draft.get("created_by_user_id"),
                "metadata": offer_input.metadata,
                "updated_at": now,
            }
            offer = await database.seller_offers.find_one_and_update(
                {"offer_code": offer_document["offer_code"]},
                {"$set": offer_document, "$setOnInsert": {"created_at": now}},
                upsert=True,
                return_document=ReturnDocument.AFTER,
                session=session,
            )
            await database.product_drafts.update_one(
                {"_id": draft_id, "status": "pending_review"},
                {
                    "$set": {
                        "status": "approved",
                        "published_product_id": product["_id"],
                        "published_offer_id": offer["_id"],
                        "reviewed_by_user_id": actor["_id"],
                        "reviewed_at": now,
                        "updated_at": now,
                    }
                },
                session=session,
            )
            await write_audit(
                database,
                action="product_draft_approved",
                entity_type="product_draft",
                entity_id=str(draft_id),
                actor=actor,
                changes={"productId": str(product["_id"]), "offerId": str(offer["_id"])},
                session=session,
            )
    return {
        "draftId": str(draft_id),
        "status": "approved",
        "productId": str(product["_id"]),
        "offerId": str(offer["_id"]),
        "productSlug": product["slug"],
    }
