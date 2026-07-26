#!/usr/bin/env python3
"""Idempotently seed StylMe MongoDB collections from processed.csv.

The default mode is a local dry-run. MongoDB is touched only with --apply.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from common import DATA_ROOT, PROCESSED_DIR, normalize_text, slugify, stable_hash


PROJECT_ROOT = DATA_ROOT.parent


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            values[key] = value
    return values


def first_configured(file_env: dict[str, str], keys: tuple[str, ...]) -> tuple[str | None, str]:
    for key in keys:
        value = str(os.environ.get(key) or file_env.get(key) or "").strip()
        if value:
            return key, value
    return None, ""


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def chunks(values: list[Any], size: int) -> Iterable[list[Any]]:
    for index in range(0, len(values), size):
        yield values[index : index + size]


def bool_value(value: Any) -> bool:
    return str(value).strip().lower() in {"true", "1", "yes"}


def metadata_field_document(field: dict[str, Any]) -> dict[str, Any]:
    return {
        "key": field["key"],
        "label": field["label"],
        "description": field.get("description"),
        "group": field["group"],
        "data_type": field["dataType"],
        "storage": field["storage"],
        "storage_path": field["storagePath"],
        "control": field["control"],
        "options": [
            option if isinstance(option, dict) else {"key": option, "label": option.replace("-", " ").title(), "active": True}
            for option in field.get("options", [])
        ],
        "validation": field.get("validation", {}),
        "filterable": bool(field.get("filterable")),
        "searchable": bool(field.get("searchable")),
        "gemini_allowed": bool(field.get("geminiAllowed")),
        "frontend_visible": bool(field.get("frontendVisible")),
        "usage_frequency": field.get("usageFrequency", "long_tail"),
        "sort_order": int(field.get("sortOrder", 0)),
        "schema_version": int(field.get("schemaVersion", 1)),
        "status": field.get("status", "active"),
        "metadata": field.get("metadata", {}),
    }


def geocode_locations(locations: list[dict[str, Any]], skip: bool) -> None:
    if skip:
        return
    try:
        import pgeocode  # type: ignore[import-not-found]
    except ImportError as exc:
        raise SystemExit("pgeocode is required unless --skip-geocode is used") from exc
    geocoder = pgeocode.Nominatim("in")
    cache: dict[str, dict[str, Any]] = {}
    for location in locations:
        pincode = location["pincode"]
        if pincode not in cache:
            value = geocoder.query_postal_code(pincode)
            latitude = getattr(value, "latitude", None)
            longitude = getattr(value, "longitude", None)
            try:
                latitude_value = float(latitude)
                longitude_value = float(longitude)
                resolved = math.isfinite(latitude_value) and math.isfinite(longitude_value)
            except (TypeError, ValueError):
                latitude_value = longitude_value = 0.0
                resolved = False
            cache[pincode] = {
                "place": {
                    "city": getattr(value, "place_name", None),
                    "district": getattr(value, "county_name", None),
                    "state": getattr(value, "state_name", None),
                    "countryCode": "IN",
                },
                "geo_point": {"type": "Point", "coordinates": [longitude_value, latitude_value]} if resolved else None,
                "geocode_resolved": resolved,
            }
        location.update(cache[pincode])


def ensure_indexes(db) -> None:
    from pymongo import ASCENDING, DESCENDING, GEOSPHERE, TEXT

    db.users.create_index([("email", ASCENDING)], unique=True)
    db.users.create_index(
        [("phone_e164", ASCENDING)],
        unique=True,
        partialFilterExpression={"phone_e164": {"$type": "string"}},
    )
    db.users.create_index([("roles", ASCENDING), ("status", ASCENDING)])
    db.sellers.create_index([("user_id", ASCENDING)], unique=True)
    db.sellers.create_index([("slug", ASCENDING)], unique=True)
    db.sellers.create_index([("status", ASCENDING)])
    db.seller_locations.create_index([("geo_point", GEOSPHERE)])
    db.seller_locations.create_index([("seller_id", ASCENDING), ("status", ASCENDING)])
    db.seller_locations.create_index([("pincode", ASCENDING), ("swoopstyl_enabled", ASCENDING), ("status", ASCENDING)])
    db.brands.create_index([("normalized_name", ASCENDING)], unique=True)
    db.brands.create_index([("slug", ASCENDING)], unique=True)
    db.colors.create_index([("key", ASCENDING)], unique=True)
    db.colors.create_index([("normalized_name", ASCENDING)], unique=True)
    db.metadata_fields.create_index([("key", ASCENDING)], unique=True)
    db.search_intent_models.create_index([("key", ASCENDING)], unique=True)
    db.pincode_geos.create_index([("country_code", ASCENDING), ("pincode", ASCENDING)], unique=True)
    db.pincode_geos.create_index([("geo_point", GEOSPHERE)])
    db.products.create_index(
        [("source", ASCENDING), ("source_product_id", ASCENDING)],
        unique=True,
        partialFilterExpression={"source": {"$type": "string"}, "source_product_id": {"$type": "string"}},
    )
    db.products.create_index(
        [("slug", ASCENDING)],
        unique=True,
        partialFilterExpression={"slug": {"$type": "string"}},
    )
    db.products.create_index([("status", ASCENDING), ("visibility", ASCENDING), ("category_key", ASCENDING), ("product_type_key", ASCENDING)])
    db.products.create_index([("search_text", TEXT)])
    db.products.create_index([("metadata.$**", ASCENDING)])
    db.seller_offers.create_index([("offer_code", ASCENDING)], unique=True)
    db.seller_offers.create_index([("product_id", ASCENDING), ("status", ASCENDING)])
    db.seller_offers.create_index([("seller_id", ASCENDING), ("status", ASCENDING)])
    db.available_filter_cache.create_index([("cache_key", ASCENDING)], unique=True)
    db.available_filter_cache.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0)
    db.carts.create_index([("user_id", ASCENDING)], unique=True)
    db.orders.create_index([("order_number", ASCENDING)], unique=True)
    db.orders.create_index([("user_id", ASCENDING), ("placed_at", DESCENDING)])
    db.audit_logs.create_index([("entity_type", ASCENDING), ("entity_id", ASCENDING), ("created_at", DESCENDING)])


def bulk_upsert(collection, operations: list[Any], batch_size: int) -> None:
    for batch in chunks(operations, batch_size):
        if batch:
            collection.bulk_write(batch, ordered=False)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=PROCESSED_DIR / "processed.csv")
    parser.add_argument("--validation", type=Path, default=PROCESSED_DIR / "validation_report.json")
    parser.add_argument("--seed-dir", type=Path, default=PROCESSED_DIR / "seed")
    parser.add_argument(
        "--shared-seed-dir",
        type=Path,
        default=PROCESSED_DIR / "seed",
        help="Fallback location for shared artifacts such as the search intent model.",
    )
    parser.add_argument("--import-key", default="", help="Stable idempotent import-job key")
    parser.add_argument("--env-file", type=Path, default=PROJECT_ROOT / ".env")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--skip-geocode", action="store_true")
    parser.add_argument(
        "--prune-managed-catalog",
        action="store_true",
        help="After a successful upsert, delete only old Myntra products/offers absent from this input.",
    )
    parser.add_argument("--apply", action="store_true", help="Required to connect and write to MongoDB")
    parser.add_argument("--check-connection", action="store_true", help="Ping MongoDB without writing")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    validation = json.loads(args.validation.read_text())
    if not validation.get("valid"):
        raise SystemExit("validation_report.json is not valid; run validate_processed.py")
    manifests = {
        "brands": read_jsonl(args.seed_dir / "brands.jsonl"),
        "sellers": read_jsonl(args.seed_dir / "sellers.jsonl"),
        "seller_locations": read_jsonl(
            args.seed_dir / "seller_locations.geocoded.jsonl"
            if (args.seed_dir / "seller_locations.geocoded.jsonl").exists()
            else args.seed_dir / "seller_locations.jsonl"
        ),
        "colors": read_jsonl(args.seed_dir / "colors.jsonl"),
    }
    metadata_fields = json.loads((args.seed_dir / "metadata_fields.json").read_text())["fields"]
    app_configs = json.loads((args.seed_dir / "app_configs.json").read_text())
    search_model_path = args.seed_dir / "search_intent_model.json"
    if not search_model_path.exists():
        search_model_path = args.shared_seed_dir / "search_intent_model.json"
    search_intent_model = json.loads(search_model_path.read_text())
    catalogue_config = next((item for item in app_configs if item.get("key") == "catalogue"), {})
    import_key = str(
        args.import_key
        or ((catalogue_config.get("metadata") or {}).get("pipeline") or {}).get("seed")
        or f"stylme-{validation['rows']}-products"
    )
    plan = {
        "mode": "apply" if args.apply else "connection-check" if args.check_connection else "dry-run",
        "products": validation["rows"],
        "offers": validation["rows"],
        "brands": len(manifests["brands"]),
        "sellers": len(manifests["sellers"]),
        "sellerUsers": len(manifests["sellers"]),
        "sellerLocations": len(manifests["seller_locations"]),
        "colors": len(manifests["colors"]),
        "metadataFields": len(metadata_fields),
        "appConfigs": len(app_configs),
        "searchIntentModelNodes": len(search_intent_model.get("nodes", {})),
        "pruneManagedCatalog": args.prune_managed_catalog,
    }
    if not args.apply and not args.check_connection:
        print(json.dumps(plan, indent=2))
        print("Dry-run only. Re-run with --apply to perform idempotent MongoDB upserts.")
        return

    # Select only Mongo settings; unrelated AI/image secrets in the root file
    # are never copied into this process environment.
    file_env = read_env_file(args.env_file)
    uri_key, uri = first_configured(file_env, ("MONGODB_URL", "MONGODB_URI"))
    database_key, database_name = first_configured(file_env, ("MONGODB_DB_NAME", "DATABASE_NAME"))
    database_name = database_name or "stylme"
    if not uri:
        raise SystemExit(f"MONGODB_URL (or MONGODB_URI) is required in {args.env_file}")
    try:
        from pymongo import MongoClient, UpdateOne
    except ImportError as exc:
        raise SystemExit("Install data/requirements.txt before using --apply") from exc
    client = MongoClient(uri, serverSelectionTimeoutMS=10_000)
    try:
        client.admin.command("ping")
    except Exception as exc:
        detail = str(exc)
        phase = (
            "tls-before-authentication"
            if any(value in detail.lower() for value in ("ssl", "tls", "alert internal"))
            else "server-selection-or-authentication"
        )
        raise SystemExit(
            json.dumps(
                {
                    "status": "connection-failed",
                    "envFile": str(args.env_file),
                    "uriVariable": uri_key,
                    "databaseVariable": database_key,
                    "phase": phase,
                    "action": "Verify the matching Atlas cluster is active, this machine's public IP is allowed, and the database user can connect.",
                    "error": detail,
                },
                indent=2,
            )
        ) from None
    if args.check_connection:
        print(
            json.dumps(
                {
                    **plan,
                    "status": "connected",
                    "envFile": str(args.env_file),
                    "uriVariable": uri_key,
                    "databaseVariable": database_key,
                    "database": database_name,
                },
                indent=2,
            )
        )
        client.close()
        return
    db = client[database_name]
    ensure_indexes(db)

    bulk_upsert(
        db.metadata_fields,
        [UpdateOne({"key": field["key"]}, {"$set": metadata_field_document(field)}, upsert=True) for field in metadata_fields],
        args.batch_size,
    )
    bulk_upsert(
        db.app_configs,
        [UpdateOne({"key": item["key"]}, {"$set": item}, upsert=True) for item in app_configs],
        args.batch_size,
    )
    db.search_intent_models.replace_one({"key": search_intent_model["key"]}, search_intent_model, upsert=True)
    color_ops = []
    for item in manifests["colors"]:
        document = {
            "key": item["key"],
            "name": item["name"],
            "normalized_name": normalize_text(item["name"]),
            "hex": item.get("hex"),
            "primary_family_key": item["primaryFamilyKey"],
            "family_keys": item["familyKeys"],
            "aliases": item.get("aliases", []),
            "status": "active",
            "metadata": {"pipeline": {"source": item.get("source"), "confidence": item.get("confidence")}},
        }
        color_ops.append(UpdateOne({"key": item["key"]}, {"$set": document}, upsert=True))
    bulk_upsert(db.colors, color_ops, args.batch_size)
    bulk_upsert(
        db.brands,
        [
            UpdateOne(
                {"metadata.pipeline.key": item["key"]},
                {
                    "$set": {
                        "name": item["name"],
                        "normalized_name": item["normalized_name"],
                        "slug": item["slug"],
                        "aliases": item["aliases"],
                        "status": "active",
                        "simulation_mode": False,
                        "metadata": {"pipeline": {"key": item["key"], "sources": item["sources"], "dedupeMethods": item["dedupe_methods"]}},
                    }
                },
                upsert=True,
            )
            for item in manifests["brands"]
        ],
        args.batch_size,
    )
    brand_ids = {item["metadata"]["pipeline"]["key"]: item["_id"] for item in db.brands.find({}, {"metadata.pipeline.key": 1})}
    color_ids = {item["key"]: item["_id"] for item in db.colors.find({}, {"key": 1})}

    user_ops = []
    for seller in manifests["sellers"]:
        suffix = f"{stable_hash(seller['key'], 'seller-user'):016x}"
        email = f"seller+{suffix}@seed.stylme.invalid"
        user_ops.append(
            UpdateOne(
                {"email": email},
                {
                    "$set": {
                        "email": email,
                        "full_name": seller["name"],
                        "avatar_url": None,
                        "status": "active",
                        "roles": ["seller"],
                        "onboarding_completed": True,
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
                        "metadata": {"pipeline": {"sellerKey": seller["key"], "simulationMode": True}},
                    }
                },
                upsert=True,
            )
        )
    bulk_upsert(db.users, user_ops, args.batch_size)
    user_ids = {item["metadata"]["pipeline"]["sellerKey"]: item["_id"] for item in db.users.find({"metadata.pipeline.sellerKey": {"$exists": True}}, {"metadata.pipeline.sellerKey": 1})}
    seller_ops = []
    for item in manifests["sellers"]:
        seller_ops.append(
            UpdateOne(
                {"metadata.pipeline.key": item["key"]},
                {
                    "$set": {
                        "user_id": user_ids[item["key"]],
                        "display_name": item["name"],
                        "normalized_name": item["normalized_name"],
                        "slug": item["slug"],
                        "legal_details": None,
                        "contact": {},
                        "status": "approved",
                        "rejection_reason": None,
                        "approved_by_user_id": None,
                        "approved_at": None,
                        "brand_ids": [brand_ids[key] for key in item.get("brand_keys", []) if key in brand_ids],
                        "simulation_mode": True,
                        "source_ref": None,
                        "metadata": {"pipeline": {"key": item["key"], "sources": item["sources"], "dedupeMethods": item["dedupe_methods"]}},
                    }
                },
                upsert=True,
            )
        )
    bulk_upsert(db.sellers, seller_ops, args.batch_size)
    seller_ids = {item["metadata"]["pipeline"]["key"]: item["_id"] for item in db.sellers.find({}, {"metadata.pipeline.key": 1})}

    geocode_locations(manifests["seller_locations"], args.skip_geocode)
    pincode_documents: dict[str, dict[str, Any]] = {}
    for item in manifests["seller_locations"]:
        pincode_documents[item["pincode"]] = {
            "country_code": "IN",
            "pincode": item["pincode"],
            "place": item.get("place", {}),
            "geo_point": item.get("geo_point"),
            "resolved": bool(item.get("geocode_resolved")),
            "metadata": {"pipeline": {"source": "pgeocode", "seeded": True}},
            "refreshed_at": datetime.now(timezone.utc),
        }
    bulk_upsert(
        db.pincode_geos,
        [
            UpdateOne(
                {"country_code": "IN", "pincode": pincode},
                {"$set": document},
                upsert=True,
            )
            for pincode, document in pincode_documents.items()
        ],
        args.batch_size,
    )
    location_ops = []
    for item in manifests["seller_locations"]:
        document = dict(item)
        document.pop("key", None)
        document.pop("seller_key", None)
        document["seller_id"] = seller_ids[item["seller_key"]]
        document.setdefault("metadata", {}).setdefault("pipeline", {})["key"] = item["key"]
        location_ops.append(UpdateOne({"metadata.pipeline.key": item["key"]}, {"$set": document}, upsert=True))
    bulk_upsert(db.seller_locations, location_ops, args.batch_size)
    location_ids = {item["metadata"]["pipeline"]["key"]: item["_id"] for item in db.seller_locations.find({}, {"metadata.pipeline.key": 1})}

    product_ops = []
    input_product_keys: set[tuple[str, str]] = set()
    with args.input.open("r", encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            input_product_keys.add((row["source"], row["source_product_id"]))
            palette = json.loads(row["color_palette_json"])
            for value in palette:
                value["color_id"] = color_ids.get(value.pop("colorKey", None))
                value["families"] = value.pop("familyKeys", value.get("families", []))
                value["primary_family_key"] = value.pop(
                    "primaryFamilyKey", value.get("primary_family_key")
                )
            product = {
                "source": row["source"],
                "source_product_id": row["source_product_id"],
                "source_url": row["source_url"],
                "brand_id": brand_ids[row["brand_key"]],
                "title": row["title"],
                "normalized_title": row["normalized_title"],
                "slug": row["slug"],
                "description": row["description"],
                "status": row["status"],
                "visibility": row["visibility"],
                "category_key": row["category_key"],
                "product_type_key": row["product_type_key"],
                "gender_keys": json.loads(row["gender_keys_json"]),
                "metadata": json.loads(row["product_metadata_json"]),
                "media": json.loads(row["media_json"]),
                "cover_image_url": row["cover_image_url"] or None,
                "color_palette": palette,
                "rating": json.loads(row["rating_json"]),
                "source_details": json.loads(row["source_details_json"]),
                "search_text": row["search_text"],
                "simulation_mode": bool_value(row["product_simulation_mode"]),
                "created_by_user_id": None,
                "system_metadata": json.loads(row["product_system_metadata_json"]),
            }
            product_ops.append(UpdateOne({"source": row["source"], "source_product_id": row["source_product_id"]}, {"$set": product}, upsert=True))
            if len(product_ops) >= args.batch_size:
                bulk_upsert(db.products, product_ops, args.batch_size)
                product_ops = []
    bulk_upsert(db.products, product_ops, args.batch_size)
    product_ids = {
        (item["source"], item["source_product_id"]): item["_id"]
        for item in db.products.find(
            {"source": {"$type": "string"}, "source_product_id": {"$type": "string"}},
            {"source": 1, "source_product_id": 1},
        )
    }

    offer_ops = []
    with args.input.open("r", encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            variants = json.loads(row["variants_json"])
            for variant in variants:
                variant["color_id"] = color_ids[variant.pop("colorKey")]
            inventory = json.loads(row["inventory_json"])
            for value in inventory:
                value["location_id"] = location_ids[value.pop("locationKey")]
            offer = {
                "product_id": product_ids[(row["source"], row["source_product_id"])],
                "seller_id": seller_ids[row["seller_key"]],
                "brand_id": brand_ids[row["brand_key"]],
                "offer_code": row["offer_code"],
                "status": "active",
                "currency": row["currency"],
                "mrp_paise": int(row["mrp_paise"]),
                "sale_price_paise": int(row["sale_price_paise"]),
                "discount_percent": float(row["discount_percent"]),
                "offer_details": json.loads(row["offer_details_json"]),
                "variants": variants,
                "inventory": inventory,
                "fit_bounds": json.loads(row["fit_bounds_json"]),
                "age_bounds": json.loads(row["age_bounds_json"]),
                "available_size_keys": json.loads(row["available_size_keys_json"]),
                "available_color_ids": [color_ids[key] for key in json.loads(row["available_color_keys_json"])],
                "available_color_family_keys": json.loads(row["available_color_family_keys_json"]),
                "location_ids": [location_ids[row["location_key"]]],
                "simulation_mode": bool_value(row["offer_simulation_mode"]),
                "created_by_user_id": None,
                "metadata": json.loads(row["offer_metadata_json"]),
            }
            offer_ops.append(UpdateOne({"offer_code": row["offer_code"]}, {"$set": offer}, upsert=True))
            if len(offer_ops) >= args.batch_size:
                bulk_upsert(db.seller_offers, offer_ops, args.batch_size)
                offer_ops = []
    bulk_upsert(db.seller_offers, offer_ops, args.batch_size)
    pruned_products = 0
    pruned_offers = 0
    if args.prune_managed_catalog:
        keep_ids = [product_ids[key] for key in input_product_keys]
        obsolete_ids = [
            item["_id"]
            for item in db.products.find(
                {
                    "source": {"$in": ["myntra_detailed", "myntra_large"]},
                    "_id": {"$nin": keep_ids},
                },
                {"_id": 1},
            )
        ]
        for obsolete_batch in chunks(obsolete_ids, args.batch_size):
            pruned_offers += db.seller_offers.delete_many(
                {"product_id": {"$in": obsolete_batch}}
            ).deleted_count
            pruned_products += db.products.delete_many(
                {"_id": {"$in": obsolete_batch}}
            ).deleted_count
    db.import_jobs.update_one(
        {"metadata.pipeline.key": import_key},
        {
            "$set": {
                "filename": "myntra-product.csv + myntra202305041052.csv",
                "source": "myntra_mixed",
                "status": "completed",
                "counts": {"total": validation["rows"], "valid": validation["rows"], "imported": validation["rows"], "rejected": 0},
                "mapping": {"schemaVersion": 1, "processedFile": args.input.name},
                "simulation_seed": import_key,
                "errors": [],
                "started_by_user_id": None,
                "metadata": {"pipeline": {"key": import_key, "idempotent": True}},
                "started_at": datetime.now(timezone.utc),
                "completed_at": datetime.now(timezone.utc),
            }
        },
        upsert=True,
    )
    print(
        json.dumps(
            {
                **plan,
                "database": database_name,
                "status": "seeded",
                "prunedProducts": pruned_products,
                "prunedOffers": pruned_offers,
            },
            indent=2,
        )
    )
    client.close()


if __name__ == "__main__":
    main()
