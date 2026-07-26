#!/usr/bin/env python3
"""Select novel apparel rows to fill a strict OpenAI vision merge shortfall."""

from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-input", type=Path, required=True)
    parser.add_argument("--reserve-input", type=Path, required=True)
    parser.add_argument("--merge-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--extra", type=int, default=0, help="Optional buffer beyond the current shortfall")
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def product_keys(path: Path) -> set[str]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return {row["product_key"] for row in csv.DictReader(handle)}


def select_rows(
    reserve_input: Path,
    excluded: set[str],
    count: int,
) -> tuple[list[str], list[dict[str, str]]]:
    with reserve_input.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        fieldnames = reader.fieldnames or []
        rows: list[dict[str, str]] = []
        seen = set(excluded)
        for row in reader:
            product_key = row.get("product_key") or ""
            if (
                product_key in seen
                or row.get("category_key") != "apparel"
                or not str(row.get("cover_image_url") or "").startswith("https://")
            ):
                continue
            seen.add(product_key)
            rows.append(row)
            if len(rows) == count:
                break
    return fieldnames, rows


def main() -> None:
    args = parse_args()
    if args.extra < 0:
        raise SystemExit("--extra cannot be negative")
    if args.output.exists() and not args.overwrite:
        raise SystemExit(f"replacement output exists; pass --overwrite to replace it: {args.output}")
    report = json.loads(args.merge_report.read_text())
    target = int(report["target"])
    accepted = int(report["accepted"])
    shortfall = target - accepted
    if shortfall <= 0:
        raise SystemExit("merge report has no shortfall")
    requested = shortfall + args.extra
    fieldnames, rows = select_rows(args.reserve_input, product_keys(args.base_input), requested)
    if len(rows) != requested:
        raise SystemExit(f"reserve has only {len(rows):,} novel eligible rows; requested {requested:,}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="raise")
        writer.writeheader()
        writer.writerows(rows)
    os.replace(temporary, args.output)
    print(json.dumps({
        "target": target,
        "accepted": accepted,
        "shortfall": shortfall,
        "buffer": args.extra,
        "replacementCandidates": len(rows),
        "output": str(args.output),
    }, indent=2))


if __name__ == "__main__":
    main()
