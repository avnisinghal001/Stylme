#!/usr/bin/env python3
"""Pilot, submit, monitor, and collect restartable OpenAI clothing-vision batches."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from common import DATA_ROOT, json_dumps
from openai_vision_common import (
    load_controls,
    response_output_text,
    validate_analysis,
)


PROJECT_ROOT = DATA_ROOT.parent
TERMINAL_STATUSES = {"completed", "failed", "expired", "cancelled"}


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--seed-dir", type=Path, required=True)
    parser.add_argument("--env-file", type=Path, default=PROJECT_ROOT / ".env")
    parser.add_argument("--allow-custom-base-url", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)
    pilot = sub.add_parser("pilot")
    pilot.add_argument("--limit", type=int, default=10)
    pilot.add_argument("--output", type=Path, default=None)
    submit = sub.add_parser("submit")
    submit.add_argument("--commit", action="store_true", help="Required before paid API uploads/submission")
    status = sub.add_parser("status")
    status.add_argument("--wait", action="store_true")
    status.add_argument("--poll-seconds", type=int, default=30)
    sub.add_parser("collect")
    cancel = sub.add_parser("cancel")
    cancel.add_argument("--commit", action="store_true", help="Required before cancelling an active batch")
    cancel.add_argument("--batch-id", action="append", default=[], help="Limit cancellation to this batch ID")
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path: Path, value: Any) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    os.replace(temporary, path)


def load_client(args: argparse.Namespace):
    try:
        from openai import OpenAI
    except ImportError as exc:
        raise SystemExit("Install data/requirements.txt to use OpenAI batch commands") from exc
    file_env = read_env(args.env_file)
    api_key = str(os.environ.get("OPENAI_API_KEY") or file_env.get("OPENAI_API_KEY") or "").strip()
    if not api_key:
        raise SystemExit(f"OPENAI_API_KEY is required in the environment or {args.env_file}")
    base_url = str(os.environ.get("OPENAI_BASE_URL") or file_env.get("OPENAI_BASE_URL") or "").strip()
    if base_url:
        host = (urlparse(base_url).hostname or "").lower()
        if host != "api.openai.com" and not args.allow_custom_base_url:
            raise SystemExit(
                f"Refusing non-OpenAI base URL host {host!r}; pass --allow-custom-base-url only intentionally"
            )
    return OpenAI(api_key=api_key, base_url=base_url or None, timeout=120.0, max_retries=3)


def state_path(plan_path: Path) -> Path:
    return plan_path.parent / "batch-state.json"


def load_state(plan: dict[str, Any], path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "model": plan["model"], "endpoint": plan["endpoint"], "batches": []}
    state = json.loads(path.read_text())
    if state.get("model") != plan.get("model") or state.get("endpoint") != plan.get("endpoint"):
        raise SystemExit("batch state model/endpoint does not match plan")
    return state


def response_dict(value: Any) -> dict[str, Any]:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return value
    return json.loads(value.json())


def pilot(args: argparse.Namespace, plan: dict[str, Any], client: Any) -> None:
    if args.limit < 1 or args.limit > 100:
        raise SystemExit("pilot --limit must be between 1 and 100")
    metadata, colors = load_controls(
        args.seed_dir / "metadata_fields.json",
        args.seed_dir / "colors.jsonl",
    )
    output = args.output or (args.plan.parent / "pilot-results.jsonl")
    temporary = output.with_suffix(output.suffix + ".tmp")
    usage = {"inputTokens": 0, "outputTokens": 0, "reasoningTokens": 0}
    completed = 0
    with temporary.open("w", encoding="utf-8") as target:
        for shard in plan["shards"]:
            with Path(shard["path"]).open(encoding="utf-8") as source:
                for line in source:
                    request = json.loads(line)
                    response = client.responses.create(**request["body"])
                    body = response_dict(response)
                    analysis = validate_analysis(
                        json.loads(response_output_text(body)), metadata, colors
                    )
                    target.write(
                        json_dumps(
                            {
                                "custom_id": request["custom_id"],
                                "response": {"status_code": 200, "body": body},
                                "analysis": analysis,
                            }
                        )
                        + "\n"
                    )
                    raw_usage = body.get("usage") or {}
                    usage["inputTokens"] += int(raw_usage.get("input_tokens") or 0)
                    usage["outputTokens"] += int(raw_usage.get("output_tokens") or 0)
                    usage["reasoningTokens"] += int(
                        (raw_usage.get("output_tokens_details") or {}).get("reasoning_tokens") or 0
                    )
                    completed += 1
                    if completed == args.limit:
                        break
            if completed == args.limit:
                break
    os.replace(temporary, output)
    print(json.dumps({"pilotCompleted": completed, "usage": usage, "output": str(output)}, indent=2))


def submit(args: argparse.Namespace, plan: dict[str, Any], client: Any) -> None:
    if not args.commit:
        raise SystemExit("Paid batch submission is disabled without submit --commit")
    path = state_path(args.plan)
    state = load_state(plan, path)
    existing = {item["inputSha256"]: item for item in state["batches"]}
    for shard_number, shard in enumerate(plan["shards"], start=1):
        input_path = Path(shard["path"])
        digest = sha256_file(input_path)
        if digest in existing:
            continue
        with input_path.open("rb") as handle:
            uploaded = client.files.create(file=handle, purpose="batch")
        batch = client.batches.create(
            input_file_id=uploaded.id,
            endpoint=plan["endpoint"],
            completion_window="24h",
            metadata={
                "description": f"StylMe clothing vision {shard_number}/{len(plan['shards'])}",
                "pipeline": "stylme-clothing-vision-v1",
            },
        )
        record = {
            "shard": shard_number,
            "inputPath": str(input_path),
            "inputSha256": digest,
            "requests": shard["requests"],
            "inputFileId": uploaded.id,
            "batchId": batch.id,
            "status": batch.status,
            "outputFileId": None,
            "errorFileId": None,
        }
        state["batches"].append(record)
        existing[digest] = record
        atomic_json(path, state)
        print(json.dumps({"submittedShard": shard_number, "batchId": batch.id, "status": batch.status}), flush=True)
    print(json.dumps({"state": str(path), "batches": len(state["batches"])}, indent=2))


def refresh_status(plan_path: Path, plan: dict[str, Any], client: Any) -> tuple[dict[str, Any], bool]:
    path = state_path(plan_path)
    state = load_state(plan, path)
    if not state["batches"]:
        raise SystemExit("no submitted batches found")
    all_terminal = True
    for record in state["batches"]:
        batch = client.batches.retrieve(record["batchId"])
        record.update(
            {
                "status": batch.status,
                "outputFileId": batch.output_file_id,
                "errorFileId": batch.error_file_id,
                "requestCounts": response_dict(batch.request_counts) if batch.request_counts else None,
            }
        )
        all_terminal = all_terminal and batch.status in TERMINAL_STATUSES
    atomic_json(path, state)
    return state, all_terminal


def show_status(args: argparse.Namespace, plan: dict[str, Any], client: Any) -> None:
    if args.poll_seconds < 10 or args.poll_seconds > 300:
        raise SystemExit("--poll-seconds must be between 10 and 300")
    while True:
        state, terminal = refresh_status(args.plan, plan, client)
        summary = [
            {
                "shard": item["shard"],
                "batchId": item["batchId"],
                "status": item["status"],
                "requestCounts": item.get("requestCounts"),
            }
            for item in state["batches"]
        ]
        print(json.dumps(summary, indent=2), flush=True)
        if terminal or not args.wait:
            return
        time.sleep(args.poll_seconds)


def download_file(client: Any, file_id: str, path: Path) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    # Batch output can be hundreds of megabytes. Stream it to a temporary file
    # instead of buffering the entire response in memory, then atomically publish.
    with client.files.with_streaming_response.content(file_id) as response:
        response.stream_to_file(temporary)
    os.replace(temporary, path)


def collect(args: argparse.Namespace, plan: dict[str, Any], client: Any) -> None:
    state, _ = refresh_status(args.plan, plan, client)
    collected: list[dict[str, Any]] = []
    for record in state["batches"]:
        shard = int(record["shard"])
        if record.get("outputFileId"):
            output = (args.plan.parent / f"output-{shard:03d}.jsonl").resolve()
            if not output.exists():
                download_file(client, record["outputFileId"], output)
            record["outputPath"] = str(output)
        if record.get("errorFileId"):
            errors = (args.plan.parent / f"errors-{shard:03d}.jsonl").resolve()
            if not errors.exists():
                download_file(client, record["errorFileId"], errors)
            record["errorPath"] = str(errors)
        collected.append(
            {
                "shard": shard,
                "status": record["status"],
                "outputPath": record.get("outputPath"),
                "errorPath": record.get("errorPath"),
            }
        )
    atomic_json(state_path(args.plan), state)
    print(json.dumps(collected, indent=2))


def cancel(args: argparse.Namespace, plan: dict[str, Any], client: Any) -> None:
    if not args.commit:
        raise SystemExit("Batch cancellation is disabled without cancel --commit")
    path = state_path(args.plan)
    state = load_state(plan, path)
    selected = set(args.batch_id)
    known = {item["batchId"] for item in state.get("batches", [])}
    unknown = selected - known
    if unknown:
        raise SystemExit(f"batch state does not contain requested batch ID: {sorted(unknown)[0]}")
    changes: list[dict[str, Any]] = []
    for record in state.get("batches", []):
        if selected and record["batchId"] not in selected:
            continue
        current = client.batches.retrieve(record["batchId"])
        if current.status in TERMINAL_STATUSES:
            changes.append({"batchId": current.id, "status": current.status, "cancelled": False})
            continue
        updated = client.batches.cancel(record["batchId"])
        record["status"] = updated.status
        changes.append({"batchId": updated.id, "status": updated.status, "cancelled": True})
    atomic_json(path, state)
    print(json.dumps(changes, indent=2))


def main() -> None:
    args = parse_args()
    plan = json.loads(args.plan.read_text())
    if plan.get("endpoint") != "/v1/responses":
        raise SystemExit("plan endpoint must be /v1/responses")
    client = load_client(args)
    if args.command == "pilot":
        pilot(args, plan, client)
    elif args.command == "submit":
        submit(args, plan, client)
    elif args.command == "status":
        show_status(args, plan, client)
    elif args.command == "collect":
        collect(args, plan, client)
    elif args.command == "cancel":
        cancel(args, plan, client)


if __name__ == "__main__":
    main()
