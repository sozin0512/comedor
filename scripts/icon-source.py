"""Fuente compartida del logo HonduRaite para iconos, splash y PWA."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE_IMAGE = ROOT / "icons" / "source" / "honduraite.jpg"
DEFAULT_BG = (232, 230, 224)  # #E8E6E0


def source_exists() -> bool:
    return SOURCE_IMAGE.is_file()


def load_master() -> Image.Image:
    if not source_exists():
        raise FileNotFoundError(f"No se encontró el logo en {SOURCE_IMAGE}")
    return Image.open(SOURCE_IMAGE).convert("RGBA")


def sample_background_color(img: Image.Image | None = None) -> tuple[int, int, int]:
    src = img or load_master().convert("RGB")
    points = [
        (0, 0),
        (src.width - 1, 0),
        (0, src.height - 1),
        (src.width - 1, src.height - 1),
        (src.width // 2, 0),
        (src.width // 2, src.height - 1),
    ]
    pixels = [src.getpixel(p) for p in points]
    return (
        sum(p[0] for p in pixels) // len(pixels),
        sum(p[1] for p in pixels) // len(pixels),
        sum(p[2] for p in pixels) // len(pixels),
    )


def trim_to_content(img: Image.Image, tolerance: int = 28) -> Image.Image:
    rgb = img.convert("RGB")
    bg = Image.new("RGB", rgb.size, sample_background_color(rgb))
    diff = ImageChops.difference(rgb, bg)
    bbox = diff.point(lambda p: 255 if p > tolerance else 0).getbbox()
    if not bbox:
        return img
    return img.crop(bbox)


def rounded_square(img: Image.Image, radius_ratio: float = 0.2) -> Image.Image:
    size = img.width
    radius = max(4, int(size * radius_ratio))
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def compose_square(
    size: int,
    scale: float = 0.88,
    rounded: bool = False,
    transparent_bg: bool = False,
    padding_ratio: float = 0.0,
) -> Image.Image:
    master = trim_to_content(load_master())
    bg_color = sample_background_color(master.convert("RGB"))
    canvas = Image.new(
        "RGBA",
        (size, size),
        (0, 0, 0, 0) if transparent_bg else (*bg_color, 255),
    )

    inner = int(size * (1 - padding_ratio * 2))
    target = max(1, int(inner * scale))
    resized = master.resize((target, target), Image.Resampling.LANCZOS)
    offset = ((size - target) // 2, (size - target) // 2)
    canvas.paste(resized, offset, resized)

    if rounded and not transparent_bg:
        return rounded_square(canvas, radius_ratio=0.2)
    return canvas


def resize_icon(size: int, rounded: bool = True) -> Image.Image:
    return compose_square(size, scale=0.92, rounded=rounded, transparent_bg=False, padding_ratio=0.04)


def resize_foreground(size: int, scale: float = 0.76) -> Image.Image:
    return compose_square(size, scale=scale, rounded=False, transparent_bg=True, padding_ratio=0.08)


def resize_splash(width: int, height: int, logo_scale: float = 0.58) -> Image.Image:
    master = trim_to_content(load_master())
    bg_color = sample_background_color(master.convert("RGB"))
    canvas = Image.new("RGB", (width, height), bg_color)

    side = int(min(width, height) * logo_scale)
    resized = master.resize((side, side), Image.Resampling.LANCZOS)
    x = (width - side) // 2
    y = (height - side) // 2
    canvas.paste(resized, (x, y), resized)
    return canvas


def resize_splash_logo(size: int = 512, logo_scale: float = 0.78) -> Image.Image:
    return resize_splash(size, size, logo_scale=logo_scale)