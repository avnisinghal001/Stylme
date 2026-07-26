#!/usr/bin/env python3
"""Train StylMe's small token-to-filter correlation graph.

This is deliberately not a generative model.  It learns weighted associations
between catalogue wording and allowlisted advanced-search filters, then writes
one compact JSON document that can be atomically upserted into MongoDB.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from common import PROCESSED_DIR, normalize_text, safe_json


MODEL_KEY = "catalogue-token-filter-v2"
STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "buy", "for", "from",
    "in", "is", "it", "of", "on", "or", "the", "this", "to", "with", "wear",
    "collection", "design", "fashion", "look", "online", "product", "shop", "style",
    "pack", "set", "piece", "pieces", "men", "women", "boys", "girls", "kids",
}
LABEL_COLUMNS = {
    "category": "category_key",
    "product_type": "product_type_key",
    "gender": "gender_keys_json",
}


def features(row: dict[str, str]) -> set[str]:
    # Do not train from search_text: it already contains output labels and would
    # leak the target into the input.  Shopper-visible title/description only.
    text = normalize_text(f"{row.get('title', '')} {row.get('description', '')}")
    tokens = [
        token for token in text.split()
        if len(token) >= 2 and not token.isdigit() and token not in STOPWORDS
    ][:80]
    output = set(tokens)
    for width in (2, 3):
        output.update(" ".join(tokens[index:index + width]) for index in range(len(tokens) - width + 1))
    return {term for term in output if len(term) <= 72}


def labels(row: dict[str, str]) -> set[tuple[str, str]]:
    output: set[tuple[str, str]] = set()
    for field, column in LABEL_COLUMNS.items():
        raw = row.get(column, "")
        values = safe_json(raw, []) if column.endswith("_json") else [raw]
        if not isinstance(values, list):
            continue
        for value in values:
            normalized = str(value or "").strip()
            if normalized and normalized != "unspecified":
                output.add((field, normalized))
    metadata = safe_json(row.get("product_metadata_json"), {})
    if isinstance(metadata, dict):
        for field, values in metadata.items():
            if not isinstance(values, list):
                values = [values]
            for value in values:
                normalized = str(value or "").strip()
                if normalized:
                    output.add((str(field), normalized))
    return output


def rows(path: Path) -> Iterable[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        yield from csv.DictReader(handle)


def train(
    input_path: Path,
    *,
    minimum_support: int,
    maximum_term_documents: int,
    maximum_nodes: int,
    maximum_edges: int,
) -> dict[str, Any]:
    term_documents: Counter[str] = Counter()
    label_documents: Counter[tuple[str, str]] = Counter()
    training_rows = 0
    for row in rows(input_path):
        training_rows += 1
        term_documents.update(features(row))
        label_documents.update(labels(row))

    candidates = {
        term for term, count in term_documents.items()
        if minimum_support <= count <= maximum_term_documents
    }
    joint: dict[str, Counter[tuple[str, str]]] = defaultdict(Counter)
    for row in rows(input_path):
        row_labels = labels(row)
        if not row_labels:
            continue
        for term in features(row) & candidates:
            joint[term].update(row_labels)

    graph: list[tuple[str, list[dict[str, Any]], float]] = []
    for term, correlations in joint.items():
        term_count = term_documents[term]
        edges: list[dict[str, Any]] = []
        for (field, value), support in correlations.items():
            if support < minimum_support:
                continue
            label_count = label_documents[(field, value)]
            precision = support / term_count
            prior = label_count / training_rows
            lift = precision / prior if prior else 0.0
            if precision < 0.16 or lift < 1.45:
                continue
            pmi = math.log(max(lift, 1e-9))
            npmi = pmi / -math.log(support / training_rows)
            reliability = support / (support + 8)
            lift_signal = min(1.0, math.log2(max(lift, 1.0)) / 6)
            confidence = reliability * (0.58 * precision + 0.27 * max(0.0, npmi) + 0.15 * lift_signal)
            if confidence < 0.30:
                continue
            edges.append(
                {
                    "field": field,
                    "value": value,
                    "confidence": round(min(confidence, 0.999), 4),
                    "support": support,
                    "precision": round(precision, 4),
                    "lift": round(lift, 3),
                }
            )
        edges.sort(key=lambda item: (-item["confidence"], -item["support"], item["field"], item["value"]))
        # A phrase should not fan out to hundreds of weak facets.  Retain at
        # most one value per field, then cap the node for bounded inference.
        unique_fields: list[dict[str, Any]] = []
        seen_fields: set[str] = set()
        for edge in edges:
            if edge["field"] in seen_fields:
                continue
            seen_fields.add(edge["field"])
            unique_fields.append(edge)
            if len(unique_fields) >= maximum_edges:
                break
        if unique_fields:
            graph.append((term, unique_fields, unique_fields[0]["confidence"]))

    graph.sort(key=lambda item: (-item[2], -len(item[0].split()), -term_documents[item[0]], item[0]))
    graph = graph[:maximum_nodes]
    nodes = {term: edges for term, edges, _ in sorted(graph, key=lambda item: item[0])}
    return {
        "key": MODEL_KEY,
        "version": 2,
        "model_type": "weighted-pmi-token-filter-graph",
        "status": "active",
        "training_rows": training_rows,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "feature_source": "title+description",
        "thresholds": {
            "minimum_support": minimum_support,
            "maximum_term_documents": maximum_term_documents,
            "runtime_minimum_confidence": 0.52,
            "maximum_query_features": 120,
        },
        "statistics": {
            "candidate_terms": len(candidates),
            "nodes": len(nodes),
            "edges": sum(len(edges) for edges in nodes.values()),
            "labels": len(label_documents),
        },
        "nodes": nodes,
        "metadata": {
            "pipeline": "stylme-30000-v1",
            "runtime": "deterministic-no-llm",
            "target_allowlist": sorted({field for field, _ in label_documents}),
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=PROCESSED_DIR / "processed.csv")
    parser.add_argument("--output", type=Path, default=PROCESSED_DIR / "seed" / "search_intent_model.json")
    parser.add_argument("--minimum-support", type=int, default=6)
    parser.add_argument("--maximum-term-documents", type=int, default=6000)
    parser.add_argument("--maximum-nodes", type=int, default=6500)
    parser.add_argument("--maximum-edges", type=int, default=4)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    model = train(
        args.input,
        minimum_support=args.minimum_support,
        maximum_term_documents=args.maximum_term_documents,
        maximum_nodes=args.maximum_nodes,
        maximum_edges=args.maximum_edges,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(model, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({**model["statistics"], "trainingRows": model["training_rows"], "output": str(args.output), "bytes": args.output.stat().st_size}, indent=2))


if __name__ == "__main__":
    main()
