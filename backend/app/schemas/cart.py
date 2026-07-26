from __future__ import annotations

from pydantic import Field

from app.schemas.base import CamelModel


class CartItemAdd(CamelModel):
    offer_id: str = Field(min_length=24, max_length=24)
    variant_id: str = Field(min_length=1, max_length=120)
    quantity: int = Field(default=1, ge=1, le=10)


class CartItemQuantity(CamelModel):
    quantity: int = Field(ge=1, le=10)

