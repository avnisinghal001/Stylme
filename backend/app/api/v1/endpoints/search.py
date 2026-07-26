from fastapi import APIRouter, Depends

from app.database.connection import get_database
from app.schemas.search import AdvancedSearchRequest, SearchIntentRequest
from app.services.search_intent_service import advanced_search, parse_search_intent


router = APIRouter(prefix="/search", tags=["Deterministic search"])


@router.post("/parse")
async def parse_intent(payload: SearchIntentRequest, database=Depends(get_database)):
    return await parse_search_intent(database, payload.query, payload.pincode)


@router.post("/advanced")
async def search_products(payload: AdvancedSearchRequest, database=Depends(get_database)):
    """Compile multilingual intent and return the matching page in one request."""
    return await advanced_search(database, payload)
