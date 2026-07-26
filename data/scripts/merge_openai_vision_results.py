#!/usr/bin/env python3
"""Validate OpenAI vision batch output and write the exact clothing-only ingestion CSV."""

from __future__ import annotations

import argparse
import csv
import json
import os
from collections import Counter
from pathlib import Path
from typing import Any

from color_utils import ColorCatalog
from common import PROCESSED_DIR, json_dumps
from openai_vision_common import (
    load_controls,
    response_output_text,
    validate_analysis,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument(
        "--replacement-input",
        type=Path,
        action="append",
        default=[],
        help="Accepted-fill candidate CSV; repeat in the same order as --replacement-plan.",
    )
    parser.add_argument(
        "--replacement-plan",
        type=Path,
        action="append",
        default=[],
        help="Collected OpenAI plan for the matching replacement input.",
    )
    parser.add_argument("--seed-dir", type=Path, required=True)
    parser.add_argument("--state", type=Path, default=None)
    parser.add_argument(
        "--result",
        type=Path,
        action="append",
        default=[],
        help="Collected output JSONL; repeat to bypass batch-state discovery (useful for pilots/retries).",
    )
    parser.add_argument("--output", type=Path, default=PROCESSED_DIR / "clothing-30k" / "processed.openai.csv")
    parser.add_argument("--report", type=Path, default=PROCESSED_DIR / "clothing-30k" / "openai_merge_report.json")
    parser.add_argument("--target", type=int, default=30_000)
    parser.add_argument("--min-confidence", type=float, default=0.80)
    return parser.parse_args()


def load_manifest(path: Path) -> dict[str, dict[str, Any]]:
    values: dict[str, dict[str, Any]] = {}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            item = json.loads(line)
            custom = item["customId"]
            if custom in values:
                raise SystemExit(f"duplicate custom ID in manifest: {custom}")
            values[custom] = item
    return values


def result_paths(plan_path: Path, state_path: Path | None) -> list[Path]:
    state_file = state_path or (plan_path.parent / "batch-state.json")
    if not state_file.exists():
        raise SystemExit(f"batch state not found: {state_file}")
    state_files = [state_file]
    if state_path is None:
        state_files.extend(sorted(plan_path.parent.glob("retry-*/batch-state.json")))
    paths: list[Path] = []
    for current_state in state_files:
        state = json.loads(current_state.read_text())
        paths.extend(
            Path(item["outputPath"])
            for item in state.get("batches", [])
            if item.get("outputPath")
        )
    if not paths:
        raise SystemExit("batch state has no collected output files")
    missing = [path for path in paths if not path.exists()]
    if missing:
        raise SystemExit(f"collected output is missing: {missing[0]}")
    return paths


def load_results(
    paths: list[Path],
    manifest: dict[str, dict[str, Any]],
    metadata: dict[str, list[str]],
    colors: list[str],
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    results: dict[str, dict[str, Any]] = {}
    failures: list[dict[str, Any]] = []
    for path in paths:
        with path.open(encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                if not line.strip():
                    continue
                envelope = json.loads(line)
                custom = str(envelope.get("custom_id") or "")
                mapping = manifest.get(custom)
                if not mapping:
                    failures.append({"customId": custom, "reason": "unknown_custom_id", "file": str(path), "line": line_number})
                    continue
                product_key = mapping["productKey"]
                if product_key in results:
                    failures.append({"customId": custom, "productKey": product_key, "reason": "duplicate_result"})
                    continue
                try:
                    response = envelope.get("response") or {}
                    if int(response.get("status_code") or 0) != 200:
                        raise ValueError(f"HTTP {response.get('status_code')}")
                    body = response.get("body") or {}
                    analysis = validate_analysis(
                        json.loads(response_output_text(body)), metadata, colors
                    )
                    results[product_key] = {
                        "analysis": analysis,
                        "customId": custom,
                        "usage": body.get("usage") or {},
                    }
                except (TypeError, ValueError, json.JSONDecodeError) as exc:
                    failures.append({"customId": custom, "productKey": product_key, "reason": str(exc)[:500]})
    return results, failures


def vision_palette(keys: list[str], confidence: float, catalog: ColorCatalog) -> list[dict[str, Any]]:
    values: list[dict[str, Any]] = []
    for key in keys:
        match = catalog.get(key, source="openai_vision", confidence=confidence).as_dict()
        match["colorKey"] = match.pop("key")
        match.pop("aliases", None)
        values.append(match)
    return values


def main() -> None:
    args = parse_args()
    if args.target < 1:
        raise SystemExit("--target must be positive")
    if not 0 <= args.min_confidence <= 1:
        raise SystemExit("--min-confidence must be between 0 and 1")
    if len(args.replacement_input) != len(args.replacement_plan):
        raise SystemExit("--replacement-input and --replacement-plan counts must match")
    plan_paths = [args.plan, *args.replacement_plan]
    plans = [json.loads(path.read_text()) for path in plan_paths]
    plan = plans[0]
    if any(item.get("model") != plan.get("model") or item.get("detail") != plan.get("detail") for item in plans):
        raise SystemExit("all source and replacement plans must use the same model and image detail")
    manifest: dict[str, dict[str, Any]] = {}
    for current_plan in plans:
        for custom, item in load_manifest(Path(current_plan["manifest"])).items():
            if custom in manifest:
                raise SystemExit(f"duplicate custom ID across plans: {custom}")
            manifest[custom] = item
    metadata, colors = load_controls(
        args.seed_dir / "metadata_fields.json",
        args.seed_dir / "colors.jsonl",
    )
    collected_paths = args.result or [
        result
        for index, current_plan_path in enumerate(plan_paths)
        for result in result_paths(current_plan_path, args.state if index == 0 else None)
    ]
    results, failures = load_results(collected_paths, manifest, metadata, colors)
    catalog = ColorCatalog()
    rejection_counts: Counter[str] = Counter()
    rejections: list[dict[str, Any]] = []
    accepted_rows: list[dict[str, str]] = []
    seen_product_keys: set[str] = set()
    total_usage = {"inputTokens": 0, "outputTokens": 0, "reasoningTokens": 0}
    for result in results.values():
        usage = result["usage"]
        total_usage["inputTokens"] += int(usage.get("input_tokens") or 0)
        total_usage["outputTokens"] += int(usage.get("output_tokens") or 0)
        total_usage["reasoningTokens"] += int(
            (usage.get("output_tokens_details") or {}).get("reasoning_tokens") or 0
        )
    fieldnames: list[str] = []
    for input_path in [args.input, *args.replacement_input]:
        with input_path.open("r", encoding="utf-8", newline="") as source:
            reader = csv.DictReader(source)
            current_fieldnames = reader.fieldnames or []
            if fieldnames and current_fieldnames != fieldnames:
                raise SystemExit(f"replacement CSV fields do not match the base input: {input_path}")
            fieldnames = current_fieldnames
            for row in reader:
                reason: str | None = None
                if row.get("category_key") != "apparel":
                    reason = "source_not_apparel"
                result = results.get(row["product_key"])
                if reason is None and not result:
                    reason = "missing_or_failed_result"
                analysis = result["analysis"] if result else None
                if reason is None and not analysis["isClothing"]:
                    reason = "vision_not_clothing"
                if reason is None and not analysis["sourceTypeMatchesImage"]:
                    reason = "source_image_mismatch"
                if reason is None and analysis["imageQuality"] == "poor":
                    reason = "poor_image"
                if reason is None and float(analysis["confidence"]) < args.min_confidence:
                    reason = "low_confidence"
                if reason is not None:
                    rejection_counts[reason] += 1
                    rejections.append(
                        {
                            "productKey": row.get("product_key"),
                            "reason": reason,
                            "customId": result.get("customId") if result else None,
                            "input": str(input_path),
                        }
                    )
                    continue
                assert analysis is not None and result is not None
                current_metadata = json.loads(row["product_metadata_json"])
                for key, values in analysis["metadata"].items():
                    if values:
                        current_metadata[key] = values
                row["product_metadata_json"] = json_dumps(current_metadata)

                current_palette = json.loads(row["color_palette_json"])
                if any(item.get("colorKey") == "unspecified" for item in current_palette):
                    current_palette = [item for item in current_palette if item.get("colorKey") != "unspecified"]
                known_colors = {item.get("colorKey") for item in current_palette}
                current_palette.extend(
                    item
                    for item in vision_palette(
                        analysis["dominantColorKeys"], float(analysis["confidence"]), catalog
                    )
                    if item["colorKey"] not in known_colors
                )
                row["color_palette_json"] = json_dumps(current_palette)

                system = json.loads(row["product_system_metadata_json"])
                pipeline = system.setdefault("pipeline", {})
                pipeline["aiEnrichmentStatus"] = "openai_vision_verified"
                pipeline["openaiVision"] = {
                    "model": plan["model"],
                    "detail": plan["detail"],
                    "confidence": analysis["confidence"],
                    "imageQuality": analysis["imageQuality"],
                    "sourceTypeMatchesImage": analysis["sourceTypeMatchesImage"],
                    "warnings": analysis["warnings"],
                    "customId": result["customId"],
                }
                pipeline.setdefault("fieldSources", {})["metadata"] = "openai_vision"
                pipeline["fieldSources"]["colors"] = "source_text_plus_openai_vision"
                row["product_system_metadata_json"] = json_dumps(system)
                flags = set(json.loads(row["quality_flags_json"]))
                flags.add("openai_vision_verified")
                flags.discard("color_needs_image_or_ai_review")
                row["quality_flags_json"] = json_dumps(sorted(flags))
                if row["product_key"] in seen_product_keys:
                    raise SystemExit(f"duplicate accepted product key: {row['product_key']}")
                seen_product_keys.add(row["product_key"])
                accepted_rows.append(row)
                if len(accepted_rows) == args.target:
                    break
        if len(accepted_rows) == args.target:
            break

    report = {
        "valid": len(accepted_rows) == args.target,
        "target": args.target,
        "accepted": len(accepted_rows),
        "sourceCandidates": len(manifest),
        "validResults": len(results),
        "failures": failures[:500],
        "failureCount": len(failures),
        "rejectionCounts": dict(sorted(rejection_counts.items())),
        "rejections": rejections,
        "usage": total_usage,
        "model": plan["model"],
        "detail": plan["detail"],
        "minConfidence": args.min_confidence,
        "plans": [str(path) for path in plan_paths],
        "output": str(args.output),
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    console_report = {
        key: value for key, value in report.items() if key not in {"failures", "rejections"}
    }
    if len(accepted_rows) != args.target:
        print(json.dumps(console_report, indent=2))
        raise SystemExit(
            f"accepted {len(accepted_rows):,} clothing images; target is {args.target:,}. "
            "Retry failed requests and prepare replacement apparel candidates before ingestion."
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=fieldnames, extrasaction="raise")
        writer.writeheader()
        writer.writerows(accepted_rows)
    os.replace(temporary, args.output)
    print(json.dumps(console_report, indent=2))


if __name__ == "__main__":
    main()
