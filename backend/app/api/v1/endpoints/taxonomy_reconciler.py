from __future__ import annotations

import hmac

from bson import ObjectId
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pymongo import ReturnDocument

from app.api.deps import require_roles
from app.api.v1.endpoints.voice_runtime import require_internal_key
from app.core.config import settings
from app.core.serialization import mongo_json
from app.database.connection import get_database
from app.schemas.taxonomy_reconciler import (
    ApplyRetagProposalsRequest,
    GraphPreviewRequest,
    ProposalDecisionRequest,
    ReconcilerRunRequest,
    SearchOutcomeWebhook,
)
from app.services.audit_service import write_audit
from app.services.taxonomy_reconciler_service import (
    GRAPH_KEY,
    apply_retag_proposals,
    record_search_outcome,
    run_reconciler,
    traverse_graph,
    utcnow,
)


router = APIRouter(tags=["Taxonomy reconciler"])


def require_reconciler_cron(
    x_cron_secret: str | None = Header(default=None, alias="X-Cron-Secret"),
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> None:
    expected = settings.CRON_SECRET or settings.AI_INTERNAL_API_KEY or ""
    header_secret = x_cron_secret if isinstance(x_cron_secret, str) else None
    bearer = None
    if isinstance(authorization, str) and authorization.startswith("Bearer "):
        bearer = authorization.removeprefix("Bearer ")
    supplied = header_secret or bearer or ""
    if not expected or not supplied or not hmac.compare_digest(expected, supplied):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid cron credentials",
        )


@router.post(
    "/internal/taxonomy-reconciler/search-outcome",
    dependencies=[Depends(require_internal_key)],
)
async def ingest_search_outcome(
    payload: SearchOutcomeWebhook,
    database=Depends(get_database),
):
    document = await record_search_outcome(
        database,
        raw_query=payload.query,
        result_count=payload.result_count,
        source=payload.source,
        intent=payload.intent,
        resolved_query=payload.resolved_query,
        fallback_count=payload.fallback_count,
        fallback_level=payload.fallback_level,
    )
    return {"ok": True, "captured": bool(document), "queryFailureId": str(document["_id"]) if document else None}


@router.post(
    "/public/taxonomy-reconciler/run",
    dependencies=[Depends(require_reconciler_cron)],
)
async def run_reconciler_from_cron(
    payload: ReconcilerRunRequest,
    database=Depends(get_database),
):
    return await run_reconciler(database, payload, requested_by="external_cron")


@router.get(
    "/public/taxonomy-reconciler/run",
    dependencies=[Depends(require_reconciler_cron)],
)
async def run_reconciler_from_vercel_cron(database=Depends(get_database)):
    payload = ReconcilerRunRequest(
        max_queries=30,
        max_products=250,
        graph_depth=4,
        use_ai=True,
        rebuild_graph=False,
        apply=settings.TAXONOMY_RECONCILER_CRON_APPLY,
    )
    return await run_reconciler(database, payload, requested_by="vercel_cron")


@router.post("/admin/taxonomy-reconciler/run")
async def run_reconciler_now(
    payload: ReconcilerRunRequest,
    actor=Depends(require_roles("admin")),
    database=Depends(get_database),
):
    return await run_reconciler(
        database, payload, requested_by=str(actor["_id"]), actor=actor
    )


@router.get("/admin/taxonomy-reconciler/queries")
async def list_failed_queries(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100, alias="pageSize"),
    query_status: str | None = Query(default=None, alias="status", max_length=40),
    actor=Depends(require_roles("admin")),
    database=Depends(get_database),
):
    query = {"status": query_status} if query_status else {}
    total = await database.search_query_failures.count_documents(query)
    items = await database.search_query_failures.find(query).sort(
        [("occurrences", -1), ("last_seen_at", -1)]
    ).skip((page - 1) * page_size).limit(page_size).to_list(length=page_size)
    return mongo_json({"items": items, "page": page, "pageSize": page_size, "total": total})


@router.get("/admin/taxonomy-reconciler/runs")
async def list_reconciliation_runs(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100, alias="pageSize"),
    actor=Depends(require_roles("admin")),
    database=Depends(get_database),
):
    total = await database.taxonomy_reconciliation_runs.count_documents({})
    items = await database.taxonomy_reconciliation_runs.find({}).sort("started_at", -1).skip(
        (page - 1) * page_size
    ).limit(page_size).to_list(length=page_size)
    return mongo_json({"items": items, "page": page, "pageSize": page_size, "total": total})


@router.get("/admin/taxonomy-reconciler/proposals")
async def list_retag_proposals(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100, alias="pageSize"),
    proposal_status: str | None = Query(default=None, alias="status", max_length=40),
    actor=Depends(require_roles("admin")),
    database=Depends(get_database),
):
    query = {"status": proposal_status} if proposal_status else {}
    total = await database.taxonomy_retag_proposals.count_documents(query)
    items = await database.taxonomy_retag_proposals.find(query).sort(
        [("confidence", -1), ("updated_at", -1)]
    ).skip((page - 1) * page_size).limit(page_size).to_list(length=page_size)
    return mongo_json({"items": items, "page": page, "pageSize": page_size, "total": total})


@router.patch("/admin/taxonomy-reconciler/proposals/{proposal_id}/decision")
async def decide_retag_proposal(
    proposal_id: str,
    payload: ProposalDecisionRequest,
    actor=Depends(require_roles("admin")),
    database=Depends(get_database),
):
    if not ObjectId.is_valid(proposal_id):
        raise HTTPException(status_code=422, detail="Invalid proposal id")
    now = utcnow()
    proposal = await database.taxonomy_retag_proposals.find_one_and_update(
        {"_id": ObjectId(proposal_id), "status": {"$in": ["proposed", "approved"]}},
        {
            "$set": {
                "status": payload.decision,
                "decision_reason": payload.reason,
                "reviewed_by_user_id": actor["_id"],
                "reviewed_at": now,
                "updated_at": now,
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if not proposal:
        raise HTTPException(status_code=404, detail="Retag proposal is not reviewable")
    await write_audit(
        database,
        action=f"taxonomy_retag_{payload.decision}",
        entity_type="taxonomy_retag_proposal",
        entity_id=proposal_id,
        actor=actor,
        changes={"decision": payload.decision, "reason": payload.reason},
    )
    return mongo_json(proposal)


@router.post("/admin/taxonomy-reconciler/proposals/apply")
async def apply_reviewed_retags(
    payload: ApplyRetagProposalsRequest,
    actor=Depends(require_roles("admin")),
    database=Depends(get_database),
):
    return await apply_retag_proposals(
        database,
        proposal_ids=payload.proposal_ids,
        minimum_confidence=payload.minimum_confidence,
        limit=payload.limit,
        include_auto=False,
        actor=actor,
        run_id=f"manual:{actor['_id']}",
    )


@router.get("/admin/taxonomy-reconciler/graph")
async def get_active_graph(
    include_graph: bool = Query(default=False, alias="includeGraph"),
    actor=Depends(require_roles("admin")),
    database=Depends(get_database),
):
    projection = None if include_graph else {"nodes": 0, "edges": 0, "taxonomy": 0}
    graph = await database.taxonomy_reconciler_graphs.find_one(
        {"key": GRAPH_KEY, "active": True}, projection
    )
    if not graph:
        raise HTTPException(status_code=404, detail="Taxonomy reconciliation graph has not been built")
    return mongo_json(graph)


@router.post("/admin/taxonomy-reconciler/graph/preview")
async def preview_graph_query(
    payload: GraphPreviewRequest,
    actor=Depends(require_roles("admin")),
    database=Depends(get_database),
):
    graph = await database.taxonomy_reconciler_graphs.find_one({"key": GRAPH_KEY, "active": True})
    if not graph:
        raise HTTPException(status_code=404, detail="Taxonomy reconciliation graph has not been built")
    return {
        "query": payload.query,
        "graphVersion": graph["version"],
        "depth": payload.depth,
        "signals": traverse_graph(graph, payload.query, depth=payload.depth, limit=payload.limit),
    }
