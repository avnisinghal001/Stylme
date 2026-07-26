from __future__ import annotations

import argparse
import asyncio
import json
import math
from collections import Counter
from typing import Any, Dict

from app.core.config import settings
from app.database.connection import mongo_runtime
from app.schemas.taxonomy_reconciler import ReconcilerRunRequest
from app.services.indian_search_demand import (
    DEMAND_PACK_VERSION,
    INDIAN_SEARCH_DEMAND,
)
from app.services.taxonomy_reconciler_service import (
    FASHION_SEARCH_EXCLUDED_PRODUCT_TYPES,
    FORBIDDEN_PRODUCT_TEXT_PATTERN,
    apply_retag_proposals,
    query_hash,
    record_search_outcome,
    run_reconciler,
    utcnow,
)


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Seed the controlled Indian/Hinglish/Hindi search-demand pack and "
            "run the idempotent taxonomy reconciler."
        )
    )
    parser.add_argument("--apply", action="store_true", help="Apply only auto-eligible proposals.")
    parser.add_argument(
        "--full-catalogue",
        action="store_true",
        help="Reset the scan cursor and cover every eligible product once.",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Continue a full-catalogue pass from the persisted product cursor.",
    )
    parser.add_argument("--rebuild-graph", action="store_true")
    parser.add_argument("--use-ai", action="store_true")
    parser.add_argument("--seed-only", action="store_true")
    parser.add_argument("--batch-size", type=int, default=1000, choices=range(1, 1001))
    parser.add_argument(
        "--max-batches",
        type=int,
        default=0,
        help="Optional safety cap; zero means all calculated batches.",
    )
    return parser.parse_args()


async def seed_demand(database) -> Dict[str, Any]:
    seeded = 0
    skipped = 0
    for item in INDIAN_SEARCH_DEMAND:
        query = str(item["query"])
        digest = query_hash(query)
        existing = await database.search_query_failures.find_one(
            {"query_hash": digest},
            {"seed_versions": 1},
        )
        if DEMAND_PACK_VERSION in (existing or {}).get("seed_versions", []):
            skipped += 1
            continue
        document = await record_search_outcome(
            database,
            raw_query=query,
            result_count=0,
            source="api",
            intent={
                "confidence": 1.0,
                "parser": DEMAND_PACK_VERSION,
                "nodes": [
                    {
                        "field": field,
                        "value": value,
                        "score": weight,
                    }
                    for field, value, weight in item["targets"]
                ],
            },
            resolved_query={},
        )
        if document:
            await database.search_query_failures.update_one(
                {"_id": document["_id"]},
                {
                    "$addToSet": {
                        "seed_versions": DEMAND_PACK_VERSION,
                        "seed_groups": item["group"],
                        "seed_languages": item["language"],
                    },
                    "$set": {"seeded_demand": True},
                },
            )
            seeded += 1
    return {
        "version": DEMAND_PACK_VERSION,
        "queries": len(INDIAN_SEARCH_DEMAND),
        "seeded": seeded,
        "alreadySeeded": skipped,
        "languages": dict(Counter(str(item["language"]) for item in INDIAN_SEARCH_DEMAND)),
        "groups": dict(Counter(str(item["group"]) for item in INDIAN_SEARCH_DEMAND)),
    }


def eligible_query() -> Dict[str, Any]:
    return {
        "status": "active",
        "visibility": "public",
        "product_type_key": {
            "$nin": sorted(FASHION_SEARCH_EXCLUDED_PRODUCT_TYPES)
        },
        "$nor": [
            {
                field: {
                    "$regex": FORBIDDEN_PRODUCT_TEXT_PATTERN,
                    "$options": "i",
                }
            }
            for field in ("title", "description", "search_text")
        ],
    }


async def reconcile(database, args: argparse.Namespace) -> Dict[str, Any]:
    started_at = utcnow()
    eligible_products = await database.products.count_documents(eligible_query())
    products_to_scan = eligible_products
    if args.full_catalogue and args.resume:
        state = await database.taxonomy_reconciler_state.find_one(
            {"key": "product-cursor"}
        ) or {}
        cursor = state.get("last_product_id")
        if cursor:
            remaining_query = eligible_query()
            remaining_query["_id"] = {"$gt": cursor}
            products_to_scan = await database.products.count_documents(
                remaining_query
            )
    batches = math.ceil(products_to_scan / args.batch_size) if args.full_catalogue else 1
    if args.max_batches:
        batches = min(batches, args.max_batches)
    if args.full_catalogue and not args.resume:
        await database.taxonomy_reconciler_state.update_one(
            {"key": "product-cursor"},
            {
                "$unset": {"last_product_id": ""},
                "$set": {
                    "updated_at": started_at,
                    "reset_reason": DEMAND_PACK_VERSION,
                },
            },
            upsert=True,
        )

    totals = Counter()
    runs = []
    for index in range(batches):
        request = ReconcilerRunRequest(
            max_queries=100,
            max_products=args.batch_size,
            graph_depth=4,
            # AI enriches only the first graph build. Subsequent batches reuse
            # the persisted graph and never retry a failed provider call.
            use_ai=bool(args.use_ai and index == 0),
            rebuild_graph=bool(args.rebuild_graph and index == 0),
            apply=args.apply,
        )
        result = await run_reconciler(
            database,
            request,
            requested_by=f"script:{DEMAND_PACK_VERSION}",
        )
        summary = result.get("summary") or {}
        runs.append(result["runId"])
        for key in (
            "queriesProcessed",
            "productsScanned",
            "targetTags",
            "proposalsStaged",
            "retagsSelected",
            "retagsApplied",
            "retagsStale",
        ):
            totals[key] += int(summary.get(key) or 0)
        print(
            json.dumps(
                {
                    "batch": index + 1,
                    "batches": batches,
                    "runId": result["runId"],
                    "summary": summary,
                },
                default=str,
                separators=(",", ":"),
            ),
            flush=True,
        )

    drain_batches = 0
    if args.apply:
        while True:
            drained = await apply_retag_proposals(
                database,
                minimum_confidence=settings.TAXONOMY_RECONCILER_AUTO_APPLY_CONFIDENCE,
                limit=1000,
                include_auto=True,
                actor=None,
                run_id=runs[-1] if runs else f"script:{DEMAND_PACK_VERSION}",
            )
            if not drained["selected"]:
                break
            drain_batches += 1
            totals["retagsSelected"] += int(drained["selected"])
            totals["retagsApplied"] += int(drained["applied"])
            totals["retagsStale"] += int(drained["stale"])
            print(
                json.dumps(
                    {
                        "drainBatch": drain_batches,
                        "retags": drained,
                    },
                    separators=(",", ":"),
                ),
                flush=True,
            )

    status_counts = {
        status: await database.taxonomy_retag_proposals.count_documents(
            {"status": status}
        )
        for status in ("proposed", "approved", "applied", "stale", "rejected")
    }
    products_updated = await database.products.count_documents(
        {"system_metadata.reconciliation.updated_at": {"$gte": started_at}}
    )
    return {
        "eligibleProducts": eligible_products,
        "productsScheduled": products_to_scan,
        "batchSize": args.batch_size,
        "batchesCompleted": len(runs),
        "proposalDrainBatches": drain_batches,
        "apply": args.apply,
        "totals": dict(totals),
        "proposalStatusCounts": status_counts,
        "productsUpdatedThisRun": products_updated,
        "firstRunId": runs[0] if runs else None,
        "lastRunId": runs[-1] if runs else None,
    }


async def main() -> None:
    args = arguments()
    database = await mongo_runtime.connect()
    try:
        seed = await seed_demand(database)
        output: Dict[str, Any] = {"seed": seed}
        if not args.seed_only:
            output["reconciliation"] = await reconcile(database, args)
        print(json.dumps(output, default=str, indent=2))
    finally:
        await mongo_runtime.close()


if __name__ == "__main__":
    asyncio.run(main())
