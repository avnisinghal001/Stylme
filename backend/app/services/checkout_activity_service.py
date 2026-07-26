from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List

from pymongo import ReturnDocument

from app.core.config import settings
from app.core.phone import normalize_e164
from app.core.security import decrypt_secret, encrypt_secret
from app.core.serialization import mongo_json
from app.services.checkout_recovery_config_service import get_config


def new_checkout_identity() -> str:
    return f"checkout_{uuid.uuid4().hex}"


def _masked_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    return f"{phone[:3]}••••{phone[-4:]}"


def _item_snapshot(item: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "offer_id": str(item.get("offerId") or ""),
        "variant_id": str(item.get("variantId") or ""),
        "product_id": str(item.get("productId") or ""),
        "title": str(item.get("title") or "")[:200],
        "quantity": max(1, int(item.get("quantity") or 1)),
        "price_paise": max(0, int(item.get("pricePaise") or 0)),
    }


async def capture_cart_activity(database, user: Dict[str, Any], cart: Dict[str, Any], event: str):
    """Rotate the checkout event identity after every successful cart mutation."""
    now = datetime.now(timezone.utc)
    config = await get_config(database)
    inactivity = int((config.get("calling") or {}).get("inactivity_minutes", 20))
    checkout_id = new_checkout_identity()
    recovery_token = secrets.token_urlsafe(32)
    recovery_token_hash = hashlib.sha256(recovery_token.encode("utf-8")).hexdigest()
    previous = await database.checkouts.find_one(
        {"user_id": user["_id"]}, {"recovery_token_hashes": 1, "recovery_token_hash": 1}
    )
    valid_hashes = list((previous or {}).get("recovery_token_hashes") or [])
    if (previous or {}).get("recovery_token_hash"):
        valid_hashes.append(previous["recovery_token_hash"])
    valid_hashes = list(dict.fromkeys([*valid_hashes, recovery_token_hash]))[-5:]
    items = [_item_snapshot(item) for item in cart.get("items") or []]
    phone = normalize_e164(user.get("phone_e164"))
    status = "active" if items and phone else "missing_phone" if items else "empty"
    update = {
        "checkout_id": checkout_id,
        "external_id": checkout_id,
        "contact_phone": phone,
        "customer_email": user.get("email"),
        "customer_name": user.get("full_name"),
        "status": status,
        "payment_status": "unpaid",
        "items": items,
        "item_count": sum(item["quantity"] for item in items),
        "cart_value_paise": max(0, int(cart.get("subtotalPaise") or 0)),
        "currency": "INR",
        "top_item": items[0]["title"] if items else None,
        "product_titles": [item["title"] for item in items[:20]],
        "last_cart_event": event,
        "last_cart_activity_at": now,
        "eligible_at": now + timedelta(minutes=inactivity),
        "recovery_token_hash": recovery_token_hash,
        "recovery_token_hashes": valid_hashes,
        "recovery_token_encrypted": encrypt_secret(recovery_token),
        "recovery_token_expires_at": now + timedelta(days=7),
        "samora": {},
        "metadata": {"source": "cart_mutation", "inactivityMinutes": inactivity},
        "updated_at": now,
    }
    return await database.checkouts.find_one_and_update(
        {"user_id": user["_id"]},
        {
            "$set": update,
            "$setOnInsert": {"user_id": user["_id"], "created_at": now},
            "$inc": {"event_version": 1},
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )


def checkout_public(document: Dict[str, Any]) -> Dict[str, Any]:
    return mongo_json(
        {
            "id": document.get("_id"),
            "checkoutId": document.get("checkout_id"),
            "externalId": document.get("external_id"),
            "userId": document.get("user_id"),
            "contactPhone": _masked_phone(document.get("contact_phone")),
            "customerEmail": document.get("customer_email"),
            "customerName": document.get("customer_name"),
            "status": document.get("status"),
            "paymentStatus": document.get("payment_status"),
            "itemCount": document.get("item_count", 0),
            "cartValuePaise": document.get("cart_value_paise", 0),
            "currency": document.get("currency", "INR"),
            "topItem": document.get("top_item"),
            "lastCartEvent": document.get("last_cart_event"),
            "eventVersion": document.get("event_version", 0),
            "eligibleAt": document.get("eligible_at"),
            "lastCartActivityAt": document.get("last_cart_activity_at"),
            "samora": document.get("samora") or {},
            "updatedAt": document.get("updated_at"),
        }
    )


def source_row(document: Dict[str, Any]) -> Dict[str, Any]:
    token = decrypt_secret(document.get("recovery_token_encrypted"))
    storefront = settings.STOREFRONT_URL.rstrip("/")
    recovery_url = f"{storefront}/checkout/recover/{token}" if token else None
    name_parts = str(document.get("customer_name") or "").strip().split(maxsplit=1)
    first_name = name_parts[0] if name_parts else ""
    last_name = name_parts[1] if len(name_parts) > 1 else ""
    value_paise = max(0, int(document.get("cart_value_paise") or 0))
    source_items = [
        {
            "title": item.get("title"),
            "quantity": item.get("quantity"),
            "price": str((Decimal(int(item.get("price_paise") or 0)) / Decimal(100)).quantize(Decimal("0.01"))),
        }
        for item in document.get("items") or []
    ]
    return {
        "checkout_id": document.get("checkout_id"),
        "external_id": document.get("external_id"),
        "status": "abandoned",
        "updated_at": document.get("updated_at"),
        "abandoned_at": document.get("eligible_at"),
        "contact_phone": document.get("contact_phone"),
        "customer_email": document.get("customer_email"),
        "customer_name": document.get("customer_name"),
        "first_name": first_name,
        "last_name": last_name,
        "shop_name": "StylMe",
        "cart_value": str((Decimal(value_paise) / Decimal(100)).quantize(Decimal("0.01"))),
        "cart_total": f"₹{value_paise / 100:,.0f}",
        "currency": document.get("currency", "INR"),
        "item_count": document.get("item_count", 0),
        "top_item": document.get("top_item"),
        "product_titles": ", ".join(document.get("product_titles") or []),
        "recovery_url": recovery_url,
        "items": source_items,
        "_checkout_object_id": document.get("_id"),
    }


async def resolve_recovery_token(database, token: str) -> Dict[str, Any] | None:
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc)
    updated = await database.checkouts.find_one_and_update(
        {
            "$or": [
                {"recovery_token_hash": token_hash},
                {"recovery_token_hashes": token_hash},
            ],
            "recovery_token_expires_at": {"$gt": now},
            "payment_status": "unpaid",
            "item_count": {"$gt": 0},
        },
        {"$set": {"recovery_clicked_at": now}},
        return_document=ReturnDocument.AFTER,
    )
    return updated
