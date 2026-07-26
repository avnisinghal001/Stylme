from __future__ import annotations

import hmac

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status

from app.api.deps import require_roles
from app.database.connection import get_database
from app.schemas.checkout_recovery import (
    CheckoutRecoveryConfigUpdate,
    RecoveryTokenResolve,
)
from app.services.audit_service import write_audit
from app.services.checkout_activity_service import resolve_recovery_token
from app.services.checkout_recovery_config_service import (
    get_config,
    public_config,
    runtime_secrets,
    save_config,
)
from app.services.checkout_recovery_service import (
    checkout_recovery_candidates,
    execute_recovery,
    list_checkouts,
    list_runs,
    test_connection,
)


router = APIRouter(tags=["Checkout recovery"])


def _require_cron_secret(config, provided: str | None) -> None:
    expected = runtime_secrets(config).get("cron_secret")
    if not expected or not provided or not hmac.compare_digest(expected, provided):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid cron credentials",
        )


@router.get("/public/checkout-recovery/run")
async def run_checkout_recovery_from_cron(
    x_cron_secret: str | None = Header(default=None, alias="X-Cron-Secret"),
    database=Depends(get_database),
):
    """External-cron entry point. The secret belongs in a request header, never a URL."""
    config = await get_config(database)
    _require_cron_secret(config, x_cron_secret)
    if not config.get("enabled"):
        return {
            "ok": True,
            "status": "skipped_disabled",
            "reason": "Checkout recovery is disabled",
        }
    return await execute_recovery(database, requested_by="external_cron")


@router.post("/public/checkout-recovery/candidates")
async def checkout_recovery_candidates_for_stylme(
    limit: int = Query(default=100, ge=1, le=500),
    x_cron_secret: str | None = Header(default=None, alias="X-Cron-Secret"),
    database=Depends(get_database),
):
    """Protected source feed for StylMe's own Go campaign scheduler."""
    config = await get_config(database)
    _require_cron_secret(config, x_cron_secret)
    return await checkout_recovery_candidates(database, limit=limit)


@router.post("/public/checkout-recovery/resolve")
async def resolve_checkout_recovery(
    payload: RecoveryTokenResolve,
    database=Depends(get_database),
):
    checkout = await resolve_recovery_token(database, payload.token)
    if not checkout:
        raise HTTPException(status_code=404, detail="Recovery link is invalid or expired")
    return {
        "ok": True,
        "checkoutId": checkout.get("checkout_id"),
        "redirectPath": "/login?next=/account/cart",
    }


@router.get("/admin/checkout-recovery/config")
async def read_checkout_recovery_config(
    actor=Depends(require_roles("admin")),
    database=Depends(get_database),
):
    return public_config(await get_config(database))


@router.put("/admin/checkout-recovery/config")
async def update_checkout_recovery_config(
    payload: CheckoutRecoveryConfigUpdate,
    actor=Depends(require_roles("admin")),
    database=Depends(get_database),
):
    return await save_config(database, actor, payload)


@router.post("/admin/checkout-recovery/test")
async def test_checkout_recovery_connection(
    actor=Depends(require_roles("admin")),
    database=Depends(get_database),
):
    result = await test_connection(database)
    await write_audit(
        database,
        action="checkout_recovery_connection_tested",
        entity_type="checkout_recovery_config",
        entity_id="default",
        actor=actor,
        changes={"ok": bool(result.get("ok"))},
    )
    return result


@router.post("/admin/checkout-recovery/run")
async def run_checkout_recovery_now(
    actor=Depends(require_roles("admin")),
    database=Depends(get_database),
):
    return await execute_recovery(database, requested_by=str(actor["_id"]))


@router.get("/admin/checkout-recovery/runs")
async def checkout_recovery_runs(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100, alias="pageSize"),
    actor=Depends(require_roles("admin")),
    database=Depends(get_database),
):
    return await list_runs(database, page, page_size)


@router.get("/admin/checkout-recovery/checkouts")
async def checkout_recovery_checkouts(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100, alias="pageSize"),
    checkout_status: str | None = Query(default=None, alias="status", max_length=80),
    actor=Depends(require_roles("admin")),
    database=Depends(get_database),
):
    return await list_checkouts(database, page, page_size, checkout_status)
