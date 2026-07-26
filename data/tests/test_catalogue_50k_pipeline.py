from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


DATA_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = DATA_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

from build_processed import (  # noqa: E402
    is_policy_excluded,
    personalize_metadata,
    priority_multiplier,
)
from taxonomy_registry import merge_taxonomy_registry  # noqa: E402


class CataloguePolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.registry = json.loads((DATA_ROOT / "config/metadata_fields.seed.json").read_text())

    def test_strict_policy_blocks_intimates_without_brand_substring_false_positives(self) -> None:
        blocked = [
            ("bra", "Women padded bra"),
            ("lingerie-set", "Lace lingerie set"),
            ("tshirts", "Men thermal underwear top"),
            ("swimwear", "Women printed bikini"),
            ("night-suits", "Girls sleepwear set"),
        ]
        for product_type, title in blocked:
            self.assertTrue(is_policy_excluded(product_type, title))
        self.assertFalse(is_policy_excluded("bracelets", "Braided charm bracelet by BrandCo"))
        self.assertFalse(is_policy_excluded("dresses", "Women festive embroidered dress"))

    def test_festive_and_youth_types_receive_more_sampling_weight(self) -> None:
        baseline = priority_multiplier("plain-shirts")
        self.assertGreater(priority_multiplier("lehenga-choli"), baseline)
        self.assertGreater(priority_multiplier("oversized-tshirts"), baseline)
        self.assertGreater(priority_multiplier("girls-dresses"), baseline)

    def test_personalization_is_controlled_and_deep(self) -> None:
        metadata = personalize_metadata(
            {},
            metadata_seed=self.registry,
            category="apparel",
            product_type="lehenga-choli",
            gender_keys=["women"],
            text_values=["Women festive zari embroidered wedding lehenga"],
        )
        self.assertIn("festive-first", metadata["personalization_segment"])
        self.assertIn("desi-fusion", metadata["aesthetic"])
        self.assertIn("ethnic-festive", metadata["dress_code"])
        self.assertIn("zari", metadata["surface_detail"])
        allowed = {
            field["key"]: set(field.get("options", []))
            for field in self.registry["fields"]
            if field["storage"] == "product_metadata"
        }
        for key, values in metadata.items():
            self.assertLessEqual(set(values), allowed[key])


class TaxonomyRegistryTests(unittest.TestCase):
    def test_database_options_are_preserved_and_new_local_fields_are_created(self) -> None:
        local = {
            "version": 3,
            "fields": [
                {"key": "style", "label": "Style", "options": ["gen-z"], "storage": "product_metadata"},
                {"key": "aesthetic", "label": "Aesthetic", "options": ["y2k"], "storage": "product_metadata"},
            ],
        }
        remote = [
            {
                "key": "style",
                "label": "Old label",
                "options": [{"key": "classic", "label": "Classic", "active": True}],
                "data_type": "multi_enum",
                "storage": "product_metadata",
                "schema_version": 8,
            },
            {
                "key": "legacy_field",
                "label": "Legacy",
                "options": ["kept"],
                "storage": "product_metadata",
                "schema_version": 8,
            },
        ]
        merged = merge_taxonomy_registry(local, remote)
        fields = {field["key"]: field for field in merged["fields"]}
        self.assertEqual(fields["style"]["label"], "Style")
        self.assertEqual(fields["style"]["options"], ["classic", "gen-z"])
        self.assertIn("aesthetic", fields)
        self.assertIn("legacy_field", fields)


if __name__ == "__main__":
    unittest.main()
