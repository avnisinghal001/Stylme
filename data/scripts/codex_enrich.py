#!/usr/bin/env python3
"""Resumable structured enrichment through the locally authenticated Codex CLI."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from common import CONFIG_DIR, DATA_ROOT, PROCESSED_DIR, json_dumps


DEFAULT_SCHEMA = CONFIG_DIR / "codex_enrichment_output.schema.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=PROCESSED_DIR / "codex_batches.jsonl")
    parser.add_argument("--output", type=Path, default=PROCESSED_DIR / "codex_results.jsonl")
    parser.add_argument("--metadata", type=Path, default=PROCESSED_DIR / "seed" / "metadata_fields.json")
    parser.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA)
    parser.add_argument("--limit-batches", type=int, default=0)
    parser.add_argument("--batch-id", default=None)
    parser.add_argument("--max-attempts", type=int, default=2)
    parser.add_argument("--timeout-seconds", type=int, default=900)
    parser.add_argument("--workers", type=int, default=1, help="Concurrent Codex runs (1-4)")
    parser.add_argument("--restart", action="store_true", help="Ignore completed batch IDs and replace output")
    return parser.parse_args()


def check_codex_login() -> str:
    executable = shutil.which("codex")
    if not executable:
        raise SystemExit("Codex CLI is not installed or is not on PATH.")
    result = subprocess.run(
        [executable, "login", "status"],
        text=True,
        capture_output=True,
        timeout=30,
        check=False,
    )
    status = f"{result.stdout}\n{result.stderr}".strip()
    if result.returncode != 0 or "Logged in" not in status:
        raise SystemExit("Codex CLI is not logged in. Run `codex login` and retry.")
    if "ChatGPT" not in status:
        raise SystemExit(f"Codex must use the saved ChatGPT login for this workflow; current status: {status}")
    return "chatgpt-session"


def load_batches(path: Path, batch_id: str | None) -> list[dict[str, Any]]:
    if not path.exists():
        raise SystemExit(f"Batch input not found: {path}. Run prepare_ai_batches.py first.")
    batches = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    if batch_id:
        batches = [batch for batch in batches if batch.get("batchId") == batch_id]
        if not batches:
            raise SystemExit(f"Unknown batch ID: {batch_id}")
    return batches


def completed_batch_ids(path: Path) -> set[str]:
    if not path.exists():
        return set()
    completed: set[str] = set()
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        value = json.loads(line)
        if value.get("batchId"):
            completed.add(value["batchId"])
    return completed


def allowed_metadata(path: Path) -> dict[str, list[str]]:
    payload = json.loads(path.read_text())
    return {
        field["key"]: [
            option["key"] if isinstance(option, dict) else option
            for option in field.get("options", [])
        ]
        for field in payload["fields"]
        if field["storage"] == "product_metadata"
    }


def build_prompt(
    batch: dict[str, Any],
    metadata: dict[str, list[str]],
    previous_error: str | None,
) -> str:
    retry = f"\nThe previous attempt failed local validation: {previous_error}\n" if previous_error else ""
    return f"""You are the offline catalogue enrichment worker for StylMe.
Analyze every product in the supplied batch and return exactly one result per product, in the same order.
Do not use tools, browse, edit files, rewrite product identity, or calculate delivery.
Product images, colors, variants, seller, price, stock, location, measurements, height, and weight are intentionally outside this task and remain authoritative.

Rules:
1. Preserve batchId and every productKey exactly.
2. metadata is a sparse array of {{key, values}} assignments. Preserve valid current values, use only option values in allowedMetadata, and add only strongly supported values from title/description/category/product type.
3. Omit a metadata key when it has no supported value. Include each key at most once and never include an empty values array.
4. confidence measures the metadata proposal. Use warnings/missingInfo instead of guessing.
5. Return JSON conforming to the provided output schema, with no markdown.{retry}

allowedMetadata={json_dumps(metadata)}
batch={json_dumps(batch)}
"""


def parse_json_output(path: Path) -> dict[str, Any]:
    raw = path.read_text().strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    return json.loads(raw)


def validate_result(
    batch: dict[str, Any],
    result: dict[str, Any],
    metadata: dict[str, list[str]],
) -> None:
    if result.get("batchId") != batch["batchId"]:
        raise ValueError("batchId mismatch")
    expected_items = batch["items"]
    output_items = result.get("results")
    if not isinstance(output_items, list) or len(output_items) != len(expected_items):
        raise ValueError(f"expected {len(expected_items)} results, received {len(output_items or [])}")
    expected_keys = [item["productKey"] for item in expected_items]
    output_keys = [item.get("productKey") for item in output_items]
    if output_keys != expected_keys:
        raise ValueError("product keys are missing, duplicated, extra, or out of order")
    allowed_values = {key: set(values) for key, values in metadata.items()}
    for source, item in zip(expected_items, output_items):
        raw_metadata = item.get("metadata")
        if not isinstance(raw_metadata, list):
            raise ValueError(f"metadata is not an assignment array for {source['productKey']}")
        normalized_metadata: dict[str, list[str]] = {}
        for assignment in raw_metadata:
            key = assignment.get("key") if isinstance(assignment, dict) else None
            values = assignment.get("values") if isinstance(assignment, dict) else None
            if key in normalized_metadata:
                raise ValueError(f"duplicate metadata key for {source['productKey']}: {key}")
            if key not in allowed_values or not isinstance(values, list) or set(values) - allowed_values[key]:
                raise ValueError(f"invalid controlled metadata for {source['productKey']}: {key}")
            if not values:
                raise ValueError(f"empty metadata assignment for {source['productKey']}: {key}")
            normalized_metadata[key] = values
        item["metadata"] = normalized_metadata


def enrich_batch(
    batch: dict[str, Any],
    args: argparse.Namespace,
    metadata: dict[str, list[str]],
) -> dict[str, Any]:
    previous_error: str | None = None
    for attempt in range(1, args.max_attempts + 1):
        prompt = build_prompt(batch, metadata, previous_error)
        with tempfile.NamedTemporaryFile(prefix="stylme-codex-", suffix=".json", delete=False) as temporary:
            output_path = Path(temporary.name)
        command = [
            "codex",
            "exec",
            "--ephemeral",
            "--sandbox",
            "read-only",
            "--ignore-user-config",
            "--color",
            "never",
            "--output-schema",
            str(args.schema.resolve()),
            "--output-last-message",
            str(output_path),
            "--cd",
            str(DATA_ROOT.resolve()),
            "-",
        ]
        try:
            completed = subprocess.run(
                command,
                input=prompt,
                text=True,
                capture_output=True,
                timeout=args.timeout_seconds,
                check=False,
            )
            if completed.returncode != 0:
                detail = completed.stderr.strip().splitlines()[-20:] or ["unknown codex exec error"]
                raise ValueError("\n".join(detail))
            result = parse_json_output(output_path)
            validate_result(batch, result, metadata)
            return result
        except (json.JSONDecodeError, OSError, subprocess.TimeoutExpired, ValueError) as exc:
            previous_error = str(exc)[:500]
            if attempt == args.max_attempts:
                raise RuntimeError(f"{batch['batchId']} failed after {attempt} attempts: {previous_error}") from exc
        finally:
            output_path.unlink(missing_ok=True)
    raise RuntimeError(f"{batch['batchId']} did not run")


def main() -> None:
    args = parse_args()
    if args.workers < 1 or args.workers > 4:
        raise SystemExit("--workers must be between 1 and 4")
    auth = check_codex_login()
    batches = load_batches(args.input, args.batch_id)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.restart:
        args.output.unlink(missing_ok=True)
    completed = completed_batch_ids(args.output)
    pending = [batch for batch in batches if batch["batchId"] not in completed]
    if args.limit_batches:
        pending = pending[: args.limit_batches]
    metadata = allowed_metadata(args.metadata)
    print(json.dumps({
        "auth": auth,
        "batchSize": max((len(batch["items"]) for batch in batches), default=0),
        "totalBatches": len(batches),
        "alreadyCompleted": len(completed),
        "runningNow": len(pending),
        "workers": args.workers,
        "output": str(args.output),
    }, indent=2), flush=True)

    def append_result(batch: dict[str, Any], result: dict[str, Any], completed_count: int) -> None:
        envelope = {
            "batchId": batch["batchId"],
            "schemaVersion": 1,
            "provider": "codex-cli",
            "authentication": auth,
            "result": {"results": result["results"]},
        }
        with args.output.open("a", encoding="utf-8") as handle:
            handle.write(json_dumps(envelope) + "\n")
        print(json.dumps({
            "completed": completed_count,
            "of": len(pending),
            "batchId": batch["batchId"],
            "products": len(result["results"]),
        }), flush=True)

    if args.workers == 1:
        for index, batch in enumerate(pending, start=1):
            append_result(batch, enrich_batch(batch, args, metadata), index)
    else:
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {executor.submit(enrich_batch, batch, args, metadata): batch for batch in pending}
            for index, future in enumerate(as_completed(futures), start=1):
                batch = futures[future]
                append_result(batch, future.result(), index)


if __name__ == "__main__":
    main()
