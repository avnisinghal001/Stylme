from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.database.connection import get_database
from app.services.product_service import (
    get_public_product,
    list_public_products,
    related_public_products,
)


router = APIRouter(prefix="/products", tags=["Products"])


@router.get("")
async def get_products(
    response: Response,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=24, ge=1, le=100),
    page_size: Optional[int] = Query(default=None, ge=1, le=100, alias="pageSize"),
    search: Optional[str] = Query(default=None, max_length=100),
    category: Optional[List[str]] = Query(default=None),
    product_type: Optional[List[str]] = Query(default=None, alias="productType"),
    brand_id: Optional[str] = Query(default=None, alias="brandId"),
    brand: Optional[List[str]] = Query(default=None),
    colour: Optional[List[str]] = Query(default=None),
    size: Optional[List[str]] = Query(default=None),
    gender: Optional[List[str]] = Query(default=None),
    meta: Optional[List[str]] = Query(default=None),
    min_price: Optional[float] = Query(default=None, ge=0, alias="min_price"),
    max_price: Optional[float] = Query(default=None, ge=0, alias="max_price"),
    min_price_paise: Optional[int] = Query(default=None, ge=0, alias="minPricePaise"),
    max_price_paise: Optional[int] = Query(default=None, ge=0, alias="maxPricePaise"),
    min_age: Optional[float] = Query(default=None, ge=0, le=110, alias="minAge"),
    max_age: Optional[float] = Query(default=None, ge=0, le=110, alias="maxAge"),
    min_height_cm: Optional[float] = Query(default=None, ge=40, le=260, alias="minHeightCm"),
    max_height_cm: Optional[float] = Query(default=None, ge=40, le=260, alias="maxHeightCm"),
    min_weight_kg: Optional[float] = Query(default=None, ge=2, le=400, alias="minWeightKg"),
    max_weight_kg: Optional[float] = Query(default=None, ge=2, le=400, alias="maxWeightKg"),
    sort_by: str = Query(default="createdAt", alias="sort_by", max_length=40),
    sort: Optional[str] = Query(default=None, max_length=40),
    order: str = Query(default="desc", pattern=r"^(?:asc|desc)$"),
    pincode: Optional[str] = Query(default=None, pattern=r"^[1-9][0-9]{5}$"),
    swoopstyl: bool = Query(default=False),
    radius_km: float = Query(default=100, ge=1, le=250, alias="radiusKm"),
    database=Depends(get_database),
):
    response.headers["Cache-Control"] = (
        "public, s-maxage=30, stale-while-revalidate=120"
    )
    resolved_page_size = page_size or limit
    resolved_min = min_price_paise if min_price_paise is not None else (round(min_price * 100) if min_price is not None else None)
    resolved_max = max_price_paise if max_price_paise is not None else (round(max_price * 100) if max_price is not None else None)
    if resolved_min is not None and resolved_max is not None and resolved_min > resolved_max:
        raise HTTPException(status_code=422, detail="Minimum price cannot exceed maximum price")
    for label, low, high in (
        ("age", min_age, max_age),
        ("height", min_height_cm, max_height_cm),
        ("weight", min_weight_kg, max_weight_kg),
    ):
        if low is not None and high is not None and low > high:
            raise HTTPException(status_code=422, detail=f"Minimum {label} cannot exceed maximum {label}")
    return await list_public_products(
        database,
        page=page,
        page_size=resolved_page_size,
        search=search,
        category=category or [],
        product_type=product_type or [],
        brand_id=brand_id,
        brand=brand or [],
        colour=colour or [],
        size=size or [],
        gender=gender or [],
        metadata_filters=meta or [],
        min_price_paise=resolved_min,
        max_price_paise=resolved_max,
        min_age=min_age,
        max_age=max_age,
        min_height_cm=min_height_cm,
        max_height_cm=max_height_cm,
        min_weight_kg=min_weight_kg,
        max_weight_kg=max_weight_kg,
        sort_by=sort or sort_by,
        order=order,
        pincode=pincode,
        swoopstyl=swoopstyl,
        radius_km=radius_km,
    )


@router.get("/{slug_or_id}/related")
async def related_products(
    slug_or_id: str,
    response: Response,
    limit: int = Query(default=8, ge=1, le=24),
    database=Depends(get_database),
):
    response.headers["Cache-Control"] = (
        "public, s-maxage=300, stale-while-revalidate=1800"
    )
    return await related_public_products(database, slug_or_id, limit)


@router.get("/{slug_or_id}")
async def get_product(
    slug_or_id: str,
    response: Response,
    database=Depends(get_database),
):
    response.headers["Cache-Control"] = (
        "public, s-maxage=60, stale-while-revalidate=300"
    )
    product = await get_public_product(database, slug_or_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product
