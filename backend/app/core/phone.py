from __future__ import annotations

import re
from typing import Optional


E164_RE = re.compile(r"^\+[1-9][0-9]{7,14}$")


def normalize_e164(value: Optional[str], *, default_country_code: str = "91") -> Optional[str]:
    """Normalize the Indian-first phone inputs used by StylMe into E.164."""
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        return None
    if raw.startswith("00"):
        raw = f"+{raw[2:]}"
    digits = re.sub(r"\D", "", raw)
    if raw.startswith("+"):
        candidate = f"+{digits}"
    elif len(digits) == 10:
        candidate = f"+{default_country_code}{digits}"
    elif len(digits) == 11 and digits.startswith("0"):
        candidate = f"+{default_country_code}{digits[1:]}"
    elif len(digits) == 12 and digits.startswith(default_country_code):
        candidate = f"+{digits}"
    else:
        candidate = f"+{digits}"
    return candidate if E164_RE.fullmatch(candidate) else None
