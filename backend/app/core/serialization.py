from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict

from bson import ObjectId


def mongo_json(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, list):
        return [mongo_json(item) for item in value]
    if isinstance(value, dict):
        return {key: mongo_json(item) for key, item in value.items()}
    return value


def _profile_age(value: Any) -> int | None:
    if not value:
        return None
    if isinstance(value, str):
        try:
            value = date.fromisoformat(value[:10])
        except ValueError:
            return None
    if isinstance(value, datetime):
        value = value.date()
    if not isinstance(value, date):
        return None
    today = date.today()
    return today.year - value.year - (
        (today.month, today.day) < (value.month, value.day)
    )


def public_user(user: Dict[str, Any], seller: Dict[str, Any] = None) -> Dict[str, Any]:
    body_profile = user.get("body_profile") or {}
    body_consent = bool(body_profile.get("consent"))
    return mongo_json(
        {
            "id": user["_id"],
            "email": user.get("email"),
            "fullName": user.get("full_name"),
            "phone": user.get("phone_e164"),
            "avatarUrl": user.get("avatar_url"),
            "roles": user.get("roles") or [],
            "status": user.get("status"),
            "onboardingCompleted": user.get("onboarding_completed", False),
            "genderKeys": (user.get("preferences") or {}).get("genderKeys") or [],
            "defaultPincode": user.get("default_pincode"),
            "profileSignals": {
                "age": _profile_age(
                    body_profile.get("dateOfBirth")
                    or body_profile.get("date_of_birth")
                ),
                "heightCm": body_profile.get("heightCm") if body_consent else None,
                "weightKg": body_profile.get("weightKg") if body_consent else None,
            },
            "sellerId": seller.get("_id") if seller else None,
            "sellerStatus": seller.get("status") if seller else None,
        }
    )
