#!/usr/bin/env python3
"""Validate Codex batch output, write proposals, and optionally create a committed CSV."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any

from color_utils import ColorCatalog
from common import PROCESSED_DIR, json_dumps


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--processed", type=Path, default=PROCESSED_DIR / "processed.csv")
    parser.add_argument("--results", type=Path, default=PROCESSED_DIR / "codex_results.jsonl")
    parser.add_argument("--metadata", type=Path, default=PROCESSED_DIR / "seed" / "metadata_fields.json")
    parser.add_argument("--proposals", type=Path, default=PROCESSED_DIR / "codex_proposals.jsonl")
    parser.add_argument("--commit-output", type=Path, default=None)
    parser.add_argument("--confidence", type=float, default=0.92)
    parser.add_argument("--allow-new-colors", action="store_true")
    parser.add_argument("--expected-results", type=int, default=0, help="Fail unless this many unique products were enriched")
    return parser.parse_args()


def load_results(path: Path) -> dict[str, dict[str, Any]]:
    values: dict[str, dict[str, Any]] = {}
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            batch = json.loads(line)
            for item in batch.get("result", {}).get("results", []):
                product_key = str(item.get("productKey") or "")
                if product_key:
                    if product_key in values:
                        raise SystemExit(f"Duplicate Codex result for {product_key}")
                    values[product_key] = item
    return values


def main() -> None:
    args = parse_args()
    metadata_payload = json.loads(args.metadata.read_text())
    allowed = {
        field["key"]: set(field.get("options", []))
        for field in metadata_payload["fields"]
        if field["storage"] == "product_metadata"
    }
    colors = ColorCatalog()
    results = load_results(args.results)
    if args.expected_results and len(results) != args.expected_results:
        raise SystemExit(f"Expected {args.expected_results} unique Codex results, found {len(results)}")
    proposals: list[dict[str, Any]] = []
    committed: dict[str, dict[str, Any]] = {}
    for product_key, item in sorted(results.items()):
        rejected: list[str] = []
        clean_metadata: dict[str, list[str]] = {}
        for key, values in (item.get("metadata") or {}).items():
            if key not in allowed or not isinstance(values, list):
                rejected.append(f"metadata.{key}")
                continue
            accepted = [value for value in values if value in allowed[key]]
            clean_metadata[key] = accepted
            rejected.extend(f"metadata.{key}:{value}" for value in values if value not in allowed[key])
        clean_colors: list[dict[str, Any]] = []
        has_new_color = False
        for raw in item.get("colors") or []:
            match = colors.resolve(name=raw.get("name"), hex_value=raw.get("hex"), source="ai_image")
            is_new = match.key not in colors.records
            has_new_color = has_new_color or is_new
            clean_colors.append({**match.as_dict(), "action": "create_new" if is_new else "use_existing", "evidence": raw.get("evidence")})
        confidence = float(item.get("confidence") or 0)
        can_commit = confidence >= args.confidence and not rejected and (args.allow_new_colors or not has_new_color)
        proposal = {
            "productKey": product_key,
            "status": "accepted_for_commit" if can_commit else "needs_review",
            "confidence": confidence,
            "title": item.get("title"),
            "description": item.get("description"),
            "metadata": clean_metadata,
            "colors": clean_colors,
            "rejectedValues": rejected,
            "warnings": item.get("warnings") or [],
            "missingInfo": item.get("missingInfo") or [],
        }
        proposals.append(proposal)
        if can_commit:
            committed[product_key] = proposal

    args.proposals.parent.mkdir(parents=True, exist_ok=True)
    with args.proposals.open("w", encoding="utf-8") as fh:
        for proposal in proposals:
            fh.write(json_dumps(proposal) + "\n")

    committed_rows = 0
    if args.commit_output:
        with args.processed.open("r", encoding="utf-8", newline="") as source:
            reader = csv.DictReader(source)
            fieldnames = reader.fieldnames or []
            args.commit_output.parent.mkdir(parents=True, exist_ok=True)
            with args.commit_output.open("w", encoding="utf-8", newline="") as target:
                writer = csv.DictWriter(target, fieldnames=fieldnames)
                writer.writeheader()
                for row in reader:
                    proposal = committed.get(row["product_key"])
                    if proposal:
                        row["title"] = str(proposal["title"] or row["title"])
                        row["description"] = str(proposal["description"] or row["description"])
                        current = json.loads(row["product_metadata_json"])
                        current.update({key: values for key, values in proposal["metadata"].items() if values})
                        row["product_metadata_json"] = json_dumps(current)
                        system = json.loads(row["product_system_metadata_json"])
                        system.setdefault("pipeline", {})["codexEnrichmentStatus"] = "committed"
                        system["pipeline"]["codexConfidence"] = proposal["confidence"]
                        row["product_system_metadata_json"] = json_dumps(system)
                        committed_rows += 1
                    writer.writerow(row)
    print(json.dumps({"results": len(results), "proposals": len(proposals), "commitEligible": len(committed), "rowsCommitted": committed_rows}, indent=2))


if __name__ == "__main__":
    main()
