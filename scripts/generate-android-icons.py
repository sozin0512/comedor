"""Genera iconos de launcher Android desde el logo HonduRaite."""
from __future__ import annotations

import importlib.util
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"

LAUNCHER_SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

FOREGROUND_SIZES = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}


def load_icon_source():
    spec = importlib.util.spec_from_file_location("icon_source", ROOT / "scripts" / "icon-source.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo cargar scripts/icon-source.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def save_png(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    img.save(path, format="PNG", optimize=True)
    print(f"Wrote {path.relative_to(ROOT)} ({img.width}x{img.height})")


def main() -> None:
    src = load_icon_source()
    if not src.source_exists():
        raise FileNotFoundError(
            "Coloca tu logo en icons/source/honduraite.jpg (1024x1024 recomendado)."
        )

    for folder, size in LAUNCHER_SIZES.items():
        icon = src.resize_icon(size, rounded=False)
        base = ANDROID_RES / folder
        save_png(icon, base / "ic_launcher.png")
        save_png(icon, base / "ic_launcher_round.png")

    for folder, size in FOREGROUND_SIZES.items():
        fg = src.resize_foreground(size, scale=0.76)
        save_png(fg, ANDROID_RES / folder / "ic_launcher_foreground.png")

    print("Iconos Android generados correctamente.")


if __name__ == "__main__":
    main()