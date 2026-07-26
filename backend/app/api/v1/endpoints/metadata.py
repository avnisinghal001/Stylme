from fastapi import APIRouter, Depends

from app.database.connection import get_database
from app.services.metadata_service import taxonomy_contract


router = APIRouter(prefix="/metadata", tags=["Metadata"])


@router.get("/fields")
async def get_metadata_fields(database=Depends(get_database)):
    schema_version, allowed_filters_hash, fields = await taxonomy_contract(database)
    return {
        "schemaVersion": schema_version,
        "allowedFiltersHash": allowed_filters_hash,
        "fields": fields,
    }
