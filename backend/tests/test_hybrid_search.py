from __future__ import annotations

import asyncio

import pytest

from app.services import search_intent_service as search_service
from app.services import taxonomy_reconciler_service as reconciler_service
from app.schemas.search import AdvancedSearchRequest
from app.services.product_service import list_public_products


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    async def to_list(self, length):
        return self.rows[:length]


class Collection:
    def __init__(self, rows=None, document=None):
        self.rows = rows or []
        self.document = document
        self.pipeline = None

    def find(self, *args, **kwargs):
        return Cursor(self.rows)

    async def find_one(self, *args, **kwargs):
        return self.document

    def aggregate(self, pipeline):
        self.pipeline = pipeline
        return Cursor([{"items": [], "count": []}])


def taxonomy_field(key: str, values: list[str], *, storage: str = "product_metadata"):
    return {
        "key": key,
        "status": "active",
        "filterable": True,
        "searchable": True,
        "gemini_allowed": True,
        "storage": storage,
        "validation": {"maxSelections": 3},
        "options": [
            {
                "key": value,
                "label": value.replace("-", " ").title(),
                "aliases": [],
                "active": True,
            }
            for value in values
        ],
    }


def fake_database():
    fields = [
        taxonomy_field("style", ["ethnic", "minimalist", "streetwear", "sporty", "contemporary"]),
        taxonomy_field("aesthetic", ["desi-fusion", "clean-girl", "indie", "soft-girl"]),
        taxonomy_field("dress_code", ["ethnic-festive", "cocktail", "formal", "smart-casual", "casual"]),
        taxonomy_field("season", ["summer", "winter", "monsoon", "all-season"]),
        taxonomy_field("material", ["cotton", "linen", "nylon", "wool"]),
        taxonomy_field("pattern", ["floral"]),
        taxonomy_field("color_family", ["red", "white"]),
        taxonomy_field("occasion", ["party", "wedding", "workout", "travel", "office"]),
        taxonomy_field("product_type", ["kurtas"], storage="product_core"),
        taxonomy_field("theme", ["party", "minimal"]),
        taxonomy_field("mood", ["playful", "bold", "elegant", "power-dressing", "relaxed", "romantic"]),
        taxonomy_field("fit", ["relaxed", "tailored", "loose"]),
        taxonomy_field("surface_detail", ["chikankari", "sequinned"]),
        taxonomy_field("trend_signal", ["trending", "viral"]),
        taxonomy_field("gender", ["women", "men"], storage="product_core"),
    ]
    model = {
        "key": search_service.MODEL_KEY,
        "version": 2,
        "model_type": "weighted-pmi-token-filter-graph",
        "training_rows": 30_000,
        "thresholds": {"runtime_minimum_confidence": 0.52},
        "nodes": {},
        "correlations": {},
    }
    return type(
        "FakeDatabase",
        (),
        {
            "metadata_fields": Collection(fields),
            "search_intent_models": Collection(document=model),
            "taxonomy_reconciler_graphs": Collection(document=None),
            "brands": Collection([]),
            "products": Collection([]),
        },
    )()


@pytest.fixture(autouse=True)
def clear_search_caches(monkeypatch):
    for name in ("_model_cache", "_graph_cache", "_fields_cache", "_brands_cache"):
        monkeypatch.setattr(search_service, name, None)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("best clothes in udaipur", {("style", "ethnic"), ("aesthetic", "desi-fusion")}),
        ("udaipur styled cloth", {("dress_code", "ethnic-festive"), ("season", "summer")}),
        ("birthday wear", {("occasion", "party"), ("theme", "party")}),
        ("minimal", {("style", "minimalist"), ("theme", "minimal")}),
        ("happy mood", {("mood", "playful")}),
        ("funky personality", {("mood", "bold"), ("aesthetic", "indie")}),
        ("sundar", {("mood", "elegant")}),
        ("ekdam pretty", {("mood", "romantic"), ("aesthetic", "soft-girl")}),
        ("loose fit ka", {("fit", "loose")}),
        ("फूलों वाला", {("pattern", "floral")}),
        ("white color ka", {("color_family", "white")}),
    ],
)
async def test_context_queries_compile_to_weighted_taxonomy_vectors(query, expected):
    intent = await search_service.compile_search_intent(fake_database(), query)
    vector = {(item["field"], item["value"]) for item in intent["rankingVector"]}
    assert expected <= vector
    assert intent["lexicalQuery"] == ""
    assert intent["version"] == 3
    assert intent["retrieval"]["strategy"] == "mongo-text-plus-sparse-cosine"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("query", "correction", "expected"),
    [
        ("brthday wer", ("brthday", "birthday"), ("occasion", "party")),
        ("udipur styld clth", ("udipur", "udaipur"), ("style", "ethnic")),
        ("minmal cloths", ("minmal", "minimal"), ("theme", "minimal")),
        ("funky persnality", ("persnality", "personality"), ("mood", "bold")),
    ],
)
async def test_malformed_queries_recover_without_poisoning_lexical_search(
    query, correction, expected
):
    intent = await search_service.compile_search_intent(fake_database(), query)
    corrections = {(item["from"], item["to"]) for item in intent["corrections"]}
    vector = {(item["field"], item["value"]) for item in intent["rankingVector"]}
    assert correction in corrections
    assert expected in vector
    assert intent["lexicalQuery"] == ""


@pytest.mark.asyncio
async def test_malformed_birthday_happy_wear_query_keeps_only_style_intent():
    intent = await search_service.compile_search_intent(
        fake_database(), "burthday waer happi mood"
    )
    corrections = {(item["from"], item["to"]) for item in intent["corrections"]}
    vector = {(item["field"], item["value"]) for item in intent["rankingVector"]}
    assert {
        ("burthday", "birthday"),
        ("waer", "wear"),
        ("happi", "happy"),
    } <= corrections
    assert {("occasion", "party"), ("mood", "playful")} <= vector
    assert intent["lexicalQuery"] == ""


@pytest.mark.asyncio
async def test_malformed_control_words_still_extract_price_and_product_type():
    intent = await search_service.compile_search_intent(
        fake_database(), "weding kurtaa undr 2500"
    )
    corrections = {(item["from"], item["to"]) for item in intent["corrections"]}
    assert {("weding", "wedding"), ("kurtaa", "kurta"), ("undr", "under")} <= corrections
    assert intent["hardFilters"]["maxPrice"] == 2500
    assert intent["hardFilters"]["productType"] == ["kurtas"]
    assert intent["lexicalQuery"] == ""


@pytest.mark.asyncio
async def test_advanced_search_reuses_fallback_shelf_on_later_pages(monkeypatch):
    async def fake_intent(*args, **kwargs):
        return {
            "hardFilters": {
                "brand": [],
                "category": [],
                "productType": [],
                "colour": [],
                "size": [],
                "gender": [],
                "metadata": {},
                "minPrice": None,
                "maxPrice": None,
                "minAge": None,
                "maxAge": None,
                "minHeightCm": None,
                "maxHeightCm": None,
                "minWeightKg": None,
                "maxWeightKg": None,
                "sort": "recommended",
                "pincode": None,
                "swoopstyl": False,
            },
            "rankingVector": [],
        }

    async def empty_strict_page(*args, **kwargs):
        return {
            "items": [],
            "page": kwargs["page"],
            "pageSize": kwargs["page_size"],
            "total": 0,
            "totalPages": 0,
        }

    fallback_calls = []

    async def fallback_page(database, payload, resolved_query=None):
        fallback_calls.append(payload.page)
        return (
            {
                "items": [{"id": "fallback-page-2"}],
                "page": payload.page,
                "pageSize": payload.page_size,
                "total": 30,
                "totalPages": 3,
            },
            {
                "used": True,
                "level": 1,
                "strategy": "drop-lexical-keep-explicit",
            },
        )

    async def unexpected_analytics(*args, **kwargs):
        raise AssertionError("later pages must not duplicate search analytics writes")

    monkeypatch.setattr(search_service, "compile_search_intent", fake_intent)
    monkeypatch.setattr(search_service, "list_public_products", empty_strict_page)
    monkeypatch.setattr(reconciler_service, "fallback_for_empty_search", fallback_page)
    monkeypatch.setattr(reconciler_service, "record_search_outcome", unexpected_analytics)

    response = await search_service.advanced_search(
        object(),
        AdvancedSearchRequest(
            query="an unmatched regional query",
            lexical_query="unmatched",
            page=2,
            page_size=12,
        ),
    )

    assert fallback_calls == [2]
    assert response["page"] == 2
    assert response["total"] == 30
    assert response["totalPages"] == 3
    assert response["items"] == [{"id": "fallback-page-2"}]
    assert response["originalResultCount"] == 0
    assert response["reconciliation"]["used"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "query",
    [
        "kurta Rs 5600",
        "kurta lower than Rs 5600",
        "kurta cheaper than INR 5600",
        "kurta not more than ₹5600",
        "kurta at most 5600",
    ],
)
async def test_currency_and_comparator_phrases_compile_to_price_ceiling(query):
    intent = await search_service.compile_search_intent(fake_database(), query)
    assert intent["hardFilters"]["maxPrice"] == 5600
    assert intent["hardFilters"]["productType"] == ["kurtas"]
    assert intent["lexicalQuery"] == ""


@pytest.mark.asyncio
async def test_text_tags_price_and_trailing_pincode_are_classified_by_type():
    intent = await search_service.compile_search_intent(
        fake_database(),
        "red floral cotton kurta lower than Rs 5600 560041",
        supplied_swoopstyl=True,
    )
    vector = {(item["field"], item["value"]) for item in intent["rankingVector"]}
    assert {
        ("color_family", "red"),
        ("pattern", "floral"),
        ("material", "cotton"),
        ("product_type", "kurtas"),
    } <= vector
    assert intent["hardFilters"]["maxPrice"] == 5600
    assert intent["hardFilters"]["pincode"] == "560041"
    assert intent["hardFilters"]["swoopstyl"] is True
    assert intent["lexicalQuery"] == ""


@pytest.mark.asyncio
async def test_pincode_is_ignored_without_swoopstyl_and_must_be_last():
    ordinary = await search_service.compile_search_intent(
        fake_database(), "kurta Rs 5600 560041"
    )
    misplaced = await search_service.compile_search_intent(
        fake_database(),
        "swoopstyl 560041 red kurta",
    )
    assert ordinary["hardFilters"]["pincode"] is None
    assert ordinary["hardFilters"]["swoopstyl"] is False
    assert misplaced["hardFilters"]["pincode"] is None
    assert misplaced["hardFilters"]["swoopstyl"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("query", "expected", "role"),
    [
        ("clothes for fast moving days", {("style", "sporty"), ("occasion", "workout")}, "activity-verb"),
        ("always on the go outfit", {("style", "sporty"), ("occasion", "travel")}, "activity-phrase"),
        ("I want to command the room", {("mood", "power-dressing"), ("fit", "tailored")}, "desired-effect"),
        ("something with nothing loud", {("style", "minimalist"), ("theme", "minimal")}, "style-directive"),
        ("comfortable all day clothes", {("fit", "relaxed"), ("material", "cotton")}, "comfort-constraint"),
    ],
)
async def test_indirect_nouns_verbs_and_descriptions_expand_to_taxonomy(
    query, expected, role
):
    intent = await search_service.compile_search_intent(fake_database(), query)
    vector = {(item["field"], item["value"]) for item in intent["rankingVector"]}
    assert expected <= vector
    assert role in {item["role"] for item in intent["linguisticSignals"]}
    assert intent["retrieval"]["indirectIntent"] is True
    assert intent["lexicalQuery"] == ""


@pytest.mark.asyncio
async def test_recipient_pronoun_is_a_soft_signal_not_a_hard_gender_filter():
    intent = await search_service.compile_search_intent(
        fake_database(), "birthday outfit for her"
    )
    vector = {(item["field"], item["value"]) for item in intent["rankingVector"]}
    assert ("gender", "women") in vector
    assert intent["hardFilters"]["gender"] == []
    assert next(
        item["weight"]
        for item in intent["rankingVector"]
        if item["field"] == "gender" and item["value"] == "women"
    ) >= 0.9
    assert {item["role"] for item in intent["linguisticSignals"]} == {
        "recipient-pronoun"
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("city", "expected"),
    [
        ("Mumbai", ("season", "summer")),
        ("Bangalore", ("season", "all-season")),
        ("Chennai", ("material", "cotton")),
        ("Lucknow", ("surface_detail", "chikankari")),
        ("Shimla", ("season", "winter")),
        ("Goa", ("occasion", "travel")),
        ("Delhi", ("dress_code", "smart-casual")),
    ],
)
async def test_major_indian_city_queries_receive_broad_context(city, expected):
    intent = await search_service.compile_search_intent(
        fake_database(), f"best clothes in {city}"
    )
    vector = {(item["field"], item["value"]) for item in intent["rankingVector"]}
    assert expected in vector


def test_probability_and_sparse_cosine_are_bounded_and_reward_coverage():
    assert search_service.fuzzy_probability("udipur", "udaipur") > 0.85
    query = {"style:ethnic": 0.8, "season:summer": 0.6}
    one_match = search_service.sparse_cosine_score(query, {"style:ethnic"})
    both_matches = search_service.sparse_cosine_score(
        query, {"style:ethnic", "season:summer"}
    )
    assert 0 < one_match < both_matches <= 1


@pytest.mark.asyncio
async def test_parser_stress_suite_is_bounded_and_deterministic():
    queries = [
        "best clothes in udaipur",
        "udaipur styled cloth",
        "birthday wear",
        "minimal",
        "happy mood",
        "funky personality",
        "brthday wer",
        "udipur styld clth",
        "minmal cloths",
        "funky persnality",
        "weding kurtaa undr 2500",
    ] * 8
    database = fake_database()
    results = await asyncio.gather(
        *(search_service.compile_search_intent(database, query) for query in queries)
    )
    assert len(results) == 88
    assert all(result["version"] == 3 for result in results)
    assert all(len(result["rankingVector"]) <= 20 for result in results)


@pytest.mark.asyncio
async def test_first_graph_activation_is_not_hidden_by_negative_cache():
    class ActivatingGraphCollection:
        def __init__(self):
            self.calls = 0

        async def find_one(self, *args, **kwargs):
            self.calls += 1
            if self.calls == 1:
                return None
            return {"version": 1, "schema_version": 2, "nodes": [], "edges": []}

    database = fake_database()
    database.taxonomy_reconciler_graphs = ActivatingGraphCollection()

    assert await search_service._reconciliation_graph(database) is None
    graph = await search_service._reconciliation_graph(database)

    assert graph["version"] == 1
    assert database.taxonomy_reconciler_graphs.calls == 2


@pytest.mark.asyncio
async def test_mongo_pipeline_scores_and_limits_candidates_before_offer_joins():
    database = fake_database()
    await list_public_products(
        database,
        page=1,
        page_size=12,
        search=None,
        category=[],
        product_type=[],
        brand_id=None,
        brand=[],
        colour=[],
        size=[],
        gender=[],
        metadata_filters=[],
        min_price_paise=None,
        max_price_paise=None,
        min_age=None,
        max_age=None,
        min_height_cm=None,
        max_height_cm=None,
        min_weight_kg=None,
        max_weight_kg=None,
        sort_by="relevance",
        order="desc",
        pincode=None,
        swoopstyl=False,
        radius_km=100,
        soft_filter_weights={"style": {"ethnic": 0.9}},
        require_soft_match=True,
        hybrid_candidate_limit=1200,
    )
    pipeline = database.products.pipeline
    limit_index = next(index for index, stage in enumerate(pipeline) if stage == {"$limit": 1200})
    facet_index = next(index for index, stage in enumerate(pipeline) if "$facet" in stage)
    item_pipeline = pipeline[facet_index]["$facet"]["items"]
    page_limit_index = next(
        index for index, stage in enumerate(item_pipeline) if stage == {"$limit": 12}
    )
    lookup_index = next(
        index for index, stage in enumerate(item_pipeline) if "$lookup" in stage
    )
    assert limit_index < facet_index
    assert page_limit_index < lookup_index
    assert any("_hybridScore" in (stage.get("$set") or {}) for stage in pipeline)
    assert pipeline[0]["$match"]["catalogue_eligible"] is True
    assert pipeline[0]["$match"]["$and"][-1]["$or"] == [
        {"metadata.style": {"$in": ["ethnic"]}}
    ]
