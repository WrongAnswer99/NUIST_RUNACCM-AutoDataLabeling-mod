#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from generate_track_mask import MaskParams, build_continuous_track_masks  # noqa: E402


def main() -> int:
    image_path = ROOT / "map.png"
    image = Image.open(image_path)
    gray_mask, binary_mask = build_continuous_track_masks(image, MaskParams())

    if gray_mask.shape != binary_mask.shape:
        raise AssertionError("Gray and binary masks should have identical dimensions.")

    if gray_mask.dtype != np.uint8 or binary_mask.dtype != np.uint8:
        raise AssertionError("Masks must be uint8 arrays.")

    if not set(np.unique(binary_mask)).issubset({0, 255}):
        raise AssertionError("Binary mask should contain only 0 and 255.")

    source_alpha = np.asarray(image.convert("RGBA"))[..., 3]
    source_nonzero = int(np.count_nonzero(source_alpha))
    binary_nonzero = int(np.count_nonzero(binary_mask))
    gray_nonzero = int(np.count_nonzero(gray_mask))
    source_binary = np.where(source_alpha > 0, 255, 0).astype(np.uint8)
    source_components = cv2.connectedComponents(source_binary, connectivity=8)[0] - 1
    binary_components = cv2.connectedComponents(binary_mask, connectivity=8)[0] - 1

    if gray_nonzero <= 0:
        raise AssertionError(
            "Gray mask should contain a visible track region."
        )

    if binary_nonzero <= 0:
        raise AssertionError("Binary mask should contain a visible track region.")

    if binary_components >= source_components:
        raise AssertionError(
            f"Expected continuous mask to merge components. source_components={source_components}, binary_components={binary_components}"
        )

    print(f"source_nonzero={source_nonzero}")
    print(f"gray_nonzero={gray_nonzero}")
    print(f"binary_nonzero={binary_nonzero}")
    print(f"source_components={source_components}")
    print(f"binary_components={binary_components}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
