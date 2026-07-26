"""Conservative entity normalization and fuzzy-deduplication registry."""

from __future__ import annotations

from collections import defaultdict
from difflib import SequenceMatcher
from typing import Any

from common import normalize_entity_name, slugify, stable_hash


class EntityRegistry:
    def __init__(self, kind: str, *, remove_legal_suffixes: bool = False) -> None:
        self.kind = kind
        self.remove_legal_suffixes = remove_legal_suffixes
        self.records: dict[str, dict[str, Any]] = {}
        self.normalized_to_key: dict[str, str] = {}
        self.buckets: dict[tuple[str, int], set[str]] = defaultdict(set)
        self.review_candidates: list[dict[str, Any]] = []

    def _normalize(self, name: str) -> str:
        return normalize_entity_name(name, remove_legal_suffixes=self.remove_legal_suffixes)

    @staticmethod
    def _bucket(normalized: str) -> tuple[str, int]:
        return normalized[:1], len(normalized) // 3

    @staticmethod
    def _similarity(left: str, right: str) -> float:
        return SequenceMatcher(None, left, right).ratio()

    def register(self, name: str, *, source: str, metadata: dict[str, Any] | None = None) -> str:
        display = " ".join(str(name or "").split()) or f"Unknown {self.kind.title()}"
        normalized = self._normalize(display)
        if normalized in self.normalized_to_key:
            key = self.normalized_to_key[normalized]
            record = self.records[key]
            if display != record["name"] and display not in record["aliases"]:
                record["aliases"].append(display)
            record["sources"].add(source)
            return key

        candidates: list[tuple[float, str]] = []
        prefix, length_bucket = self._bucket(normalized)
        for bucket in ((prefix, length_bucket - 1), (prefix, length_bucket), (prefix, length_bucket + 1)):
            for candidate_key in self.buckets.get(bucket, set()):
                candidate = self.records[candidate_key]["normalized_name"]
                if abs(len(candidate) - len(normalized)) > max(3, int(len(normalized) * 0.15)):
                    continue
                candidates.append((self._similarity(normalized, candidate), candidate_key))
        if candidates:
            score, candidate_key = max(candidates)
            candidate = self.records[candidate_key]
            left_tokens, right_tokens = set(normalized.split()), set(candidate["normalized_name"].split())
            token_score = len(left_tokens & right_tokens) / max(1, len(left_tokens | right_tokens))
            if score >= 0.975 or (score >= 0.96 and token_score >= 0.8):
                if display not in candidate["aliases"]:
                    candidate["aliases"].append(display)
                candidate["sources"].add(source)
                candidate["dedupe_methods"].add("high_confidence_fuzzy")
                return candidate_key
            if score >= 0.88:
                self.review_candidates.append(
                    {
                        "entityType": self.kind,
                        "incomingName": display,
                        "incomingNormalized": normalized,
                        "candidateKey": candidate_key,
                        "candidateName": candidate["name"],
                        "similarity": round(score, 4),
                        "tokenSimilarity": round(token_score, 4),
                        "decision": "needs_review",
                    }
                )

        base = slugify(display, self.kind)
        key = f"{self.kind}:{base}"
        if key in self.records:
            key = f"{key}-{stable_hash(normalized):08x}"
        record = {
            "key": key,
            "name": display,
            "normalized_name": normalized,
            "slug": key.split(":", 1)[1],
            "aliases": [],
            "sources": {source},
            "dedupe_methods": {"normalized_exact"},
            "metadata": metadata or {},
        }
        self.records[key] = record
        self.normalized_to_key[normalized] = key
        self.buckets[self._bucket(normalized)].add(key)
        return key

    def export(self) -> list[dict[str, Any]]:
        output: list[dict[str, Any]] = []
        for key in sorted(self.records):
            record = dict(self.records[key])
            record["aliases"] = sorted(set(record["aliases"]))
            record["sources"] = sorted(record["sources"])
            record["dedupe_methods"] = sorted(record["dedupe_methods"])
            output.append(record)
        return output

