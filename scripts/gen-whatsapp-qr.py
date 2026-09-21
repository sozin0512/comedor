"""QR del chatbot WhatsApp HonduRaite — escaneable, listo para redes."""
from pathlib import Path
from urllib.parse import quote

import qrcode
from PIL import Image, ImageDraw, ImageFont
from qrcode.constants import ERROR_CORRECT_H
from qrcode.image.styledpil import StyledPilImage
from qrcode.image.styles.moduledrawers import RoundedModuleDrawer

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "images"
OUT_DIR.mkdir(exist_ok=True)

# Número Cloud API del chatbot (Meta WABA), no el de soporte HN.
WA_NUMBER = "14693876894"
WA_DISPLAY = "+1 469-387-6894"
WA_TEXT = "Hola, quiero pedir un viaje"
WA_URL = f"https://wa.me/{WA_NUMBER}?text={quote(WA_TEXT)}"

NAVY = (4, 30, 66)
BLUE = (13, 71, 161)
WHITE = (255, 255, 255)
GREEN = (37, 211, 102)
GOLD = (251, 191, 36)
SLATE = (226, 232, 240)


def make_qr(box_size=18, border=3):
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_H,
        box_size=box_size,
        border=border,
    )
    qr.add_data(WA_URL)
    qr.make(fit=True)
    img = qr.make_image(
        image_factory=StyledPilImage,
        module_drawer=RoundedModuleDrawer(),
        fill_color=NAVY,
        back_color=WHITE,
    ).convert("RGBA")
    return img


def add_center_logo(qr_img, logo_path, frac=0.18):
    logo = Image.open(logo_path).convert("RGBA")
    side = int(min(qr_img.size) * frac)
    logo = logo.resize((side, side), Image.Resampling.LANCZOS)
    pad = int(side * 0.14)
    badge = Image.new("RGBA", (side + pad * 2, side + pad * 2), (255, 255, 255, 0))
    d = ImageDraw.Draw(badge)
    d.rounded_rectangle(
        [0, 0, badge.size[0] - 1, badge.size[1] - 1],
        radius=int(badge.size[0] * 0.22),
        fill=WHITE,
    )
    badge.paste(logo, (pad, pad), logo)
    x = (qr_img.size[0] - badge.size[0]) // 2
    y = (qr_img.size[1] - badge.size[1]) // 2
    qr_img.alpha_composite(badge, (x, y))
    return qr_img


def font(size, bold=False):
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
    ]
    for p in candidates:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def social_card(qr_img):
    W, H = 1080, 1080
    canvas = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(canvas)
    d.rectangle([0, 0, W, 18], fill=GREEN)
    d.rectangle([0, H - 18, W, H], fill=GREEN)

    title = font(54, bold=True)
    sub = font(32, bold=True)
    body = font(28)
    small = font(24)
    tiny = font(22)

    d.text((W // 2, 78), "HonduRaite", font=title, fill=WHITE, anchor="mt")
    d.text((W // 2, 148), "Chatbot de WhatsApp", font=sub, fill=GOLD, anchor="mt")
    d.text(
        (W // 2, 200),
        "Escanea y escribe al bot · sin cuenta · 24/7",
        font=body,
        fill=SLATE,
        anchor="mt",
    )

    qr = qr_img.convert("RGB")
    qr_side = 560
    qr = qr.resize((qr_side, qr_side), Image.Resampling.NEAREST)
    frame = 24
    box = Image.new("RGB", (qr_side + frame * 2, qr_side + frame * 2), WHITE)
    box.paste(qr, (frame, frame))
    bx = (W - box.size[0]) // 2
    by = 248
    shadow = Image.new("RGB", (box.size[0] + 16, box.size[1] + 16), (2, 16, 36))
    canvas.paste(shadow, (bx + 8, by + 10))
    canvas.paste(box, (bx, by))

    d.text((W // 2, 900), f"WhatsApp  {WA_DISPLAY}", font=small, fill=WHITE, anchor="mt")
    d.text((W // 2, 952), "El bot te arma el viaje  ·  taxi, moto, flete o grúa", font=tiny, fill=SLATE, anchor="mt")
    return canvas


def main():
    qr = make_qr()
    logo = ROOT / "icons" / "icon-512.png"
    if logo.exists():
        qr = add_center_logo(qr, logo)

    clean = OUT_DIR / "qr-honduraite-whatsapp.png"
    qr.convert("RGB").save(clean, "PNG", optimize=True)

    card = social_card(qr)
    social = OUT_DIR / "qr-honduraite-whatsapp-redes.png"
    card.save(social, "PNG", optimize=True)

    print("URL:", WA_URL)
    print("QR:", clean)
    print("Redes:", social)


if __name__ == "__main__":
    main()
