from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_current_user, object_id
from app.core.serialization import mongo_json
from app.database.connection import get_database


router = APIRouter(prefix="/orders", tags=["Customer orders"])


def order_public(order):
    return mongo_json(
        {
            "id": order.get("_id"),
            "orderNumber": order.get("order_number"),
            "status": order.get("status"),
            "currency": order.get("currency", "INR"),
            "items": order.get("items") or [],
            "itemCount": order.get("item_count", len(order.get("items") or [])),
            "subtotalPaise": order.get("subtotal_paise", 0),
            "shippingPaise": order.get("shipping_paise", 0),
            "totalPaise": order.get("total_paise", 0),
            "shippingAddress": order.get("shipping_address") or {},
            "placedAt": order.get("placed_at") or order.get("created_at"),
            "updatedAt": order.get("updated_at"),
            "metadata": order.get("metadata") or {},
        }
    )


@router.get("")
async def list_my_orders(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100, alias="pageSize"),
    user=Depends(get_current_user),
    database=Depends(get_database),
):
    query = {"user_id": user["_id"]}
    total = await database.orders.count_documents(query)
    orders = await database.orders.find(query).sort("placed_at", -1).skip(
        (page - 1) * page_size
    ).limit(page_size).to_list(length=page_size)
    return {
        "items": [order_public(order) for order in orders],
        "page": page,
        "pageSize": page_size,
        "total": total,
    }


@router.get("/{order_id}")
async def get_my_order(
    order_id: str,
    user=Depends(get_current_user),
    database=Depends(get_database),
):
    order = await database.orders.find_one(
        {"_id": object_id(order_id, "order id"), "user_id": user["_id"]}
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order_public(order)
