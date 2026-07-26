from __future__ import annotations

import json
import uuid
from datetime import datetime, time, timezone
from typing import Any, Dict, Iterable, List, Sequence, Tuple
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.core.config import settings
from app.core.phone import normalize_e164
from app.core.serialization import mongo_json
from app.schemas.base import to_camel
from app.services.checkout_activity_service import checkout_public, source_row
from app.services.checkout_recovery_config_service import get_config, runtime_secrets
from app.services.samora_client import SamoraClient, SamoraError


ACTIVE_CALL_STATUSES = {"PENDING", "QUEUED", "TRIGGERED", "ONGOING"}
MAX_BATCH = 500


def _api_json(value: Any) -> Any:
    value = mongo_json(value)
    if isinstance(value, list):
        return [_api_json(item) for item in value]
    if isinstance(value, dict):
        return {
            ("id" if key == "_id" else to_camel(key)): _api_json(item)
            for key, item in value.items()
            if key != "_id" or item is not None
        }
    return value


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def chunks(values: Sequence[Dict[str, Any]], size: int = MAX_BATCH):
    for index in range(0, len(values), size):
        yield values[index : index + size]


def parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def within_calling_window(now: datetime, calling: Dict[str, Any]) -> bool:
    local = now.astimezone(ZoneInfo(calling.get("timezone") or "Asia/Kolkata"))

    def parsed(value: Any, fallback: time) -> time:
        if isinstance(value, time):
            return value
        try:
            return time.fromisoformat(str(value))
        except ValueError:
            return fallback

    start = parsed(calling.get("window_start"), time(9, 0))
    end = parsed(calling.get("window_end"), time(20, 0))
    current = local.time().replace(tzinfo=None)
    return start <= current < end if start < end else current >= start or current < end


def validate_and_dedupe_source(
    rows: Iterable[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], int]:
    valid: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    for raw in rows:
        row = dict(raw)
        external_id = str(row.get("external_id") or "").strip()
        phone = normalize_e164(row.get("contact_phone"))
        updated_at = parse_datetime(row.get("updated_at"))
        recovery_url = str(row.get("recovery_url") or "").strip()
        code = None
        if not external_id:
            code = "missing_external_id"
        elif not row.get("contact_phone"):
            code = "missing_phone"
        elif not phone:
            code = "invalid_phone"
        elif not updated_at:
            code = "invalid_updated_at"
        elif not recovery_url:
            code = "missing_recovery_url"
        elif not (
            recovery_url.startswith("https://")
            or recovery_url.startswith("http://localhost")
        ):
            code = "invalid_recovery_url"
        if code:
            errors.append(
                {
                    "external_id": external_id or None,
                    "stage": "source",
                    "code": code,
                    "retryable": False,
                }
            )
            continue
        row["contact_phone"] = phone
        row["updated_at"] = updated_at
        valid.append(row)
    latest: Dict[str, Dict[str, Any]] = {}
    for row in valid:
        current = latest.get(row["contact_phone"])
        if current is None or row["updated_at"] > current["updated_at"]:
            latest[row["contact_phone"]] = row
    deduped = sorted(latest.values(), key=lambda item: item["updated_at"], reverse=True)
    return deduped, errors, len(valid)


def lookup_eligible(
    rows: Sequence[Dict[str, Any]], results: Sequence[Dict[str, Any]]
) -> Tuple[List[Dict[str, Any]], Dict[str, int], List[Dict[str, Any]]]:
    eligible: List[Dict[str, Any]] = []
    counts = {
        "submitted": len(rows),
        "eligible": 0,
        "skipped_completed": 0,
        "skipped_stale": 0,
        "skipped_active_call": 0,
        "errors": 0,
    }
    errors: List[Dict[str, Any]] = []
    for index, row in enumerate(rows):
        result = results[index] if index < len(results) else {"error": {"code": "missing_result"}}
        if result.get("error"):
            counts["errors"] += 1
            errors.append(
                {
                    "external_id": row["external_id"],
                    "stage": "lookup",
                    "code": str((result.get("error") or {}).get("code") or "lookup_error")[:120],
                    "retryable": False,
                }
            )
            continue
        data = result.get("data") or {}
        if result.get("found") and data.get("completed") is True:
            counts["skipped_completed"] += 1
            continue
        last_activity = parse_datetime(data.get("last_activity_at"))
        if result.get("found") and last_activity and last_activity >= row["updated_at"]:
            counts["skipped_stale"] += 1
            continue
        if result.get("found") and str(data.get("call_status") or "").upper() in ACTIVE_CALL_STATUSES:
            counts["skipped_active_call"] += 1
            continue
        eligible.append(row)
    counts["eligible"] = len(eligible)
    return eligible, counts, errors


def _json_size(value: Dict[str, Any]) -> int:
    return len(json.dumps(value, separators=(",", ":"), default=str).encode("utf-8"))


def _schedule_item(row: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any]:
    calling = config.get("calling") or {}
    multilingual = config.get("multilingual") or {}
    delivery = config.get("post_call_delivery") or {}
    variables = {
        key: row.get(key)
        for key in (
            "checkout_id", "customer_name", "first_name", "last_name",
            "customer_email", "shop_name", "cart_value", "cart_total", "currency",
            "item_count", "top_item", "product_titles", "recovery_url",
        )
    }
    variables["post_call_question_id"] = delivery.get("question_id")
    variables.update(
        {
            "multilingual_enabled": bool(multilingual.get("enabled")),
            "primary_language": multilingual.get("primary_language", "en-IN"),
            "supported_languages": multilingual.get("supported_languages") or ["en-IN", "hi-IN"],
            "language_switch_tool": multilingual.get("language_switch_tool", "switch_language_tool"),
        }
    )
    item_config = {
        "max_attempts": int(calling.get("max_attempts", 2)),
        "cooldown_minutes": int(calling.get("cooldown_minutes", 1440)),
        "multilingual": {
            "enabled": bool(multilingual.get("enabled")),
            "primary_language": multilingual.get("primary_language", "en-IN"),
            "supported_languages": multilingual.get("supported_languages") or ["en-IN", "hi-IN"],
            "automatic_detection": bool(multilingual.get("automatic_detection", True)),
            "detection_threshold": int(multilingual.get("detection_threshold", 2)),
            "language_switch_tool": multilingual.get("language_switch_tool", "switch_language_tool"),
        },
    }
    if _json_size(variables) > 16 * 1024:
        raise ValueError("variables_too_large")
    if _json_size(item_config) > 16 * 1024:
        raise ValueError("config_too_large")
    return {
        "external_id": row["external_id"],
        "contact_phone": row["contact_phone"],
        "call_variables": variables,
        "config": item_config,
    }


def _activity_item(
    row: Dict[str, Any], call_id: str, config: Dict[str, Any], secrets: Dict[str, str | None]
) -> Dict[str, Any]:
    samora = config.get("samora") or {}
    calling = config.get("calling") or {}
    multilingual = config.get("multilingual") or {}
    delivery = config.get("post_call_delivery") or {}
    provider = delivery.get("provider_config") or {}
    zepic = None
    if delivery.get("enabled"):
        zepic = {
            "enabled": True,
            "mode": provider.get("mode"),
            "base_url": provider.get("base_url"),
            "api_token": secrets.get("zepic_api_token"),
            "require_condition": True,
            "condition": {
                "question_id": delivery.get("question_id"),
                "equals": delivery.get("expected_answer"),
            },
            "send_on_status": delivery.get("send_on_status") or ["CALL_FINISHED"],
            "lookup_field": provider.get("lookup_field"),
            "object_name": provider.get("object_name"),
            "object_type": provider.get("object_type"),
            "object_api_name": provider.get("object_api_name"),
            "record_fields": provider.get("record_fields") or {},
        }
    metadata = {
        key: row.get(key)
        for key in (
            "checkout_id", "customer_name", "first_name", "last_name", "customer_email",
            "shop_name", "cart_value", "cart_total", "currency", "item_count", "top_item",
            "product_titles", "recovery_url", "items",
        )
    }
    if _json_size(metadata) > 128 * 1024:
        raise ValueError("metadata_too_large")
    return {
        "agent_id": samora.get("agent_id"),
        "platform": samora.get("platform"),
        "external_id": row["external_id"],
        "contact_phone": row["contact_phone"],
        "source": "stylme_abandoned_checkout",
        "trigger_type": "abandoned_checkout",
        "last_event": "call_scheduled",
        "last_activity_at": row["updated_at"].isoformat(),
        "call_id": call_id,
        "completed": False,
        "config": {
            "max_attempts": int(calling.get("max_attempts", 2)),
            "cooldown_minutes": int(calling.get("cooldown_minutes", 1440)),
            "multilingual": multilingual,
            "tool_integration": {"zepic": zepic} if zepic else {},
        },
        "metadata": metadata,
    }


def _empty_summary(run_id: str, config_id: Any, started_at: datetime) -> Dict[str, Any]:
    return {
        "run_id": run_id,
        "configuration_id": str(config_id),
        "status": "running",
        "started_at": started_at,
        "finished_at": None,
        "source": {"fetched": 0, "valid": 0, "invalid": 0, "deduplicated": 0},
        "lookup": {"submitted": 0, "eligible": 0, "skipped_completed": 0, "skipped_stale": 0, "skipped_active_call": 0, "errors": 0},
        "schedule": {"submitted": 0, "scheduled": 0, "already_scheduled": 0, "skipped": 0, "failed": 0},
        "activity_upsert": {"submitted": 0, "succeeded": 0, "failed": 0},
        "errors": [],
    }


async def _acquire_lock(database, lock_key: str, owner: str, now: datetime) -> bool:
    expires = now.timestamp() + settings.CHECKOUT_RECOVERY_LOCK_SECONDS
    expires_at = datetime.fromtimestamp(expires, tz=timezone.utc)
    try:
        document = await database.workflow_locks.find_one_and_update(
            {
                "key": lock_key,
                "$or": [{"expires_at": {"$lte": now}}, {"owner": owner}],
            },
            {
                "$set": {"owner": owner, "acquired_at": now, "expires_at": expires_at},
                "$setOnInsert": {"key": lock_key, "created_at": now},
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        return bool(document and document.get("owner") == owner)
    except DuplicateKeyError:
        return False


async def _release_lock(database, lock_key: str, owner: str) -> None:
    await database.workflow_locks.delete_one({"key": lock_key, "owner": owner})


async def execute_recovery(database, *, requested_by: str) -> Dict[str, Any]:
    config = await get_config(database)
    if not config.get("enabled"):
        raise HTTPException(status_code=409, detail="Checkout recovery is disabled")
    samora_config = config.get("samora") or {}
    campaign_id = samora_config.get("campaign_id")
    run_id = f"run_{uuid.uuid4().hex}"
    lock_key = f"checkout-recovery:{campaign_id}"
    started_at = utcnow()
    if not await _acquire_lock(database, lock_key, run_id, started_at):
        raise HTTPException(status_code=409, detail="A checkout-recovery run is already active")
    summary = _empty_summary(run_id, config.get("_id"), started_at)
    run_document = {
        **summary,
        "requested_by": requested_by,
        "metadata": {"campaignId": str(campaign_id), "platform": samora_config.get("platform")},
        "created_at": started_at,
        "updated_at": started_at,
    }
    await database.checkout_recovery_runs.insert_one(run_document)
    client: SamoraClient | None = None
    try:
        if not within_calling_window(started_at, config.get("calling") or {}):
            summary["status"] = "skipped_outside_calling_window"
            return await _finish_run(database, summary)
        raw_documents = await database.checkouts.find(
            {
                "status": "active",
                "payment_status": "unpaid",
                "item_count": {"$gt": 0},
                "eligible_at": {"$lte": started_at},
            }
        ).sort("updated_at", -1).limit(int((config.get("source") or {}).get("page_size", 500))).to_list(length=500)
        raw_rows = [source_row(document) for document in raw_documents]
        rows, source_errors, valid_count = validate_and_dedupe_source(raw_rows)
        summary["source"] = {
            "fetched": len(raw_rows),
            "valid": valid_count,
            "invalid": len(source_errors),
            "deduplicated": len(rows),
        }
        summary["errors"].extend(source_errors)
        if not rows:
            summary["status"] = "completed_with_errors" if source_errors else "completed"
            return await _finish_run(database, summary)

        secrets = runtime_secrets(config)
        if not secrets.get("org_api_key"):
            raise HTTPException(status_code=503, detail="Samora API key is not configured")
        client = SamoraClient(
            base_url=str(samora_config.get("base_url")), api_key=str(secrets["org_api_key"])
        )

        eligible: List[Dict[str, Any]] = []
        for batch in chunks(rows):
            response = await client.lookup(
                {
                    "platform": samora_config.get("platform"),
                    "agent_id": str(samora_config.get("agent_id")),
                    "keys": [
                        {"external_id": row["external_id"], "contact_phone": row["contact_phone"]}
                        for row in batch
                    ],
                }
            )
            batch_eligible, counts, errors = lookup_eligible(batch, response.get("results") or [])
            eligible.extend(batch_eligible)
            for key, value in counts.items():
                summary["lookup"][key] += value
            summary["errors"].extend(errors)

        scheduled_rows: List[Tuple[Dict[str, Any], str, str]] = []
        for batch in chunks(eligible):
            prepared_rows: List[Dict[str, Any]] = []
            schedule_items: List[Dict[str, Any]] = []
            for row in batch:
                try:
                    schedule_items.append(_schedule_item(row, config))
                    prepared_rows.append(row)
                except ValueError as exc:
                    summary["schedule"]["skipped"] += 1
                    summary["errors"].append({"external_id": row["external_id"], "stage": "schedule", "code": str(exc), "retryable": False})
            if not prepared_rows:
                continue
            summary["schedule"]["submitted"] += len(prepared_rows)
            response = await client.schedule(
                {
                    "platform": samora_config.get("platform"),
                    "external_workflow_id": samora_config.get("external_workflow_id"),
                    "campaign_id": str(campaign_id),
                    "allowed_campaign_statuses": samora_config.get("allowed_campaign_statuses") or ["DRAFT", "IN_PROGRESS"],
                    "items": schedule_items,
                }
            )
            results = (response.get("data") or {}).get("results") or []
            handled_indexes: set[int] = set()
            for result in results:
                index = result.get("index")
                if (
                    not isinstance(index, int)
                    or index < 0
                    or index >= len(prepared_rows)
                    or index in handled_indexes
                ):
                    summary["schedule"]["failed"] += 1
                    summary["errors"].append({"external_id": None, "stage": "schedule", "code": "invalid_result_index", "retryable": False})
                    continue
                handled_indexes.add(index)
                row = prepared_rows[index]
                status = str(result.get("status") or "")
                call_id = str(result.get("call_id") or "")
                if status in {"scheduled", "already_scheduled"} and call_id:
                    summary["schedule"][status] += 1
                    scheduled_rows.append((row, call_id, status))
                elif status.startswith("skipped"):
                    summary["schedule"]["skipped"] += 1
                    summary["errors"].append({"external_id": row["external_id"], "stage": "schedule", "code": status[:120], "retryable": False})
                else:
                    summary["schedule"]["failed"] += 1
                    summary["errors"].append({"external_id": row["external_id"], "stage": "schedule", "code": status[:120] or "schedule_failed", "retryable": False})
            for index, row in enumerate(prepared_rows):
                if index not in handled_indexes:
                    summary["schedule"]["failed"] += 1
                    summary["errors"].append({"external_id": row["external_id"], "stage": "schedule", "code": "missing_result", "retryable": True})

        for batch in chunks([{"row": row, "call_id": call_id, "schedule_status": status} for row, call_id, status in scheduled_rows]):
            activity_items = []
            activity_rows = []
            for entry in batch:
                try:
                    activity_items.append(_activity_item(entry["row"], entry["call_id"], config, secrets))
                    activity_rows.append(entry)
                except ValueError as exc:
                    summary["activity_upsert"]["failed"] += 1
                    summary["errors"].append({"external_id": entry["row"]["external_id"], "stage": "activity_upsert", "code": str(exc), "retryable": False})
            if not activity_rows:
                continue
            summary["activity_upsert"]["submitted"] += len(activity_rows)
            response = await client.bulk_activity({"items": activity_items})
            results = response.get("results") or []
            indexed_results = {
                result.get("index"): result
                for result in results
                if isinstance(result.get("index"), int)
            }
            for index, entry in enumerate(activity_rows):
                # The current contract includes an explicit index. Positional
                # results remain supported for an older compatible deployment.
                result = indexed_results.get(index)
                if result is None and index < len(results) and "index" not in results[index]:
                    result = results[index]
                if result is None:
                    result = {"ok": False, "error": {"code": "missing_result"}}
                if result.get("ok") is True:
                    summary["activity_upsert"]["succeeded"] += 1
                    now = utcnow()
                    await database.checkouts.update_one(
                        {"_id": entry["row"]["_checkout_object_id"], "external_id": entry["row"]["external_id"]},
                        {"$set": {"status": "recovery_scheduled", "samora": {"call_id": entry["call_id"], "schedule_status": entry["schedule_status"], "last_activity_at": entry["row"]["updated_at"], "processed_at": now}, "updated_at": entry["row"]["updated_at"]}},
                    )
                else:
                    summary["activity_upsert"]["failed"] += 1
                    summary["errors"].append({"external_id": entry["row"]["external_id"], "stage": "activity_upsert", "code": str((result.get("error") or {}).get("code") or "bulk_upsert_failed")[:120], "retryable": True})
        summary["status"] = "completed_with_errors" if summary["errors"] else "completed"
        return await _finish_run(database, summary)
    except SamoraError as exc:
        summary["status"] = "failed"
        summary["errors"].append({"external_id": None, "stage": "samora", "code": exc.code, "retryable": exc.retryable})
        await _finish_run(database, summary)
        raise HTTPException(status_code=502, detail=f"Samora workflow failed ({exc.code})") from exc
    except HTTPException:
        summary["status"] = "failed"
        await _finish_run(database, summary)
        raise
    finally:
        if client:
            await client.close()
        await _release_lock(database, lock_key, run_id)


async def _finish_run(database, summary: Dict[str, Any]) -> Dict[str, Any]:
    summary["finished_at"] = utcnow()
    await database.checkout_recovery_runs.update_one(
        {"run_id": summary["run_id"]},
        {"$set": {**summary, "updated_at": summary["finished_at"]}},
    )
    return _api_json(summary)


async def test_connection(database) -> Dict[str, Any]:
    config = await get_config(database)
    secrets = runtime_secrets(config)
    samora = config.get("samora") or {}
    if not secrets.get("org_api_key"):
        raise HTTPException(status_code=422, detail="Save a Samora API key first")
    if not samora.get("agent_id"):
        raise HTTPException(status_code=422, detail="Save a Samora agent ID first")
    if not samora.get("campaign_id"):
        raise HTTPException(status_code=422, detail="Save a Samora campaign ID first")
    client = SamoraClient(base_url=str(samora.get("base_url")), api_key=str(secrets["org_api_key"]))
    started = utcnow()
    try:
        lookup_response = await client.lookup(
            {
                "platform": samora.get("platform"),
                "agent_id": str(samora.get("agent_id")),
                "keys": [{"external_id": "stylme_connection_test", "contact_phone": "+919999999999"}],
            }
        )
        schedule_response = await client.schedule(
            {
                "platform": samora.get("platform"),
                "external_workflow_id": samora.get("external_workflow_id"),
                "campaign_id": str(samora.get("campaign_id")),
                "allowed_campaign_statuses": samora.get("allowed_campaign_statuses") or ["DRAFT", "IN_PROGRESS"],
                # A deliberately incomplete item validates ownership and the
                # campaign status gate without inserting or dialing a call.
                "items": [{"external_id": f"stylme_connection_test_{uuid.uuid4().hex}"}],
            }
        )
        schedule_results = (schedule_response.get("data") or {}).get("results") or []
        campaign_verified = bool(
            schedule_results
            and schedule_results[0].get("status") == "skipped_no_phone"
        )
        if not campaign_verified:
            raise SamoraError(None, "campaign_probe_unexpected_response", retryable=False)
        multilingual = config.get("multilingual") or {}
        return mongo_json({
            "ok": True,
            "latencyMs": round((utcnow() - started).total_seconds() * 1000),
            "total": lookup_response.get("total", 0),
            "agentVerified": True,
            "campaignVerified": True,
            "multilingual": {
                "enabled": bool(multilingual.get("enabled")),
                "languageSwitchTool": multilingual.get("language_switch_tool", "switch_language_tool"),
                "agentConfigurationRequired": True,
            },
        })
    except SamoraError as exc:
        raise HTTPException(status_code=502, detail=f"Samora connection failed ({exc.code})") from exc
    finally:
        await client.close()


async def list_runs(database, page: int, page_size: int):
    total = await database.checkout_recovery_runs.count_documents({})
    documents = await database.checkout_recovery_runs.find({}).sort("started_at", -1).skip((page - 1) * page_size).limit(page_size).to_list(length=page_size)
    return {"items": _api_json(documents), "page": page, "pageSize": page_size, "total": total}


async def list_checkouts(database, page: int, page_size: int, status: str | None):
    query = {"status": status} if status else {}
    total = await database.checkouts.count_documents(query)
    documents = await database.checkouts.find(query).sort("updated_at", -1).skip((page - 1) * page_size).limit(page_size).to_list(length=page_size)
    return {"items": [checkout_public(document) for document in documents], "page": page, "pageSize": page_size, "total": total}


async def checkout_recovery_candidates(database, *, limit: int) -> Dict[str, Any]:
    """Return normalized unpaid-cart targets; downstream campaign IDs own idempotency."""
    now = utcnow()
    documents = await database.checkouts.find(
        {
            "status": "active",
            "payment_status": "unpaid",
            "item_count": {"$gt": 0},
            "eligible_at": {"$lte": now},
        }
    ).sort("updated_at", -1).limit(limit).to_list(length=limit)
    rows, errors, valid = validate_and_dedupe_source(
        [source_row(document) for document in documents]
    )
    items = []
    for row in rows:
        items.append(
            {
                "externalId": row["external_id"],
                "phone": row["contact_phone"],
                "participant": {
                    "name": row.get("customer_name") or row.get("first_name") or "",
                    "email": row.get("customer_email") or "",
                },
                "context": {
                    "workflow": "abandoned_checkout",
                    "checkoutId": row.get("checkout_id"),
                    "cartValue": row.get("cart_value") or row.get("cart_total"),
                    "currency": row.get("currency") or "INR",
                    "itemCount": row.get("item_count") or 0,
                    "productTitles": row.get("product_titles") or [],
                    "recoveryUrl": row.get("recovery_url"),
                    "checkoutUpdatedAt": row["updated_at"].isoformat(),
                },
                "metadata": {
                    "source": "stylme_checkout_recovery",
                    "preferred_language": "hi-IN",
                },
            }
        )
    return {
        "items": items,
        "fetched": len(documents),
        "valid": valid,
        "eligible": len(items),
        "errors": errors,
        "generatedAt": now.isoformat(),
    }
