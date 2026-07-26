"""Shared contracts for clothing-only OpenAI vision batch enrichment."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from common import json_dumps


VISION_METADATA_FIELDS = (
    "style",
    "theme",
    "occasion",
    "material",
    "pattern",
    "fit",
    "silhouette",
    "season",
    "mood",
    "outfit_role",
)
IMAGE_QUALITY_VALUES = ("good", "usable", "poor")


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def load_controls(metadata_path: Path, colors_path: Path) -> tuple[dict[str, list[str]], list[str]]:
    metadata_payload = json.loads(metadata_path.read_text())
    metadata = {
        field["key"]: sorted(
            option["key"] if isinstance(option, dict) else option
            for option in field.get("options", [])
        )
        for field in metadata_payload["fields"]
        if field.get("key") in VISION_METADATA_FIELDS
    }
    missing = sorted(set(VISION_METADATA_FIELDS) - set(metadata))
    if missing:
        raise ValueError(f"metadata controls are missing required fields: {missing}")
    colors = sorted(item["key"] for item in read_jsonl(colors_path) if item.get("key") != "unspecified")
    if not colors:
        raise ValueError("color manifest has no controlled color keys")
    return metadata, colors


def vision_schema(metadata: dict[str, list[str]], colors: list[str]) -> dict[str, Any]:
    metadata_properties = {
        key: {"type": "array", "items": {"type": "string", "enum": values}}
        for key, values in metadata.items()
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "isClothing": {"type": "boolean"},
            "sourceTypeMatchesImage": {"type": "boolean"},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            "metadata": {
                "type": "object",
                "additionalProperties": False,
                "properties": metadata_properties,
                "required": list(metadata_properties),
            },
            "dominantColorKeys": {
                "type": "array",
                "maxItems": 4,
                "items": {"type": "string", "enum": colors},
            },
            "imageQuality": {"type": "string", "enum": list(IMAGE_QUALITY_VALUES)},
            "warnings": {"type": "array", "maxItems": 5, "items": {"type": "string"}},
        },
        "required": [
            "isClothing",
            "sourceTypeMatchesImage",
            "confidence",
            "metadata",
            "dominantColorKeys",
            "imageQuality",
            "warnings",
        ],
    }


def custom_id(product_key: str) -> str:
    digest = hashlib.sha256(product_key.encode("utf-8")).hexdigest()[:24]
    return f"stylme-clothing-{digest}"


def request_body(
    *,
    model: str,
    detail: str,
    image_url: str,
    product_key: str,
    title: str,
    description: str,
    product_type: str,
    current_metadata: dict[str, Any],
    schema: dict[str, Any],
    reasoning_effort: str,
) -> dict[str, Any]:
    evidence = {
        "productKey": product_key,
        "title": title[:500],
        "description": description[:1200],
        "sourceProductType": product_type,
        "currentMetadata": {
            key: values for key, values in current_metadata.items() if key in VISION_METADATA_FIELDS
        },
    }
    instructions = (
        "Classify one fashion catalog image and return JSON matching the schema. "
        "Clothing means a standalone garment worn on the body. Exclude footwear, jewelry, "
        "bags, watches, cosmetics, electronics, home goods, and accessories. Use the image as "
        "primary evidence and the supplied catalog text only as supporting evidence. Keep an "
        "array empty when a controlled attribute is not visibly or textually supported. Do not "
        "infer religion, ethnicity, health, body shape, attractiveness, identity, or other "
        "sensitive traits. Mark isClothing false for a non-garment, unusable image, or mismatch."
    )
    return {
        "model": model,
        "reasoning": {"effort": reasoning_effort},
        "store": False,
        "max_output_tokens": 900,
        "input": [
            {"role": "system", "content": instructions},
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": json_dumps(evidence)},
                    {"type": "input_image", "image_url": image_url, "detail": detail},
                ],
            },
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "stylme_clothing_vision_v1",
                "strict": True,
                "schema": schema,
            }
        },
    }


def batch_request(custom: str, body: dict[str, Any]) -> dict[str, Any]:
    return {"custom_id": custom, "method": "POST", "url": "/v1/responses", "body": body}


def response_output_text(body: dict[str, Any]) -> str:
    for output in body.get("output") or []:
        if not isinstance(output, dict) or output.get("type") != "message":
            continue
        for content in output.get("content") or []:
            if not isinstance(content, dict):
                continue
            if content.get("type") == "refusal":
                raise ValueError(f"model refusal: {content.get('refusal')}")
            if content.get("type") == "output_text" and isinstance(content.get("text"), str):
                return content["text"]
    raise ValueError("response has no output_text")


def validate_analysis(
    value: dict[str, Any],
    metadata: dict[str, list[str]],
    colors: list[str],
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("analysis is not an object")
    if not isinstance(value.get("isClothing"), bool):
        raise ValueError("isClothing is not boolean")
    if not isinstance(value.get("sourceTypeMatchesImage"), bool):
        raise ValueError("sourceTypeMatchesImage is not boolean")
    confidence = value.get("confidence")
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
        raise ValueError("confidence is outside 0..1")
    assignments = value.get("metadata")
    if not isinstance(assignments, dict) or set(assignments) != set(metadata):
        raise ValueError("metadata keys do not match the controlled contract")
    for key, values in assignments.items():
        if not isinstance(values, list):
            raise ValueError(f"metadata.{key} must be an array")
        assignments[key] = list(dict.fromkeys(values))
        values = assignments[key]
        invalid = set(values) - set(metadata[key])
        if invalid:
            raise ValueError(f"metadata.{key} has invalid values: {sorted(invalid)}")
    dominant = value.get("dominantColorKeys")
    if not isinstance(dominant, list):
        raise ValueError("dominantColorKeys must be an array")
    value["dominantColorKeys"] = list(dict.fromkeys(dominant))
    dominant = value["dominantColorKeys"]
    if len(dominant) > 4:
        raise ValueError("dominantColorKeys must have at most four values")
    invalid_colors = set(dominant) - set(colors)
    if invalid_colors:
        raise ValueError(f"invalid dominant colors: {sorted(invalid_colors)}")
    if value.get("imageQuality") not in IMAGE_QUALITY_VALUES:
        raise ValueError("invalid imageQuality")
    warnings = value.get("warnings")
    if not isinstance(warnings, list) or len(warnings) > 5 or not all(isinstance(item, str) for item in warnings):
        raise ValueError("warnings must be a string array with at most five values")
    value["warnings"] = list(dict.fromkeys(warnings))
    return value
