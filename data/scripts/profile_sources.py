#!/usr/bin/env python3
"""Stream-profile both Myntra CSV sources without loading either into memory."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from common import (
    PROCESSED_DIR,
    RAW_DIR,
    RICH_JSON_COLUMNS,
    canonical_images,
    category_from_url,
    compact_counter,
    detect_gender_keys,
    extract_pincode,
    extract_product_id,
    parse_float,
    parse_int,
    parse_money_paise,
    safe_json,
    tokenize,
)


@dataclass
class NumericStats:
    count: int = 0
    missing: int = 0
    invalid: int = 0
    minimum: float | None = None
    maximum: float | None = None
    total: float = 0.0

    def add(self, raw: Any, parser) -> None:
        if raw is None or str(raw).strip() == "":
            self.missing += 1
            return
        value = parser(raw)
        if value is None:
            self.invalid += 1
            return
        number = float(value)
        self.count += 1
        self.minimum = number if self.minimum is None else min(self.minimum, number)
        self.maximum = number if self.maximum is None else max(self.maximum, number)
        self.total += number

    def as_dict(self) -> dict[str, Any]:
        return {
            "count": self.count,
            "missing": self.missing,
            "invalid": self.invalid,
            "min": self.minimum,
            "max": self.maximum,
            "mean": self.total / self.count if self.count else None,
        }


def profile_rich(path: Path) -> dict[str, Any]:
    missing: Counter[str] = Counter()
    json_valid: Counter[str] = Counter()
    json_invalid: Counter[str] = Counter()
    sellers: Counter[str] = Counter()
    pincodes: Counter[str] = Counter()
    categories: Counter[str] = Counter()
    genders: Counter[str] = Counter()
    image_counts: Counter[int] = Counter()
    source_ids: set[str] = set()
    numeric = {
        "rating": NumericStats(),
        "ratings_count": NumericStats(),
        "initial_price_paise": NumericStats(),
        "final_price_paise": NumericStats(),
        "discount_percent": NumericStats(),
    }
    rows = malformed = 0
    with path.open("r", encoding="utf-8-sig", errors="replace", newline="") as fh:
        reader = csv.DictReader(fh)
        columns = reader.fieldnames or []
        for row in reader:
            rows += 1
            if None in row or any(value is None for value in row.values()):
                malformed += 1
            for key in columns:
                if not str(row.get(key) or "").strip():
                    missing[key] += 1
            source_id = str(row.get("product_id") or "").strip()
            if source_id:
                source_ids.add(source_id)
            seller = str(row.get("seller_name") or "").strip()
            if seller:
                sellers[seller] += 1
            pincode = extract_pincode(row.get("seller_information"))
            if pincode:
                pincodes[pincode] += 1
            breadcrumbs = safe_json(row.get("breadcrumbs"), [])
            if isinstance(breadcrumbs, list) and breadcrumbs:
                category = str((breadcrumbs[0] or {}).get("name") or "uncategorized")
                categories[category] += 1
            for gender in detect_gender_keys(row.get("product_description"), row.get("url")):
                genders[gender] += 1
            image_counts[len(canonical_images(row.get("images"), json_encoded=True))] += 1
            for key in RICH_JSON_COLUMNS:
                raw = row.get(key)
                if raw is None or str(raw).strip() == "":
                    continue
                try:
                    json.loads(str(raw))
                    json_valid[key] += 1
                except (TypeError, ValueError, json.JSONDecodeError):
                    json_invalid[key] += 1
            numeric["rating"].add(row.get("rating"), parse_float)
            numeric["ratings_count"].add(row.get("ratings_count"), parse_int)
            numeric["initial_price_paise"].add(row.get("initial_price"), parse_money_paise)
            numeric["final_price_paise"].add(row.get("final_price"), parse_money_paise)
            numeric["discount_percent"].add(row.get("discount"), parse_float)
    return {
        "path": str(path),
        "bytes": path.stat().st_size,
        "columns": columns,
        "rows": rows,
        "malformed_rows": malformed,
        "unique_source_product_ids": len(source_ids),
        "missing_by_column": dict(sorted(missing.items())),
        "json_valid_by_column": dict(sorted(json_valid.items())),
        "json_invalid_by_column": dict(sorted(json_invalid.items())),
        "numeric": {key: stats.as_dict() for key, stats in numeric.items()},
        "unique_sellers": len(sellers),
        "top_sellers": compact_counter(sellers, 30),
        "unique_pincodes": len(pincodes),
        "top_pincodes": compact_counter(pincodes, 30),
        "categories": compact_counter(categories, 50),
        "genders": dict(sorted(genders.items())),
        "canonical_image_count_distribution": {
            str(key): value for key, value in sorted(image_counts.items())
        },
    }


def profile_large(path: Path, progress_every: int) -> dict[str, Any]:
    missing: Counter[str] = Counter()
    categories: Counter[str] = Counter()
    unique_categories: Counter[str] = Counter()
    brands: Counter[str] = Counter()
    genders: Counter[str] = Counter()
    image_counts: Counter[int] = Counter()
    tokens: Counter[str] = Counter()
    product_ids: set[int] = set()
    rows = malformed = ids_missing = duplicate_product_rows = 0
    numeric = {
        "price_paise": NumericStats(),
        "mrp_paise": NumericStats(),
        "rating": NumericStats(),
        "rating_total": NumericStats(),
        "discount_percent": NumericStats(),
    }
    with path.open("r", encoding="utf-8-sig", errors="replace", newline="") as fh:
        reader = csv.DictReader(fh)
        columns = reader.fieldnames or []
        for row in reader:
            rows += 1
            if None in row or any(value is None for value in row.values()):
                malformed += 1
            for key in columns:
                if not str(row.get(key) or "").strip():
                    missing[key] += 1
            category = category_from_url(row.get("purl"))
            categories[category] += 1
            brand = str(row.get("seller") or "").strip()
            if brand:
                brands[brand] += 1
            for gender in detect_gender_keys(row.get("name"), row.get("purl")):
                genders[gender] += 1
            image_counts[len(canonical_images(row.get("img")))] += 1
            tokens.update(tokenize(row.get("name")))
            product_id = extract_product_id(row.get("purl"))
            if product_id and product_id.isdigit():
                numeric_id = int(product_id)
                if numeric_id in product_ids:
                    duplicate_product_rows += 1
                else:
                    product_ids.add(numeric_id)
                    unique_categories[category] += 1
            else:
                ids_missing += 1
            numeric["price_paise"].add(row.get("price"), parse_money_paise)
            numeric["mrp_paise"].add(row.get("mrp"), parse_money_paise)
            numeric["rating"].add(row.get("rating"), parse_float)
            numeric["rating_total"].add(row.get("ratingTotal"), parse_int)
            numeric["discount_percent"].add(row.get("discount"), parse_float)
            if progress_every and rows % progress_every == 0:
                print(
                    f"profiled {rows:,} CSV records; {len(product_ids):,} unique products",
                    file=sys.stderr,
                    flush=True,
                )
    return {
        "path": str(path),
        "bytes": path.stat().st_size,
        "columns": columns,
        "csv_records": rows,
        "malformed_rows": malformed,
        "unique_source_product_ids": len(product_ids),
        "duplicate_product_rows": duplicate_product_rows,
        "missing_product_ids": ids_missing,
        "missing_by_column": dict(sorted(missing.items())),
        "numeric": {key: stats.as_dict() for key, stats in numeric.items()},
        "unique_brand_labels": len(brands),
        "top_brand_labels": compact_counter(brands, 50),
        "categories_by_record": compact_counter(categories, 200),
        "categories_by_unique_product": compact_counter(unique_categories, 200),
        "unique_category_counts": dict(sorted(unique_categories.items())),
        "genders_by_record": dict(sorted(genders.items())),
        "canonical_image_count_distribution": {
            str(key): value for key, value in sorted(image_counts.items())
        },
        "top_name_tokens": compact_counter(tokens, 150),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rich", type=Path, default=RAW_DIR / "myntra-product.csv")
    parser.add_argument("--large", type=Path, default=RAW_DIR / "myntra202305041052.csv")
    parser.add_argument("--output", type=Path, default=PROCESSED_DIR / "source_profile.json")
    parser.add_argument("--progress-every", type=int, default=500_000)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = {
        "profile_version": 1,
        "rich_source": profile_rich(args.rich),
        "large_source": profile_large(args.large, args.progress_every),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(args.output)


if __name__ == "__main__":
    main()
