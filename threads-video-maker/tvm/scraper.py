"""Lấy bài viết + bình luận nổi bật từ link Threads bằng Playwright.

Threads nhúng dữ liệu bài viết dưới dạng JSON trong thẻ <script> và trả thêm
qua các request GraphQL. Ta gom mọi object có dạng "post" từ cả hai nguồn.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field

from playwright.sync_api import sync_playwright


@dataclass
class Post:
    pk: str
    username: str
    text: str
    likes: int = 0
    replies: int = 0
    avatar_url: str = ""
    code: str = ""


@dataclass
class ThreadData:
    url: str
    main: Post
    comments: list[Post] = field(default_factory=list)


CODE_RE = re.compile(r"/post/([A-Za-z0-9_-]+)")


def _walk(node, out: dict[str, Post]):
    if isinstance(node, dict):
        user = node.get("user")
        if isinstance(user, dict) and user.get("username") and ("caption" in node or "text_post_app_info" in node):
            caption = node.get("caption") or {}
            text = caption.get("text", "") if isinstance(caption, dict) else ""
            pk = str(node.get("pk") or node.get("id") or "")
            if pk and text.strip():
                info = node.get("text_post_app_info") or {}
                out.setdefault(pk, Post(
                    pk=pk,
                    username=user["username"],
                    text=text.strip(),
                    likes=int(node.get("like_count") or 0),
                    replies=int((info or {}).get("direct_reply_count") or 0),
                    avatar_url=user.get("profile_pic_url", ""),
                    code=node.get("code", ""),
                ))
        for v in node.values():
            _walk(v, out)
    elif isinstance(node, list):
        for v in node:
            _walk(v, out)


def _parse_json_blobs(texts, out):
    for t in texts:
        try:
            _walk(json.loads(t), out)
        except (ValueError, TypeError):
            continue


def fetch_thread(url: str, max_comments: int = 5, headless: bool = True, timeout_ms: int = 45000) -> ThreadData:
    m = CODE_RE.search(url)
    code = m.group(1) if m else ""
    posts: dict[str, Post] = {}
    blobs: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless, executable_path=os.environ.get("TVM_CHROMIUM") or None)
        ctx = browser.new_context(
            locale="vi-VN",
            viewport={"width": 430, "height": 932},
            user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"),
        )
        page = ctx.new_page()

        def on_response(resp):
            if "graphql" in resp.url:
                try:
                    blobs.append(resp.text())
                except Exception:
                    pass

        page.on("response", on_response)
        page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
        try:
            page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass
        # Cuộn để Threads tải thêm bình luận.
        for _ in range(4):
            page.mouse.wheel(0, 2500)
            page.wait_for_timeout(1200)
        blobs.extend(page.eval_on_selector_all(
            'script[type="application/json"]', "els => els.map(e => e.textContent)"))
        browser.close()

    _parse_json_blobs(blobs, posts)
    if not posts:
        raise RuntimeError("Không đọc được bài viết (link sai, bài riêng tư, hoặc Threads đổi cấu trúc).")

    main = next((p for p in posts.values() if code and p.code == code), None)
    if main is None:
        main = next(iter(posts.values()))
    others = [p for p in posts.values() if p.pk != main.pk]
    others.sort(key=lambda p: p.likes, reverse=True)
    return ThreadData(url=url, main=main, comments=others[:max_comments])
