from __future__ import annotations

from typing import Optional

from pydantic import Field

from app.schemas.base import CamelModel


class LocationResolveRequest(CamelModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_meters: Optional[float] = Field(default=None, ge=0, le=100_000)
