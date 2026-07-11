"""Genera splash screens Android con el logo HonduRaite centrado."""
from __future__ import annotations

import importlib.util
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"
ICONS_OUT = ROOT / "icons"

SPLASH_SIZES = {
    "drawable": (480, 320),
    "drawable-port-mdpi": (320, 480),
    "drawable-port-hdpi": (480, 800),
    "drawable-port-xhdpi": (720, 1280),
    "drawable-port-xxhdpi": (960, 1600),
    "drawable-port-xxxhdpi": (1280, 1920),
    "drawable-land-mdpi": (480, 320),
    "drawable-land-hdpi": (800, 480),
    "drawable-land-xhdpi": (1280, 720),
    "drawable-land-xxhdpi": (1600, 960),
    "drawable-land-xxxhdpi": (1920, 1280),
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
    img.save(path, format="PNG", optimize=True)
    print(f"Wrote {path.relative_to(ROOT)} ({img.width}x{img.height})")


def main() -> None:
    src = load_icon_source()
    if not src.source_exists():
        raise FileNotFoundError("Coloca tu logo en icons/source/honduraite.jpg")

    logo = src.resize_splash_logo(512, logo_scale=0.78)
    save_png(logo.convert("RGBA"), ICONS_OUT / "splash-logo.png")

    for folder, (width, height) in SPLASH_SIZES.items():
        splash = src.resize_splash(width, height, logo_scale=0.58)
        save_png(splash, ANDROID_RES / folder / "splash.png")

    bg = src.sample_background_color()
    hex_color = f"#{bg[0]:02X}{bg[1]:02X}{bg[2]:02X}"
    bg_xml = ROOT / "android" / "app" / "src" / "main" / "res" / "values" / "ic_launcher_background.xml"
    bg_xml.write_text(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
        "<resources>\n"
        f"    <color name=\"ic_launcher_background\">{hex_color}</color>\n"
        "</resources>\n",
        encoding="utf-8",
    )
    print(f"Actualizado fondo splash/icono: {hex_color}")
    print("Splash screens generados correctamente.")


if __name__ == "__main__":
    main()