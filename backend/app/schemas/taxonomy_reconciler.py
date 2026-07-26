from __future__ import annotations

import json
from typing import Any, Dict, List, Literal, Optional

from pydantic import Field, model_validator

from app.schemas.base import CamelModel


class SearchOutcomeWebhook(CamelModel):
    query: str = Field(min_length=1, max_length=300)
    result_count: int = Field(ge=0)
    source: Literal["storefront", "advanced-search", "ai", "voice", "api"] = "api"
    intent: Dict[str, Any] = Field(default_factory=dict)
    resolved_query: Dict[str, Any] = Field(default_factory=dict)
    fallback_count: int = Field(default=0, ge=0)
    fallback_level: Optional[int] = Field(default=None, ge=1, le=4)

    @model_validator(mode="after")
    def bounded_context(self):
        payload = {"intent": self.intent, "resolvedQuery": self.resolved_query}
        if len(json.dumps(payload, default=str, separators=(",", ":")).encode()) > 32_768:
            raise ValueError("Search outcome context exceeds 32 KB")
        return self


class ReconcilerRunRequest(CamelModel):
    max_queries: int = Field(default=30, ge=1, le=100)
    max_products: int = Field(default=250, ge=1, le=1000)
    graph_depth: int = Field(default=4, ge=1, le=4)
    use_ai: bool = True
    rebuild_graph: bool = False
    apply: bool = False


class GraphPreviewRequest(CamelModel):
    query: str = Field(min_length=1, max_length=300)
    depth: int = Field(default=4, ge=1, le=4)
    limit: int = Field(default=20, ge=1, le=50)


class ProposalDecisionRequest(CamelModel):
    decision: Literal["approved", "rejected"]
    reason: Optional[str] = Field(default=None, max_length=500)


class ApplyRetagProposalsRequest(CamelModel):
    proposal_ids: List[str] = Field(default_factory=list, max_length=500)
    minimum_confidence: float = Field(default=0.94, ge=0.5, le=1)
    limit: int = Field(default=500, ge=1, le=1000)
