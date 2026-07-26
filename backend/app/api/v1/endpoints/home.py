from typing import Optional

from fastapi import APIRouter, Depends, Query, Response

from app.api.deps import get_current_user
from app.database.connection import get_database
from app.services.home_service import home_service


router = APIRouter(prefix="/home", tags=["Home"])


@router.get("")
async def get_home(response: Response, database=Depends(get_database)):
    response.headers["Cache-Control"] = (
        "public, s-maxage=60, stale-while-revalidate=300"
    )
    return await home_service.get_home(database)


@router.get("/personalized")
async def get_personalized_home(
    pincode: Optional[str] = Query(default=None, pattern=r"^[1-9][0-9]{5}$"),
    swoopstyl: bool = Query(default=False),
    limit: int = Query(default=8, ge=1, le=24),
    user=Depends(get_current_user),
    database=Depends(get_database),
):
    return await home_service.get_personalized(
        database,
        user,
        pincode=pincode,
        swoopstyl=swoopstyl,
        limit=limit,
    )
