from fastapi import APIRouter, Depends, Query

from app.api.deps import require_roles
from app.api.v1.endpoints.ai_processing import router as ai_processing_router
from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.cart import router as cart_router
from app.api.v1.endpoints.checkout_recovery import router as checkout_recovery_router
from app.api.v1.endpoints.dashboard import router as dashboard_router
from app.api.v1.endpoints.filter import router as filter_router
from app.api.v1.endpoints.home import router as home_router
from app.api.v1.endpoints.location import router as location_router
from app.api.v1.endpoints.metadata import router as metadata_router
from app.api.v1.endpoints.order import router as order_router
from app.api.v1.endpoints.product import router as product_router
from app.api.v1.endpoints.product_draft import router as product_draft_router
from app.api.v1.endpoints.profile import router as profile_router
from app.api.v1.endpoints.search import router as search_router
from app.api.v1.endpoints.seller import router as seller_router
from app.api.v1.endpoints.taxonomy_reconciler import router as taxonomy_reconciler_router
from app.api.v1.endpoints.voice_runtime import router as voice_runtime_router
from app.core.config import settings
from app.core.serialization import mongo_json
from app.database.connection import get_database


router = APIRouter()
router.include_router(auth_router)
router.include_router(cart_router)
router.include_router(checkout_recovery_router)
router.include_router(seller_router)
router.include_router(metadata_router)
router.include_router(product_router)
router.include_router(product_draft_router)
router.include_router(ai_processing_router)
router.include_router(profile_router)
router.include_router(order_router)
router.include_router(search_router)
router.include_router(location_router)
router.include_router(dashboard_router)
router.include_router(home_router)
router.include_router(filter_router)
router.include_router(voice_runtime_router)
router.include_router(taxonomy_reconciler_router)


@router.get("/health", tags=["Health"])
async def health(database=Depends(get_database)):
    await database.command("ping")
    return {"status": "ok", "service": settings.APP_NAME, "version": settings.API_VERSION}


@router.get("/version", tags=["Health"])
async def version():
    return {"app": settings.APP_NAME, "version": settings.API_VERSION}


@router.get("/admin/audit-logs", tags=["Audit"])
async def audit_logs(
    entity_type: str = Query(default=None, alias="entityType", max_length=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100, alias="pageSize"),
    actor=Depends(require_roles("admin")),
    database=Depends(get_database),
):
    query = {"entity_type": entity_type} if entity_type else {}
    total = await database.audit_logs.count_documents(query)
    items = await database.audit_logs.find(query).sort("created_at", -1).skip(
        (page - 1) * page_size
    ).limit(page_size).to_list(length=page_size)
    return {"items": mongo_json(items), "page": page, "pageSize": page_size, "total": total}
