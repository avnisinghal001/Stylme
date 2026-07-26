import pytest
from fastapi import HTTPException

from app.services.metadata_service import validate_product_metadata


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, length):
        return self.rows[:length]


class FakeCollection:
    def __init__(self, rows):
        self.rows = rows

    def find(self, query):
        return FakeCursor(self.rows)


class FakeDatabase:
    def __init__(self):
        def field(key, data_type, storage, options, ai=True):
            return {
                "key": key,
                "data_type": data_type,
                "storage": storage,
                "storage_path": key,
                "options": [{"key": value, "active": True} for value in options],
                "validation": {},
                "gemini_allowed": ai,
            }

        self.metadata_fields = FakeCollection(
            [
                field("category", "enum", "product_core", ["apparel"]),
                field("product_type", "enum", "product_core", ["t-shirts"]),
                field("gender", "multi_enum", "product_core", ["men", "women"]),
                field("style", "multi_enum", "product_metadata", ["classic", "gen-z"]),
                field("internal_note", "text", "product_metadata", [], ai=False),
            ]
        )


@pytest.mark.asyncio
async def test_controlled_metadata_accepts_known_values():
    result = await validate_product_metadata(
        FakeDatabase(),
        category_key="apparel",
        product_type_key="t-shirts",
        gender_keys=["men"],
        metadata={"style": ["classic"]},
    )
    assert result == {"style": ["classic"]}


@pytest.mark.asyncio
async def test_controlled_metadata_rejects_unknown_values():
    with pytest.raises(HTTPException) as exc:
        await validate_product_metadata(
            FakeDatabase(),
            category_key="apparel",
            product_type_key="t-shirts",
            gender_keys=["men"],
            metadata={"style": ["invented"]},
        )
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_ai_cannot_write_non_ai_metadata():
    with pytest.raises(HTTPException) as exc:
        await validate_product_metadata(
            FakeDatabase(),
            category_key=None,
            product_type_key=None,
            gender_keys=None,
            metadata={"internal_note": "do not expose"},
            partial=True,
            ai_only=True,
        )
    assert exc.value.status_code == 422
