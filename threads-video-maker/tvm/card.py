"""Vẽ thẻ bài viết / bình luận kiểu Threads thành ảnh PNG trong suốt."""
from __future__ import annotations

import io
import os
import urllib.request

from PIL import Image, ImageDraw, ImageFont

from .scraper import Post

CARD_W = 960
PAD = 40
AVATAR = 84
MAX_LINES = 16

_FONT_CANDIDATES = {
    "regular": [r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"],
    "bold": [r"C:\Windows\Fonts\segoeuib.ttf", r"C:\Windows\Fonts\arialbd.ttf",
             "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"],
}


def _font(kind: str, size: int):
    local = os.path.join(os.path.dirname(__file__), "..", "assets", "fonts", f"{kind}.ttf")
    for path in [local, *_FONT_CANDIDATES[kind]]:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size)


def _wrap(draw, text, font, width):
    lines = []
    for para in text.split("\n"):
        words, cur = para.split(" "), ""
        for w in words:
            trial = f"{cur} {w}".strip()
            if draw.textlength(trial, font=font) <= width:
                cur = trial
            else:
                if cur:
                    lines.append(cur)
                cur = w
        lines.append(cur)
    if len(lines) > MAX_LINES:
        lines = lines[:MAX_LINES]
        lines[-1] = lines[-1].rstrip() + " …"
    return lines


def _avatar(post: Post) -> Image.Image:
    img = None
    if post.avatar_url:
        try:
            req = urllib.request.Request(post.avatar_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=10) as r:
                img = Image.open(io.BytesIO(r.read())).convert("RGB")
        except Exception:
            img = None
    if img is None:
        img = Image.new("RGB", (AVATAR, AVATAR), (60, 60, 60))
        d = ImageDraw.Draw(img)
        f = _font("bold", 40)
        ch = (post.username[:1] or "?").upper()
        d.text((AVATAR / 2, AVATAR / 2), ch, font=f, fill="white", anchor="mm")
    img = img.resize((AVATAR, AVATAR))
    mask = Image.new("L", (AVATAR, AVATAR), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, AVATAR, AVATAR), fill=255)
    img.putalpha(mask)
    return img


def render_card(post: Post, out_path: str, is_comment: bool = False, dark: bool = False) -> str:
    bg = (24, 24, 24, 245) if dark else (255, 255, 255, 245)
    fg = (240, 240, 240) if dark else (16, 16, 16)
    sub = (150, 150, 150)
    f_name = _font("bold", 36)
    f_text = _font("regular", 44 if not is_comment else 40)
    f_meta = _font("regular", 30)

    tmp = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    text_w = CARD_W - PAD * 2
    lines = _wrap(tmp, post.text, f_text, text_w)
    line_h = int(f_text.size * 1.35)
    h = PAD + AVATAR + 24 + line_h * len(lines) + 30 + 40 + PAD

    card = Image.new("RGBA", (CARD_W, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle((0, 0, CARD_W - 1, h - 1), radius=36, fill=bg)
    card.alpha_composite(_avatar(post), (PAD, PAD))
    label = ("↳ " if is_comment else "") + post.username
    d.text((PAD + AVATAR + 24, PAD + AVATAR / 2), label, font=f_name, fill=fg, anchor="lm")

    y = PAD + AVATAR + 24
    for ln in lines:
        d.text((PAD, y), ln, font=f_text, fill=fg)
        y += line_h
    y += 30
    meta = f"♥ {post.likes:,}".replace(",", ".")
    if post.replies:
        meta += f"     {post.replies:,} phản hồi".replace(",", ".")
    d.text((PAD, y), meta, font=f_meta, fill=sub)
    card.save(out_path)
    return out_path
