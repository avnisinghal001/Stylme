import hashlib
from datetime import datetime, timedelta, timezone

from app.core.serialization import mongo_json
from app.services.metadata_service import taxonomy_contract


class FilterService:
    async def get_filters(self, database):
        schema_version, allowed_hash, fields = await taxonomy_contract(database)
        catalogue = await database.app_configs.find_one({"key": "catalogue"}) or {}
        catalogue_revision = int((catalogue.get("value") or {}).get("revision", 1))
        cache_key = hashlib.sha256(
            f"public-filters-v2:{schema_version}:{catalogue_revision}".encode("utf-8")
        ).hexdigest()
        now = datetime.now(timezone.utc)
        cached = await database.available_filter_cache.find_one(
            {"cache_key": cache_key, "expires_at": {"$gt": now}}
        )
        if cached:
            return mongo_json(cached["payload"])
        brands = await database.brands.find(
            {"status": "active"}, {"name": 1, "slug": 1}
        ).sort("name", 1).to_list(length=5000)
        colors = await database.colors.find(
            {"status": "active"},
            {"key": 1, "name": 1, "hex": 1, "family_keys": 1},
        ).sort("name", 1).to_list(length=500)
        price_rows = await database.seller_offers.aggregate(
            [
                {"$match": {"status": "active", "sale_price_paise": {"$gte": 0}}},
                {
                    "$group": {
                        "_id": None,
                        "minimum": {"$min": "$sale_price_paise"},
                        "maximum": {"$max": "$sale_price_paise"},
                    }
                },
            ]
        ).to_list(length=1)
        prices = price_rows[0] if price_rows else {"minimum": 0, "maximum": 100_000}
        expires_at = now + timedelta(minutes=5)
        field_map = {field["key"]: field for field in fields}
        payload = {
                "schemaVersion": schema_version,
                "allowedFiltersHash": allowed_hash,
                "generatedAt": now,
                "expiresAt": expires_at,
                "fields": fields,
                "categories": (field_map.get("category") or {}).get("options") or [],
                "productTypes": (field_map.get("product_type") or {}).get("options") or [],
                "sizes": (field_map.get("size") or {}).get("options") or [],
                "brands": [
                    {"id": item["_id"], "name": item.get("name"), "slug": item.get("slug")}
                    for item in brands
                ],
                "colors": [
                    {
                        "id": item["_id"],
                        "key": item.get("key"),
                        "name": item.get("name"),
                        "hex": item.get("hex"),
                        "familyKeys": item.get("family_keys") or [],
                    }
                    for item in colors
                ],
                "priceBounds": {
                    "min": int(prices.get("minimum") or 0) // 100,
                    "max": max(1, int(prices.get("maximum") or 100_000) // 100),
                },
            }
        await database.available_filter_cache.update_one(
            {"cache_key": cache_key},
            {
                "$set": {
                    "context": {"scope": "public", "catalogueRevision": catalogue_revision},
                    "metadata_schema_version": schema_version,
                    "catalogue_revision": catalogue_revision,
                    "payload": payload,
                    "metadata": {"source": "api"},
                    "generated_at": now,
                    "expires_at": expires_at,
                }
            },
            upsert=True,
        )
        return mongo_json(payload)


filter_service = FilterService()
