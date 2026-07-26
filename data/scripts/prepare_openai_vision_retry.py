#!/usr/bin/env python3
"""Build a restartable retry batch for requests without a successful response."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import Any

from common import json_dumps


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--state", type=Path, default=None)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--requests-per-file", type=int, default=25_000)
    parser.add_argument("--max-file-mb", type=int, default=190)
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def atomic_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(value, encoding="utf-8")
    os.replace(temporary, path)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def successful_custom_ids(state: dict[str, Any]) -> set[str]:
    successful: set[str] = set()
    for batch in state.get("batches", []):
        output_value = batch.get("outputPath")
        if not output_value:
            continue
        output = Path(output_value)
        if not output.exists():
            raise SystemExit(f"collected output is missing: {output}")
        for envelope in read_jsonl(output):
            response = envelope.get("response") or {}
            if int(response.get("status_code") or 0) == 200 and envelope.get("custom_id"):
                successful.add(str(envelope["custom_id"]))
    return successful


def main() -> None:
    args = parse_args()
    if not 1 <= args.requests_per_file <= 50_000:
        raise SystemExit("--requests-per-file must be between 1 and 50,000")
    if not 1 <= args.max_file_mb < 200:
        raise SystemExit("--max-file-mb must be between 1 and 199")
    plan = json.loads(args.plan.read_text())
    state_path = args.state or (args.plan.parent / "batch-state.json")
    state = json.loads(state_path.read_text())
    nonterminal = [
        item.get("batchId")
        for item in state.get("batches", [])
        if item.get("status") not in {"completed", "failed", "expired", "cancelled"}
    ]
    if nonterminal:
        raise SystemExit("all source batches must be terminal and collected before retry preparation")

    ordered_requests: list[dict[str, Any]] = []
    request_ids: set[str] = set()
    for shard in plan.get("shards", []):
        for request in read_jsonl(Path(shard["path"])):
            custom = str(request.get("custom_id") or "")
            if not custom or custom in request_ids:
                raise SystemExit(f"missing or duplicate custom_id in source requests: {custom!r}")
            request_ids.add(custom)
            ordered_requests.append(request)
    successful = successful_custom_ids(state)
    unknown = successful - request_ids
    if unknown:
        raise SystemExit(f"collected output includes an unknown custom_id: {sorted(unknown)[0]}")
    retry_requests = [item for item in ordered_requests if item["custom_id"] not in successful]

    existing = list(args.output_dir.glob("requests-*.jsonl")) + [
        args.output_dir / "manifest.jsonl",
        args.output_dir / "plan.json",
    ]
    existing = [path for path in existing if path.exists()]
    if existing and not args.overwrite:
        raise SystemExit(f"retry output already exists; pass --overwrite to replace it: {existing[0]}")
    for path in existing:
        path.unlink()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    source_manifest = {
        item["customId"]: item for item in read_jsonl(Path(plan["manifest"]))
    }
    missing_manifest = [item["custom_id"] for item in retry_requests if item["custom_id"] not in source_manifest]
    if missing_manifest:
        raise SystemExit(f"source manifest is missing custom_id: {missing_manifest[0]}")

    max_bytes = args.max_file_mb * 1024 * 1024
    shards: list[dict[str, Any]] = []
    shard_lines: list[str] = []
    shard_bytes = 0

    def flush() -> None:
        nonlocal shard_lines, shard_bytes
        if not shard_lines:
            return
        path = args.output_dir / f"requests-{len(shards) + 1:03d}.jsonl"
        atomic_text(path, "".join(shard_lines))
        shards.append({"path": str(path), "requests": len(shard_lines), "bytes": shard_bytes})
        shard_lines = []
        shard_bytes = 0

    for request in retry_requests:
        line = json_dumps(request) + "\n"
        encoded_bytes = len(line.encode("utf-8"))
        if shard_lines and (
            len(shard_lines) >= args.requests_per_file or shard_bytes + encoded_bytes > max_bytes
        ):
            flush()
        shard_lines.append(line)
        shard_bytes += encoded_bytes
    flush()

    retry_ids = {item["custom_id"] for item in retry_requests}
    manifest_lines = [
        json_dumps(item) + "\n"
        for item in source_manifest.values()
        if item["customId"] in retry_ids
    ]
    atomic_text(args.output_dir / "manifest.jsonl", "".join(manifest_lines))
    retry_plan = {
        "version": 1,
        "endpoint": plan["endpoint"],
        "model": plan["model"],
        "detail": plan["detail"],
        "reasoningEffort": plan["reasoningEffort"],
        "candidateImages": len(retry_requests),
        "requiredFinalProducts": len(retry_requests),
        "input": plan["input"],
        "inputSha256": sha256_file(Path(plan["input"])),
        "manifest": str(args.output_dir / "manifest.jsonl"),
        "sourcePlan": str(args.plan),
        "sourceState": str(state_path),
        "successfulSourceRequests": len(successful),
        "shards": shards,
    }
    atomic_text(args.output_dir / "plan.json", json.dumps(retry_plan, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(retry_plan, indent=2))


if __name__ == "__main__":
    main()
