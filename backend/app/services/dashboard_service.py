from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from app.core.serialization import mongo_json


class DashboardService:
    async def get_stats(self, database):
        (
            product_total,
            active_products,
            pending_review,
            rejected,
            missing_images,
            seller_total,
            seller_pending,
            seller_approved,
            brand_total,
            offers_total,
            rating_rows,
            categories,
            product_statuses,
            activity,
        ) = await asyncio.gather(
            database.products.count_documents({}),
            database.products.count_documents({"status": "active"}),
            database.product_drafts.count_documents({"status": "pending_review"}),
            database.product_drafts.count_documents({"status": "rejected"}),
            database.products.count_documents(
                {
                    "$or": [
                        {"cover_image_url": {"$in": [None, ""]}},
                        {"media": {"$exists": False}},
                        {"media": {"$size": 0}},
                    ]
                }
            ),
            database.sellers.count_documents({}),
            database.sellers.count_documents({"status": "pending"}),
            database.sellers.count_documents({"status": "approved"}),
            database.brands.count_documents({"status": "active"}),
            database.seller_offers.count_documents({"status": "active"}),
            database.products.aggregate(
                [{"$group": {"_id": None, "value": {"$avg": "$rating.average"}}}]
            ).to_list(length=1),
            database.products.aggregate(
                [
                    {"$match": {"status": "active"}},
                    {"$group": {"_id": "$category_key", "count": {"$sum": 1}}},
                    {"$sort": {"count": -1}},
                ]
            ).to_list(length=100),
            database.products.aggregate(
                [
                    {"$group": {"_id": "$status", "count": {"$sum": 1}}},
                    {"$sort": {"_id": 1}},
                ]
            ).to_list(length=20),
            database.audit_logs.find({})
            .sort("created_at", -1)
            .limit(12)
            .to_list(length=12),
        )

        average_rating = round(float(rating_rows[0]["value"]), 2) if rating_rows and rating_rows[0].get("value") is not None else 0
        return mongo_json(
            {
                "products": {
                    "total": product_total,
                    "active": active_products,
                    "pendingReview": pending_review,
                    "rejected": rejected,
                    "missingImages": missing_images,
                },
                "sellers": {
                    "total": seller_total,
                    "pending": seller_pending,
                    "approved": seller_approved,
                },
                "brands": brand_total,
                "totalOffers": offers_total,
                "averageRating": average_rating,
                "categoryDistribution": [
                    {"name": row.get("_id") or "uncategorized", "count": row["count"]}
                    for row in categories
                ],
                "statusDistribution": [
                    {"name": row.get("_id") or "unknown", "count": row["count"]}
                    for row in product_statuses
                ],
                "recentActivity": [
                    {
                        "id": row.get("_id"),
                        "action": row.get("action"),
                        "entityType": row.get("entity_type"),
                        "entityId": row.get("entity_id"),
                        "actorRole": row.get("actor_role"),
                        "createdAt": row.get("created_at"),
                    }
                    for row in activity
                ],
                "generatedAt": datetime.now(timezone.utc),
                "totalProducts": product_total,
                "approvedProducts": active_products,
                "pendingProducts": pending_review,
                "rejectedProducts": rejected,
            }
        )


dashboard_service = DashboardService()
