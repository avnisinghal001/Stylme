from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.database.connection import get_database
from app.schemas.cart import CartItemAdd, CartItemQuantity
from app.services.cart_service import add_cart_item, get_cart, remove_cart_item, set_cart_quantity


router = APIRouter(prefix="/cart", tags=["Customer cart"])


@router.get("")
async def my_cart(user=Depends(get_current_user), database=Depends(get_database)):
    return await get_cart(database, user)


@router.post("/items", status_code=201)
async def add_item(payload: CartItemAdd, user=Depends(get_current_user), database=Depends(get_database)):
    return await add_cart_item(database, user, payload)


@router.patch("/items/{offer_id}/{variant_id}")
async def change_quantity(offer_id: str, variant_id: str, payload: CartItemQuantity, user=Depends(get_current_user), database=Depends(get_database)):
    return await set_cart_quantity(database, user, offer_id, variant_id, payload.quantity)


@router.delete("/items/{offer_id}/{variant_id}")
async def delete_item(offer_id: str, variant_id: str, user=Depends(get_current_user), database=Depends(get_database)):
    return await remove_cart_item(database, user, offer_id, variant_id)

