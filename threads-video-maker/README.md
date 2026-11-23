# Threads Video Maker (Windows)

Dán link bài Threads → tool tự lấy bài viết + bình luận nổi bật, đọc bằng giọng AI tiếng Việt,
ghép lên video nền + nhạc nền, xuất MP4 9:16 (1080×1920) cho TikTok / Reels / Shorts.

## Cài đặt (1 lần)

1. Cài **Python 3.10+** từ python.org — nhớ tick **"Add Python to PATH"**.
2. Nhấp đúp **`run.bat`**. Lần đầu nó tự tạo môi trường, cài thư viện và Chromium (vài phút).
   Những lần sau nhấp đúp là mở ngay.

Không cần cài FFmpeg riêng (đã có sẵn trong gói `imageio-ffmpeg`).

## Sử dụng

1. Bỏ video nền (gameplay, 3D, meme… `.mp4`) vào `assets/backgrounds/` — mỗi video sẽ chọn ngẫu nhiên 1 file.
   Để trống thì dùng nền màu tối.
2. Bỏ nhạc nền (`.mp3`) vào `assets/music/` (tuỳ chọn).
3. Dán link Threads, mỗi dòng 1 link, chọn giọng / tốc độ / số bình luận / số luồng → **Bắt đầu**.
4. Video ra trong thư mục `output/`.

## Cấu trúc

| File | Việc |
|---|---|
| `tvm/scraper.py` | Mở link bằng Playwright, đọc JSON Threads nhúng trong trang để lấy bài + bình luận (xếp theo lượt thích) |
| `tvm/tts.py` | Giọng đọc Edge-TTS (Hoài My / Nam Minh) |
| `tvm/card.py` | Vẽ thẻ bài viết kiểu Threads (Pillow) |
| `tvm/video.py` | Ghép thẻ + giọng + nền + nhạc bằng FFmpeg |
| `tvm/pipeline.py` | 1 link → 1 MP4 |
| `app.py` | Giao diện Tkinter, chạy đa luồng |

## Lưu ý

- Threads không có API công khai cho bài của người khác; tool đọc dữ liệu trang. Khi Threads đổi cấu trúc,
  cần sửa `tvm/scraper.py`. Bài riêng tư / yêu cầu đăng nhập sẽ không lấy được.
- Edge-TTS cần Internet.
- Tự động thu thập dữ liệu có thể trái điều khoản của Meta; đăng lại nội dung người khác có thể vi phạm bản quyền.
  Tự cân nhắc khi dùng.
