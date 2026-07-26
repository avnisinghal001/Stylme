#!/usr/bin/env python3
"""Optional local image cleanup/background removal and palette proposal."""

from __future__ import annotations

import argparse
import io
import json
import urllib.request
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps

from color_utils import ColorCatalog
from common import PROCESSED_DIR, slugify, stable_hash


MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024


def load_image(source: str) -> Image.Image:
    if source.startswith(("https://", "http://")):
        request = urllib.request.Request(source, headers={"User-Agent": "StylMeDataPipeline/1.0"})
        with urllib.request.urlopen(request, timeout=20) as response:
            data = response.read(MAX_DOWNLOAD_BYTES + 1)
        if len(data) > MAX_DOWNLOAD_BYTES:
            raise ValueError("Image exceeds 32 MB safety limit")
        image = Image.open(io.BytesIO(data))
    else:
        image = Image.open(source)
    return ImageOps.exif_transpose(image)


def remove_background(image: Image.Image) -> Image.Image:
    try:
        from rembg import remove  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError('Background removal requires: pip install "rembg[cpu]"') from exc
    result = remove(image.convert("RGBA"))
    if not isinstance(result, Image.Image):
        result = Image.open(io.BytesIO(result))
    return result.convert("RGBA")


def palette(image: Image.Image, count: int = 6) -> list[dict[str, Any]]:
    rgba = image.convert("RGBA")
    rgba.thumbnail((512, 512))
    pixels = [
        (r, g, b)
        for r, g, b, alpha in rgba.getdata()
        if alpha >= 48 and not (r >= 248 and g >= 248 and b >= 248)
    ]
    if not pixels:
        return []
    sample = Image.new("RGB", (len(pixels), 1))
    sample.putdata(pixels)
    quantized = sample.quantize(colors=count, method=Image.Quantize.MEDIANCUT)
    color_counts = quantized.getcolors(maxcolors=count) or []
    raw_palette = quantized.getpalette() or []
    total = sum(value for value, _ in color_counts) or 1
    output: list[dict[str, Any]] = []
    for frequency, palette_index in sorted(color_counts, reverse=True):
        offset = palette_index * 3
        rgb = tuple(raw_palette[offset : offset + 3])
        if len(rgb) != 3:
            continue
        output.append(
            {
                "hex": "#{:02X}{:02X}{:02X}".format(*rgb),
                "coverage": round(frequency / total, 4),
            }
        )
    return output


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Local path or HTTPS URL")
    parser.add_argument("--product-key", required=True)
    parser.add_argument("--variant-id", default="")
    parser.add_argument("--color-name", default="")
    parser.add_argument("--output-dir", type=Path, default=PROCESSED_DIR / "images")
    parser.add_argument("--remove-background", action="store_true")
    parser.add_argument("--palette-size", type=int, default=6)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    image = load_image(args.input)
    original_mode = image.mode
    if args.remove_background:
        image = remove_background(image)
    else:
        image = image.convert("RGBA")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{slugify(args.product_key)}-{stable_hash(args.input, 'image'):016x}.png"
    output_path = args.output_dir / filename
    image.save(output_path, format="PNG", optimize=True)

    catalog = ColorCatalog()
    palette_values = palette(image, max(1, min(args.palette_size, 10)))
    proposals: list[dict[str, Any]] = []
    for index, value in enumerate(palette_values):
        match = catalog.resolve(
            name=args.color_name if index == 0 and args.color_name else None,
            hex_value=value["hex"],
            source="image_palette",
        )
        proposals.append({**match.as_dict(), "coverage": value["coverage"], "action": "use_existing" if match.key in catalog.records else "create_new"})

    result = {
        "productKey": args.product_key,
        "variantId": args.variant_id or None,
        "source": args.input,
        "localPath": str(output_path),
        "name": output_path.stem,
        "originalMode": original_mode,
        "backgroundRemoved": args.remove_background,
        "paletteProposals": proposals,
        "status": "proposed",
    }
    result_path = output_path.with_suffix(".json")
    result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
