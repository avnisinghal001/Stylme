"""Load and merge the catalogue taxonomy contract without leaking credentials."""

from __future__ import annotations

import copy
import os
from pathlib import Path
from typing import Any, Iterable


DB_TO_SEED_KEYS = {
    "data_type": "dataType",
    "storage_path": "storagePath",
    "gemini_allowed": "geminiAllowed",
    "frontend_visible": "frontendVisible",
    "usage_frequency": "usageFrequency",
    "sort_order": "sortOrder",
    "schema_version": "schemaVersion",
}


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        if key.strip():
            values[key.strip()] = value
    return values


def seed_field_from_document(document: dict[str, Any]) -> dict[str, Any]:
    field: dict[str, Any] = {}
    for key, value in document.items():
        if key == "_id":
            continue
        if key == "options" and isinstance(value, list):
            field["options"] = [
                str(option.get("key")) if isinstance(option, dict) else str(option)
                for option in value
                if (option.get("key") if isinstance(option, dict) else option)
            ]
            continue
        field[DB_TO_SEED_KEYS.get(key, key)] = copy.deepcopy(value)
    return field


def merge_taxonomy_registry(
    local: dict[str, Any], remote_documents: Iterable[dict[str, Any]]
) -> dict[str, Any]:
    """Merge DB options into local definitions; local schema settings remain authoritative."""
    remote = {
        str(document.get("key")): seed_field_from_document(document)
        for document in remote_documents
        if document.get("key")
    }
    output = copy.deepcopy(local)
    local_keys: set[str] = set()
    merged_fields: list[dict[str, Any]] = []
    for local_field in output.get("fields", []):
        key = str(local_field["key"])
        local_keys.add(key)
        merged = {**remote.get(key, {}), **local_field}
        merged["options"] = sorted(
            {
                str(value)
                for value in [
                    *remote.get(key, {}).get("options", []),
                    *local_field.get("options", []),
                ]
                if str(value).strip()
            }
        )
        merged_fields.append(merged)
    for key in sorted(set(remote) - local_keys):
        merged_fields.append(remote[key])
    output["fields"] = merged_fields
    output["version"] = max(
        int(local.get("version") or 1),
        *(int(document.get("schemaVersion") or 1) for document in remote.values()),
    )
    return output


def load_registry_from_mongo(
    local: dict[str, Any], *, env_file: Path, uri_key: str = "MONGODB_URL", timeout_ms: int = 15_000
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Fetch the active Mongo registry and return a credential-free provenance summary."""
    from pymongo import MongoClient

    file_env = read_env_file(env_file)
    uri = (
        os.environ.get(uri_key)
        or file_env.get(uri_key)
        or (os.environ.get("MONGODB_URI") if uri_key == "MONGODB_URL" else None)
        or (file_env.get("MONGODB_URI") if uri_key == "MONGODB_URL" else None)
    )
    database = (
        os.environ.get("MONGODB_DB_NAME")
        or os.environ.get("DATABASE_NAME")
        or file_env.get("MONGODB_DB_NAME")
        or file_env.get("DATABASE_NAME")
        or "StylMe"
    )
    if not uri:
        fallback = " (or MONGODB_URI)" if uri_key == "MONGODB_URL" else ""
        raise ValueError(f"{uri_key}{fallback} is required in {env_file}")
    with MongoClient(uri, serverSelectionTimeoutMS=timeout_ms) as client:
        documents = list(
            client[database].metadata_fields.find(
                {"status": {"$ne": "inactive"}}, {"_id": 0}
            )
        )
    merged = merge_taxonomy_registry(local, documents)
    return merged, {
        "source": "mongo+local",
        "uriVariable": uri_key,
        "database": database,
        "remoteFieldCount": len(documents),
        "mergedFieldCount": len(merged.get("fields", [])),
    }
