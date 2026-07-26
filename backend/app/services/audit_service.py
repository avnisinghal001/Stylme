from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional


async def write_audit(
    database,
    *,
    action: str,
    entity_type: str,
    entity_id: str,
    actor: Optional[Dict[str, Any]],
    changes: Optional[Dict[str, Any]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    session=None,
) -> None:
    roles = (actor or {}).get("roles") or []
    actor_role = "owner" if "owner" in roles else roles[0] if roles else "system"
    await database.audit_logs.insert_one(
        {
            "actor_user_id": (actor or {}).get("_id"),
            "actor_role": actor_role,
            "action": action,
            "entity_type": entity_type,
            "entity_id": str(entity_id),
            "changes": changes or {},
            "metadata": metadata or {},
            "created_at": datetime.now(timezone.utc),
        },
        session=session,
    )
