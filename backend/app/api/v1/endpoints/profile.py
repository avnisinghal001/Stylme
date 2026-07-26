from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, object_id
from app.database.connection import get_database
from app.schemas.user import (
    AppearanceCompleteRequest,
    AppearanceFailRequest,
    AppearanceReserveRequest,
    UserProfileUpdate,
)
from app.services.profile_service import (
    complete_appearance,
    fail_appearance,
    profile_public,
    reserve_appearance,
    update_profile,
)


router = APIRouter(prefix="/profile", tags=["Customer profile"])


@router.get("")
async def get_profile(user=Depends(get_current_user)):
    return profile_public(user)


@router.patch("")
async def patch_profile(
    payload: UserProfileUpdate,
    user=Depends(get_current_user),
    database=Depends(get_database),
):
    return await update_profile(database, user, payload)


@router.post("/onboarding/complete")
async def complete_onboarding(
    payload: UserProfileUpdate,
    user=Depends(get_current_user),
    database=Depends(get_database),
):
    return await update_profile(database, user, payload, complete_onboarding=True)


@router.post("/appearance/reserve", status_code=201)
async def reserve_appearance_run(
    payload: AppearanceReserveRequest,
    user=Depends(get_current_user),
    database=Depends(get_database),
):
    return await reserve_appearance(database, user, payload)


@router.post("/appearance/{run_id}/complete")
async def complete_appearance_run(
    run_id: str,
    payload: AppearanceCompleteRequest,
    user=Depends(get_current_user),
    database=Depends(get_database),
):
    return await complete_appearance(
        database, user, object_id(run_id, "appearance run id"), payload
    )


@router.post("/appearance/{run_id}/fail")
async def fail_appearance_run(
    run_id: str,
    payload: AppearanceFailRequest,
    user=Depends(get_current_user),
    database=Depends(get_database),
):
    return await fail_appearance(
        database, user, object_id(run_id, "appearance run id"), payload
    )


@router.delete("/appearance", status_code=204)
async def delete_appearance_profile(
    user=Depends(get_current_user), database=Depends(get_database)
):
    await database.users.update_one(
        {"_id": user["_id"]},
        {
            "$unset": {
                "appearance_profile": "",
                "metadata.recommendation.appearanceRunId": "",
            }
        },
    )
    return None
