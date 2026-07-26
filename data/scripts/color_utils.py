"""Canonical color lookup, HEX validation, family mapping, and text extraction."""

from __future__ import annotations

import colorsys
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from common import CONFIG_DIR, normalize_text, slugify, stable_hash, unique_preserving_order


HEX_RE = re.compile(r"^#?([0-9a-fA-F]{6})$")


def normalize_hex(value: str | None) -> str | None:
    if not value:
        return None
    match = HEX_RE.match(value.strip())
    return f"#{match.group(1).upper()}" if match else None


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    normalized = normalize_hex(value)
    if not normalized:
        raise ValueError(f"Invalid HEX color: {value}")
    return tuple(int(normalized[index : index + 2], 16) for index in (1, 3, 5))  # type: ignore[return-value]


def _linearize(channel: float) -> float:
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def hex_to_lab(value: str) -> tuple[float, float, float]:
    r8, g8, b8 = hex_to_rgb(value)
    r, g, b = (_linearize(channel / 255.0) for channel in (r8, g8, b8))
    x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
    y = r * 0.2126 + g * 0.7152 + b * 0.0722
    z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883

    def pivot(channel: float) -> float:
        return channel ** (1 / 3) if channel > 0.008856 else 7.787 * channel + 16 / 116

    fx, fy, fz = pivot(x), pivot(y), pivot(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def delta_e_76(left: str, right: str) -> float:
    l1, a1, b1 = hex_to_lab(left)
    l2, a2, b2 = hex_to_lab(right)
    return math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2)


def classify_hex_families(value: str) -> tuple[str, list[str]]:
    r8, g8, b8 = hex_to_rgb(value)
    hue, saturation, brightness = colorsys.rgb_to_hsv(r8 / 255, g8 / 255, b8 / 255)
    hue *= 360
    if brightness <= 0.14:
        return "black", ["black"]
    if brightness >= 0.94 and saturation <= 0.10:
        return "white", ["white"]
    if saturation <= 0.14:
        family = "gray"
        if brightness >= 0.75:
            return family, [family, "white"]
        if brightness <= 0.28:
            return family, [family, "black"]
        return family, [family]
    if 12 <= hue < 48 and brightness < 0.68:
        return "brown", ["brown", "orange" if hue >= 25 else "red"]
    if 20 <= hue < 60 and saturation < 0.45 and brightness >= 0.65:
        return "beige", ["beige", "brown", "yellow"]
    ranges = (
        ("red", 0, 15),
        ("orange", 15, 45),
        ("yellow", 45, 70),
        ("green", 70, 165),
        ("blue", 165, 250),
        ("indigo", 250, 275),
        ("violet", 275, 330),
        ("pink", 330, 345),
        ("red", 345, 360),
    )
    primary = next(family for family, start, end in ranges if start <= hue < end)
    families = [primary]
    boundaries = [15, 45, 70, 165, 250, 275, 330, 345]
    for boundary in boundaries:
        if abs(hue - boundary) <= 5:
            before = next(f for f, start, end in ranges if start <= max(0, boundary - 1) < end)
            after = next(f for f, start, end in ranges if start <= min(359, boundary + 1) < end)
            families.extend((before, after))
    return primary, unique_preserving_order(families)


@dataclass(frozen=True)
class ColorMatch:
    key: str
    name: str
    hex: str | None
    primary_family_key: str
    family_keys: tuple[str, ...]
    aliases: tuple[str, ...]
    source: str
    confidence: float

    def as_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "name": self.name,
            "hex": self.hex,
            "primaryFamilyKey": self.primary_family_key,
            "familyKeys": list(self.family_keys),
            "aliases": list(self.aliases),
            "source": self.source,
            "confidence": self.confidence,
        }


class ColorCatalog:
    def __init__(self, config_path: Path | None = None) -> None:
        path = config_path or CONFIG_DIR / "color_catalog.seed.json"
        payload = json.loads(path.read_text())
        self.version = int(payload["version"])
        self.families = payload["families"]
        self.records: dict[str, dict[str, Any]] = {item["key"]: item for item in payload["colors"]}
        self.alias_to_key: dict[str, str] = {}
        self.hex_to_key: dict[str, str] = {}
        for record in self.records.values():
            terms = [record["key"], record["name"], *record.get("aliases", [])]
            for term in terms:
                normalized = normalize_text(term)
                if normalized:
                    self.alias_to_key[normalized] = record["key"]
            normalized_hex = normalize_hex(record.get("hex"))
            if normalized_hex:
                self.hex_to_key[normalized_hex] = record["key"]
        self._search_terms = sorted(self.alias_to_key, key=lambda item: (-len(item), item))

    def get(self, key: str, *, source: str = "catalog", confidence: float = 1.0) -> ColorMatch:
        record = self.records[key]
        return ColorMatch(
            key=record["key"],
            name=record["name"],
            hex=normalize_hex(record.get("hex")),
            primary_family_key=record["primaryFamilyKey"],
            family_keys=tuple(record["familyKeys"]),
            aliases=tuple(record.get("aliases", [])),
            source=source,
            confidence=confidence,
        )

    def extract_from_text(self, *values: Any, limit: int = 4) -> list[ColorMatch]:
        text = f" {' '.join(normalize_text(value) for value in values)} "
        found: list[str] = []
        occupied: list[tuple[int, int]] = []
        for term in self._search_terms:
            pattern = re.compile(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])")
            for match in pattern.finditer(text):
                span = match.span()
                if any(not (span[1] <= left or span[0] >= right) for left, right in occupied):
                    continue
                key = self.alias_to_key[term]
                if key not in found:
                    found.append(key)
                    occupied.append(span)
                break
            if len(found) >= limit:
                break
        return [self.get(key, source="source_text", confidence=0.88) for key in found]

    def resolve(self, *, name: str | None, hex_value: str | None, source: str) -> ColorMatch:
        normalized_name = normalize_text(name)
        if normalized_name in self.alias_to_key:
            key = self.alias_to_key[normalized_name]
            record = self.get(key, source=source, confidence=1.0)
            normalized_hex = normalize_hex(hex_value)
            if not normalized_hex or not record.hex or delta_e_76(normalized_hex, record.hex) <= 8:
                return record
        normalized_hex = normalize_hex(hex_value)
        if normalized_hex and normalized_hex in self.hex_to_key:
            return self.get(self.hex_to_key[normalized_hex], source=source, confidence=1.0)
        if normalized_hex:
            nearest: tuple[float, str] | None = None
            for candidate_hex, key in self.hex_to_key.items():
                distance = delta_e_76(normalized_hex, candidate_hex)
                if nearest is None or distance < nearest[0]:
                    nearest = (distance, key)
            if nearest and nearest[0] <= 3:
                return self.get(nearest[1], source=f"{source}:nearest", confidence=0.96)
            primary, families = classify_hex_families(normalized_hex)
            display = str(name or f"Custom {normalized_hex}").strip()
            key = f"{slugify(display, 'custom')}-{stable_hash(normalized_hex):06x}"[-72:]
            return ColorMatch(
                key=key,
                name=display,
                hex=normalized_hex,
                primary_family_key=primary,
                family_keys=tuple(families),
                aliases=(),
                source=source,
                confidence=0.9,
            )
        return self.get("unspecified", source=source, confidence=0.0)

    def seed_records(self) -> list[dict[str, Any]]:
        return [self.get(key).as_dict() for key in sorted(self.records)]

