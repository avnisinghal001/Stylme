from __future__ import annotations

from datetime import datetime, time
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import Field, HttpUrl, field_validator, model_validator

from app.schemas.base import CamelModel


class CheckoutRecoverySourceConfig(CamelModel):
    page_size: int = Field(default=500, ge=1, le=500)


class SamoraConfigInput(CamelModel):
    environment: Literal["stage", "production"] = "stage"
    base_url: HttpUrl = "https://api.stage.samora.ai"
    org_api_key: Optional[str] = Field(default=None, min_length=8, max_length=1000)
    agent_id: Optional[UUID] = None
    campaign_id: Optional[UUID] = None
    platform: str = Field(default="stylme", pattern=r"^[a-z][a-z0-9_-]{1,63}$")
    external_workflow_id: str = Field(
        default="stylme-abandoned-checkout-v1",
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$",
    )
    allowed_campaign_statuses: List[Literal["DRAFT", "IN_PROGRESS"]] = Field(
        default_factory=lambda: ["DRAFT", "IN_PROGRESS"], min_length=1, max_length=2
    )

    @field_validator("base_url")
    @classmethod
    def allowed_samora_host(cls, value: HttpUrl):
        if str(value).rstrip("/") not in {
            "https://api.stage.samora.ai",
            "https://api.samora.ai",
        }:
            raise ValueError("Samora base URL is outside the server allowlist")
        return value


class CallingConfigInput(CamelModel):
    timezone: Literal["Asia/Kolkata"] = "Asia/Kolkata"
    window_start: time = time(9, 0)
    window_end: time = time(20, 0)
    inactivity_minutes: int = Field(default=20, ge=15, le=1440)
    max_attempts: int = Field(default=2, ge=1, le=10)
    cooldown_minutes: int = Field(default=1440, ge=1, le=43_200)

    @model_validator(mode="after")
    def valid_window(self):
        if self.window_start == self.window_end:
            raise ValueError("Calling window start and end cannot match")
        return self


class MultilingualCallConfigInput(CamelModel):
    enabled: bool = True
    primary_language: Literal["en-IN", "hi-IN", "ta-IN", "te-IN", "bn-IN", "mr-IN"] = "en-IN"
    supported_languages: List[Literal["en-IN", "hi-IN", "ta-IN", "te-IN", "bn-IN", "mr-IN"]] = Field(
        default_factory=lambda: ["en-IN", "hi-IN"], min_length=1, max_length=6
    )
    automatic_detection: bool = True
    detection_threshold: int = Field(default=2, ge=1, le=5)
    language_switch_tool: Literal["switch_language_tool"] = "switch_language_tool"

    @model_validator(mode="after")
    def primary_is_supported(self):
        if self.enabled and self.primary_language not in self.supported_languages:
            raise ValueError("Primary language must be included in supported languages")
        return self


class ZepicProviderConfigInput(CamelModel):
    mode: Literal["record_sync"] = "record_sync"
    base_url: HttpUrl
    api_token: Optional[str] = Field(default=None, min_length=8, max_length=2000)
    lookup_field: str = Field(default="mobile_number", min_length=1, max_length=100)
    object_name: str = Field(default="Samora-Checkout", min_length=1, max_length=120)
    object_type: str = Field(default="custom", min_length=1, max_length=80)
    object_api_name: str = Field(default="samora_checkout", pattern=r"^[a-z][a-z0-9_]{1,79}$")
    record_fields: Dict[str, str] = Field(default_factory=dict)

    @field_validator("base_url")
    @classmethod
    def allowed_zepic_host(cls, value: HttpUrl):
        host = (value.host or "").casefold()
        if not host.endswith(".myzepic.com"):
            raise ValueError("ZEPIC base URL must use an approved myzepic.com account host")
        return value


class PostCallDeliveryInput(CamelModel):
    enabled: bool = False
    provider: Literal["zepic"] = "zepic"
    question_id: Optional[str] = Field(default="send_checkout_link", max_length=120)
    expected_answer: str = Field(default="yes", min_length=1, max_length=120)
    send_on_status: List[Literal["CALL_FINISHED"]] = Field(
        default_factory=lambda: ["CALL_FINISHED"], min_length=1, max_length=1
    )
    provider_config: Optional[ZepicProviderConfigInput] = None

    @model_validator(mode="after")
    def delivery_requirements(self):
        if self.enabled and (not self.question_id or not self.provider_config):
            raise ValueError("Enabled post-call delivery requires questionId and providerConfig")
        return self


class CheckoutRecoveryConfigUpdate(CamelModel):
    enabled: bool = False
    cron_secret: Optional[str] = Field(default=None, min_length=32, max_length=512)
    source: CheckoutRecoverySourceConfig = Field(default_factory=CheckoutRecoverySourceConfig)
    samora: SamoraConfigInput
    calling: CallingConfigInput = Field(default_factory=CallingConfigInput)
    multilingual: MultilingualCallConfigInput = Field(default_factory=MultilingualCallConfigInput)
    post_call_delivery: PostCallDeliveryInput = Field(default_factory=PostCallDeliveryInput)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class RecoveryTokenResolve(CamelModel):
    token: str = Field(min_length=32, max_length=512)


class CheckoutRecoveryRunQuery(CamelModel):
    requested_at: Optional[datetime] = None
