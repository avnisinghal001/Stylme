#!/usr/bin/env python3
"""Convert processed.csv into compact JSON batches for local Codex enrichment."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any

from common import PROCESSED_DIR, json_dumps, stable_hash


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=PROCESSED_DIR / "processed.csv")
    parser.add_argument("--output", type=Path, default=PROCESSED_DIR / "ai_batches.jsonl")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--limit", type=int, default=0, help="0 means all products")
    parser.add_argument("--only-flagged", action="store_true")
    parser.add_argument("--seed", default="stylme-codex-batches-v1")
    return parser.parse_args()


def ai_item(row: dict[str, str]) -> dict[str, Any]:
    return {
        "productKey": row["product_key"],
        "title": row["title"],
        "description": row["description"],
        "brand": row["brand_name"],
        "categoryKey": row["category_key"],
        "productTypeKey": row["product_type_key"],
        "genderKeys": json.loads(row["gender_keys_json"]),
        "metadata": json.loads(row["product_metadata_json"]),
    }


def main() -> None:
    args = parse_args()
    if args.batch_size < 1 or args.batch_size > 100:
        raise SystemExit("--batch-size must be between 1 and 100")
    candidates: list[tuple[int, dict[str, Any]]] = []
    with args.input.open("r", encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            flags = set(json.loads(row["quality_flags_json"]))
            if args.only_flagged and not flags.intersection(
                {
                    "description_needs_ai_enrichment",
                    "color_needs_image_or_ai_review",
                    "variants_simulated",
                }
            ):
                continue
            item = ai_item(row)
            candidates.append((stable_hash(item["productKey"], args.seed), item))
    candidates.sort(key=lambda value: value[0])
    if args.limit:
        candidates = candidates[: args.limit]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as fh:
        for index in range(0, len(candidates), args.batch_size):
            items = [item for _, item in candidates[index : index + args.batch_size]]
            batch = {
                "batchId": f"batch-{index // args.batch_size + 1:05d}",
                "intentSchemaVersion": 1,
                "items": items,
            }
            fh.write(json_dumps(batch) + "\n")
    print(json.dumps({"eligibleProducts": len(candidates), "batches": (len(candidates) + args.batch_size - 1) // args.batch_size, "output": str(args.output)}, indent=2))


if __name__ == "__main__":
    main()
