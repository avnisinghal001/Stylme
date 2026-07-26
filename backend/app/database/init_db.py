from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import sys

from pymongo import ASCENDING, DESCENDING, GEOSPHERE, TEXT, ReturnDocument

from app.core.config import settings
from app.database.connection import mongo_runtime


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def ensure_indexes(database) -> None:
    await database.users.create_index("email", unique=True)
    await database.users.create_index(
        "phone_e164",
        unique=True,
        partialFilterExpression={"phone_e164": {"$type": "string"}},
    )
    await database.users.create_index([("roles", ASCENDING), ("status", ASCENDING)])

    await database.sellers.create_index("user_id", unique=True)
    await database.sellers.create_index("slug", unique=True)
    await database.sellers.create_index("status")
    await database.sellers.create_index(
        [("status", ASCENDING), ("created_at", DESCENDING), ("_id", DESCENDING)],
        name="admin_sellers_status_created_v1",
    )
    await database.seller_locations.create_index([("geo_point", GEOSPHERE)])
    await database.seller_locations.create_index(
        [("seller_id", ASCENDING), ("status", ASCENDING)]
    )
    await database.seller_locations.create_index(
        [("seller_id", ASCENDING), ("status", ASCENDING), ("name", ASCENDING)],
        name="seller_locations_options_v1",
    )
    await database.pincode_geos.create_index([("geo_point", GEOSPHERE)])
    await database.pincode_geos.create_index(
        [("country_code", ASCENDING), ("pincode", ASCENDING)], unique=True
    )

    await database.brands.create_index("normalized_name", unique=True)
    await database.brands.create_index("slug", unique=True)
    await database.brands.create_index(
        [("status", ASCENDING), ("name", ASCENDING)],
        name="active_brands_name_v1",
    )
    await database.colors.create_index("key", unique=True)
    await database.colors.create_index(
        [("status", ASCENDING), ("name", ASCENDING)],
        name="active_colors_name_v1",
    )
    await database.app_configs.create_index("key", unique=True)
    await database.metadata_fields.create_index("key", unique=True)
    await database.metadata_fields.create_index(
        [("status", ASCENDING), ("frontend_visible", ASCENDING), ("sort_order", ASCENDING)]
    )

    await database.products.create_index(
        [("source", ASCENDING), ("source_product_id", ASCENDING)],
        unique=True,
        partialFilterExpression={
            "source": {"$type": "string"},
            "source_product_id": {"$type": "string"},
        },
    )
    await database.products.create_index(
        "slug",
        unique=True,
        partialFilterExpression={"slug": {"$type": "string"}},
    )
    await database.products.create_index(
        [
            ("status", ASCENDING),
            ("visibility", ASCENDING),
            ("category_key", ASCENDING),
            ("product_type_key", ASCENDING),
        ]
    )
    await database.products.create_index(
        [
            ("status", ASCENDING),
            ("visibility", ASCENDING),
            ("catalogue_eligible", ASCENDING),
            ("created_at", DESCENDING),
            ("_id", DESCENDING),
        ],
        name="catalogue_newest_v1",
    )
    await database.products.create_index(
        [
            ("status", ASCENDING),
            ("visibility", ASCENDING),
            ("catalogue_eligible", ASCENDING),
            ("rating.count", DESCENDING),
            ("rating.average", DESCENDING),
            ("_id", DESCENDING),
        ],
        name="catalogue_relevance_v1",
    )
    await database.products.create_index(
        [
            ("status", ASCENDING),
            ("visibility", ASCENDING),
            ("catalogue_eligible", ASCENDING),
            ("rating.average", DESCENDING),
            ("rating.count", DESCENDING),
            ("_id", DESCENDING),
        ],
        name="catalogue_rating_v1",
    )
    await database.products.create_index(
        [
            ("status", ASCENDING),
            ("visibility", ASCENDING),
            ("catalogue_eligible", ASCENDING),
            ("category_key", ASCENDING),
            ("rating.average", DESCENDING),
            ("rating.count", DESCENDING),
            ("_id", DESCENDING),
        ],
        name="catalogue_related_rating_v1",
    )
    await database.products.create_index(
        [
            ("status", ASCENDING),
            ("visibility", ASCENDING),
            ("catalogue_eligible", ASCENDING),
            ("catalogue_min_price_paise", ASCENDING),
            ("_id", DESCENDING),
        ],
        name="catalogue_price_v1",
    )
    await database.products.create_index(
        [
            ("status", ASCENDING),
            ("visibility", ASCENDING),
            ("catalogue_eligible", ASCENDING),
            ("category_key", ASCENDING),
            ("product_type_key", ASCENDING),
            ("created_at", DESCENDING),
            ("_id", DESCENDING),
        ],
        name="catalogue_category_type_newest_v1",
    )
    await database.products.create_index(
        [
            ("status", ASCENDING),
            ("visibility", ASCENDING),
            ("catalogue_eligible", ASCENDING),
            ("brand_id", ASCENDING),
            ("created_at", DESCENDING),
            ("_id", DESCENDING),
        ],
        name="catalogue_brand_newest_v1",
    )
    await database.products.create_index([("search_text", TEXT)])
    for field_key in (
        "aesthetic",
        "dress_code",
        "material",
        "mood",
        "occasion",
        "season",
        "style",
        "theme",
    ):
        await database.products.create_index(
            [
                ("status", ASCENDING),
                ("visibility", ASCENDING),
                (f"metadata.{field_key}", ASCENDING),
            ],
            name=f"hybrid_search_{field_key}",
        )

    await database.seller_offers.create_index("offer_code", unique=True)
    await database.seller_offers.create_index(
        [("product_id", ASCENDING), ("status", ASCENDING)]
    )
    await database.seller_offers.create_index(
        [
            ("product_id", ASCENDING),
            ("status", ASCENDING),
            ("sale_price_paise", ASCENDING),
        ],
        name="public_offer_product_price_v1",
    )
    await database.seller_offers.create_index(
        [
            ("status", ASCENDING),
            ("sale_price_paise", ASCENDING),
            ("product_id", ASCENDING),
        ],
        name="public_offer_price_product_v1",
    )
    await database.seller_offers.create_index(
        [
            ("age_bounds.applicable", ASCENDING),
            ("age_bounds.minAge", ASCENDING),
            ("age_bounds.maxAge", ASCENDING),
        ]
    )
    await database.seller_offers.create_index(
        [("seller_id", ASCENDING), ("status", ASCENDING)]
    )
    await database.seller_offers.create_index("location_ids")
    await database.seller_offers.create_index("available_size_keys")
    await database.seller_offers.create_index("available_color_ids")
    await database.seller_offers.create_index("available_color_family_keys")
    await database.seller_offers.create_index(
        [
            ("fit_bounds.applicable", ASCENDING),
            ("fit_bounds.minHeightCm", ASCENDING),
            ("fit_bounds.maxHeightCm", ASCENDING),
            ("fit_bounds.minWeightKg", ASCENDING),
            ("fit_bounds.maxWeightKg", ASCENDING),
        ]
    )

    await database.product_drafts.create_index(
        [("seller_id", ASCENDING), ("status", ASCENDING), ("updated_at", DESCENDING)]
    )
    await database.product_drafts.create_index(
        [("created_by_user_id", ASCENDING), ("updated_at", DESCENDING)]
    )
    await database.product_drafts.create_index(
        [("status", ASCENDING), ("updated_at", DESCENDING)],
        name="admin_product_drafts_status_updated_v1",
    )
    await database.ai_processing_runs.create_index(
        [("draft_id", ASCENDING), ("input_hash", ASCENDING), ("contract_version", ASCENDING)],
        unique=True,
    )
    await database.ai_processing_runs.create_index(
        [("actor_user_id", ASCENDING), ("created_at", DESCENDING)]
    )

    await database.available_filter_cache.create_index("cache_key", unique=True)
    await database.available_filter_cache.create_index(
        "expires_at", expireAfterSeconds=0
    )
    await database.audit_logs.create_index(
        [("entity_type", ASCENDING), ("entity_id", ASCENDING), ("created_at", DESCENDING)]
    )
    await database.audit_logs.create_index(
        [("entity_type", ASCENDING), ("created_at", DESCENDING)],
        name="audit_entity_created_v1",
    )
    await database.audit_logs.create_index(
        [("created_at", DESCENDING)],
        name="audit_created_v1",
    )
    await database.user_appearance_runs.create_index(
        [("user_id", ASCENDING), ("input_hash", ASCENDING), ("contract_version", ASCENDING)],
        unique=True,
    )
    await database.user_appearance_runs.create_index(
        [("user_id", ASCENDING), ("created_at", DESCENDING)]
    )
    await database.search_intent_models.create_index("key", unique=True)
    await database.search_query_failures.create_index("query_hash", unique=True)
    await database.search_query_failures.create_index(
        [("status", ASCENDING), ("occurrences", DESCENDING), ("last_seen_at", DESCENDING)]
    )
    await database.search_query_failures.create_index("expires_at", expireAfterSeconds=0)
    await database.taxonomy_reconciler_graphs.create_index(
        [("key", ASCENDING), ("version", DESCENDING)], unique=True
    )
    await database.taxonomy_reconciler_graphs.create_index(
        [("key", ASCENDING), ("active", ASCENDING)]
    )
    await database.taxonomy_retag_proposals.create_index("proposal_key", unique=True)
    await database.taxonomy_retag_proposals.create_index(
        [("status", ASCENDING), ("confidence", DESCENDING), ("updated_at", DESCENDING)]
    )
    await database.taxonomy_retag_proposals.create_index(
        [("product_id", ASCENDING), ("graph_version", DESCENDING)]
    )
    await database.taxonomy_reconciliation_runs.create_index("run_id", unique=True)
    await database.taxonomy_reconciliation_runs.create_index([("started_at", DESCENDING)])
    await database.taxonomy_reconciler_state.create_index("key", unique=True)
    await database.orders.create_index("order_number", unique=True)
    await database.carts.create_index("user_id", unique=True)
    await database.orders.create_index(
        [("user_id", ASCENDING), ("placed_at", DESCENDING)]
    )
    await database.checkouts.create_index("user_id", unique=True)
    await database.checkouts.create_index("external_id", unique=True)
    await database.checkouts.create_index(
        "contact_phone",
        unique=True,
        partialFilterExpression={"contact_phone": {"$type": "string"}},
    )
    await database.checkouts.create_index(
        [
            ("status", ASCENDING),
            ("payment_status", ASCENDING),
            ("eligible_at", ASCENDING),
            ("updated_at", DESCENDING),
        ]
    )
    await database.checkout_recovery_configs.create_index("key", unique=True)
    await database.checkout_recovery_runs.create_index("run_id", unique=True)
    await database.checkout_recovery_runs.create_index([("started_at", DESCENDING)])
    await database.workflow_locks.create_index("key", unique=True)
    await database.workflow_locks.create_index("expires_at", expireAfterSeconds=0)


async def ensure_customer_metadata_fields(database) -> None:
    fields = [
        {
            "key": "generation",
            "label": "Generation",
            "description": "Audience generation signal; never inferred from appearance photos.",
            "group": "identity",
            "options": ["gen-alpha", "gen-z", "millennial", "gen-x", "timeless"],
            "sort_order": 80,
        },
        {
            "key": "trend_signal",
            "label": "Trend signal",
            "description": "Controlled merchandising signal for current and evergreen styles.",
            "group": "appearance",
            "options": ["trending", "viral", "emerging", "evergreen"],
            "sort_order": 81,
        },
    ]
    for field in fields:
        await database.metadata_fields.update_one(
            {"key": field["key"]},
            {
                "$set": {
                    **field,
                    "data_type": "multi_enum",
                    "storage": "product_metadata",
                    "storage_path": f"metadata.{field['key']}",
                    "control": "multi_select",
                    "options": [
                        {"key": key, "label": key.replace("-", " ").title(), "active": True}
                        for key in field["options"]
                    ],
                    "validation": {"maxSelections": 3},
                    "filterable": True,
                    "searchable": True,
                    "gemini_allowed": True,
                    "frontend_visible": True,
                    "usage_frequency": "common",
                    "schema_version": 3,
                    "status": "active",
                    "metadata": {"system": {"managed": True}},
                }
            },
            upsert=True,
        )


async def bootstrap_owner(database) -> None:
    if not settings.OWNER_EMAIL or not settings.OWNER_PASSWORD_HASH:
        return
    now = utcnow()
    email = settings.OWNER_EMAIL.strip().lower()
    await database.users.find_one_and_update(
        {"email": email},
        {
            "$set": {
                "email": email,
                "full_name": settings.OWNER_FULL_NAME,
                "password_hash": settings.OWNER_PASSWORD_HASH,
                "status": "active",
                "onboarding_completed": True,
                "updated_at": now,
            },
            "$setOnInsert": {
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
                "metadata": {"auth": {"bootstrapOwner": True}},
                "created_at": now,
            },
            "$addToSet": {"roles": {"$each": ["owner", "admin"]}},
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )


async def init_db():
    settings.validate_runtime_security()
    database = await mongo_runtime.connect()
    if settings.MONGO_ENSURE_INDEXES_ON_STARTUP:
        await ensure_indexes(database)
        await ensure_customer_metadata_fields(database)
        await bootstrap_owner(database)
    return database


async def initialize_database_schema() -> None:
    """Explicit deployment/setup task; never part of a serverless request path."""
    database = await mongo_runtime.connect()
    try:
        await ensure_indexes(database)
        await ensure_customer_metadata_fields(database)
        owner_hash = settings.OWNER_PASSWORD_HASH or ""
        if owner_hash.startswith(("$2a$", "$2b$", "$2y$")):
            await bootstrap_owner(database)
        elif settings.OWNER_EMAIL or owner_hash:
            print(
                "[db:init] skipped owner bootstrap: OWNER_PASSWORD_HASH is not bcrypt",
                file=sys.stderr,
            )
    finally:
        await mongo_runtime.close()


if __name__ == "__main__":
    asyncio.run(initialize_database_schema())
