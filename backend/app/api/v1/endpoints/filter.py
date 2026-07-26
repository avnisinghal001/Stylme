from fastapi import APIRouter, Depends, Response

from app.database.connection import get_database
from app.services.filter_service import filter_service


router = APIRouter(prefix="/filters", tags=["Filters"])


@router.get("")
async def get_filters(response: Response, database=Depends(get_database)):
    response.headers["Cache-Control"] = (
        "public, s-maxage=300, stale-while-revalidate=3600"
    )
    return await filter_service.get_filters(database)
