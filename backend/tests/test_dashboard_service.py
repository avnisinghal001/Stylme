import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

from app.services.dashboard_service import DashboardService


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *_args):
        return self

    def limit(self, *_args):
        return self

    async def to_list(self, *, length):
        return self.rows[:length]


class _Collection:
    def __init__(self, *, counts=None, aggregates=None, rows=None):
        self.counts = counts or {}
        self.aggregates = list(aggregates or [])
        self.rows = rows or []
        self.find_calls = 0

    async def count_documents(self, query):
        if not query:
            return self.counts.get("total", 0)
        if "status" in query:
            return self.counts.get(query["status"], 0)
        return self.counts.get("other", 0)

    def aggregate(self, _pipeline):
        return _Cursor(self.aggregates.pop(0))

    def find(self, _query):
        self.find_calls += 1
        return _Cursor(self.rows)


def test_dashboard_stats_returns_a_complete_ui_contract():
    audit_logs = _Collection(
        rows=[
            {
                "_id": "audit-1",
                "action": "product_draft_approved",
                "entity_type": "product",
                "entity_id": "product-1",
                "actor_role": "admin",
                "created_at": datetime(2026, 7, 20, tzinfo=timezone.utc),
            }
        ]
    )
    database = SimpleNamespace(
        products=_Collection(
            counts={"total": 120, "active": 90, "other": 4},
            aggregates=[
                [{"_id": None, "value": 4.35}],
                [{"_id": "apparel", "count": 70}, {"_id": "footwear", "count": 20}],
                [{"_id": "active", "count": 90}, {"_id": "draft", "count": 30}],
            ],
        ),
        product_drafts=_Collection(counts={"pending_review": 8, "rejected": 3}),
        sellers=_Collection(counts={"total": 22, "pending": 2, "approved": 19}),
        brands=_Collection(counts={"active": 14}),
        seller_offers=_Collection(counts={"active": 310}),
        audit_logs=audit_logs,
    )

    stats = asyncio.run(DashboardService().get_stats(database))

    assert stats["products"] == {
        "total": 120,
        "active": 90,
        "pendingReview": 8,
        "rejected": 3,
        "missingImages": 4,
    }
    assert stats["sellers"] == {"total": 22, "pending": 2, "approved": 19}
    assert stats["averageRating"] == 4.35
    assert stats["categoryDistribution"][0] == {"name": "apparel", "count": 70}
    assert {row["name"]: row["count"] for row in stats["statusDistribution"]} == {
        "active": 90,
        "draft": 30,
    }
    assert stats["recentActivity"][0]["action"] == "product_draft_approved"
    assert stats["recentActivity"][0]["createdAt"] == "2026-07-20T00:00:00+00:00"
    assert stats["generatedAt"].endswith("+00:00")
    assert audit_logs.find_calls == 1
