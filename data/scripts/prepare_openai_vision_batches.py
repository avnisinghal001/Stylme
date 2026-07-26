#!/usr/bin/env python3
"""Prepare clothing-only OpenAI Responses Batch JSONL files and a merge manifest."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
from typing import Any, TextIO

from common import PROCESSED_DIR, json_dumps
from openai_vision_common import batch_request, custom_id, load_controls, request_body, vision_schema


DEFAULT_OUTPUT = PROCESSED_DIR / "clothing-30k" / "openai"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--seed-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--target", type=int, default=30_000, help="Apparel images to process")
    parser.add_argument(
        "--all-eligible",
        action="store_true",
        help="Process every eligible row in the input instead of requiring --target rows.",
    )
    parser.add_argument("--model", default="gpt-5.6-luna")
    parser.add_argument("--detail", choices=("low", "high", "original"), default="high")
    parser.add_argument("--reasoning-effort", choices=("none", "low", "medium"), default="low")
    parser.add_argument("--requests-per-file", type=int, default=25_000)
    parser.add_argument("--max-file-mb", type=int, default=190)
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def source_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def open_atomic(path: Path) -> tuple[Path, TextIO]:
    temporary = path.with_suffix(path.suffix + ".tmp")
    return temporary, temporary.open("w", encoding="utf-8")


def main() -> None:
    args = parse_args()
    args.input = args.input.resolve()
    args.seed_dir = args.seed_dir.resolve()
    args.output_dir = args.output_dir.resolve()
    if args.target < 1 and not args.all_eligible:
        raise SystemExit("--target must be positive")
    if not 1 <= args.requests_per_file <= 50_000:
        raise SystemExit("--requests-per-file must be between 1 and 50,000")
    if not 1 <= args.max_file_mb < 200:
        raise SystemExit("--max-file-mb must be between 1 and 199")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    existing = list(args.output_dir.glob("requests-*.jsonl")) + [
        args.output_dir / "manifest.jsonl",
        args.output_dir / "plan.json",
    ]
    existing = [path for path in existing if path.exists()]
    if existing and not args.overwrite:
        raise SystemExit(f"output already exists; pass --overwrite to replace generated artifacts: {existing[0]}")
    if args.overwrite:
        for path in existing:
            path.unlink()

    metadata, colors = load_controls(
        args.seed_dir / "metadata_fields.json",
        args.seed_dir / "colors.jsonl",
    )
    schema = vision_schema(metadata, colors)
    max_file_bytes = args.max_file_mb * 1024 * 1024
    shard_index = 0
    shard_count = 0
    shard_bytes = 0
    shard_path: Path | None = None
    shard_temp: Path | None = None
    shard_handle: TextIO | None = None
    shards: list[dict[str, Any]] = []

    def close_shard() -> None:
        nonlocal shard_handle, shard_temp, shard_path, shard_count, shard_bytes
        if shard_handle is None or shard_temp is None or shard_path is None:
            return
        shard_handle.close()
        os.replace(shard_temp, shard_path)
        shards.append({"path": str(shard_path), "requests": shard_count, "bytes": shard_bytes})
        shard_handle = None
        shard_temp = None
        shard_path = None
        shard_count = 0
        shard_bytes = 0

    manifest_path = args.output_dir / "manifest.jsonl"
    manifest_temp, manifest_handle = open_atomic(manifest_path)
    selected = 0
    seen_custom_ids: set[str] = set()
    try:
        with args.input.open("r", encoding="utf-8", newline="") as source:
            for row_number, row in enumerate(csv.DictReader(source), start=2):
                if row.get("category_key") != "apparel":
                    continue
                image_url = str(row.get("cover_image_url") or "").strip()
                if not image_url.startswith("https://"):
                    continue
                custom = custom_id(row["product_key"])
                if custom in seen_custom_ids:
                    raise SystemExit(f"custom_id collision for {row['product_key']}")
                seen_custom_ids.add(custom)
                current_metadata = json.loads(row["product_metadata_json"])
                body = request_body(
                    model=args.model,
                    detail=args.detail,
                    image_url=image_url,
                    product_key=row["product_key"],
                    title=row["title"],
                    description=row["description"],
                    product_type=row["product_type_key"],
                    current_metadata=current_metadata,
                    schema=schema,
                    reasoning_effort=args.reasoning_effort,
                )
                encoded = (json_dumps(batch_request(custom, body)) + "\n").encode("utf-8")
                if shard_handle is None or shard_count >= args.requests_per_file or (
                    shard_count > 0 and shard_bytes + len(encoded) > max_file_bytes
                ):
                    close_shard()
                    shard_index += 1
                    shard_path = args.output_dir / f"requests-{shard_index:03d}.jsonl"
                    shard_temp, shard_handle = open_atomic(shard_path)
                assert shard_handle is not None
                shard_handle.write(encoded.decode("utf-8"))
                shard_count += 1
                shard_bytes += len(encoded)
                manifest_handle.write(
                    json_dumps(
                        {
                            "customId": custom,
                            "productKey": row["product_key"],
                            "rowNumber": row_number,
                            "imageUrl": image_url,
                            "sourceProductType": row["product_type_key"],
                            "shard": shard_index,
                        }
                    )
                    + "\n"
                )
                selected += 1
                if not args.all_eligible and selected == args.target:
                    break
    finally:
        close_shard()
        manifest_handle.close()
    if not args.all_eligible and selected != args.target:
        manifest_temp.unlink(missing_ok=True)
        raise SystemExit(f"found {selected:,} eligible apparel images; expected {args.target:,}")
    if selected < 1:
        manifest_temp.unlink(missing_ok=True)
        raise SystemExit("found no eligible apparel images")
    os.replace(manifest_temp, manifest_path)
    plan = {
        "version": 1,
        "endpoint": "/v1/responses",
        "model": args.model,
        "detail": args.detail,
        "reasoningEffort": args.reasoning_effort,
        "candidateImages": selected,
        "requiredFinalProducts": selected if args.all_eligible else args.target,
        "input": str(args.input),
        "inputSha256": source_sha256(args.input),
        "manifest": str(manifest_path),
        "shards": shards,
    }
    plan_path = args.output_dir / "plan.json"
    plan_temp = plan_path.with_suffix(".json.tmp")
    plan_temp.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n")
    os.replace(plan_temp, plan_path)
    print(json.dumps(plan, indent=2))


if __name__ == "__main__":
    main()
