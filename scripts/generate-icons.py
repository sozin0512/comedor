"""Genera iconos PNG de HonduRaite para PWA y favicon."""
from __future__ import annotations

import importlib.util
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "icons"
SIZES = {
    "favicon-16.png": 16,
    "favicon-32.png": 32,
    "apple-touch-icon.png": 180,
    "icon-192.png": 192,
    "icon-512.png": 512,
}


def load_icon_source():
    spec = importlib.util.spec_from_file_location("icon_source", ROOT / "scripts" / "icon-source.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo cargar scripts/icon-source.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    src = load_icon_source()

    if not src.source_exists():
        raise FileNotFoundError(
            "Coloca tu logo en icons/source/honduraite.jpg (1024x1024 recomendado)."
        )

    for name, size in SIZES.items():
        rounded = size >= 180
        icon = src.resize_icon(size, rounded=rounded)
        icon.save(OUT / name, format="PNG", optimize=True)
        print(f"Wrote {OUT / name} ({size}px)")

    print("Done.")


if __name__ == "__main__":
    main()