from __future__ import annotations

import re
from typing import Dict, List, Literal, Optional

from pydantic import Field, model_validator

from app.schemas.base import CamelModel


class SearchIntentRequest(CamelModel):
    query: str = Field(min_length=1, max_length=300)
    pincode: Optional[str] = Field(default=None, pattern=r"^[1-9][0-9]{5}$")


class AdvancedSearchRequest(CamelModel):
    query: str = Field(min_length=1, max_length=300)
    lexical_query: Optional[str] = Field(default=None, max_length=100)
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=12, ge=1, le=100)
    brand: List[str] = Field(default_factory=list, max_length=20)
    category: List[str] = Field(default_factory=list, max_length=20)
    product_type: List[str] = Field(default_factory=list, max_length=30)
    colour: List[str] = Field(default_factory=list, max_length=20)
    size: List[str] = Field(default_factory=list, max_length=30)
    gender: List[str] = Field(default_factory=list, max_length=10)
    profile_gender: List[str] = Field(default_factory=list, max_length=3)
    profile_age: Optional[float] = Field(default=None, ge=0, le=110)
    profile_height_cm: Optional[float] = Field(default=None, ge=40, le=260)
    profile_weight_kg: Optional[float] = Field(default=None, ge=2, le=400)
    metadata: Dict[str, List[str]] = Field(default_factory=dict)
    min_price: Optional[float] = Field(default=None, ge=0)
    max_price: Optional[float] = Field(default=None, ge=0)
    min_age: Optional[float] = Field(default=None, ge=0, le=110)
    max_age: Optional[float] = Field(default=None, ge=0, le=110)
    min_height_cm: Optional[float] = Field(default=None, ge=40, le=260)
    max_height_cm: Optional[float] = Field(default=None, ge=40, le=260)
    min_weight_kg: Optional[float] = Field(default=None, ge=2, le=400)
    max_weight_kg: Optional[float] = Field(default=None, ge=2, le=400)
    sort: Literal["recommended", "newest", "price-low", "price-high", "rating"] = "recommended"
    pincode: Optional[str] = Field(default=None, pattern=r"^[1-9][0-9]{5}$")
    swoopstyl: bool = False
    radius_km: float = Field(default=100, ge=1, le=250)

    @model_validator(mode="after")
    def ordered_advanced_ranges(self):
        for label, low, high in (
            ("price", self.min_price, self.max_price),
            ("age", self.min_age, self.max_age),
            ("height", self.min_height_cm, self.max_height_cm),
            ("weight", self.min_weight_kg, self.max_weight_kg),
        ):
            if low is not None and high is not None and low > high:
                raise ValueError(f"Minimum {label} cannot exceed maximum {label}")
        if self.swoopstyl and not self.pincode:
            trailing_pincode = re.search(
                r"(?<![0-9])([1-9][0-9]{5})\s*$", self.query
            )
            if not trailing_pincode:
                raise ValueError(
                    "SwoopStyl search requires a pincode field or a trailing pincode"
                )
            self.pincode = trailing_pincode.group(1)
        return self
