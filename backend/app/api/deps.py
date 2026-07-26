from __future__ import annotations

from typing import Any, Callable, Dict, Iterable

from bson import ObjectId
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.security import TokenError, decode_access_token
from app.database.connection import get_database


bearer = HTTPBearer(auto_error=False)


def object_id(value: str, label: str = "id") -> ObjectId:
    if not ObjectId.is_valid(value):
        raise HTTPException(status_code=422, detail=f"Invalid {label}")
    return ObjectId(value)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    database=Depends(get_database),
) -> Dict[str, Any]:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer authentication is required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = object_id(str(payload["sub"]), "token subject")
    except (TokenError, KeyError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = await database.users.find_one({"_id": user_id, "status": "active"})
    if not user:
        raise HTTPException(status_code=401, detail="User is unavailable")
    return user


def require_roles(*allowed: str) -> Callable:
    allowed_set = set(allowed)

    async def dependency(user: Dict[str, Any] = Depends(get_current_user)):
        roles = set(user.get("roles") or [])
        if "owner" not in roles and not roles.intersection(allowed_set):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user

    return dependency


async def require_approved_seller(
    user: Dict[str, Any] = Depends(get_current_user),
    database=Depends(get_database),
) -> Dict[str, Any]:
    roles = set(user.get("roles") or [])
    if "owner" in roles or "admin" in roles:
        return user
    if "seller" not in roles:
        raise HTTPException(status_code=403, detail="Seller role is required")
    seller = await database.sellers.find_one({"user_id": user["_id"]})
    if not seller or seller.get("status") != "approved":
        raise HTTPException(status_code=403, detail="Seller approval is required")
    user["_seller"] = seller
    return user


def has_any_role(user: Dict[str, Any], roles: Iterable[str]) -> bool:
    current = set(user.get("roles") or [])
    return "owner" in current or bool(current.intersection(set(roles)))
