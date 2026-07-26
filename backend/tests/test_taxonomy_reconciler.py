from __future__ import annotations

from bson import ObjectId
import pytest
from pydantic import ValidationError

from app.schemas.taxonomy_reconciler import ReconcilerRunRequest, SearchOutcomeWebhook
from app.schemas.search import AdvancedSearchRequest
from app.services.indian_search_demand import INDIAN_SEARCH_DEMAND
from app.services.taxonomy_reconciler_service import (
    MAX_RETAG_PROPOSALS_PER_FIELD,
    MAX_RETAG_PROPOSALS_PER_PRODUCT,
    apply_retag_proposals,
    baseline_context_signals,
    build_deterministic_graph,
    fallback_for_empty_search,
    proposals_for_product,
    record_search_outcome,
    redact_query,
    stage_retag_proposals,
    taxonomy_node,
    traverse_graph,
)


class AsyncCursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    async def to_list(self, length):
        return self.rows[:length]


class MetadataCollection:
    def __init__(self, rows):
        self.rows = rows

    def find(self, *args, **kwargs):
        return AsyncCursor(self.rows)


class GraphCollection:
    async def find_one(self, *args, **kwargs):
        return None


class FailureCollection:
    def __init__(self):
        self.call = None

    async def find_one_and_update(self, query, update, **kwargs):
        self.call = (query, update, kwargs)
        return {"_id": ObjectId(), **update.get("$setOnInsert", {}), **update.get("$set", {})}


class StateCollection:
    async def find_one(self, *args, **kwargs):
        return None

    async def update_one(self, *args, **kwargs):
        return None


class ProductCollection:
    def __init__(self, rows):
        self.rows = rows

    def find(self, *args, **kwargs):
        return AsyncCursor(self.rows)


class ProposalCollection:
    def __init__(self, rows=None):
        self.rows = rows or []
        self.inserted = []

    def find(self, *args, **kwargs):
        return AsyncCursor(self.rows)

    async def insert_many(self, documents, **kwargs):
        self.inserted.extend(documents)


class ApplyingProductCollection(ProductCollection):
    def __init__(self, rows):
        super().__init__(rows)
        self.find_calls = 0
        self.operations = []

    def find(self, *args, **kwargs):
        self.find_calls += 1
        return super().find(*args, **kwargs)

    async def bulk_write(self, operations, **kwargs):
        self.operations = operations


class ApplyingProposalCollection:
    def __init__(self, rows):
        self.rows = rows
        self.status_updates = []

    def find(self, *args, **kwargs):
        return AsyncCursor(self.rows)

    async def update_many(self, query, update):
        self.status_updates.append((query, update))


class DeleteCollection:
    async def delete_many(self, *args, **kwargs):
        return None


class FakeDatabase:
    def __init__(self, metadata):
        self.metadata_fields = MetadataCollection(metadata)
        self.taxonomy_reconciler_graphs = GraphCollection()
        self.search_query_failures = FailureCollection()


def field(key: str, values: list[str], *, storage: str = "product_metadata"):
    return {
        "key": key,
        "label": key.replace("_", " ").title(),
        "storage": storage,
        "storagePath": f"metadata.{key}",
        "dataType": "multi_enum",
        "validation": {"maxSelections": 3},
        "aiAllowed": True,
        "options": [
            {"key": value, "label": value.replace("-", " ").title(), "aliases": []}
            for value in values
        ],
    }


def graph_document(fields, model=None):
    nodes, edges = build_deterministic_graph(fields, model)
    return {"version": 1, "nodes": list(nodes.values()), "edges": list(edges.values())}


def test_indian_demand_pack_has_100_unique_multilingual_allowlisted_queries():
    assert len(INDIAN_SEARCH_DEMAND) == 100
    assert len({item["query"] for item in INDIAN_SEARCH_DEMAND}) == 100
    assert {item["language"] for item in INDIAN_SEARCH_DEMAND} >= {
        "hi-Deva",
        "hi-Latn",
        "hinglish",
        "en-IN",
    }
    allowed = {
        "aesthetic": {
            "boho-chic", "clean-girl", "desi-fusion", "indie", "old-money",
            "quiet-luxury", "soft-girl", "y2k",
        },
        "color_family": {"white", "yellow"},
        "dress_code": {
            "bridal-party", "casual", "ethnic-festive", "formal",
            "smart-casual", "wedding-guest",
        },
        "festival": {
            "diwali", "durga-puja", "eid", "navratri", "raksha-bandhan",
        },
        "fit": {"flared", "loose", "oversized", "relaxed", "tailored"},
        "generation": {"gen-alpha", "gen-z", "millennial", "timeless"},
        "material": {"chiffon", "cotton", "linen", "pure-cotton", "wool"},
        "mood": {
            "bold", "elegant", "playful", "power-dressing", "relaxed",
            "romantic",
        },
        "occasion": {
            "college", "date-night", "haldi", "mehendi", "office", "puja",
            "sangeet", "travel", "wedding", "wedding-guest",
        },
        "pattern": {
            "checked", "colourblocked", "embroidered", "floral", "printed",
            "solid", "striped",
        },
        "season": {"monsoon", "summer", "winter"},
        "style": {
            "bohemian", "classic", "contemporary", "ethnic", "gen-z",
            "luxury", "minimalist", "smart-casual", "sporty", "streetwear",
        },
        "surface_detail": {"chikankari", "embroidery"},
        "theme": {
            "devotional", "festive", "minimal", "romantic", "vacation",
        },
        "trend_signal": {"evergreen", "trending", "viral"},
    }
    for item in INDIAN_SEARCH_DEMAND:
        assert item["query"].strip()
        assert item["targets"]
        for field_name, value, weight in item["targets"]:
            assert value in allowed[field_name]
            assert 0.5 <= weight <= 1


def test_india_context_graph_resolves_udaipur_without_inventing_taxonomy():
    fields = {
        "style": field("style", ["ethnic", "minimalist"]),
        "aesthetic": field("aesthetic", ["desi-fusion"]),
        "dress_code": field("dress_code", ["ethnic-festive"]),
        "season": field("season", ["summer"]),
        "material": field("material", ["cotton"]),
        "generation": field("generation", ["millennial"]),
        "festival": field("festival", ["diwali"]),
        "product_type": field("product_type", ["sarees", "shapewear"]),
    }
    graph = graph_document(fields)
    signals = traverse_graph(graph, "clothes for Udaipur", depth=4, limit=20)
    pairs = {(item["field"], item["value"]) for item in signals}
    assert ("style", "ethnic") in pairs
    assert ("aesthetic", "desi-fusion") in pairs
    assert ("generation", "millennial") not in pairs
    assert ("festival", "diwali") not in pairs
    assert ("product_type", "shapewear") not in pairs
    assert all(item["depth"] <= 4 for item in signals)
    assert all(item["value"] in {option["key"] for option in fields[item["field"]]["options"]} for item in signals)


def test_baseline_context_is_available_before_first_cron_graph_build():
    fields = {
        "occasion": field("occasion", ["travel"]),
        "season": field("season", ["summer"]),
        "dress_code": field("dress_code", ["casual"]),
        "fit": field("fit", ["relaxed"]),
    }
    signals = baseline_context_signals("looks for Goa", fields)
    assert {(item["field"], item["value"]) for item in signals} >= {
        ("occasion", "travel"),
        ("season", "summer"),
    }


def test_catalogue_cooccurrence_stages_allowlisted_product_retag():
    fields = {
        "style": field("style", ["ethnic"]),
        "occasion": field("occasion", ["wedding"]),
    }
    model = {
        "nodes": {
            "anarkali": [
                {"field": "style", "value": "ethnic", "confidence": 0.98, "support": 100},
                {"field": "occasion", "value": "wedding", "confidence": 0.96, "support": 90},
            ]
        }
    }
    graph = graph_document(fields, model)
    product = {
        "_id": ObjectId(),
        "title": "Embroidered Anarkali",
        "description": "Flowing festive silhouette",
        "search_text": "embroidered anarkali ethnic",
        "metadata": {"style": ["ethnic"]},
    }
    target = taxonomy_node("occasion", "wedding")
    proposals = proposals_for_product(
        product,
        graph,
        {target: {"score": 0.86, "queryHashes": ["q1"]}},
        fields,
    )
    assert proposals[0]["field"] == "occasion"
    assert proposals[0]["value"] == "wedding"
    assert proposals[0]["evidence"]["type"] == "catalogue-cooccurrence"
    assert proposals[0]["auto_eligible"] is True


def test_product_retag_budget_excludes_innerwear_and_caps_each_product():
    values = {
        "aesthetic": ["clean-girl", "soft-girl", "y2k"],
        "fit": ["loose", "oversized", "relaxed"],
        "material": ["cotton", "linen", "silk"],
        "mood": ["elegant", "playful", "romantic"],
        "pattern": ["floral", "solid", "striped"],
        "style": ["classic", "ethnic", "minimalist"],
        "theme": ["festive", "minimal", "romantic"],
        "outfit_role": ["innerwear"],
    }
    fields = {key: field(key, options) for key, options in values.items()}
    graph = graph_document(fields)
    product = {
        "_id": ObjectId(),
        "title": " ".join(value for options in values.values() for value in options),
        "description": "",
        "search_text": "",
        "metadata": {},
    }
    targets = {
        taxonomy_node(field_name, value): {
            "score": 0.9,
            "queryHashes": ["q-budget"],
        }
        for field_name, options in values.items()
        for value in options
    }
    proposals = proposals_for_product(product, graph, targets, fields)
    assert len(proposals) == MAX_RETAG_PROPOSALS_PER_PRODUCT
    counts = {}
    for proposal in proposals:
        counts[proposal["field"]] = counts.get(proposal["field"], 0) + 1
        assert proposal["field"] != "outfit_role"
        assert proposal["value"] != "innerwear"
    assert max(counts.values()) <= MAX_RETAG_PROPOSALS_PER_FIELD


def test_sensitive_query_values_are_redacted_before_failure_storage():
    redacted = redact_query(
        "kurta for test@example.com call +91 9876543210 card 4111 1111 1111 1111"
    )
    assert "test@example.com" not in redacted
    assert "9876543210" not in redacted
    assert "4111" not in redacted
    assert "[email]" in redacted
    assert "[phone]" in redacted


def test_reconciler_contract_caps_graph_depth_and_context_size():
    with pytest.raises(ValidationError):
        ReconcilerRunRequest(graphDepth=5)
    with pytest.raises(ValidationError):
        SearchOutcomeWebhook(
            query="empty query",
            resultCount=0,
            intent={"payload": "x" * 33_000},
        )
    request = ReconcilerRunRequest(maxQueries=10, maxProducts=100, graphDepth=4)
    assert request.apply is False
    assert request.graph_depth == 4


@pytest.mark.asyncio
async def test_zero_result_capture_redacts_and_aggregates_query():
    database = FakeDatabase([])
    document = await record_search_outcome(
        database,
        raw_query="Udaipur clothes for test@example.com +91 9876543210",
        result_count=0,
        source="advanced-search",
        intent={"confidence": 0.5},
        resolved_query={},
    )
    _, update, kwargs = database.search_query_failures.call
    assert kwargs["upsert"] is True
    assert update["$inc"] == {"occurrences": 1, "zero_result_count": 1}
    assert "test@example.com" not in document["query"]
    assert "9876543210" not in document["query"]
    assert document["status"] == "open"


@pytest.mark.asyncio
async def test_empty_search_fallback_uses_graph_signals_and_exclusion_policy(monkeypatch):
    metadata = [
        {
            **field("style", ["ethnic"]),
            "filterable": True,
            "searchable": True,
            "gemini_allowed": True,
        },
        {
            **field("aesthetic", ["desi-fusion"]),
            "filterable": True,
            "searchable": True,
            "gemini_allowed": True,
        },
        {
            **field("dress_code", ["ethnic-festive"]),
            "filterable": True,
            "searchable": True,
            "gemini_allowed": True,
        },
        {
            **field("season", ["summer"]),
            "filterable": True,
            "searchable": True,
            "gemini_allowed": True,
        },
        {
            **field("material", ["cotton"]),
            "filterable": True,
            "searchable": True,
            "gemini_allowed": True,
        },
    ]
    database = FakeDatabase(metadata)
    calls = []

    async def fake_list_public_products(**kwargs):
        calls.append(kwargs)
        return {"items": [{"id": "p1"}], "total": 1, "page": 1, "pageSize": 12, "totalPages": 1}

    monkeypatch.setattr(
        "app.services.product_service.list_public_products",
        fake_list_public_products,
    )
    result, details = await fallback_for_empty_search(
        database,
        AdvancedSearchRequest(query="clothes for Udaipur"),
    )
    assert result["total"] == 1
    assert details["level"] == 1
    assert calls[0]["soft_metadata_filters"]["style"] == ["ethnic"]
    assert "shapewear" in calls[0]["excluded_product_types"]
    assert "lingerie" in calls[0]["excluded_text_pattern"]


@pytest.mark.asyncio
async def test_proposal_retry_preserves_existing_admin_decision():
    metadata = [
        {
            **field("occasion", ["wedding"]),
            "status": "active",
            "filterable": True,
            "searchable": True,
            "gemini_allowed": True,
        }
    ]
    database = FakeDatabase(metadata)
    database.taxonomy_reconciler_state = StateCollection()
    product_id = ObjectId()
    database.products = ProductCollection(
        [
            {
                "_id": product_id,
                "title": "Wedding ready embroidered kurta",
                "description": "Festive outfit",
                "search_text": "wedding kurta",
                "status": "active",
                "visibility": "public",
                "metadata": {},
            }
        ]
    )
    database.taxonomy_retag_proposals = ProposalCollection(
        [{"proposal_key": f"{product_id}:occasion:wedding", "status": "approved"}]
    )
    fields = {"occasion": field("occasion", ["wedding"])}
    graph = graph_document(fields)
    await stage_retag_proposals(
        database,
        graph=graph,
        failures=[{"query": "wedding outfit", "query_hash": "q1"}],
        max_products=10,
        depth=4,
        run_id="run-2",
    )
    assert database.taxonomy_retag_proposals.inserted == []


@pytest.mark.asyncio
async def test_hinglish_baseline_can_stage_evidence_backed_product_retag():
    metadata = [
        {
            **field("mood", ["elegant"]),
            "status": "active",
            "filterable": True,
            "searchable": True,
            "gemini_allowed": True,
        }
    ]
    database = FakeDatabase(metadata)
    database.taxonomy_reconciler_state = StateCollection()
    database.products = ProductCollection(
        [
            {
                "_id": ObjectId(),
                "title": "Elegant embroidered kurta",
                "description": "A polished festive layer",
                "search_text": "elegant embroidered kurta",
                "status": "active",
                "visibility": "public",
                "metadata": {},
            }
        ]
    )
    database.taxonomy_retag_proposals = ProposalCollection()
    fields = {"mood": field("mood", ["elegant"])}
    graph = graph_document(fields)
    result = await stage_retag_proposals(
        database,
        graph=graph,
        failures=[{"query": "ekdam sundar", "query_hash": "q-hinglish"}],
        max_products=10,
        depth=4,
        run_id="run-india",
    )
    assert result["targetTags"] == 1
    assert result["proposalsStaged"] == 1
    proposal = database.taxonomy_retag_proposals.inserted[0]
    assert proposal["field"] == "mood"
    assert proposal["value"] == "elegant"
    assert proposal["auto_eligible"] is True
    assert proposal["status"] == "proposed"


@pytest.mark.asyncio
async def test_apply_retags_prefetches_products_and_consolidates_writes(monkeypatch):
    product_id = ObjectId()
    missing_product_id = ObjectId()
    proposal_ids = [ObjectId() for _ in range(4)]
    metadata = [
        {
            **field("mood", ["bold", "elegant", "romantic"]),
            "validation": {"maxSelections": 2},
            "status": "active",
            "filterable": True,
            "searchable": True,
            "gemini_allowed": True,
        },
        {
            **field("occasion", ["wedding"]),
            "status": "active",
            "filterable": True,
            "searchable": True,
            "gemini_allowed": True,
        },
    ]
    database = FakeDatabase(metadata)
    database.products = ApplyingProductCollection(
        [{"_id": product_id, "metadata": {"mood": ["bold"]}}]
    )
    database.taxonomy_retag_proposals = ApplyingProposalCollection(
        [
            {
                "_id": proposal_ids[0],
                "product_id": product_id,
                "field": "mood",
                "value": "elegant",
                "graph_version": 4,
            },
            {
                "_id": proposal_ids[1],
                "product_id": product_id,
                "field": "mood",
                "value": "romantic",
                "graph_version": 4,
            },
            {
                "_id": proposal_ids[2],
                "product_id": product_id,
                "field": "occasion",
                "value": "wedding",
                "graph_version": 5,
            },
            {
                "_id": proposal_ids[3],
                "product_id": missing_product_id,
                "field": "mood",
                "value": "elegant",
                "graph_version": 5,
            },
        ]
    )
    database.available_filter_cache = DeleteCollection()

    async def fake_write_audit(*args, **kwargs):
        return None

    monkeypatch.setattr(
        "app.services.taxonomy_reconciler_service.write_audit",
        fake_write_audit,
    )
    result = await apply_retag_proposals(
        database,
        minimum_confidence=0.8,
        limit=1000,
        include_auto=True,
        actor=None,
        run_id="run-batched",
    )

    assert result == {"selected": 4, "applied": 2, "stale": 2}
    assert database.products.find_calls == 1
    assert len(database.products.operations) == 1
    update = database.products.operations[0]._doc
    assert update["$addToSet"] == {
        "metadata.mood": {"$each": ["elegant"]},
        "metadata.occasion": {"$each": ["wedding"]},
    }
    assert update["$set"]["system_metadata.reconciliation.last_graph_version"] == 5
