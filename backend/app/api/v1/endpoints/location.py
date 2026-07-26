from fastapi import APIRouter, Depends, HTTPException

from app.core.serialization import mongo_json
from app.database.connection import get_database
from app.schemas.location import LocationResolveRequest


router = APIRouter(prefix="/locations", tags=["Location"])


@router.post("/resolve-pincode")
async def resolve_pincode(
    payload: LocationResolveRequest,
    database=Depends(get_database),
):
    rows = await database.pincode_geos.aggregate(
        [
            {
                "$geoNear": {
                    "near": {
                        "type": "Point",
                        "coordinates": [payload.longitude, payload.latitude],
                    },
                    "key": "geo_point",
                    "distanceField": "_distance_meters",
                    "maxDistance": 250_000,
                    "spherical": True,
                    "query": {
                        "country_code": "IN",
                        "resolved": True,
                        "pincode": {"$type": "string"},
                    },
                }
            },
            {"$limit": 1},
        ]
    ).to_list(length=1)
    if not rows:
        raise HTTPException(
            status_code=422,
            detail="No serviceable StylMe pincode was found near this location",
        )
    row = rows[0]
    place = row.get("place") or {}
    return mongo_json(
        {
            "pincode": row.get("pincode"),
            "place": place.get("city") if isinstance(place, dict) else str(place),
            "state": place.get("state") if isinstance(place, dict) else None,
            "distanceKm": round(float(row.get("_distance_meters", 0)) / 1000, 2),
            "accuracyMeters": payload.accuracy_meters,
            "source": "nearest-serviceable-pincode",
            "persisted": False,
        }
    )
