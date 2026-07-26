#!/usr/bin/env python3
"""Resolve the deduplicated seller-location manifest with pgeocode."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import pgeocode

from common import PROCESSED_DIR, json_dumps, stable_hash


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=PROCESSED_DIR / "seed" / "seller_locations.jsonl")
    parser.add_argument("--output", type=Path, default=PROCESSED_DIR / "seed" / "seller_locations.geocoded.jsonl")
    return parser.parse_args()


def finite(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def main() -> None:
    args = parse_args()
    locations = [json.loads(line) for line in args.input.read_text().splitlines() if line.strip()]
    geocoder = pgeocode.Nominatim("in")
    cache: dict[str, dict[str, Any]] = {}
    for item in locations:
        pincode = item["pincode"]
        if pincode not in cache:
            value = geocoder.query_postal_code(pincode)
            latitude = finite(getattr(value, "latitude", None))
            longitude = finite(getattr(value, "longitude", None))
            resolved = latitude is not None and longitude is not None
            cache[pincode] = {
                "place": {
                    "city": getattr(value, "place_name", None),
                    "district": getattr(value, "county_name", None),
                    "state": getattr(value, "state_name", None),
                    "countryCode": "IN",
                },
                "geo_point": {"type": "Point", "coordinates": [longitude, latitude]} if resolved else None,
                "geocode_resolved": resolved,
            }
        item.update(cache[pincode])
    resolved_pincodes = sorted(key for key, value in cache.items() if value["geocode_resolved"])
    fallback_count = 0
    for item in locations:
        pipeline = item.setdefault("metadata", {}).setdefault("pipeline", {})
        if not item["geocode_resolved"] and resolved_pincodes:
            original = item["pincode"]
            replacement = resolved_pincodes[stable_hash(item["key"], "pincode-fallback") % len(resolved_pincodes)]
            item["pincode"] = replacement
            item.update(cache[replacement])
            pipeline["originalUnresolvedPincode"] = original
            pipeline["pincodeFallback"] = True
            pipeline["fabricated"] = True
            fallback_count += 1
        pipeline["geocodePending"] = not item["geocode_resolved"]
    args.output.write_text("".join(json_dumps(item) + "\n" for item in locations))
    print(json.dumps({"locations": len(locations), "sourcePincodes": len(cache), "resolvedSourcePincodes": sum(1 for value in cache.values() if value["geocode_resolved"]), "fallbackLocations": fallback_count, "allLocationsResolved": all(item["geocode_resolved"] for item in locations), "output": str(args.output)}, indent=2))


if __name__ == "__main__":
    main()
