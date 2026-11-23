"""Một link Threads → một file MP4."""
from __future__ import annotations

import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from typing import Callable

from . import card, tts, video
from .scraper import ThreadData, fetch_thread


@dataclass
class Settings:
    output_dir: str
    voice: str = "vi-VN-HoaiMyNeural"
    rate: str = "+10%"
    max_comments: int = 5
    backgrounds_dir: str = ""
    music_dir: str = ""
    music_volume: float = 0.15
    dark_card: bool = False
    read_username: bool = True


def _slug(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "_", text)[:60] or "video"


def build_from_data(data: ThreadData, s: Settings, log: Callable[[str], None] = print) -> str:
    os.makedirs(s.output_dir, exist_ok=True)
    work = tempfile.mkdtemp(prefix="tvm_")
    try:
        background = video.pick_file(s.backgrounds_dir, video.VIDEO_EXT)
        music = video.pick_file(s.music_dir, video.AUDIO_EXT)
        items = [(data.main, False)] + [(c, True) for c in data.comments]
        segments = []
        for i, (post, is_comment) in enumerate(items):
            log(f"  [{i + 1}/{len(items)}] {'bình luận' if is_comment else 'bài viết'} @{post.username}")
            png = card.render_card(post, os.path.join(work, f"card{i}.png"), is_comment, s.dark_card)
            speech = post.text
            if is_comment and s.read_username:
                speech = f"{post.username} bình luận: {speech}"
            mp3 = tts.synthesize(speech, s.voice, os.path.join(work, f"voice{i}.mp3"), s.rate)
            segments.append(video.make_segment(png, mp3, os.path.join(work, f"seg{i}.mp4"), background))
        code = data.main.code or data.main.pk
        out = os.path.join(s.output_dir, f"{_slug(data.main.username)}_{_slug(code)}.mp4")
        video.concat_with_music(segments, out, music, s.music_volume)
        return out
    finally:
        shutil.rmtree(work, ignore_errors=True)


def build_video(url: str, s: Settings, log: Callable[[str], None] = print) -> str:
    log(f"Đang lấy nội dung: {url}")
    data = fetch_thread(url, max_comments=s.max_comments)
    log(f"  Lấy được bài của @{data.main.username} + {len(data.comments)} bình luận")
    return build_from_data(data, s, log)
