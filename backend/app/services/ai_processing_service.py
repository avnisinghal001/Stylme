from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.core.config import settings
from app.core.serialization import mongo_json
from app.services.audit_service import write_audit
from app.services.metadata_service import taxonomy_contract, validate_product_metadata
from app.services.product_draft_service import assert_draft_access


def run_public(document: Dict[str, Any], include_result: bool = True) -> Dict[str, Any]:
    result = {
        "runId": document.get("_id"),
        "draftId": document.get("draft_id"),
        "status": document.get("status"),
        "shouldProcess": document.get("_should_process", False),
        "kind": document.get("kind"),
        "inputHash": document.get("input_hash"),
        "contractVersion": document.get("contract_version"),
        "metadataSchemaVersion": document.get("metadata_schema_version"),
        "allowedFiltersHash": document.get("allowed_filters_hash"),
        "reservationExpiresAt": document.get("reservation_expires_at"),
        "createdAt": document.get("created_at"),
        "completedAt": document.get("completed_at"),
    }
    if include_result and document.get("status") == "completed":
        result.update(
            {
                "provider": document.get("provider"),
                "model": document.get("model"),
                "proposal": document.get("proposal"),
                "confidence": document.get("confidence"),
                "warnings": document.get("warnings") or [],
            }
        )
    if document.get("status") == "failed":
        result["error"] = document.get("error")
    return mongo_json(result)


async def reserve_run(database, payload, actor):
    draft = await assert_draft_access(database, payload.draft_id, actor)
    if draft.get("status") not in {"draft", "rejected"}:
        raise HTTPException(status_code=409, detail="AI processing is closed for this draft")
    schema_version, allowed_hash, _ = await taxonomy_contract(database)
    if payload.contract_version != settings.AI_CONTRACT_VERSION:
        raise HTTPException(status_code=409, detail="AI contract version is stale")
    if payload.metadata_schema_version != schema_version:
        raise HTTPException(status_code=409, detail="Metadata schema version is stale")
    if payload.allowed_filters_hash != allowed_hash:
        raise HTTPException(status_code=409, detail="Allowed filters hash is stale")
    now = datetime.now(timezone.utc)
    document = {
        "draft_id": draft["_id"],
        "actor_user_id": actor["_id"],
        "kind": payload.kind,
        "input_hash": payload.input_hash,
        "contract_version": payload.contract_version,
        "metadata_schema_version": payload.metadata_schema_version,
        "allowed_filters_hash": payload.allowed_filters_hash,
        "status": "reserved",
        "reservation_expires_at": now
        + timedelta(seconds=settings.AI_RESERVATION_TTL_SECONDS),
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = await database.ai_processing_runs.insert_one(document)
        document["_id"] = result.inserted_id
        document["_should_process"] = True
        await write_audit(
            database,
            action="ai_processing_reserved",
            entity_type="ai_processing_run",
            entity_id=str(result.inserted_id),
            actor=actor,
            metadata={"draftId": payload.draft_id, "inputHash": payload.input_hash},
        )
        return run_public(document, include_result=False)
    except DuplicateKeyError:
        existing = await database.ai_processing_runs.find_one(
            {
                "draft_id": draft["_id"],
                "input_hash": payload.input_hash,
                "contract_version": payload.contract_version,
            }
        )
        existing["_should_process"] = False
        return run_public(existing)


async def complete_run(database, run_id, payload, actor):
    run = await database.ai_processing_runs.find_one({"_id": run_id})
    if not run:
        raise HTTPException(status_code=404, detail="AI processing run not found")
    await assert_draft_access(database, str(run["draft_id"]), actor)
    if run.get("status") != "reserved":
        raise HTTPException(status_code=409, detail="AI processing run is already final")
    now = datetime.now(timezone.utc)
    expires_at = run.get("reservation_expires_at")
    if expires_at and expires_at < now:
        await database.ai_processing_runs.update_one(
            {"_id": run_id, "status": "reserved"},
            {
                "$set": {
                    "status": "failed",
                    "error": {"code": "reservation_expired", "message": "Reservation expired"},
                    "completed_at": now,
                    "updated_at": now,
                }
            },
        )
        raise HTTPException(status_code=409, detail="AI processing reservation expired")
    proposal = payload.proposal.model_dump(mode="json", by_alias=False)
    proposal["metadata"] = await validate_product_metadata(
        database,
        category_key=proposal.get("category_key"),
        product_type_key=proposal.get("product_type_key"),
        gender_keys=proposal.get("gender_keys"),
        metadata=proposal.get("metadata") or {},
        partial=True,
        ai_only=True,
    )
    known_families = set(await database.colors.distinct("family_keys", {"status": "active"}))
    proposed_families = {
        family
        for color in proposal.get("color_proposals") or []
        for family in color.get("family_keys") or []
    }
    unknown_families = sorted(proposed_families - known_families)
    if unknown_families:
        raise HTTPException(
            status_code=422,
            detail={"message": "AI proposed unknown color families", "values": unknown_families},
        )
    updated = await database.ai_processing_runs.find_one_and_update(
        {"_id": run_id, "status": "reserved"},
        {
            "$set": {
                "status": "completed",
                "provider": payload.provider,
                "model": payload.model,
                "proposal": proposal,
                "confidence": payload.confidence,
                "warnings": payload.warnings,
                "completed_at": now,
                "updated_at": now,
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        raise HTTPException(status_code=409, detail="AI processing run is already final")
    await database.product_drafts.update_one(
        {"_id": run["draft_id"], "status": {"$in": ["draft", "rejected"]}},
        {
            "$set": {
                "ai_proposal": {
                    "runId": run_id,
                    "inputHash": run["input_hash"],
                    "proposal": proposal,
                    "confidence": payload.confidence,
                    "generatedAt": now,
                },
                "updated_at": now,
            }
        },
    )
    await write_audit(
        database,
        action="ai_processing_completed",
        entity_type="ai_processing_run",
        entity_id=str(run_id),
        actor=actor,
        metadata={"draftId": str(run["draft_id"]), "provider": payload.provider},
    )
    return run_public(updated)


async def fail_run(database, run_id, payload, actor):
    run = await database.ai_processing_runs.find_one({"_id": run_id})
    if not run:
        raise HTTPException(status_code=404, detail="AI processing run not found")
    await assert_draft_access(database, str(run["draft_id"]), actor)
    if run.get("status") != "reserved":
        raise HTTPException(status_code=409, detail="AI processing run is already final")
    now = datetime.now(timezone.utc)
    updated = await database.ai_processing_runs.find_one_and_update(
        {"_id": run_id, "status": "reserved"},
        {
            "$set": {
                "status": "failed",
                "provider": payload.provider,
                "model": payload.model,
                "error": {"code": payload.error_code, "message": payload.error_message},
                "completed_at": now,
                "updated_at": now,
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        raise HTTPException(status_code=409, detail="AI processing run is already final")
    await write_audit(
        database,
        action="ai_processing_failed",
        entity_type="ai_processing_run",
        entity_id=str(run_id),
        actor=actor,
        changes={"errorCode": payload.error_code},
    )
    return run_public(updated)
