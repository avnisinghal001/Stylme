from fastapi import APIRouter, Depends

from app.api.deps import object_id, require_approved_seller
from app.database.connection import get_database
from app.schemas.ai_processing import AIFailRequest, AICompleteRequest, AIReserveRequest
from app.services.ai_processing_service import complete_run, fail_run, reserve_run


router = APIRouter(prefix="/ai-processing", tags=["AI processing"])


@router.post("/reserve", status_code=201)
async def reserve(
    payload: AIReserveRequest,
    actor=Depends(require_approved_seller),
    database=Depends(get_database),
):
    return await reserve_run(database, payload, actor)


@router.post("/{run_id}/complete")
async def complete(
    run_id: str,
    payload: AICompleteRequest,
    actor=Depends(require_approved_seller),
    database=Depends(get_database),
):
    return await complete_run(database, object_id(run_id, "run id"), payload, actor)


@router.post("/{run_id}/fail")
async def fail(
    run_id: str,
    payload: AIFailRequest,
    actor=Depends(require_approved_seller),
    database=Depends(get_database),
):
    return await fail_run(database, object_id(run_id, "run id"), payload, actor)
