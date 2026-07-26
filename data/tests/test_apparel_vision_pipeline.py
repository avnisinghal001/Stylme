from __future__ import annotations

import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from build_processed import category_group, sample_large  # noqa: E402
from common import canonicalize_myntra_image  # noqa: E402
from openai_vision_common import (  # noqa: E402
    VISION_METADATA_FIELDS,
    custom_id,
    request_body,
    validate_analysis,
    vision_schema,
)
from merge_openai_vision_results import result_paths  # noqa: E402
from prepare_openai_vision_retry import successful_custom_ids  # noqa: E402
from prepare_openai_vision_replacements import select_rows  # noqa: E402
from run_openai_vision_batches import download_file  # noqa: E402


class ApparelSelectionTests(unittest.TestCase):
    def test_image_canonicalizer_rejects_source_placeholders(self) -> None:
        self.assertIsNone(canonicalize_myntra_image("-"))
        self.assertIsNone(canonicalize_myntra_image("not-a-url"))
        self.assertEqual(
            canonicalize_myntra_image("http://assets.example/shirt.jpg"),
            "https://assets.example/shirt.jpg",
        )

    def test_final_title_classification_excludes_non_apparel_from_fallback(self) -> None:
        rows = [
            {
                "id": "1",
                "name": "Women Pure Cotton T-shirt",
                "img": "https://assets.example/apparel.jpg",
                "purl": "https://www.myntra.com/tshirts/brand/item/1001/buy",
            },
            {
                "id": "2",
                "name": "Women Face Serum Gift Kit",
                "img": "https://assets.example/not-apparel.jpg",
                # A misleading apparel URL must not bypass title-aware filtering.
                "purl": "https://www.myntra.com/tshirts/brand/item/1002/buy",
            },
        ]
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.csv"
            with source.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
                writer.writeheader()
                writer.writerows(rows)
            selected = sample_large(
                source,
                target=1,
                excluded_ids=set(),
                category_counts={"tshirts": 2},
                seed="test",
                progress_every=0,
                require_image=True,
                allowed_categories={"apparel"},
            )
        self.assertEqual(selected[0]["id"], "1")
        self.assertEqual(category_group("tshirts", selected[0]["name"]), "apparel")


class VisionContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.metadata = {key: [f"{key}-value"] for key in VISION_METADATA_FIELDS}
        self.colors = ["black", "blue"]

    def valid_analysis(self) -> dict[str, object]:
        return {
            "isClothing": True,
            "sourceTypeMatchesImage": True,
            "confidence": 0.94,
            "metadata": {key: [] for key in VISION_METADATA_FIELDS},
            "dominantColorKeys": ["blue"],
            "imageQuality": "good",
            "warnings": [],
        }

    def test_schema_and_local_validator_reject_uncontrolled_values(self) -> None:
        schema = vision_schema(self.metadata, self.colors)
        self.assertFalse(schema["additionalProperties"])
        self.assertEqual(set(schema["properties"]["metadata"]["required"]), set(VISION_METADATA_FIELDS))
        value = self.valid_analysis()
        validate_analysis(value, self.metadata, self.colors)
        value["metadata"]["style"] = ["invented-style"]  # type: ignore[index]
        with self.assertRaisesRegex(ValueError, "invalid values"):
            validate_analysis(value, self.metadata, self.colors)

    def test_local_validator_normalizes_duplicate_controlled_values(self) -> None:
        value = self.valid_analysis()
        value["metadata"]["style"] = ["style-value", "style-value"]  # type: ignore[index]
        value["dominantColorKeys"] = ["blue", "blue"]
        result = validate_analysis(value, self.metadata, self.colors)
        self.assertEqual(result["metadata"]["style"], ["style-value"])
        self.assertEqual(result["dominantColorKeys"], ["blue"])

    def test_request_is_one_image_apparel_classification_with_structured_output(self) -> None:
        schema = vision_schema(self.metadata, self.colors)
        body = request_body(
            model="gpt-5.6-luna",
            detail="high",
            image_url="https://assets.example/shirt.jpg",
            product_key="product:myntra_large:1001",
            title="Blue cotton shirt",
            description="Blue cotton shirt",
            product_type="shirts",
            current_metadata={},
            schema=schema,
            reasoning_effort="low",
        )
        self.assertEqual(body["model"], "gpt-5.6-luna")
        self.assertEqual(body["input"][1]["content"][1]["detail"], "high")
        self.assertEqual(body["text"]["format"]["type"], "json_schema")
        self.assertFalse(body["store"])
        self.assertEqual(custom_id("same"), custom_id("same"))
        self.assertNotEqual(custom_id("same"), custom_id("different"))
        evidence = json.loads(body["input"][1]["content"][0]["text"])
        self.assertEqual(evidence["sourceProductType"], "shirts")


class VisionRetryTests(unittest.TestCase):
    def test_batch_output_is_streamed_to_an_atomic_file(self) -> None:
        payload = b'{"custom_id":"one"}\n'

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def stream_to_file(self, path):
                Path(path).write_bytes(payload)

        class Content:
            def __call__(self, file_id):
                self.file_id = file_id
                return Response()

        content = Content()
        client = type("Client", (), {})()
        client.files = type("Files", (), {})()
        client.files.with_streaming_response = type("Streaming", (), {"content": content})()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "output.jsonl"
            download_file(client, "file-one", output)
            self.assertEqual(output.read_bytes(), payload)
            self.assertFalse(output.with_suffix(".jsonl.tmp").exists())
        self.assertEqual(content.file_id, "file-one")

    def test_retry_success_detection_and_merge_state_discovery(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original_output = root / "output-001.jsonl"
            original_output.write_text(
                json.dumps({"custom_id": "ok", "response": {"status_code": 200}}) + "\n"
                + json.dumps({"custom_id": "retry", "response": {"status_code": 500}}) + "\n"
            )
            state = {
                "batches": [{"status": "completed", "outputPath": str(original_output)}]
            }
            self.assertEqual(successful_custom_ids(state), {"ok"})

            state_path = root / "batch-state.json"
            state_path.write_text(json.dumps(state))
            retry_dir = root / "retry-001"
            retry_dir.mkdir()
            retry_output = retry_dir / "output-001.jsonl"
            retry_output.write_text("{}\n")
            (retry_dir / "batch-state.json").write_text(
                json.dumps({"batches": [{"outputPath": str(retry_output)}]})
            )
            self.assertEqual(
                result_paths(root / "plan.json", None),
                [original_output, retry_output],
            )

    def test_replacement_selection_is_novel_and_apparel_only(self) -> None:
        rows = [
            {"product_key": "existing", "category_key": "apparel", "cover_image_url": "https://a/1.jpg"},
            {"product_key": "footwear", "category_key": "footwear", "cover_image_url": "https://a/2.jpg"},
            {"product_key": "no-image", "category_key": "apparel", "cover_image_url": "-"},
            {"product_key": "replacement", "category_key": "apparel", "cover_image_url": "https://a/3.jpg"},
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "reserve.csv"
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
                writer.writeheader()
                writer.writerows(rows)
            _, selected = select_rows(path, {"existing"}, 1)
        self.assertEqual([item["product_key"] for item in selected], ["replacement"])


if __name__ == "__main__":
    unittest.main()
