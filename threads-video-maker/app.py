"""Threads Video Maker – giao diện Tkinter.

Chạy:  python app.py
"""
from __future__ import annotations

import os
import queue
import threading
import tkinter as tk
from concurrent.futures import ThreadPoolExecutor
from tkinter import filedialog, messagebox, ttk

from tvm.pipeline import Settings, build_video
from tvm.tts import VOICES

BASE = os.path.dirname(os.path.abspath(__file__))


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Threads Video Maker")
        self.geometry("820x680")
        self.logq: queue.Queue[str] = queue.Queue()
        self.running = False
        self._build()
        self.after(150, self._drain_log)

    def _row_dir(self, parent, label, var, r):
        ttk.Label(parent, text=label).grid(row=r, column=0, sticky="w", pady=3)
        ttk.Entry(parent, textvariable=var).grid(row=r, column=1, sticky="ew", padx=6)
        ttk.Button(parent, text="Chọn…", command=lambda: var.set(filedialog.askdirectory() or var.get())
                   ).grid(row=r, column=2)

    def _build(self):
        pad = {"padx": 10, "pady": 6}
        ttk.Label(self, text="Dán link Threads (mỗi dòng 1 link):").pack(anchor="w", **pad)
        self.links = tk.Text(self, height=8)
        self.links.pack(fill="x", padx=10)

        f = ttk.Frame(self)
        f.pack(fill="x", **pad)
        f.columnconfigure(1, weight=1)
        self.out_dir = tk.StringVar(value=os.path.join(BASE, "output"))
        self.bg_dir = tk.StringVar(value=os.path.join(BASE, "assets", "backgrounds"))
        self.music_dir = tk.StringVar(value=os.path.join(BASE, "assets", "music"))
        self._row_dir(f, "Thư mục xuất video", self.out_dir, 0)
        self._row_dir(f, "Video nền (3D/meme)", self.bg_dir, 1)
        self._row_dir(f, "Nhạc nền", self.music_dir, 2)

        g = ttk.Frame(self)
        g.pack(fill="x", **pad)
        self.voice = tk.StringVar(value=list(VOICES)[0])
        self.rate = tk.IntVar(value=10)
        self.comments = tk.IntVar(value=5)
        self.workers = tk.IntVar(value=2)
        self.volume = tk.IntVar(value=15)
        self.dark = tk.BooleanVar(value=False)
        ttk.Label(g, text="Giọng đọc").grid(row=0, column=0, sticky="w")
        ttk.Combobox(g, textvariable=self.voice, values=list(VOICES), state="readonly", width=16
                     ).grid(row=0, column=1, padx=6)
        ttk.Label(g, text="Tốc độ đọc (%)").grid(row=0, column=2, sticky="w")
        ttk.Spinbox(g, from_=-50, to=100, textvariable=self.rate, width=6).grid(row=0, column=3, padx=6)
        ttk.Label(g, text="Số bình luận").grid(row=0, column=4, sticky="w")
        ttk.Spinbox(g, from_=0, to=20, textvariable=self.comments, width=6).grid(row=0, column=5, padx=6)
        ttk.Label(g, text="Số luồng").grid(row=1, column=0, sticky="w", pady=6)
        ttk.Spinbox(g, from_=1, to=8, textvariable=self.workers, width=6).grid(row=1, column=1, sticky="w", padx=6)
        ttk.Label(g, text="Âm lượng nhạc (%)").grid(row=1, column=2, sticky="w")
        ttk.Spinbox(g, from_=0, to=100, textvariable=self.volume, width=6).grid(row=1, column=3, padx=6)
        ttk.Checkbutton(g, text="Thẻ nền tối", variable=self.dark).grid(row=1, column=4, columnspan=2, sticky="w")

        b = ttk.Frame(self)
        b.pack(fill="x", **pad)
        self.start_btn = ttk.Button(b, text="▶ Bắt đầu tạo video", command=self.start)
        self.start_btn.pack(side="left")
        ttk.Button(b, text="Mở thư mục xuất", command=self.open_out).pack(side="left", padx=8)
        self.progress = ttk.Progressbar(b, mode="determinate")
        self.progress.pack(side="left", fill="x", expand=True, padx=8)

        self.log_box = tk.Text(self, height=14, state="disabled", bg="#111", fg="#ddd")
        self.log_box.pack(fill="both", expand=True, padx=10, pady=(0, 10))

    def log(self, msg: str):
        self.logq.put(msg)

    def _drain_log(self):
        while not self.logq.empty():
            msg = self.logq.get()
            if msg == "__TICK__":
                self.progress["value"] += 1
                continue
            self.log_box.configure(state="normal")
            self.log_box.insert("end", msg + "\n")
            self.log_box.see("end")
            self.log_box.configure(state="disabled")
        self.after(150, self._drain_log)

    def open_out(self):
        os.makedirs(self.out_dir.get(), exist_ok=True)
        if hasattr(os, "startfile"):
            os.startfile(self.out_dir.get())

    def start(self):
        if self.running:
            return
        urls = [u.strip() for u in self.links.get("1.0", "end").splitlines() if u.strip().startswith("http")]
        if not urls:
            messagebox.showwarning("Thiếu link", "Hãy dán ít nhất 1 link Threads.")
            return
        rate = self.rate.get()
        s = Settings(
            output_dir=self.out_dir.get(), voice=VOICES[self.voice.get()],
            rate=f"{'+' if rate >= 0 else ''}{rate}%", max_comments=self.comments.get(),
            backgrounds_dir=self.bg_dir.get(), music_dir=self.music_dir.get(),
            music_volume=self.volume.get() / 100, dark_card=self.dark.get(),
        )
        self.running = True
        self.start_btn.configure(state="disabled")
        self.progress.configure(maximum=len(urls), value=0)
        threading.Thread(target=self._run_all, args=(urls, s, self.workers.get()), daemon=True).start()

    def _run_one(self, url, s):
        try:
            out = build_video(url, s, self.log)
            self.log(f"✔ Xong: {out}")
            return True
        except Exception as e:
            self.log(f"✘ Lỗi {url}: {e}")
            return False
        finally:
            self.log("__TICK__")

    def _run_all(self, urls, s, workers):
        with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
            results = list(ex.map(lambda u: self._run_one(u, s), urls))
        self.log(f"=== Hoàn tất: {sum(results)}/{len(results)} video thành công ===")
        self.running = False
        self.after(0, lambda: self.start_btn.configure(state="normal"))


if __name__ == "__main__":
    App().mainloop()
