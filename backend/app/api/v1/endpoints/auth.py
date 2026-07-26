from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError

from app.core.security import create_access_token, hash_password, verify_password
from app.core.phone import normalize_e164
from app.core.serialization import public_user
from app.database.connection import get_database
from app.api.deps import get_current_user
from app.schemas.auth import LoginRequest, RegisterRequest
from app.services.audit_service import write_audit


router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", status_code=201)
async def register(payload: RegisterRequest, database=Depends(get_database)):
    email = str(payload.email).strip().lower()
    phone = normalize_e164(payload.phone)
    if not phone:
        raise HTTPException(status_code=422, detail="Enter a valid phone number with country code")
    now = datetime.now(timezone.utc)
    document = {
        "email": email,
        "full_name": payload.full_name,
        "phone_e164": phone,
        "password_hash": hash_password(payload.password),
        "avatar_url": None,
        "status": "active",
        "roles": ["customer"],
        "onboarding_completed": False,
        "addresses": [],
        "default_address_id": None,
        "default_pincode": None,
        "preferences": {
            "styleKeys": [],
            "sizeKeys": [],
            "generationKeys": [],
            "genderKeys": [],
        },
        "body_profile": {
            "dateOfBirth": None,
            "heightCm": None,
            "weightKg": None,
            "measurements": {},
            "consent": False,
            "updatedAt": None,
        },
        "appearance_profile": None,
        "whatsapp_opt_in": False,
        "metadata": {"auth": {"source": "customer_registration"}},
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = await database.users.insert_one(document)
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="An account already exists for this email") from exc
    document["_id"] = result.inserted_id
    await write_audit(
        database,
        action="customer_registered",
        entity_type="user",
        entity_id=str(result.inserted_id),
        actor=document,
    )
    return {
        "accessToken": create_access_token(str(result.inserted_id)),
        "tokenType": "bearer",
        "user": public_user(document),
    }


@router.post("/login")
async def login(payload: LoginRequest, database=Depends(get_database)):
    email = str(payload.email).strip().lower()
    user = await database.users.find_one({"email": email})
    if (
        not user
        or user.get("status") != "active"
        or not verify_password(payload.password, user.get("password_hash", ""))
    ):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    seller = await database.sellers.find_one({"user_id": user["_id"]})
    await database.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"last_login_at": datetime.now(timezone.utc)}},
    )
    await write_audit(
        database,
        action="auth_login",
        entity_type="user",
        entity_id=str(user["_id"]),
        actor=user,
    )
    return {
        "accessToken": create_access_token(str(user["_id"])),
        "tokenType": "bearer",
        "user": public_user(user, seller),
    }


@router.get("/me")
async def me(user=Depends(get_current_user), database=Depends(get_database)):
    seller = await database.sellers.find_one({"user_id": user["_id"]})
    return public_user(user, seller)
