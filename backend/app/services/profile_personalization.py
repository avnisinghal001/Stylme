from __future__ import annotations

import math
from typing import Any, Dict, Optional

from app.services.profile_service import _age


# These boundaries mirror the processed catalogue contract in DATA.md:
# adult wearable variants are 13–110; child variants are 0–14.
ADULT_MIN_AGE = 13
CHILD_MAX_AGE = 14
HEIGHT_BAND_CM = 15
WEIGHT_BAND_KG = 10


def measurement_band(value: Optional[float], width: int) -> Optional[Dict[str, float]]:
    if value is None:
        return None
    minimum = math.floor(float(value) / width) * width
    return {"min": minimum, "max": minimum + width}


def compatible_gender_keys(values: list[str], age: Optional[int] = None) -> list[str]:
    """Translate an explicit preference into age-compatible product departments."""
    resolved: list[str] = []
    for value in values:
        if value == "unspecified":
            continue
        if value in {"women", "girls"}:
            if age is None or age >= ADULT_MIN_AGE:
                resolved.append("women")
            if age is None or age <= CHILD_MAX_AGE:
                resolved.extend(("girls", "kids"))
            resolved.append("unisex")
        elif value in {"men", "boys"}:
            if age is None or age >= ADULT_MIN_AGE:
                resolved.append("men")
            if age is None or age <= CHILD_MAX_AGE:
                resolved.extend(("boys", "kids"))
            resolved.append("unisex")
        elif value == "kids":
            resolved.extend(("kids", "girls", "boys", "unisex"))
        else:
            resolved.append(value)
    return list(dict.fromkeys(resolved))


def profile_personalization(user: Dict[str, Any]) -> Dict[str, Any]:
    preferences = user.get("preferences") or {}
    body = user.get("body_profile") or {}
    appearance = user.get("appearance_profile") or {}
    consent = bool(body.get("consent"))
    age = _age(body.get("dateOfBirth") or body.get("date_of_birth"))
    soft_metadata = {
        key: list(dict.fromkeys(values))
        for key, values in {
            "style": preferences.get("styleKeys") or [],
            "generation": preferences.get("generationKeys") or [],
            "aesthetic": preferences.get("aestheticKeys") or [],
            "occasion": preferences.get("occasionKeys") or [],
            "festival": preferences.get("festivalKeys") or [],
            "personalization_segment": preferences.get("personalizationSegmentKeys") or [],
            "color_family": appearance.get("recommendedColorFamilyKeys") or [],
        }.items()
        if values
    }
    selected_gender = preferences.get("genderKeys") or []
    height = body.get("heightCm") if consent else None
    weight = body.get("weightKg") if consent else None
    return {
        "selectedGenderKeys": selected_gender,
        "genderKeys": compatible_gender_keys(selected_gender, age),
        "age": age,
        "heightCm": height,
        "weightKg": weight,
        "heightBand": measurement_band(height, HEIGHT_BAND_CM),
        "weightBand": measurement_band(weight, WEIGHT_BAND_KG),
        "softMetadata": soft_metadata,
    }
