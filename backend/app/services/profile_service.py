from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, Optional

from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.core.phone import normalize_e164
from app.core.serialization import mongo_json
from app.services.audit_service import write_audit
from app.services.metadata_service import active_fields, taxonomy_contract


PROFILE_CORE_KEYS = {
    "email", "roles", "status", "password", "passwordHash", "bodyProfile",
    "preferences", "appearanceProfile", "addresses", "defaultPincode",
}


def _age(date_of_birth: Optional[date | datetime | str]) -> Optional[int]:
    if not date_of_birth:
        return None
    if isinstance(date_of_birth, str):
        try:
            date_of_birth = date.fromisoformat(date_of_birth[:10])
        except ValueError:
            return None
    if isinstance(date_of_birth, datetime):
        date_of_birth = date_of_birth.date()
    today = date.today()
    return today.year - date_of_birth.year - (
        (today.month, today.day) < (date_of_birth.month, date_of_birth.day)
    )


def profile_public(user: Dict[str, Any]) -> Dict[str, Any]:
    body = user.get("body_profile") or {}
    date_of_birth = body.get("dateOfBirth") or body.get("date_of_birth")
    preferences = {
        key: value
        for key, value in (user.get("preferences") or {}).items()
        if key != "colorFamilyKeys"
    }
    for key in (
        "styleKeys",
        "sizeKeys",
        "generationKeys",
        "genderKeys",
        "aestheticKeys",
        "occasionKeys",
        "festivalKeys",
        "personalizationSegmentKeys",
    ):
        preferences.setdefault(key, [])
    return mongo_json(
        {
            "id": user.get("_id"),
            "email": user.get("email"),
            "fullName": user.get("full_name"),
            "phone": user.get("phone_e164"),
            "avatarUrl": user.get("avatar_url"),
            "roles": user.get("roles") or [],
            "status": user.get("status"),
            "onboardingCompleted": bool(user.get("onboarding_completed")),
            "defaultPincode": user.get("default_pincode"),
            "addresses": user.get("addresses") or [],
            "preferences": preferences,
            "bodyProfile": {
                "dateOfBirth": date_of_birth,
                "age": _age(date_of_birth),
                "heightCm": body.get("heightCm"),
                "weightKg": body.get("weightKg"),
                "consent": bool(body.get("consent")),
                "updatedAt": body.get("updatedAt"),
            },
            "appearanceProfile": user.get("appearance_profile"),
            "metadata": user.get("metadata") or {},
            "createdAt": user.get("created_at"),
            "updatedAt": user.get("updated_at"),
        }
    )


async def _validate_options(database, field_key: str, values: Iterable[str]) -> list[str]:
    fields = await active_fields(database)
    field = fields.get(field_key)
    if not field:
        raise HTTPException(status_code=503, detail=f"Controlled field {field_key} is unavailable")
    allowed = {
        option.get("key")
        for option in field.get("options") or []
        if isinstance(option, dict) and option.get("active", True)
    }
    clean = list(dict.fromkeys(values))
    unknown = sorted(set(clean) - allowed)
    if unknown:
        raise HTTPException(
            status_code=422,
            detail={"message": f"Unknown {field_key} options", "values": unknown},
        )
    return clean


async def update_profile(database, user, payload, *, complete_onboarding: bool = False):
    values = payload.model_dump(mode="json", by_alias=False, exclude_unset=True)
    now = datetime.now(timezone.utc)
    updates: Dict[str, Any] = {"updated_at": now}
    if "full_name" in values:
        updates["full_name"] = values["full_name"]
    if "phone" in values:
        normalized_phone = normalize_e164(values["phone"])
        if not normalized_phone:
            raise HTTPException(status_code=422, detail="Enter a valid phone number with country code")
        updates["phone_e164"] = normalized_phone

    preferences = dict(user.get("preferences") or {})
    preference_fields = {
        "style_keys": ("style", "styleKeys"),
        "size_keys": ("size", "sizeKeys"),
        "generation_keys": ("generation", "generationKeys"),
        "gender_keys": ("gender", "genderKeys"),
        "aesthetic_keys": ("aesthetic", "aestheticKeys"),
        "occasion_keys": ("occasion", "occasionKeys"),
        "festival_keys": ("festival", "festivalKeys"),
        "personalization_segment_keys": (
            "personalization_segment",
            "personalizationSegmentKeys",
        ),
    }
    for request_key, (field_key, storage_key) in preference_fields.items():
        if request_key in values:
            preferences[storage_key] = await _validate_options(
                database, field_key, values[request_key] or []
            )
    # Color is derived from the reviewed appearance analysis, not stored as a
    # manual profile preference. Clear the legacy preference on the next save.
    preferences.pop("colorFamilyKeys", None)
    updates["preferences"] = preferences

    body = dict(user.get("body_profile") or {})
    if "body_profile_consent" in values:
        body["consent"] = bool(values["body_profile_consent"])
        if not body["consent"]:
            body["heightCm"] = None
            body["weightKg"] = None
    if "date_of_birth" in values:
        body["dateOfBirth"] = values["date_of_birth"]
    if "height_cm" in values:
        if not values.get("body_profile_consent", body.get("consent")):
            raise HTTPException(status_code=422, detail="Height requires body-profile consent")
        body["heightCm"] = values["height_cm"]
    if "weight_kg" in values:
        if not values.get("body_profile_consent", body.get("consent")):
            raise HTTPException(status_code=422, detail="Weight requires body-profile consent")
        body["weightKg"] = values["weight_kg"]
    if any(
        key in values
        for key in ("date_of_birth", "height_cm", "weight_kg", "body_profile_consent")
    ):
        body["updatedAt"] = now
    updates["body_profile"] = body

    if "metadata" in values and values["metadata"] is not None:
        invalid = sorted(set(values["metadata"]) & PROFILE_CORE_KEYS)
        if invalid:
            raise HTTPException(
                status_code=422,
                detail={"message": "Metadata cannot override profile fields", "keys": invalid},
            )
        updates["metadata"] = {**(user.get("metadata") or {}), **values["metadata"]}
    if complete_onboarding:
        updates["onboarding_completed"] = True
        if user.get("appearance_profile"):
            updates["appearance_profile.reviewRequired"] = False

    try:
        updated = await database.users.find_one_and_update(
            {"_id": user["_id"], "status": "active"},
            {"$set": updates},
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="This phone number is already in use") from exc
    await write_audit(
        database,
        action="customer_onboarding_completed" if complete_onboarding else "profile_updated",
        entity_type="user",
        entity_id=str(user["_id"]),
        actor=user,
        changes={"fields": sorted(values)},
    )
    return profile_public(updated)


def appearance_run_public(document: Dict[str, Any]) -> Dict[str, Any]:
    result = {
        "runId": document.get("_id"),
        "status": document.get("status"),
        "shouldProcess": bool(document.get("_should_process", False)),
        "inputHash": document.get("input_hash"),
        "contractVersion": document.get("contract_version"),
        "metadataSchemaVersion": document.get("metadata_schema_version"),
        "allowedFiltersHash": document.get("allowed_filters_hash"),
        "createdAt": document.get("created_at"),
        "completedAt": document.get("completed_at"),
    }
    if document.get("status") == "completed":
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


async def reserve_appearance(database, user, payload):
    schema_version, allowed_hash, _ = await taxonomy_contract(database)
    if payload.contract_version != 2:
        raise HTTPException(status_code=409, detail="Appearance contract version is stale")
    if payload.metadata_schema_version != schema_version:
        raise HTTPException(status_code=409, detail="Metadata schema version is stale")
    if payload.allowed_filters_hash != allowed_hash:
        raise HTTPException(status_code=409, detail="Allowed filters hash is stale")
    now = datetime.now(timezone.utc)
    document = {
        "user_id": user["_id"],
        "input_hash": payload.input_hash,
        "image_hashes": payload.image_hashes,
        "contract_version": payload.contract_version,
        "metadata_schema_version": payload.metadata_schema_version,
        "allowed_filters_hash": payload.allowed_filters_hash,
        "consent": True,
        "status": "reserved",
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = await database.user_appearance_runs.insert_one(document)
        document["_id"] = result.inserted_id
        document["_should_process"] = True
        return appearance_run_public(document)
    except DuplicateKeyError:
        existing = await database.user_appearance_runs.find_one(
            {
                "user_id": user["_id"],
                "input_hash": payload.input_hash,
                "contract_version": payload.contract_version,
            }
        )
        if not existing:
            raise HTTPException(status_code=409, detail="Appearance run could not be reserved")
        retryable = existing.get("status") == "failed" or (
            existing.get("status") == "reserved"
            and existing.get("updated_at", existing.get("created_at", now))
            < now - timedelta(minutes=5)
        )
        if retryable:
            existing = await database.user_appearance_runs.find_one_and_update(
                {"_id": existing["_id"], "status": existing.get("status")},
                {
                    "$set": {
                        **document,
                        "status": "reserved",
                        "updated_at": now,
                    },
                    "$unset": {
                        "error": "",
                        "provider": "",
                        "model": "",
                        "proposal": "",
                        "confidence": "",
                        "warnings": "",
                        "completed_at": "",
                    },
                },
                return_document=ReturnDocument.AFTER,
            )
            if existing:
                existing["_should_process"] = True
                return appearance_run_public(existing)
        existing["_should_process"] = False
        return appearance_run_public(existing)


async def complete_appearance(database, user, run_id, payload):
    run = await database.user_appearance_runs.find_one(
        {"_id": run_id, "user_id": user["_id"]}
    )
    if not run:
        raise HTTPException(status_code=404, detail="Appearance run not found")
    if run.get("status") != "reserved":
        raise HTTPException(status_code=409, detail="Appearance run is already final")
    proposal_internal = payload.proposal.model_dump(mode="json", by_alias=False)
    controlled = {
        "recommended_color_family_keys": "color_family",
        "style_keys": "style",
        "fit_keys": "fit",
        "silhouette_keys": "silhouette",
    }
    for key, field_key in controlled.items():
        proposal_internal[key] = await _validate_options(
            database, field_key, proposal_internal.get(key) or []
        )
    action_fields = {
        "recommended_color_family": "recommended_color_family_keys",
        "style": "style_keys",
        "fit": "fit_keys",
        "silhouette": "silhouette_keys",
    }
    for action in proposal_internal.get("actions") or []:
        expected_values = proposal_internal.get(action_fields[action["field"]]) or []
        if sorted(action.get("values") or []) != sorted(expected_values):
            raise HTTPException(status_code=422, detail="Appearance action/value mismatch")
    proposal = payload.proposal.model_copy(
        update={key: proposal_internal[key] for key in controlled}
    ).model_dump(mode="json", by_alias=True)
    now = datetime.now(timezone.utc)
    updated = await database.user_appearance_runs.find_one_and_update(
        {"_id": run_id, "user_id": user["_id"], "status": "reserved"},
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
        raise HTTPException(status_code=409, detail="Appearance run is already final")
    appearance_profile = {
        **proposal,
        "runId": str(run_id),
        "inputHash": run["input_hash"],
        "imageHashes": run.get("image_hashes") or [],
        "confidence": payload.confidence,
        "reviewRequired": True,
        "updatedAt": now,
    }
    await database.users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "appearance_profile": appearance_profile,
                "metadata.recommendation.appearanceRunId": str(run_id),
                "updated_at": now,
            }
        },
    )
    await write_audit(
        database,
        action="appearance_profile_proposed",
        entity_type="user",
        entity_id=str(user["_id"]),
        actor=user,
        metadata={"runId": str(run_id)},
    )
    return appearance_run_public(updated)


async def fail_appearance(database, user, run_id, payload):
    now = datetime.now(timezone.utc)
    updated = await database.user_appearance_runs.find_one_and_update(
        {"_id": run_id, "user_id": user["_id"], "status": "reserved"},
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
        raise HTTPException(status_code=409, detail="Appearance run is missing or already final")
    return appearance_run_public(updated)
