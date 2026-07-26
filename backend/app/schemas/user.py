from __future__ import annotations

import re
from datetime import date
from typing import Any, Dict, List, Literal, Optional

from pydantic import Field, field_validator, model_validator

from app.schemas.base import CamelModel


class UserProfileUpdate(CamelModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    phone: Optional[str] = Field(default=None, min_length=8, max_length=32)
    date_of_birth: Optional[date] = None
    height_cm: Optional[float] = Field(default=None, ge=80, le=240)
    weight_kg: Optional[float] = Field(default=None, ge=20, le=350)
    body_profile_consent: Optional[bool] = None
    style_keys: Optional[List[str]] = Field(default=None, max_length=12)
    size_keys: Optional[List[str]] = Field(default=None, max_length=20)
    generation_keys: Optional[List[str]] = Field(default=None, max_length=4)
    gender_keys: Optional[List[str]] = Field(default=None, max_length=3)
    aesthetic_keys: Optional[List[str]] = Field(default=None, max_length=8)
    occasion_keys: Optional[List[str]] = Field(default=None, max_length=8)
    festival_keys: Optional[List[str]] = Field(default=None, max_length=6)
    personalization_segment_keys: Optional[List[str]] = Field(default=None, max_length=8)
    metadata: Optional[Dict[str, Any]] = None

    @field_validator(
        "style_keys",
        "size_keys",
        "generation_keys",
        "gender_keys",
        "aesthetic_keys",
        "occasion_keys",
        "festival_keys",
        "personalization_segment_keys",
    )
    @classmethod
    def unique_values(cls, values: Optional[List[str]]):
        if values is not None and len(values) != len(set(values)):
            raise ValueError("Profile preference values must be unique")
        return values

    @field_validator("date_of_birth")
    @classmethod
    def plausible_birth_date(cls, value: Optional[date]):
        if value is None:
            return value
        today = date.today()
        age = today.year - value.year - ((today.month, today.day) < (value.month, value.day))
        if age < 5 or age > 110:
            raise ValueError("Age must be between 5 and 110")
        return value

    @field_validator("metadata")
    @classmethod
    def bounded_metadata(cls, value: Optional[Dict[str, Any]]):
        if value is not None and len(str(value).encode("utf-8")) > 16_384:
            raise ValueError("Profile metadata exceeds 16 KB")
        return value

    @model_validator(mode="after")
    def measurements_require_consent(self):
        if self.body_profile_consent is False and (
            self.height_cm is not None or self.weight_kg is not None
        ):
            raise ValueError("Height/weight require body profile consent")
        return self


class AppearanceReserveRequest(CamelModel):
    consent: Literal[True]
    input_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    contract_version: int = Field(default=2, ge=2)
    metadata_schema_version: int = Field(ge=1)
    allowed_filters_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    image_hashes: List[str] = Field(min_length=1, max_length=4)

    @field_validator("image_hashes")
    @classmethod
    def valid_unique_hashes(cls, values: List[str]):
        if len(values) != len(set(values)):
            raise ValueError("imageHashes must be unique")
        if any(not re.fullmatch(r"[a-f0-9]{64}", value) for value in values):
            raise ValueError("Every image hash must be SHA-256")
        return values


class AppearanceAction(CamelModel):
    field: Literal["recommended_color_family", "style", "fit", "silhouette"]
    action: Literal["reuse"]
    values: List[str] = Field(max_length=12)


class AppearanceProposal(CamelModel):
    skin_tone: Literal[
        "very-light", "light", "medium", "tan", "deep", "unknown"
    ] = "unknown"
    undertone: Literal["cool", "warm", "neutral", "olive", "unknown"] = "unknown"
    recommended_color_family_keys: List[str] = Field(default_factory=list, max_length=12)
    style_keys: List[str] = Field(default_factory=list, max_length=12)
    fit_keys: List[str] = Field(default_factory=list, max_length=8)
    silhouette_keys: List[str] = Field(default_factory=list, max_length=8)
    contrast_level: Literal["low", "medium", "high", "unknown"] = "unknown"
    notes: List[str] = Field(default_factory=list, max_length=12)
    actions: List[AppearanceAction] = Field(default_factory=list, max_length=12)


class AppearanceCompleteRequest(CamelModel):
    provider: str = Field(min_length=1, max_length=80)
    model: str = Field(min_length=1, max_length=160)
    proposal: AppearanceProposal
    confidence: float = Field(ge=0, le=1)
    warnings: List[str] = Field(default_factory=list, max_length=30)


class AppearanceFailRequest(CamelModel):
    provider: Optional[str] = Field(default=None, max_length=80)
    model: Optional[str] = Field(default=None, max_length=160)
    error_code: str = Field(min_length=1, max_length=100)
    error_message: str = Field(min_length=1, max_length=1000)
