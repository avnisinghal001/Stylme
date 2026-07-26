from __future__ import annotations

from datetime import datetime, timedelta, timezone
import base64
import hashlib
from typing import Any, Dict, Optional

import bcrypt
import jwt
from cryptography.fernet import Fernet, InvalidToken
from jwt import InvalidTokenError

from app.core.config import settings


class TokenError(ValueError):
    pass


class SecretDecryptionError(ValueError):
    pass


def _secret_cipher() -> Fernet:
    material = settings.CHECKOUT_RECOVERY_ENCRYPTION_KEY or settings.JWT_SECRET
    if len(material) < 32:
        raise RuntimeError("Checkout-recovery secret encryption is not configured")
    key = base64.urlsafe_b64encode(hashlib.sha256(material.encode("utf-8")).digest())
    return Fernet(key)


def encrypt_secret(value: str) -> str:
    return _secret_cipher().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_secret(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        return _secret_cipher().decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeError, ValueError) as exc:
        raise SecretDecryptionError("Encrypted integration secret cannot be read") from exc


def mask_secret(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    suffix = value[-4:] if len(value) >= 4 else "set"
    return f"••••••••{suffix}"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode(
        "utf-8"
    )


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (TypeError, ValueError):
        return False


def create_access_token(user_id: str) -> str:
    if len(settings.JWT_SECRET) < 32:
        raise RuntimeError("JWT authentication is not configured")
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "iat": now,
        "exp": now + timedelta(minutes=settings.JWT_EXPIRES_MINUTES),
        "iss": "stylme-api",
        "type": "access",
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> Dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
            issuer="stylme-api",
            options={"require": ["sub", "iat", "exp", "iss", "type"]},
        )
    except InvalidTokenError as exc:
        raise TokenError("Invalid or expired access token") from exc
    if payload.get("type") != "access":
        raise TokenError("Invalid token type")
    return payload
