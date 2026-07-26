from __future__ import annotations

import hmac
import re
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from app.core.config import settings
from app.database.connection import get_database


router = APIRouter(prefix="/internal/voice", tags=["Voice runtime"])


class VoiceOrderLookup(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    order_number: str = Field(alias="orderNumber", min_length=2, max_length=80)
    phone_last4: str = Field(alias="phoneLast4", pattern=r"^[0-9]{4}$")


def phone_suffix_matches(phone: Any, suffix: str) -> bool:
    digits = re.sub(r"\D", "", str(phone or ""))
    return bool(digits and len(suffix) == 4 and suffix.isdigit() and digits[-4:] == suffix)


def voice_order_public(order: dict[str, Any]) -> dict[str, Any]:
    """Return only fields safe to read aloud after identity verification."""
    metadata = order.get("metadata") or {}
    result: dict[str, Any] = {
        "orderNumber": order.get("order_number"),
        "status": order.get("status"),
        "paymentStatus": order.get("payment_status")
        or metadata.get("paymentStatus")
        or metadata.get("payment_status"),
        "itemCount": order.get("item_count", len(order.get("items") or [])),
    }
    safe_metadata = {
        "shipmentStatus": ("shipmentStatus", "shipment_status"),
        "estimatedDeliveryAt": ("estimatedDeliveryAt", "estimated_delivery_at"),
        "refundStatus": ("refundStatus", "refund_status"),
        "canCancel": ("canCancel", "can_cancel"),
        "returnEligible": ("returnEligible", "return_eligible"),
        "exchangeEligible": ("exchangeEligible", "exchange_eligible"),
    }
    for public_key, candidates in safe_metadata.items():
        value = next((metadata.get(key) for key in candidates if metadata.get(key) is not None), None)
        if value not in (None, ""):
            result[public_key] = value
    return result


def require_internal_key(
    x_internal_key: str | None = Header(default=None, alias="X-Internal-Key"),
) -> None:
    expected = settings.AI_INTERNAL_API_KEY or settings.CRON_SECRET or ""
    if (
        not expected
        or not x_internal_key
        or not hmac.compare_digest(expected, x_internal_key)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal credentials",
        )


@router.post("/orders/lookup", dependencies=[Depends(require_internal_key)])
async def lookup_order_for_voice(
    payload: VoiceOrderLookup,
    database=Depends(get_database),
):
    order_number = payload.order_number.strip()
    order = await database.orders.find_one({"order_number": order_number})
    if not order:
        raise HTTPException(status_code=404, detail="Order could not be verified")

    user = None
    if order.get("user_id") is not None:
        user = await database.users.find_one(
            {"_id": order["user_id"]}, {"phone_e164": 1}
        )
    shipping = order.get("shipping_address") or {}
    candidate_phones = [
        (user or {}).get("phone_e164"),
        shipping.get("phone_e164"),
        shipping.get("phone"),
    ]
    if not any(
        phone_suffix_matches(phone, payload.phone_last4) for phone in candidate_phones
    ):
        raise HTTPException(status_code=404, detail="Order could not be verified")
    return voice_order_public(order)
