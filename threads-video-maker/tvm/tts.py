"""Giọng đọc AI tiếng Việt qua Edge-TTS (miễn phí, cần Internet)."""
from __future__ import annotations

import asyncio
import re

import edge_tts

VOICES = {
    "Hoài My (nữ)": "vi-VN-HoaiMyNeural",
    "Nam Minh (nam)": "vi-VN-NamMinhNeural",
}

_URL_RE = re.compile(r"https?://\S+")


def clean_for_speech(text: str) -> str:
    text = _URL_RE.sub("", text)
    text = re.sub(r"[#@]", "", text)
    return re.sub(r"\s+", " ", text).strip()


async def _speak(text: str, voice: str, out_path: str, rate: str):
    await edge_tts.Communicate(text, voice, rate=rate).save(out_path)


def synthesize(text: str, voice: str, out_path: str, rate: str = "+10%", retries: int = 3) -> str:
    text = clean_for_speech(text) or "..."
    last = None
    for _ in range(retries):
        try:
            asyncio.run(_speak(text, voice, out_path, rate))
            return out_path
        except Exception as e:  # mạng chập chờn → thử lại
            last = e
    raise RuntimeError(f"TTS lỗi: {last}")
