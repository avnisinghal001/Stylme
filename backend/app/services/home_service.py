import asyncio
from typing import Any, Dict, Optional

from app.services.product_service import (
    list_public_products,
    product_lookups,
    public_product,
)
from app.services.profile_personalization import profile_personalization


class HomeService:
    async def get_home(self, database):
        base = {
            "status": "active",
            "visibility": "public",
            "catalogue_eligible": True,
        }
        trending_pipeline = [
            {"$match": base},
            {"$sort": {"rating.average": -1, "rating.count": -1, "_id": -1}},
            {"$limit": 8},
            *product_lookups(),
        ]
        arrivals_pipeline = [
            {"$match": base},
            {"$sort": {"created_at": -1, "_id": -1}},
            {"$limit": 8},
            *product_lookups(),
        ]
        categories_pipeline = [
            {"$match": base},
            {"$group": {"_id": "$category_key", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
        ]
        trending, new_arrivals, categories = await asyncio.gather(
            database.products.aggregate(trending_pipeline).to_list(length=8),
            database.products.aggregate(arrivals_pipeline).to_list(length=8),
            database.products.aggregate(categories_pipeline).to_list(length=100),
        )
        return {
            "banners": [],
            "trending": [public_product(item) for item in trending],
            "newArrivals": [public_product(item) for item in new_arrivals],
            "categories": [
                {"key": item.get("_id"), "label": str(item.get("_id") or "Other").replace("-", " ").title(), "count": item["count"]}
                for item in categories
            ],
        }

    async def get_personalized(
        self,
        database,
        user: Dict[str, Any],
        *,
        pincode: Optional[str] = None,
        swoopstyl: bool = False,
        limit: int = 8,
    ):
        profile = profile_personalization(user)
        resolved_pincode = pincode or user.get("default_pincode")
        height_band = profile["heightBand"] or {}
        weight_band = profile["weightBand"] or {}
        page = await list_public_products(
            database,
            page=1,
            page_size=limit,
            search=None,
            category=[],
            product_type=[],
            brand_id=None,
            brand=[],
            colour=[],
            size=(user.get("preferences") or {}).get("sizeKeys") or [],
            gender=profile["genderKeys"],
            metadata_filters=[],
            min_price_paise=None,
            max_price_paise=None,
            min_age=profile["age"],
            max_age=profile["age"],
            min_height_cm=height_band.get("min"),
            max_height_cm=height_band.get("max"),
            min_weight_kg=weight_band.get("min"),
            max_weight_kg=weight_band.get("max"),
            sort_by="relevance",
            order="desc",
            pincode=resolved_pincode,
            swoopstyl=swoopstyl,
            radius_km=100,
            soft_metadata_filters=profile["softMetadata"],
        )
        page["personalization"] = {
            **profile,
            "pincode": resolved_pincode,
            "swoopStyl": swoopstyl,
            "genderMode": "profile" if profile["selectedGenderKeys"] else "wildcard",
            "rankingRule": (
                "distance-first-then-profile"
                if swoopstyl
                else "profile-signals-then-catalogue-quality"
            ),
        }
        return page


home_service = HomeService()
