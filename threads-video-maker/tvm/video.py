"""Ghép video 9:16 bằng FFmpeg (dùng bản FFmpeg đóng gói sẵn trong imageio-ffmpeg)."""
from __future__ import annotations

import os
import random
import re
import subprocess

W, H, FPS = 1080, 1920, 30
VIDEO_EXT = (".mp4", ".mov", ".mkv", ".webm")
AUDIO_EXT = (".mp3", ".m4a", ".wav", ".aac", ".ogg")
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def ffmpeg_bin() -> str:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def _run(args: list[str]):
    proc = subprocess.run([ffmpeg_bin(), "-hide_banner", "-loglevel", "error", "-y", *args],
                          capture_output=True, text=True, encoding="utf-8", errors="replace",
                          creationflags=_NO_WINDOW)
    if proc.returncode != 0:
        raise RuntimeError("FFmpeg lỗi: " + proc.stderr.strip()[-800:])


def media_duration(path: str) -> float:
    proc = subprocess.run([ffmpeg_bin(), "-hide_banner", "-i", path], capture_output=True, text=True,
                          encoding="utf-8", errors="replace", creationflags=_NO_WINDOW)
    m = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", proc.stderr)
    if not m:
        return 0.0
    h, mi, s = m.groups()
    return int(h) * 3600 + int(mi) * 60 + float(s)


def pick_file(folder: str, exts) -> str | None:
    if not folder or not os.path.isdir(folder):
        return None
    files = [os.path.join(folder, f) for f in os.listdir(folder) if f.lower().endswith(exts)]
    return random.choice(files) if files else None


def make_segment(card_png: str, voice: str, out_path: str, background: str | None, tail: float = 0.4):
    dur = media_duration(voice) + tail
    if background:
        bg_len = media_duration(background)
        offset = random.uniform(0, max(0.0, bg_len - dur)) if bg_len > dur else 0
        bg_in = ["-stream_loop", "-1", "-ss", f"{offset:.2f}", "-i", background]
    else:
        bg_in = ["-f", "lavfi", "-i", f"color=c=0x101418:s={W}x{H}:r={FPS}"]
    filt = (
        f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,fps={FPS}[b];"
        f"[1:v]format=rgba,scale='if(gt(ih,1700),-2,iw)':'if(gt(ih,1700),1700,ih)'[c];"
        f"[b][c]overlay=(W-w)/2:(H-h)/2:shortest=1,format=yuv420p[v];"
        f"[2:a]aresample=44100,aformat=channel_layouts=stereo,apad[a]"
    )
    _run([*bg_in, "-loop", "1", "-i", card_png, "-i", voice,
          "-filter_complex", filt, "-map", "[v]", "-map", "[a]", "-t", f"{dur:.2f}",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-r", str(FPS),
          "-c:a", "aac", "-b:a", "160k", "-ar", "44100", out_path])
    return out_path


def concat_with_music(segments: list[str], out_path: str, music: str | None, music_volume: float = 0.15):
    work = os.path.dirname(segments[0])
    list_file = os.path.join(work, "concat.txt")
    with open(list_file, "w", encoding="utf-8") as f:
        for s in segments:
            f.write("file '" + s.replace("\\", "/").replace("'", "'\\''") + "'\n")
    joined = os.path.join(work, "joined.mp4")
    _run(["-f", "concat", "-safe", "0", "-i", list_file, "-c", "copy", joined])
    if not music:
        os.replace(joined, out_path)
        return out_path
    _run(["-i", joined, "-stream_loop", "-1", "-i", music,
          "-filter_complex",
          f"[1:a]volume={music_volume},aresample=44100[m];"
          f"[0:a][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]",
          "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
          "-movflags", "+faststart", out_path])
    return out_path
