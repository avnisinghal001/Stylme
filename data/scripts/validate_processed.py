#!/usr/bin/env python3
"""Validate the processed CSV and seed manifests before MongoDB ingestion."""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path
from typing import Any

from build_processed import CSV_COLUMNS, CURATED_POLICY, is_policy_excluded
from common import PROCESSED_DIR, json_dumps


JSON_COLUMNS = [
    "gender_keys_json",
    "product_metadata_json",
    "media_json",
    "color_palette_json",
    "rating_json",
    "source_details_json",
    "product_system_metadata_json",
    "seller_metadata_json",
    "location_place_json",
    "location_geo_json",
    "offer_details_json",
    "variants_json",
    "inventory_json",
    "fit_bounds_json",
    "age_bounds_json",
    "available_size_keys_json",
    "available_color_keys_json",
    "available_color_family_keys_json",
    "offer_metadata_json",
    "quality_flags_json",
]


def load_jsonl_keys(path: Path) -> set[str]:
    result: set[str] = set()
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                result.add(json.loads(line)["key"])
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=PROCESSED_DIR / "processed.csv")
    parser.add_argument("--seed-dir", type=Path, default=PROCESSED_DIR / "seed")
    parser.add_argument(
        "--supplemental-seed-dir",
        type=Path,
        action="append",
        default=[],
        help="Additional seed directories that may supply replacement entities.",
    )
    parser.add_argument("--expected-rows", type=int, default=30_000)
    parser.add_argument(
        "--required-category",
        action="append",
        default=[],
        help="Fail if any row is outside this category allow-list; repeat as needed.",
    )
    parser.add_argument(
        "--required-quality-flag",
        action="append",
        default=[],
        help="Fail if a row lacks this quality/audit flag; repeat as needed.",
    )
    parser.add_argument("--output", type=Path, default=PROCESSED_DIR / "validation_report.json")
    parser.add_argument(
        "--policy",
        choices=[CURATED_POLICY],
        help="Validate strict exclusions and deep personalization coverage.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    metadata_payload = json.loads((args.seed_dir / "metadata_fields.json").read_text())
    fields = {field["key"]: field for field in metadata_payload["fields"]}
    controlled_product_fields = {
        key: set(field.get("options", []))
        for key, field in fields.items()
        if field["storage"] == "product_metadata"
    }
    seed_dirs = [args.seed_dir, *args.supplemental_seed_dir]
    color_keys = set().union(*(load_jsonl_keys(path / "colors.jsonl") for path in seed_dirs))
    brand_keys = set().union(*(load_jsonl_keys(path / "brands.jsonl") for path in seed_dirs))
    seller_keys = set().union(*(load_jsonl_keys(path / "sellers.jsonl") for path in seed_dirs))
    location_keys = set().union(*(load_jsonl_keys(path / "seller_locations.jsonl") for path in seed_dirs))

    errors: list[dict[str, Any]] = []
    warnings: Counter[str] = Counter()
    categories: Counter[str] = Counter()
    product_types: Counter[str] = Counter()
    sources: Counter[str] = Counter()
    color_usage: Counter[str] = Counter()
    flags: Counter[str] = Counter()
    variant_counts: Counter[int] = Counter()
    total_variants = 0
    total_inventory_entries = 0
    applicable_variant_fit_ranges = 0
    non_applicable_variant_fit_envelopes = 0
    product_keys: set[str] = set()
    offer_codes: set[str] = set()
    slugs: set[str] = set()
    rows = 0
    cohort_counts: Counter[str] = Counter()

    def error(row_number: int, code: str, detail: str) -> None:
        if len(errors) < 500:
            errors.append({"row": row_number, "code": code, "detail": detail})

    with args.input.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames != CSV_COLUMNS:
            error(1, "header_mismatch", "Processed CSV columns differ from pipeline contract")
        for row_number, row in enumerate(reader, start=2):
            rows += 1
            required_text = (
                "source",
                "source_product_id",
                "source_url",
                "product_key",
                "brand_key",
                "brand_name",
                "title",
                "normalized_title",
                "slug",
                "description",
                "category_key",
                "product_type_key",
                "search_text",
                "seller_key",
                "seller_name",
                "location_key",
                "location_address",
                "location_pincode",
                "offer_code",
                "currency",
            )
            for column in required_text:
                if not str(row.get(column) or "").strip():
                    error(row_number, "missing_required_field", column)
            parsed: dict[str, Any] = {}
            for column in JSON_COLUMNS:
                try:
                    parsed[column] = json.loads(row[column])
                except (TypeError, json.JSONDecodeError) as exc:
                    error(row_number, "invalid_json", f"{column}: {exc}")
                    parsed[column] = None
            for field_name, seen in (
                ("product_key", product_keys),
                ("offer_code", offer_codes),
                ("slug", slugs),
            ):
                value = row[field_name]
                if value in seen:
                    error(row_number, "duplicate_key", f"{field_name}={value}")
                seen.add(value)
            if row["brand_key"] not in brand_keys:
                error(row_number, "unknown_brand", row["brand_key"])
            if row["seller_key"] not in seller_keys:
                error(row_number, "unknown_seller", row["seller_key"])
            if row["location_key"] not in location_keys:
                error(row_number, "unknown_location", row["location_key"])
            if len(row["location_pincode"]) != 6 or not row["location_pincode"].isdigit():
                error(row_number, "invalid_pincode", row["location_pincode"])
            try:
                mrp = int(row["mrp_paise"])
                sale = int(row["sale_price_paise"])
                discount = float(row["discount_percent"])
                if not (0 < sale <= mrp and 0 <= discount <= 100):
                    error(row_number, "invalid_price", f"mrp={mrp}, sale={sale}, discount={discount}")
            except ValueError:
                error(row_number, "invalid_price_type", "price fields are not numeric")

            metadata = parsed.get("product_metadata_json")
            if isinstance(metadata, dict):
                for key, values in metadata.items():
                    if key not in controlled_product_fields:
                        error(row_number, "unknown_metadata_key", key)
                        continue
                    if not isinstance(values, list):
                        error(row_number, "metadata_not_array", key)
                        continue
                    invalid = set(values) - controlled_product_fields[key]
                    if invalid:
                        error(row_number, "unknown_metadata_value", f"{key}: {sorted(invalid)}")
                if args.policy == CURATED_POLICY:
                    missing_personalization = {
                        key
                        for key in (
                            "generation",
                            "personalization_segment",
                            "aesthetic",
                            "dress_code",
                            "body_fit_preference",
                        )
                        if not metadata.get(key)
                    }
                    if missing_personalization:
                        error(
                            row_number,
                            "missing_personalization_metadata",
                            str(sorted(missing_personalization)),
                        )
                    if "festive-first" in metadata.get("personalization_segment", []):
                        cohort_counts["festive"] += 1
                    if "gen-z" in metadata.get("generation", []):
                        cohort_counts["genZ"] += 1
                    if "gen-alpha" in metadata.get("generation", []):
                        cohort_counts["genAlpha"] += 1
                    if not missing_personalization:
                        cohort_counts["deepPersonalization"] += 1

            variants = parsed.get("variants_json")
            inventory = parsed.get("inventory_json")
            available_colors = parsed.get("available_color_keys_json")
            if isinstance(available_colors, list):
                unknown_colors = set(available_colors) - color_keys
                if unknown_colors:
                    error(row_number, "unknown_color", str(sorted(unknown_colors)))
                color_usage.update(available_colors)
            if not isinstance(variants, list) or not variants:
                error(row_number, "missing_variants", "offer has no variants")
                variants = []
            variant_counts[len(variants)] += 1
            total_variants += len(variants)
            variant_ids: set[str] = set()
            variant_color_keys: set[str] = set()
            for variant in variants:
                variant_id = variant.get("id")
                color_key = variant.get("colorKey")
                if not variant_id or variant_id in variant_ids:
                    error(row_number, "invalid_variant_id", str(variant_id))
                variant_ids.add(variant_id)
                for field_name in ("sku", "sizeKey", "source"):
                    if not isinstance(variant.get(field_name), str) or not variant[field_name].strip():
                        error(row_number, "missing_variant_field", field_name)
                for field_name in ("measurements", "attributes"):
                    if not isinstance(variant.get(field_name), dict):
                        error(row_number, "invalid_variant_object", field_name)
                if not isinstance(color_key, str) or color_key not in color_keys:
                    error(row_number, "invalid_variant_color", str(color_key))
                else:
                    variant_color_keys.add(color_key)
                fit = variant.get("fitRange")
                if not isinstance(fit, dict) or not isinstance(fit.get("applicable"), bool):
                    error(row_number, "missing_fit_profile", str(fit))
                else:
                    confidence = fit.get("confidence")
                    if not isinstance(fit.get("source"), str) or not fit["source"].strip():
                        error(row_number, "missing_fit_source", str(fit))
                    if (
                        not isinstance(confidence, (int, float))
                        or isinstance(confidence, bool)
                        or not 0 <= confidence <= 1
                    ):
                        error(row_number, "invalid_fit_confidence", str(confidence))
                    bound_keys = ("minHeightCm", "maxHeightCm", "minWeightKg", "maxWeightKg")
                    if fit["applicable"]:
                        applicable_variant_fit_ranges += 1
                        if not all(type(fit.get(key)) is int for key in bound_keys):
                            error(row_number, "invalid_fit_range", str(fit))
                        elif not (
                            fit["minHeightCm"] <= fit["maxHeightCm"]
                            and fit["minWeightKg"] <= fit["maxWeightKg"]
                        ):
                            error(row_number, "inverted_fit_range", str(fit))
                    else:
                        non_applicable_variant_fit_envelopes += 1
                        if any(fit.get(key) is not None for key in bound_keys):
                            error(row_number, "non_applicable_fit_has_bounds", str(fit))
                age = variant.get("ageRange")
                if not isinstance(age, dict) or not isinstance(age.get("applicable"), bool):
                    error(row_number, "missing_age_profile", str(age))
                elif age["applicable"]:
                    if not all(type(age.get(key)) in (int, float) for key in ("minAge", "maxAge")):
                        error(row_number, "invalid_age_range", str(age))
                    elif age["minAge"] > age["maxAge"]:
                        error(row_number, "inverted_age_range", str(age))
                elif age.get("minAge") is not None or age.get("maxAge") is not None:
                    error(row_number, "non_applicable_age_has_bounds", str(age))
            if isinstance(available_colors, list) and set(available_colors) != variant_color_keys:
                error(
                    row_number,
                    "variant_color_facet_mismatch",
                    f"facets={sorted(available_colors)}, variants={sorted(variant_color_keys)}",
                )
            if not isinstance(inventory, list) or not inventory:
                error(row_number, "missing_inventory", "offer has no inventory")
                inventory = []
            total_inventory_entries += len(inventory)
            inventory_variant_ids: list[str] = []
            for item in inventory:
                inventory_variant_ids.append(item.get("variantId"))
                if item.get("variantId") not in variant_ids:
                    error(row_number, "inventory_unknown_variant", str(item.get("variantId")))
                if item.get("locationKey") != row["location_key"]:
                    error(row_number, "inventory_location_mismatch", str(item.get("locationKey")))
                if not isinstance(item.get("availableQty"), int) or item["availableQty"] <= 0:
                    error(row_number, "invalid_inventory_quantity", str(item.get("availableQty")))
            if len(inventory_variant_ids) != len(set(inventory_variant_ids)):
                error(row_number, "duplicate_variant_inventory", str(inventory_variant_ids))
            if set(inventory_variant_ids) != variant_ids:
                error(row_number, "variant_inventory_coverage_mismatch", row["offer_code"])
            fit_bounds = parsed.get("fit_bounds_json")
            if not isinstance(fit_bounds, dict) or not isinstance(fit_bounds.get("applicable"), bool):
                error(row_number, "missing_offer_fit_bounds", str(fit_bounds))
            elif fit_bounds["applicable"]:
                bound_keys = ("minHeightCm", "maxHeightCm", "minWeightKg", "maxWeightKg")
                if not all(type(fit_bounds.get(key)) is int for key in bound_keys):
                    error(row_number, "invalid_offer_fit_bounds", str(fit_bounds))
                elif not (
                    fit_bounds["minHeightCm"] <= fit_bounds["maxHeightCm"]
                    and fit_bounds["minWeightKg"] <= fit_bounds["maxWeightKg"]
                ):
                    error(row_number, "inverted_offer_fit_bounds", str(fit_bounds))
            elif any(
                fit_bounds.get(key) is not None
                for key in ("minHeightCm", "maxHeightCm", "minWeightKg", "maxWeightKg")
            ):
                error(row_number, "non_applicable_offer_fit_has_bounds", str(fit_bounds))
            age_bounds = parsed.get("age_bounds_json")
            if not isinstance(age_bounds, dict) or not isinstance(age_bounds.get("applicable"), bool):
                error(row_number, "missing_offer_age_bounds", str(age_bounds))
            elif age_bounds["applicable"] and (
                not all(type(age_bounds.get(key)) in (int, float) for key in ("minAge", "maxAge"))
                or age_bounds["minAge"] > age_bounds["maxAge"]
            ):
                error(row_number, "invalid_offer_age_bounds", str(age_bounds))
            elif not age_bounds["applicable"] and (
                age_bounds.get("minAge") is not None or age_bounds.get("maxAge") is not None
            ):
                error(row_number, "non_applicable_offer_age_has_bounds", str(age_bounds))
            media = parsed.get("media_json")
            if not isinstance(media, list) or not media:
                warnings["missing_media"] += 1
            row_flags = parsed.get("quality_flags_json")
            if isinstance(row_flags, list):
                flags.update(row_flags)
                missing_flags = set(args.required_quality_flag) - set(row_flags)
                if missing_flags:
                    error(row_number, "required_quality_flag_missing", str(sorted(missing_flags)))
            elif args.required_quality_flag:
                error(row_number, "required_quality_flag_missing", str(sorted(args.required_quality_flag)))
            categories[row["category_key"]] += 1
            if args.required_category and row["category_key"] not in args.required_category:
                error(
                    row_number,
                    "category_not_allowed",
                    f"expected one of {sorted(args.required_category)}, got {row['category_key']}",
                )
            product_types[row["product_type_key"]] += 1
            if args.policy == CURATED_POLICY and is_policy_excluded(
                row["product_type_key"], row["title"], row["source_url"]
            ):
                error(row_number, "catalogue_policy_exclusion", row["product_type_key"])
            sources[row["source"]] += 1

    if rows != args.expected_rows:
        error(0, "row_count_mismatch", f"expected={args.expected_rows}, actual={rows}")
    report = {
        "valid": not errors,
        "rows": rows,
        "errors": errors,
        "warnings": dict(sorted(warnings.items())),
        "uniqueCounts": {
            "products": len(product_keys),
            "offers": len(offer_codes),
            "slugs": len(slugs),
            "brands": len(brand_keys),
            "sellers": len(seller_keys),
            "sellerLocations": len(location_keys),
            "colors": len(color_keys),
            "categoriesUsed": len(categories),
            "productTypesUsed": len(product_types),
        },
        "sources": dict(sorted(sources.items())),
        "cataloguePolicy": args.policy,
        "cohortCounts": dict(sorted(cohort_counts.items())),
        "ingestionCounts": {
            "variants": total_variants,
            "inventoryEntries": total_inventory_entries,
            "applicableVariantFitRanges": applicable_variant_fit_ranges,
            "nonApplicableVariantFitEnvelopes": non_applicable_variant_fit_envelopes,
        },
        "topCategories": categories.most_common(30),
        "topProductTypes": product_types.most_common(30),
        "colorUsage": color_usage.most_common(),
        "qualityFlags": flags.most_common(),
        "variantCountDistribution": {str(key): value for key, value in sorted(variant_counts.items())},
    }
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({key: report[key] for key in ("valid", "rows", "uniqueCounts", "sources")}, indent=2))
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
