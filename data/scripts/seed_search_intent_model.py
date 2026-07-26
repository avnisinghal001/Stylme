#!/usr/bin/env python3
"""Upsert the trained, non-generative search graph into StylMe MongoDB."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPOSITORY_ROOT / "backend"
MODEL_PATH = REPOSITORY_ROOT / "data" / "processed" / "seed" / "search_intent_model.json"
sys.path.insert(0, str(BACKEND_ROOT))

from app.database.connection import mongo_runtime  # noqa: E402


async def seed() -> None:
    model = json.loads(MODEL_PATH.read_text(encoding="utf-8"))
    if model.get("training_rows") != 30_000:
        raise RuntimeError("Search graph must be trained from exactly 30,000 products")
    database = await mongo_runtime.connect()
    try:
        await database.search_intent_models.replace_one(
            {"key": model["key"]},
            model,
            upsert=True,
        )
        await database.search_intent_models.create_index("key", unique=True)
        print(json.dumps({
            "key": model["key"],
            "trainingRows": model["training_rows"],
            "nodes": model["statistics"]["nodes"],
            "edges": model["statistics"]["edges"],
        }))
    finally:
        await mongo_runtime.close()


if __name__ == "__main__":
    asyncio.run(seed())
