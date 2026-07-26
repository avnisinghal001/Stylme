from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo import ReturnDocument

from app.api.deps import require_approved_seller, require_roles
from app.core.serialization import mongo_json
from app.database.connection import get_database
from app.schemas.product import ProductDraftCreate, ProductDraftUpdate, ProductReviewDecision
from app.services.audit_service import write_audit
from app.services.metadata_service import taxonomy_contract
from app.services.product_draft_service import (
    assert_draft_access,
    draft_public,
    publish_draft,
    revalidate_draft,
    seller_for_actor,
    validate_draft_payload,
)
from app.services.product_service import public_product


router = APIRouter(tags=["Product drafts"])


@router.get("/managed-products")
async def list_managed_products(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=100, alias="pageSize"),
    actor=Depends(require_approved_seller),
    database=Depends(get_database),
):
    """Published catalogue rows scoped through seller offer ownership."""
    roles = set(actor.get("roles") or [])
    is_marketplace_admin = bool({"owner", "admin"} & roles)
    if is_marketplace_admin:
        approved_seller_ids = await database.sellers.distinct(
            "_id", {"status": "approved"}
        )
        owned_offer_query = {"seller_id": {"$in": approved_seller_ids}}
    else:
        owned_offer_query = {}
        owned_offer_query["seller_id"] = actor["_seller"]["_id"]

    ownership_rows = await database.seller_offers.aggregate(
        [
            {"$match": owned_offer_query},
            {"$project": {"product_id": 1, "updated_at": 1}},
            {"$sort": {"updated_at": -1, "_id": -1}},
            {
                "$group": {
                    "_id": "$product_id",
                    "updatedAt": {"$first": "$updated_at"},
                }
            },
            {"$sort": {"updatedAt": -1, "_id": -1}},
            {
                "$facet": {
                    "items": [
                        {"$skip": (page - 1) * page_size},
                        {"$limit": page_size},
                    ],
                    "count": [{"$count": "value"}],
                }
            },
        ],
        allowDiskUse=True,
    ).to_list(length=1)
    ownership_bucket = ownership_rows[0] if ownership_rows else {"items": [], "count": []}
    product_ids = [item["_id"] for item in ownership_bucket.get("items") or []]
    count_rows = ownership_bucket.get("count") or []
    total = count_rows[0]["value"] if count_rows else 0

    offer_match = {"$expr": {"$eq": ["$product_id", "$$productId"]}, **owned_offer_query}
    product_pipeline = [
        {"$match": {"_id": {"$in": product_ids}, "status": {"$ne": "deleted"}}},
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
                    {"$match": offer_match},
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
    rows = await database.products.aggregate(product_pipeline).to_list(length=page_size)
    row_map = {row["_id"]: row for row in rows}
    items = []
    for product_id in product_ids:
        row = row_map.get(product_id)
        if not row:
            continue
        item = public_product(row)
        item["description"] = row.get("description")
        item["status"] = "approved" if row.get("status") == "active" else row.get("status")
        items.append(item)
    return {
        "items": items,
        "page": page,
        "pageSize": page_size,
        "total": total,
        "scope": "all" if is_marketplace_admin else "seller",
    }


@router.post("/product-drafts", status_code=201)
async def create_product_draft(
    payload: ProductDraftCreate,
    actor=Depends(require_approved_seller),
    database=Depends(get_database),
):
    seller = await seller_for_actor(database, actor, payload.seller_id)
    values = await validate_draft_payload(database, seller, payload)
    now = datetime.now(timezone.utc)
    document = {
        **values,
        "source": (
            "manual_admin"
            if set(actor.get("roles") or []) & {"owner", "admin"}
            else "manual_seller"
        ),
        "status": "draft",
        "rejection_reason": None,
        "ai_proposal": None,
        "created_by_user_id": actor["_id"],
        "created_at": now,
        "updated_at": now,
    }
    result = await database.product_drafts.insert_one(document)
    document["_id"] = result.inserted_id
    await write_audit(
        database,
        action="product_draft_created",
        entity_type="product_draft",
        entity_id=str(result.inserted_id),
        actor=actor,
    )
    return draft_public(document)


@router.get("/product-drafts")
async def list_product_drafts(
    draft_status: Optional[str] = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100, alias="pageSize"),
    actor=Depends(require_approved_seller),
    database=Depends(get_database),
):
    roles = set(actor.get("roles") or [])
    query = {}
    if not ({"owner", "admin"} & roles):
        seller = actor.get("_seller")
        query["seller_id"] = seller["_id"]
    if draft_status:
        query["status"] = draft_status
    total = await database.product_drafts.count_documents(query)
    items = await database.product_drafts.find(query).sort("updated_at", -1).skip(
        (page - 1) * page_size
    ).limit(page_size).to_list(length=page_size)
    return {
        "items": [draft_public(item) for item in items],
        "page": page,
        "pageSize": page_size,
        "total": total,
    }


@router.get("/product-drafts/options")
async def product_draft_options(
    seller_id: Optional[str] = Query(default=None, alias="sellerId"),
    actor=Depends(require_approved_seller),
    database=Depends(get_database),
):
    roles = set(actor.get("roles") or [])
    seller_query = {"status": "approved"}
    if {"owner", "admin"} & roles:
        if seller_id:
            from app.api.deps import object_id

            seller_query["_id"] = object_id(seller_id, "sellerId")
    else:
        seller_query["_id"] = actor["_seller"]["_id"]
    sellers = await database.sellers.find(
        seller_query,
        {"display_name": 1, "slug": 1, "brand_ids": 1},
    ).sort("display_name", 1).to_list(length=1000)
    accessible_seller_ids = [seller["_id"] for seller in sellers]
    brand_ids = list(
        {brand_id for seller in sellers for brand_id in seller.get("brand_ids") or []}
    )
    brands = await database.brands.find(
        {"_id": {"$in": brand_ids}, "status": "active"},
        {"name": 1, "slug": 1},
    ).sort("name", 1).to_list(length=5000)
    locations = await database.seller_locations.find(
        {"seller_id": {"$in": accessible_seller_ids}, "status": "active"},
        {"seller_id": 1, "name": 1, "pincode": 1, "geocode_resolved": 1, "swoopstyl_enabled": 1},
    ).sort("name", 1).to_list(length=5000)
    colors = await database.colors.find(
        {"status": "active"},
        {"key": 1, "name": 1, "hex": 1, "family_keys": 1},
    ).sort("name", 1).to_list(length=500)
    schema_version, allowed_hash, fields = await taxonomy_contract(database)
    return mongo_json(
        {
            "sellers": [
                {
                    "id": seller["_id"],
                    "displayName": seller.get("display_name"),
                    "slug": seller.get("slug"),
                    "brandIds": seller.get("brand_ids") or [],
                }
                for seller in sellers
            ],
            "brands": [
                {"id": brand["_id"], "name": brand.get("name"), "slug": brand.get("slug")}
                for brand in brands
            ],
            "locations": [
                {
                    "id": location["_id"],
                    "sellerId": location.get("seller_id"),
                    "name": location.get("name"),
                    "pincode": location.get("pincode"),
                    "geocodeResolved": location.get("geocode_resolved", False),
                    "swoopstylEnabled": location.get("swoopstyl_enabled", False),
                }
                for location in locations
            ],
            "colors": [
                {
                    "id": color["_id"],
                    "key": color.get("key"),
                    "name": color.get("name"),
                    "hex": color.get("hex"),
                    "familyKeys": color.get("family_keys") or [],
                }
                for color in colors
            ],
            "metadata": {
                "schemaVersion": schema_version,
                "allowedFiltersHash": allowed_hash,
                "fields": fields,
            },
        }
    )


@router.get("/product-drafts/{draft_id}")
async def get_product_draft(
    draft_id: str,
    actor=Depends(require_approved_seller),
    database=Depends(get_database),
):
    return draft_public(await assert_draft_access(database, draft_id, actor))


@router.patch("/product-drafts/{draft_id}")
async def update_product_draft(
    draft_id: str,
    payload: ProductDraftUpdate,
    actor=Depends(require_approved_seller),
    database=Depends(get_database),
):
    draft = await assert_draft_access(database, draft_id, actor)
    if draft.get("status") not in {"draft", "rejected"}:
        raise HTTPException(status_code=409, detail="Only draft/rejected products can be edited")
    updates = payload.model_dump(mode="json", by_alias=False, exclude_unset=True)
    merged = {**draft, **updates, "seller_id": draft["seller_id"]}
    candidate = ProductDraftCreate.model_validate(
        {
            "seller_id": str(merged["seller_id"]),
            "brand_id": str(merged["brand_id"]),
            "title": merged["title"],
            "description": merged["description"],
            "category_key": merged["category_key"],
            "product_type_key": merged["product_type_key"],
            "gender_keys": merged.get("gender_keys") or [],
            "metadata": merged.get("metadata") or {},
            "media": merged.get("media") or [],
            "offer": merged["offer"],
        }
    )
    seller = await seller_for_actor(database, actor, str(draft["seller_id"]))
    clean = await validate_draft_payload(database, seller, candidate)
    now = datetime.now(timezone.utc)
    updated = await database.product_drafts.find_one_and_update(
        {"_id": draft["_id"], "status": {"$in": ["draft", "rejected"]}},
        {"$set": {**clean, "status": "draft", "rejection_reason": None, "updated_at": now}},
        return_document=ReturnDocument.AFTER,
    )
    await write_audit(
        database,
        action="product_draft_updated",
        entity_type="product_draft",
        entity_id=draft_id,
        actor=actor,
        changes={"fields": sorted(updates)},
    )
    return draft_public(updated)


@router.post("/product-drafts/{draft_id}/submit")
async def submit_product_draft(
    draft_id: str,
    actor=Depends(require_approved_seller),
    database=Depends(get_database),
):
    draft = await assert_draft_access(database, draft_id, actor)
    if draft.get("status") not in {"draft", "rejected"}:
        raise HTTPException(status_code=409, detail="Draft has already been submitted")
    await revalidate_draft(database, draft)
    now = datetime.now(timezone.utc)
    updated = await database.product_drafts.find_one_and_update(
        {"_id": draft["_id"], "status": {"$in": ["draft", "rejected"]}},
        {
            "$set": {
                "status": "pending_review",
                "rejection_reason": None,
                "submitted_at": now,
                "updated_at": now,
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    await write_audit(
        database,
        action="product_draft_submitted",
        entity_type="product_draft",
        entity_id=draft_id,
        actor=actor,
    )
    return draft_public(updated)


@router.patch("/admin/product-drafts/{draft_id}/decision")
async def review_product_draft(
    draft_id: str,
    payload: ProductReviewDecision,
    actor=Depends(require_roles("admin")),
    database=Depends(get_database),
):
    draft = await assert_draft_access(database, draft_id, actor, admin_only=True)
    if draft.get("status") != "pending_review":
        raise HTTPException(status_code=409, detail="Draft is not pending review")
    if payload.decision == "approved":
        return await publish_draft(database, draft, actor)
    now = datetime.now(timezone.utc)
    updated = await database.product_drafts.find_one_and_update(
        {"_id": draft["_id"], "status": "pending_review"},
        {
            "$set": {
                "status": "rejected",
                "rejection_reason": payload.reason,
                "reviewed_by_user_id": actor["_id"],
                "reviewed_at": now,
                "updated_at": now,
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    await write_audit(
        database,
        action="product_draft_rejected",
        entity_type="product_draft",
        entity_id=draft_id,
        actor=actor,
        changes={"reason": payload.reason},
    )
    return draft_public(updated)
