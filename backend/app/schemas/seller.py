from __future__ import annotations

from typing import Any, Dict, Literal, Optional

from pydantic import EmailStr, Field, field_validator

from app.schemas.base import CamelModel


class GeoPointInput(CamelModel):
    type: Literal["Point"] = "Point"
    coordinates: list[float] = Field(min_length=2, max_length=2)

    @field_validator("coordinates")
    @classmethod
    def validate_coordinates(cls, value: list[float]) -> list[float]:
        longitude, latitude = value
        if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
            raise ValueError("Invalid longitude/latitude")
        return value


class PrimaryLocationInput(CamelModel):
    name: str = Field(default="Primary location", min_length=2, max_length=120)
    address_line: str = Field(min_length=5, max_length=500)
    pincode: str = Field(pattern=r"^[1-9][0-9]{5}$")
    place: Dict[str, Any] = Field(default_factory=dict)
    geo_point: Optional[GeoPointInput] = None
    timezone: str = Field(default="Asia/Kolkata", max_length=80)
    daily_capacity: int = Field(default=100, ge=1, le=1_000_000)
    cutoff_local: str = Field(default="14:00", pattern=r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")
    handling_hours: int = Field(default=8, ge=0, le=168)
    swoopstyl_enabled: bool = True


class SellerApplicationCreate(CamelModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=120)
    display_name: str = Field(min_length=2, max_length=120)
    brand_name: str = Field(min_length=2, max_length=160)
    contact: Dict[str, Any] = Field(default_factory=dict)
    legal_details: Optional[Dict[str, Any]] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    primary_location: PrimaryLocationInput

    @field_validator("metadata", "contact")
    @classmethod
    def bounded_objects(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        if len(str(value).encode("utf-8")) > 16_384:
            raise ValueError("Object exceeds the 16 KB limit")
        return value


class SellerDecisionRequest(CamelModel):
    decision: Literal["approved", "rejected"]
    reason: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("reason")
    @classmethod
    def rejection_requires_reason(cls, value: Optional[str], info):
        if info.data.get("decision") == "rejected" and not value:
            raise ValueError("A rejection reason is required")
        return value
