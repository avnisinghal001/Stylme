from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict

from bson import ObjectId
from fastapi import HTTPException
from pymongo import ReturnDocument

from app.core.serialization import mongo_json
from app.services.checkout_activity_service import capture_cart_activity


def _oid(value: str, label: str) -> ObjectId:
    if not ObjectId.is_valid(value):
        raise HTTPException(status_code=422, detail=f"Invalid {label}")
    return ObjectId(value)


def _stock_for_variant(offer: Dict[str, Any], variant_id: str) -> int:
    return sum(
        max(0, int(item.get("availableQty", 0)))
        for item in offer.get("inventory") or []
        if item.get("variantId") == variant_id and item.get("active") is True
    )


async def _validated_selection(database, offer_id: str, variant_id: str):
    offer = await database.seller_offers.find_one(
        {"_id": _oid(offer_id, "offerId"), "status": "active"}
    )
    if not offer:
        raise HTTPException(status_code=404, detail="Offer is unavailable")
    variant = next(
        (item for item in offer.get("variants") or [] if item.get("id") == variant_id),
        None,
    )
    if not variant:
        raise HTTPException(status_code=422, detail="The selected variant does not belong to this offer")
    if _stock_for_variant(offer, variant_id) < 1:
        raise HTTPException(status_code=409, detail="The selected variant is out of stock")
    product = await database.products.find_one(
        {"_id": offer["product_id"], "status": "active", "visibility": "public"}
    )
    seller = await database.sellers.find_one(
        {"_id": offer["seller_id"], "status": "approved"}
    )
    if not product or not seller:
        raise HTTPException(status_code=409, detail="This product is no longer purchasable")
    return offer, variant, product, seller


async def add_cart_item(database, user, payload):
    offer, variant, _, _ = await _validated_selection(
        database, payload.offer_id, payload.variant_id
    )
    now = datetime.now(timezone.utc)
    cart = await database.carts.find_one({"user_id": user["_id"]}) or {"items": []}
    existing = next(
        (
            item for item in cart.get("items") or []
            if item.get("offer_id") == offer["_id"] and item.get("variant_id") == variant["id"]
        ),
        None,
    )
    next_quantity = payload.quantity + (int(existing.get("quantity", 0)) if existing else 0)
    if next_quantity > 10:
        raise HTTPException(status_code=422, detail="A cart variant is limited to 10 units")
    if next_quantity > _stock_for_variant(offer, variant["id"]):
        raise HTTPException(status_code=409, detail="Requested quantity exceeds live variant stock")
    if existing:
        await database.carts.update_one(
            {
                "user_id": user["_id"],
                "items": {"$elemMatch": {"offer_id": offer["_id"], "variant_id": variant["id"]}},
            },
            {"$set": {"items.$.quantity": next_quantity, "items.$.updated_at": now, "updated_at": now}},
        )
    else:
        await database.carts.update_one(
            {"user_id": user["_id"]},
            {
                "$setOnInsert": {"created_at": now, "metadata": {}},
                "$set": {"updated_at": now},
                "$push": {
                    "items": {
                        "offer_id": offer["_id"],
                        "product_id": offer["product_id"],
                        "variant_id": variant["id"],
                        "quantity": payload.quantity,
                        "added_at": now,
                        "updated_at": now,
                    }
                },
            },
            upsert=True,
        )
    public_cart = await get_cart(database, user)
    await capture_cart_activity(database, user, public_cart, "item_added")
    return public_cart


async def set_cart_quantity(database, user, offer_id: str, variant_id: str, quantity: int):
    offer, variant, _, _ = await _validated_selection(database, offer_id, variant_id)
    if quantity > _stock_for_variant(offer, variant_id):
        raise HTTPException(status_code=409, detail="Requested quantity exceeds live variant stock")
    updated = await database.carts.find_one_and_update(
        {
            "user_id": user["_id"],
            "items": {"$elemMatch": {"offer_id": offer["_id"], "variant_id": variant["id"]}},
        },
        {"$set": {"items.$.quantity": quantity, "items.$.updated_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc)}},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Cart item not found")
    public_cart = await get_cart(database, user)
    await capture_cart_activity(database, user, public_cart, "quantity_changed")
    return public_cart


async def remove_cart_item(database, user, offer_id: str, variant_id: str):
    offer_object_id = _oid(offer_id, "offerId")
    updated = await database.carts.find_one_and_update(
        {"user_id": user["_id"]},
        {"$pull": {"items": {"offer_id": offer_object_id, "variant_id": variant_id}}, "$set": {"updated_at": datetime.now(timezone.utc)}},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Cart not found")
    public_cart = await get_cart(database, user)
    await capture_cart_activity(database, user, public_cart, "item_removed")
    return public_cart


async def get_cart(database, user):
    cart = await database.carts.find_one({"user_id": user["_id"]}) or {"items": []}
    public_items = []
    subtotal = 0
    for item in cart.get("items") or []:
        offer = await database.seller_offers.find_one({"_id": item.get("offer_id"), "status": "active"})
        if not offer:
            continue
        variant = next((value for value in offer.get("variants") or [] if value.get("id") == item.get("variant_id")), None)
        product = await database.products.find_one({"_id": offer.get("product_id"), "status": "active"})
        if not variant or not product:
            continue
        color = await database.colors.find_one({"_id": variant.get("color_id")}, {"name": 1, "hex": 1, "family_keys": 1})
        quantity = min(int(item.get("quantity", 1)), max(0, _stock_for_variant(offer, variant["id"])))
        line_total = int(offer.get("sale_price_paise", 0)) * quantity
        subtotal += line_total
        public_items.append(
            {
                "key": f"{offer['_id']}:{variant['id']}",
                "offerId": offer["_id"],
                "productId": product["_id"],
                "variantId": variant["id"],
                "slug": product.get("slug"),
                "title": product.get("title"),
                "imageUrl": product.get("cover_image_url"),
                "sizeKey": variant.get("sizeKey"),
                "color": {"name": (color or {}).get("name"), "hex": (color or {}).get("hex"), "familyKeys": (color or {}).get("family_keys") or []},
                "quantity": quantity,
                "availableQty": _stock_for_variant(offer, variant["id"]),
                "pricePaise": int(offer.get("sale_price_paise", 0)),
                "lineTotalPaise": line_total,
            }
        )
    return mongo_json({"items": public_items, "itemCount": sum(item["quantity"] for item in public_items), "subtotalPaise": subtotal, "updatedAt": cart.get("updated_at")})
