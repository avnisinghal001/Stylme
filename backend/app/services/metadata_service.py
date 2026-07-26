from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, Iterable, List, Optional, Tuple

from fastapi import HTTPException

from app.core.serialization import mongo_json


def _option_keys(field: Dict[str, Any]) -> set[str]:
    return {
        str(option.get("key"))
        for option in field.get("options") or []
        if isinstance(option, dict) and option.get("key") and option.get("active", True)
    }


async def active_fields(database) -> Dict[str, Dict[str, Any]]:
    documents = await database.metadata_fields.find({"status": "active"}).to_list(
        length=500
    )
    return {document["key"]: document for document in documents}


def _validate_enum_values(field: Dict[str, Any], value: Any, path: str) -> Any:
    data_type = field.get("data_type")
    options = _option_keys(field)
    if data_type == "multi_enum":
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            raise HTTPException(status_code=422, detail=f"{path} must be a string array")
        if len(value) != len(set(value)):
            raise HTTPException(status_code=422, detail=f"{path} contains duplicates")
        max_selections = (field.get("validation") or {}).get("maxSelections")
        if max_selections is not None and len(value) > int(max_selections):
            raise HTTPException(
                status_code=422,
                detail=f"{path} allows at most {max_selections} values",
            )
        invalid = sorted(set(value) - options) if options else []
        if invalid:
            raise HTTPException(
                status_code=422,
                detail={"message": f"{path} contains unknown options", "values": invalid},
            )
        return value
    if data_type == "enum":
        if not isinstance(value, str):
            raise HTTPException(status_code=422, detail=f"{path} must be a string")
        if options and value not in options:
            raise HTTPException(
                status_code=422,
                detail={"message": f"{path} contains an unknown option", "value": value},
            )
        return value
    if data_type == "text" and not isinstance(value, str):
        raise HTTPException(status_code=422, detail=f"{path} must be text")
    if data_type == "number" and not isinstance(value, (int, float)):
        raise HTTPException(status_code=422, detail=f"{path} must be numeric")
    if data_type == "boolean" and not isinstance(value, bool):
        raise HTTPException(status_code=422, detail=f"{path} must be boolean")
    return value


async def validate_product_metadata(
    database,
    *,
    category_key: Optional[str],
    product_type_key: Optional[str],
    gender_keys: Optional[List[str]],
    metadata: Optional[Dict[str, Any]],
    partial: bool = False,
    ai_only: bool = False,
) -> Dict[str, Any]:
    fields = await active_fields(database)
    core_values = {
        "category": category_key,
        "product_type": product_type_key,
        "gender": gender_keys,
    }
    if not partial and any(value is None for value in core_values.values()):
        raise HTTPException(status_code=422, detail="Product classification is incomplete")
    for key, value in core_values.items():
        if value is None:
            continue
        field = fields.get(key)
        if not field:
            raise HTTPException(status_code=503, detail=f"Controlled field {key} is unavailable")
        if ai_only and not field.get("gemini_allowed"):
            raise HTTPException(status_code=422, detail=f"AI cannot propose {key}")
        _validate_enum_values(field, value, field.get("storage_path") or key)

    clean_metadata: Dict[str, Any] = {}
    for key, value in (metadata or {}).items():
        if not isinstance(key, str) or key.startswith("$") or "." in key:
            raise HTTPException(status_code=422, detail="Invalid metadata key")
        field = fields.get(key)
        if not field or field.get("storage") != "product_metadata":
            raise HTTPException(
                status_code=422,
                detail={"message": "Unknown product metadata field", "key": key},
            )
        if ai_only and not field.get("gemini_allowed"):
            raise HTTPException(status_code=422, detail=f"AI cannot propose metadata.{key}")
        clean_metadata[key] = _validate_enum_values(field, value, f"metadata.{key}")
    if len(json.dumps(clean_metadata, separators=(",", ":")).encode("utf-8")) > 32_768:
        raise HTTPException(status_code=422, detail="Product metadata exceeds 32 KB")
    return clean_metadata


async def taxonomy_contract(database) -> Tuple[int, str, List[Dict[str, Any]]]:
    fields = await database.metadata_fields.find(
        {"status": "active", "frontend_visible": True}
    ).sort([("sort_order", 1), ("key", 1)]).to_list(length=500)
    schema_version = max(
        [int(field.get("schema_version", 1)) for field in fields] or [1]
    )
    contract = [
        {
            "key": field["key"],
            "label": field.get("label", field["key"]),
            "description": field.get("description"),
            "group": field.get("group"),
            "dataType": field.get("data_type"),
            "storage": field.get("storage"),
            "storagePath": field.get("storage_path"),
            "control": field.get("control"),
            "options": [
                mongo_json(option)
                for option in field.get("options") or []
                if isinstance(option, dict) and option.get("active", True)
            ],
            "validation": field.get("validation") or {},
            "filterable": bool(field.get("filterable")),
            "searchable": bool(field.get("searchable")),
            "aiAllowed": bool(field.get("gemini_allowed")),
            "frontendVisible": bool(field.get("frontend_visible")),
            "schemaVersion": int(field.get("schema_version", 1)),
        }
        for field in fields
    ]
    allowlist = [
        {
            "key": item["key"],
            "storagePath": item["storagePath"],
            "options": [option.get("key") for option in item["options"]],
        }
        for item in contract
        if item["aiAllowed"]
    ]
    digest = hashlib.sha256(
        json.dumps(allowlist, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return schema_version, digest, contract
