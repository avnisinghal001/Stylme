from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.api.deps import get_current_user, object_id, require_roles
from app.core.security import hash_password
from app.core.serialization import mongo_json, public_user
from app.core.text import normalize_name, slugify
from app.database.connection import get_database
from app.schemas.seller import SellerApplicationCreate, SellerDecisionRequest
from app.services.audit_service import write_audit
from app.services.product_service import refresh_catalogue_projection_for_products


router = APIRouter(tags=["Sellers"])


def _slug(value: str) -> str:
    return slugify(value, 70) or "seller"


async def _resolve_application_brand(database, name, user_id, now):
    normalized = normalize_name(name)
    existing = await database.brands.find_one({"normalized_name": normalized})
    if existing:
        return existing, False
    document = {
        "name": name,
        "normalized_name": normalized,
        "slug": _slug(name),
        "aliases": [],
        "logo_url": None,
        "description": None,
        "status": "active",
        "simulation_mode": False,
        "created_by_user_id": user_id,
        "metadata": {"workflow": {"source": "seller_application"}},
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = await database.brands.insert_one(document)
    except DuplicateKeyError:
        existing = await database.brands.find_one({"normalized_name": normalized})
        if existing:
            return existing, False
        document["slug"] = f"{_slug(name)}-{str(user_id)[-6:]}"
        result = await database.brands.insert_one(document)
    document["_id"] = result.inserted_id
    return document, True


def seller_public(seller, include_private=False):
    users = seller.get("_user") or []
    user = users[0] if users else None
    locations = seller.get("_locations") or []
    brands = seller.get("_brands") or []
    result = {
        "id": seller["_id"],
        "userId": seller.get("user_id"),
        "displayName": seller.get("display_name"),
        "slug": seller.get("slug"),
        "status": seller.get("status"),
        "rejectionReason": seller.get("rejection_reason"),
        "brandIds": seller.get("brand_ids") or [],
        "approvedByUserId": seller.get("approved_by_user_id"),
        "approvedAt": seller.get("approved_at"),
        "createdAt": seller.get("created_at"),
        "updatedAt": seller.get("updated_at"),
        "user": (
            {
                "id": user.get("_id"),
                "email": user.get("email"),
                "fullName": user.get("full_name"),
                "status": user.get("status"),
            }
            if user
            else None
        ),
        "locations": [
            {
                "id": location.get("_id"),
                "name": location.get("name"),
                "pincode": location.get("pincode"),
                "status": location.get("status"),
                "geocodeResolved": location.get("geocode_resolved", False),
                "swoopstylEnabled": location.get("swoopstyl_enabled", False),
            }
            for location in locations
        ],
        "brands": [
            {"id": brand.get("_id"), "name": brand.get("name"), "slug": brand.get("slug")}
            for brand in brands
        ],
    }
    if include_private:
        result.update(
            {
                "contact": seller.get("contact") or {},
                "legalDetails": seller.get("legal_details"),
                "metadata": seller.get("metadata") or {},
            }
        )
    return mongo_json(result)


@router.post("/seller/application", status_code=201)
async def seller_application(
    payload: SellerApplicationCreate, database=Depends(get_database)
):
    email = str(payload.email).lower()
    if await database.users.find_one({"email": email}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="An account already exists for this email")
    now = datetime.now(timezone.utc)
    user_document = {
        "email": email,
        "full_name": payload.full_name,
        "password_hash": hash_password(payload.password),
        "avatar_url": None,
        "status": "active",
        "roles": ["seller"],
        "onboarding_completed": False,
        "addresses": [],
        "default_address_id": None,
        "default_pincode": None,
        "preferences": {},
        "body_profile": {
            "heightCm": None,
            "weightKg": None,
            "measurements": {},
            "consent": False,
            "updatedAt": None,
        },
        "whatsapp_opt_in": False,
        "metadata": {"auth": {"source": "seller_application"}},
        "created_at": now,
        "updated_at": now,
    }
    try:
        user_result = await database.users.insert_one(user_document)
        brand_document, _ = await _resolve_application_brand(
            database, payload.brand_name, user_result.inserted_id, now
        )
        seller_document = {
            "user_id": user_result.inserted_id,
            "display_name": payload.display_name,
            "normalized_name": payload.display_name.casefold().strip(),
            "slug": f"{_slug(payload.display_name)}-{str(user_result.inserted_id)[-6:]}",
            "legal_details": payload.legal_details,
            "contact": payload.contact,
            "status": "pending",
            "rejection_reason": None,
            "approved_by_user_id": None,
            "approved_at": None,
            "brand_ids": [brand_document["_id"]],
            "simulation_mode": False,
            "source_ref": None,
            "metadata": payload.metadata,
            "created_at": now,
            "updated_at": now,
        }
        seller_result = await database.sellers.insert_one(seller_document)
        configured_location = payload.primary_location.model_dump(mode="json", by_alias=False)
        cached_geo = await database.pincode_geos.find_one(
            {"country_code": "IN", "pincode": configured_location["pincode"], "resolved": True}
        )
        geo_point = configured_location.get("geo_point") or (
            cached_geo.get("geo_point") if cached_geo else None
        )
        place = configured_location.get("place") or (cached_geo.get("place") if cached_geo else {})
        location_document = {
            "seller_id": seller_result.inserted_id,
            "name": configured_location["name"],
            "address_line": configured_location["address_line"],
            "pincode": configured_location["pincode"],
            "place": place,
            "geo_point": geo_point,
            "geocode_resolved": bool(geo_point),
            "timezone": configured_location["timezone"],
            "daily_capacity": configured_location["daily_capacity"],
            "current_committed_load": 0,
            "capacity_date": now.date().isoformat(),
            "cutoff_local": configured_location["cutoff_local"],
            "handling_hours": configured_location["handling_hours"],
            "swoopstyl_enabled": configured_location["swoopstyl_enabled"],
            "radius_km_override": None,
            "status": "active",
            "simulation_mode": False,
            "metadata": {"workflow": {"primary": True}},
            "created_at": now,
            "updated_at": now,
        }
        location_result = await database.seller_locations.insert_one(location_document)
    except DuplicateKeyError as exc:
        if "seller_result" in locals():
            await database.seller_locations.delete_many({"seller_id": seller_result.inserted_id})
            await database.sellers.delete_one({"_id": seller_result.inserted_id})
        if "user_result" in locals():
            await database.users.delete_one({"_id": user_result.inserted_id})
        raise HTTPException(status_code=409, detail="Seller application already exists") from exc
    except Exception:
        if "seller_result" in locals():
            await database.seller_locations.delete_many({"seller_id": seller_result.inserted_id})
            await database.sellers.delete_one({"_id": seller_result.inserted_id})
        if "user_result" in locals():
            await database.users.delete_one({"_id": user_result.inserted_id})
        raise
    seller_document["_id"] = seller_result.inserted_id
    location_document["_id"] = location_result.inserted_id
    await write_audit(
        database,
        action="seller_applied",
        entity_type="seller",
        entity_id=str(seller_result.inserted_id),
        actor={**user_document, "_id": user_result.inserted_id},
    )
    return {
        "user": public_user({**user_document, "_id": user_result.inserted_id}, seller_document),
        "seller": seller_public(seller_document, include_private=True),
        "primaryLocation": mongo_json(location_document),
        "brand": mongo_json(
            {"id": brand_document["_id"], "name": brand_document["name"], "slug": brand_document["slug"]}
        ),
    }


@router.get("/seller/me")
async def seller_me(user=Depends(get_current_user), database=Depends(get_database)):
    rows = await database.sellers.aggregate(
        [
            {"$match": {"user_id": user["_id"]}},
            {"$lookup": {"from": "users", "localField": "user_id", "foreignField": "_id", "as": "_user"}},
            {"$lookup": {"from": "seller_locations", "localField": "_id", "foreignField": "seller_id", "as": "_locations"}},
            {"$lookup": {"from": "brands", "localField": "brand_ids", "foreignField": "_id", "as": "_brands"}},
            {"$limit": 1},
        ]
    ).to_list(length=1)
    if not rows:
        raise HTTPException(status_code=404, detail="Seller profile not found")
    return seller_public(rows[0], include_private=True)


@router.get("/admin/sellers")
async def admin_sellers(
    seller_status: Optional[str] = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100, alias="pageSize"),
    user=Depends(require_roles("admin")),
    database=Depends(get_database),
):
    query = {}
    if seller_status:
        if seller_status not in {"pending", "approved", "rejected", "suspended"}:
            raise HTTPException(status_code=422, detail="Invalid seller status")
        query["status"] = seller_status
    total = await database.sellers.count_documents(query)
    rows = await database.sellers.aggregate(
        [
            {"$match": query},
            {"$sort": {"created_at": -1, "_id": -1}},
            {
                "$facet": {
                    "items": [
                        {"$skip": (page - 1) * page_size},
                        {"$limit": page_size},
                        {"$lookup": {"from": "users", "localField": "user_id", "foreignField": "_id", "as": "_user"}},
                        {"$lookup": {"from": "seller_locations", "localField": "_id", "foreignField": "seller_id", "as": "_locations"}},
                        {"$lookup": {"from": "brands", "localField": "brand_ids", "foreignField": "_id", "as": "_brands"}},
                    ],
                    "count": [{"$count": "value"}],
                }
            },
        ]
    ).to_list(length=1)
    facet = rows[0] if rows else {"items": [], "count": []}
    sellers = facet["items"]
    return {
        "items": [seller_public(seller, include_private=True) for seller in sellers],
        "page": page,
        "pageSize": page_size,
        "total": total,
    }


@router.patch("/admin/sellers/{seller_id}/decision")
async def decide_seller(
    seller_id: str,
    payload: SellerDecisionRequest,
    actor=Depends(require_roles("admin")),
    database=Depends(get_database),
):
    identifier = object_id(seller_id, "seller id")
    now = datetime.now(timezone.utc)
    before = await database.sellers.find_one({"_id": identifier})
    if not before:
        raise HTTPException(status_code=404, detail="Seller not found")
    updated = await database.sellers.find_one_and_update(
        {"_id": identifier},
        {
            "$set": {
                "status": payload.decision,
                "rejection_reason": payload.reason if payload.decision == "rejected" else None,
                "approved_by_user_id": actor["_id"] if payload.decision == "approved" else None,
                "approved_at": now if payload.decision == "approved" else None,
                "updated_at": now,
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    affected_product_ids = await database.seller_offers.distinct(
        "product_id", {"seller_id": identifier}
    )
    await refresh_catalogue_projection_for_products(
        database, affected_product_ids
    )
    await write_audit(
        database,
        action=f"seller_{payload.decision}",
        entity_type="seller",
        entity_id=seller_id,
        actor=actor,
        changes={"before": before.get("status"), "after": payload.decision, "reason": payload.reason},
    )
    return seller_public(updated, include_private=True)
