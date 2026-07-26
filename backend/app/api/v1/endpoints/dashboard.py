from fastapi import APIRouter, Depends

from app.api.deps import require_roles
from app.database.connection import get_database
from app.services.dashboard_service import dashboard_service


router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/stats")
async def dashboard_stats(
    actor=Depends(require_roles("admin")), database=Depends(get_database)
):
    return await dashboard_service.get_stats(database)
