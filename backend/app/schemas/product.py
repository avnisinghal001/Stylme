from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import Field, HttpUrl, field_validator, model_validator

from app.schemas.base import CamelModel


class MediaInput(CamelModel):
    id: Optional[str] = Field(default=None, max_length=120)
    type: Literal["image", "video"] = "image"
    url: HttpUrl
    display_url: Optional[HttpUrl] = None
    alt: str = Field(default="", max_length=300)
    position: int = Field(default=0, ge=0, le=100)
    provider: Optional[str] = Field(default=None, max_length=40)
    provider_id: Optional[str] = Field(default=None, max_length=160)
    width: Optional[int] = Field(default=None, ge=1, le=20_000)
    height: Optional[int] = Field(default=None, ge=1, le=20_000)
    size: Optional[int] = Field(default=None, ge=1, le=50_000_000)
    mime: Optional[str] = Field(default=None, max_length=100)
    sha256: Optional[str] = Field(default=None, pattern=r"^[a-f0-9]{64}$")


class FitRangeInput(CamelModel):
    applicable: bool
    min_height_cm: Optional[float] = Field(default=None, ge=40, le=260)
    max_height_cm: Optional[float] = Field(default=None, ge=40, le=260)
    min_weight_kg: Optional[float] = Field(default=None, ge=2, le=400)
    max_weight_kg: Optional[float] = Field(default=None, ge=2, le=400)
    source: str = Field(default="seller_confirmed", max_length=80)
    confidence: float = Field(default=1, ge=0, le=1)

    @model_validator(mode="after")
    def validate_bounds(self):
        bounds = (
            self.min_height_cm,
            self.max_height_cm,
            self.min_weight_kg,
            self.max_weight_kg,
        )
        if self.applicable and any(value is None for value in bounds):
            raise ValueError("Applicable fit ranges require all height/weight bounds")
        if not self.applicable and any(value is not None for value in bounds):
            raise ValueError("Non-applicable fit ranges must use null bounds")
        if self.applicable:
            if self.min_height_cm > self.max_height_cm:
                raise ValueError("Minimum height cannot exceed maximum height")
            if self.min_weight_kg > self.max_weight_kg:
                raise ValueError("Minimum weight cannot exceed maximum weight")
        return self


class AgeRangeInput(CamelModel):
    applicable: bool = False
    min_age: Optional[float] = Field(default=None, ge=0, le=110)
    max_age: Optional[float] = Field(default=None, ge=0, le=110)
    source: str = Field(default="seller_confirmed", max_length=80)
    confidence: float = Field(default=1, ge=0, le=1)

    @model_validator(mode="after")
    def validate_bounds(self):
        if self.applicable and (self.min_age is None or self.max_age is None):
            raise ValueError("Applicable age ranges require minimum and maximum ages")
        if not self.applicable and (self.min_age is not None or self.max_age is not None):
            raise ValueError("Non-applicable age ranges must use null bounds")
        if self.applicable and self.min_age > self.max_age:
            raise ValueError("Minimum age cannot exceed maximum age")
        return self


class VariantInput(CamelModel):
    id: str = Field(min_length=1, max_length=120)
    sku: str = Field(min_length=1, max_length=160)
    size_key: str = Field(min_length=1, max_length=80)
    color_id: str = Field(min_length=24, max_length=24)
    measurements: Dict[str, Any] = Field(default_factory=dict)
    fit_range: FitRangeInput
    age_range: AgeRangeInput = Field(default_factory=AgeRangeInput)
    attributes: Dict[str, Any] = Field(default_factory=dict)


class InventoryInput(CamelModel):
    variant_id: str = Field(min_length=1, max_length=120)
    location_id: str = Field(min_length=24, max_length=24)
    available_qty: int = Field(ge=0, le=10_000_000)
    active: bool = True


class OfferDraftInput(CamelModel):
    currency: Literal["INR"] = "INR"
    mrp_paise: int = Field(ge=0, le=1_000_000_000)
    sale_price_paise: int = Field(ge=0, le=1_000_000_000)
    offer_details: Dict[str, Any] = Field(default_factory=dict)
    variants: List[VariantInput] = Field(min_length=1, max_length=250)
    inventory: List[InventoryInput] = Field(min_length=1, max_length=2000)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_price(self):
        if self.sale_price_paise > self.mrp_paise:
            raise ValueError("Sale price cannot exceed MRP")
        return self


class ProductDraftCreate(CamelModel):
    seller_id: Optional[str] = Field(default=None, min_length=24, max_length=24)
    brand_id: str = Field(min_length=24, max_length=24)
    title: str = Field(min_length=3, max_length=300)
    description: str = Field(min_length=10, max_length=20_000)
    category_key: str = Field(min_length=1, max_length=100)
    product_type_key: str = Field(min_length=1, max_length=160)
    gender_keys: List[str] = Field(default_factory=list, max_length=10)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    media: List[MediaInput] = Field(min_length=1, max_length=20)
    offer: OfferDraftInput

    @field_validator("gender_keys")
    @classmethod
    def unique_genders(cls, values: List[str]) -> List[str]:
        if len(set(values)) != len(values):
            raise ValueError("genderKeys cannot contain duplicates")
        return values


class ProductDraftUpdate(CamelModel):
    brand_id: Optional[str] = Field(default=None, min_length=24, max_length=24)
    title: Optional[str] = Field(default=None, min_length=3, max_length=300)
    description: Optional[str] = Field(default=None, min_length=10, max_length=20_000)
    category_key: Optional[str] = Field(default=None, min_length=1, max_length=100)
    product_type_key: Optional[str] = Field(default=None, min_length=1, max_length=160)
    gender_keys: Optional[List[str]] = Field(default=None, max_length=10)
    metadata: Optional[Dict[str, Any]] = None
    media: Optional[List[MediaInput]] = Field(default=None, min_length=1, max_length=20)
    offer: Optional[OfferDraftInput] = None


class ProductReviewDecision(CamelModel):
    decision: Literal["approved", "rejected"]
    reason: Optional[str] = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def require_reason(self):
        if self.decision == "rejected" and not self.reason:
            raise ValueError("A rejection reason is required")
        return self
