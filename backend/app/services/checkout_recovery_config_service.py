from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import HTTPException
from pymongo import ReturnDocument

from app.core.config import settings
from app.core.security import decrypt_secret, encrypt_secret, mask_secret
from app.core.serialization import mongo_json
from app.services.audit_service import write_audit


CONFIG_KEY = "default"


def default_config(now: Optional[datetime] = None) -> Dict[str, Any]:
    timestamp = now or datetime.now(timezone.utc)
    return {
        "key": CONFIG_KEY,
        "enabled": False,
        "source": {"page_size": 500},
        "samora": {
            "environment": "stage",
            "base_url": "https://api.stage.samora.ai",
            "org_api_key_encrypted": None,
            "agent_id": None,
            "campaign_id": None,
            "platform": "stylme",
            "external_workflow_id": "stylme-abandoned-checkout-v1",
            "allowed_campaign_statuses": ["DRAFT", "IN_PROGRESS"],
        },
        "calling": {
            "timezone": "Asia/Kolkata",
            "window_start": "09:00:00",
            "window_end": "20:00:00",
            "inactivity_minutes": 20,
            "max_attempts": 2,
            "cooldown_minutes": 1440,
        },
        "multilingual": {
            "enabled": True,
            "primary_language": "en-IN",
            "supported_languages": ["en-IN", "hi-IN"],
            "automatic_detection": True,
            "detection_threshold": 2,
            "language_switch_tool": "switch_language_tool",
        },
        "post_call_delivery": {
            "enabled": False,
            "provider": "zepic",
            "question_id": "send_checkout_link",
            "expected_answer": "yes",
            "send_on_status": ["CALL_FINISHED"],
            "provider_config": None,
        },
        "cron_secret_encrypted": None,
        "metadata": {"system": {"managed": True}},
        "created_at": timestamp,
        "updated_at": timestamp,
    }


async def get_config(database) -> Dict[str, Any]:
    existing = await database.checkout_recovery_configs.find_one({"key": CONFIG_KEY})
    if existing:
        return existing
    document = default_config()
    updated = await database.checkout_recovery_configs.find_one_and_update(
        {"key": CONFIG_KEY},
        {"$setOnInsert": document},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return updated


def _configured_mask(encrypted: Optional[str]) -> tuple[bool, Optional[str]]:
    secret = decrypt_secret(encrypted) if encrypted else None
    return bool(secret), mask_secret(secret)


def public_config(document: Dict[str, Any]) -> Dict[str, Any]:
    samora = dict(document.get("samora") or {})
    stored_cron = decrypt_secret(document.get("cron_secret_encrypted")) if document.get("cron_secret_encrypted") else None
    cron_secret = settings.CRON_SECRET or stored_cron
    cron_configured, cron_masked = bool(cron_secret), mask_secret(cron_secret)
    org_configured, org_masked = _configured_mask(samora.pop("org_api_key_encrypted", None))
    delivery = dict(document.get("post_call_delivery") or {})
    provider = dict(delivery.get("provider_config") or {}) if delivery.get("provider_config") else None
    token_configured = False
    token_masked = None
    if provider is not None:
        token_configured, token_masked = _configured_mask(provider.pop("api_token_encrypted", None))
        delivery["providerConfig"] = {
            "mode": provider.get("mode"),
            "baseUrl": provider.get("base_url"),
            "apiTokenConfigured": token_configured,
            "apiToken": token_masked,
            "lookupField": provider.get("lookup_field"),
            "objectName": provider.get("object_name"),
            "objectType": provider.get("object_type"),
            "objectApiName": provider.get("object_api_name"),
            "recordFields": provider.get("record_fields") or {},
        }
    delivery_public = {
        "enabled": bool(delivery.get("enabled")),
        "provider": delivery.get("provider", "zepic"),
        "questionId": delivery.get("question_id"),
        "expectedAnswer": delivery.get("expected_answer"),
        "sendOnStatus": delivery.get("send_on_status") or [],
        "providerConfig": delivery.get("providerConfig"),
    }
    source = document.get("source") or {}
    calling = document.get("calling") or {}
    multilingual = document.get("multilingual") or default_config().get("multilingual") or {}
    result = {
        "id": document.get("_id"),
        "key": document.get("key"),
        "enabled": bool(document.get("enabled")),
        "source": {"pageSize": source.get("page_size", 500)},
        "samora": {
            "environment": samora.get("environment"),
            "baseUrl": samora.get("base_url"),
            "agentId": samora.get("agent_id"),
            "campaignId": samora.get("campaign_id"),
            "platform": samora.get("platform"),
            "externalWorkflowId": samora.get("external_workflow_id"),
            "allowedCampaignStatuses": samora.get("allowed_campaign_statuses") or [],
            "orgApiKeyConfigured": org_configured,
            "orgApiKey": org_masked,
        },
        "calling": {
            "timezone": calling.get("timezone"),
            "windowStart": calling.get("window_start"),
            "windowEnd": calling.get("window_end"),
            "inactivityMinutes": calling.get("inactivity_minutes"),
            "maxAttempts": calling.get("max_attempts"),
            "cooldownMinutes": calling.get("cooldown_minutes"),
        },
        "multilingual": {
            "enabled": bool(multilingual.get("enabled", True)),
            "primaryLanguage": multilingual.get("primary_language", "en-IN"),
            "supportedLanguages": multilingual.get("supported_languages") or ["en-IN", "hi-IN"],
            "automaticDetection": bool(multilingual.get("automatic_detection", True)),
            "detectionThreshold": int(multilingual.get("detection_threshold", 2)),
            "languageSwitchTool": multilingual.get("language_switch_tool", "switch_language_tool"),
        },
        "postCallDelivery": delivery_public,
        "cronSecretConfigured": cron_configured,
        "cronSecret": cron_masked,
        "cronHeader": "X-Cron-Secret",
        "metadata": document.get("metadata") or {},
        "updatedAt": document.get("updated_at"),
        "updatedByUserId": document.get("updated_by_user_id"),
    }
    return mongo_json(result)


async def save_config(database, actor, payload) -> Dict[str, Any]:
    existing = await get_config(database)
    values = payload.model_dump(mode="json", by_alias=False)
    samora = values["samora"]
    incoming_org_key = samora.pop("org_api_key", None)
    current_org_key = (existing.get("samora") or {}).get("org_api_key_encrypted")
    samora["org_api_key_encrypted"] = (
        encrypt_secret(incoming_org_key) if incoming_org_key else current_org_key
    )
    incoming_cron = values.pop("cron_secret", None)
    cron_encrypted = encrypt_secret(incoming_cron) if incoming_cron else existing.get("cron_secret_encrypted")

    delivery = values["post_call_delivery"]
    provider = delivery.get("provider_config")
    if provider is not None:
        incoming_token = provider.pop("api_token", None)
        existing_provider = (existing.get("post_call_delivery") or {}).get("provider_config") or {}
        provider["api_token_encrypted"] = (
            encrypt_secret(incoming_token)
            if incoming_token
            else existing_provider.get("api_token_encrypted")
        )

    if values["enabled"]:
        missing = []
        if not samora.get("agent_id"):
            missing.append("samora.agentId")
        if not samora.get("campaign_id"):
            missing.append("samora.campaignId")
        if not samora.get("org_api_key_encrypted"):
            missing.append("samora.orgApiKey")
        if not settings.CRON_SECRET and not cron_encrypted:
            missing.append("cronSecret")
        if delivery.get("enabled") and not (provider or {}).get("api_token_encrypted"):
            missing.append("postCallDelivery.providerConfig.apiToken")
        if missing:
            raise HTTPException(
                status_code=422,
                detail={"message": "Enabled recovery configuration is incomplete", "fields": missing},
            )

    now = datetime.now(timezone.utc)
    updates = {
        **values,
        "samora": samora,
        "post_call_delivery": delivery,
        "cron_secret_encrypted": cron_encrypted,
        "updated_by_user_id": actor["_id"],
        "updated_at": now,
    }
    updated = await database.checkout_recovery_configs.find_one_and_update(
        {"key": CONFIG_KEY},
        {"$set": updates, "$setOnInsert": {"created_at": now}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    await write_audit(
        database,
        action="checkout_recovery_config_updated",
        entity_type="checkout_recovery_config",
        entity_id=str(updated["_id"]),
        actor=actor,
        changes={
            "enabled": bool(values["enabled"]),
            "fields": ["source", "samora", "calling", "multilingual", "post_call_delivery"],
            "secretFieldsUpdated": [
                name
                for name, changed in (
                    ("cronSecret", bool(incoming_cron)),
                    ("samora.orgApiKey", bool(incoming_org_key)),
                    ("postCallDelivery.providerConfig.apiToken", bool(provider and incoming_token)),
                )
                if changed
            ],
        },
    )
    return public_config(updated)


def runtime_secrets(document: Dict[str, Any]) -> Dict[str, Optional[str]]:
    delivery = document.get("post_call_delivery") or {}
    provider = delivery.get("provider_config") or {}
    return {
        "cron_secret": settings.CRON_SECRET or decrypt_secret(document.get("cron_secret_encrypted")),
        "org_api_key": decrypt_secret((document.get("samora") or {}).get("org_api_key_encrypted")),
        "zepic_api_token": decrypt_secret(provider.get("api_token_encrypted")),
    }
