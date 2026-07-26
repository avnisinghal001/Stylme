from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import Field, field_validator

from app.schemas.base import CamelModel


class AIReserveRequest(CamelModel):
    draft_id: str = Field(min_length=24, max_length=24)
    input_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    contract_version: int = Field(ge=1)
    metadata_schema_version: int = Field(ge=1)
    allowed_filters_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    kind: str = Field(default="product_details", pattern=r"^[a-z][a-z0-9_-]{1,63}$")


class AIColorProposal(CamelModel):
    name: str = Field(min_length=1, max_length=100)
    hex: str = Field(pattern=r"^#[A-Fa-f0-9]{6}$")
    family_keys: List[str] = Field(min_length=1, max_length=4)
    confidence: float = Field(ge=0, le=1)

    @field_validator("family_keys")
    @classmethod
    def unique_families(cls, values: List[str]) -> List[str]:
        if len(values) != len(set(values)):
            raise ValueError("familyKeys cannot contain duplicates")
        return values


class AIProductProposal(CamelModel):
    title: Optional[str] = Field(default=None, min_length=3, max_length=300)
    description: Optional[str] = Field(default=None, min_length=10, max_length=20_000)
    category_key: Optional[str] = Field(default=None, min_length=1, max_length=100)
    product_type_key: Optional[str] = Field(default=None, min_length=1, max_length=160)
    gender_keys: Optional[List[str]] = Field(default=None, max_length=10)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    color_proposals: List[AIColorProposal] = Field(default_factory=list, max_length=20)


class AICompleteRequest(CamelModel):
    provider: str = Field(min_length=1, max_length=80)
    model: str = Field(min_length=1, max_length=160)
    proposal: AIProductProposal
    confidence: float = Field(ge=0, le=1)
    warnings: List[str] = Field(default_factory=list, max_length=50)


class AIFailRequest(CamelModel):
    provider: Optional[str] = Field(default=None, max_length=80)
    model: Optional[str] = Field(default=None, max_length=160)
    error_code: str = Field(min_length=1, max_length=100)
    error_message: str = Field(min_length=1, max_length=1000)
