# Tổng kết toàn bộ dự án Máy Dịch (App Mobile, Web & Phần cứng)

Tài liệu hợp nhất toàn bộ lộ trình, tính năng đã hoàn thành, thiết kế phần cứng và các lỗi kỹ thuật đã xử lý. Cập nhật ngày: **04/10/2026**.

---

## 1. Tổng quan hệ thống
Dự án phiên dịch song ngữ Nhật - Việt, phục vụ hội thoại hàng ngày và chế độ ghi âm bài giảng/lớp học:
- **Web App (`web/`)**: Next.js App Router, triển khai Vercel (`translate-ruby-phi.vercel.app`). Chạy trên máy tính và mobile browser (iOS Safari, Android Chrome).
- **Mobile App (`app/`)**: Flutter Android (v0.2.0 → v0.4.0+6000), dùng cho thiết bị cá nhân độc lập.
- **Kế hoạch phần cứng mini**: Bộ dịch cầm tay độc lập 2 nút bấm trên nền ESP32-S3.

---

## 2. Tính năng đã hoàn thành qua các giai đoạn

### A. Mobile App (Flutter v0.2 → v0.4)
- **Hội thoại hai chiều & Chế độ lớp học**: Thu âm liên tục 1 micro không ngắt quãng; hiển thị phụ đề gốc và dịch song song khi giáo viên nói.
- **Tối ưu giọng nói & Quota**:
  - Cơ chế nhận diện ngừng nói (VAD): mốc 10 giây im lặng chốt câu.
  - Bộ ghép câu thông minh: chống ngắt vụn câu khi người nói ngập ngừng hoặc đọc vấp.
  - Phân tách người nói (Diarization): nhận diện nhãn Speaker 1–8, hỗ trợ gắn nhãn thủ công hoặc nhận dạng mẫu giọng giáo viên.
- **Lưu trữ & Bảo mật**: Toàn bộ audio và văn bản lưu cục bộ (SQLite/Hive); API key mã hóa trong Flutter Secure Storage; xuất/xóa dữ liệu thủ công.

### B. Web App (Next.js + Vercel)
- **Giao diện đa thiết bị**: Tối ưu hiển thị responsive (320px–800px), vùng cuộn độc lập cho bản gốc và bản dịch.
- **Tạm dừng API (Pause / Resume)**:
  - Bấm **Dừng API**: Ngừng gửi dữ liệu lên AI để tiết kiệm quota/chi phí, nhưng mic vẫn ghi âm cục bộ liên tục.
  - Bấm **Tiếp tục**: Mở lại stream nhận dạng trong cùng phiên, không gửi bù audio lúc nghỉ.
  - Phân đoạn audio tự động theo mỗi lần tạm dừng, popup nghe lại và tải từng đoạn.
- **Đa dạng bộ nhận dạng giọng nói (STT Providers)**:
  1. **Gemini Live & Gemini Transcribe**: Chạy qua WebSocket/HTTP, hỗ trợ phân tách người nói.
  2. **Nemotron 3.5 ASR**: Tích hợp qua NeMo-Speech.cpp + WebSocket Gateway bảo vệ bằng ticket ngắn hạn.
  3. **Soniox Realtime STT (`stt-rt-v5`)** *(vừa hoàn thành 04/10/2026)*:
     - Nhận dạng trực tiếp tiếng Nhật và tiếng Việt qua WebSocket.
     - Cấp khóa phiên an toàn tại server (`/api/speech/soniox/session`), tự gia hạn ở phút 55.
     - Streaming PCM 16kHz mono; xử lý token final/non-final chính xác; drain 5s khi dừng.
     - Nút kiểm tra kết nối dùng 1s audio im lặng tổng hợp (không bật mic).
     - Chi phí dự toán: ~0,12 USD/giờ phiên Soniox STT.

---

## 3. Lộ trình phần cứng: Bộ dịch hai nút ESP32-S3
- **Mục tiêu**: Thiết bị dịch cầm tay độc lập, 2 nút cứng (Nhật/Việt), loa ngoài, mic lọc ồn.
- **Danh sách linh kiện dự kiến (< ¥10.000 tại Tokyo/Saitama)**:
  - Bo mạch chính: **Waveshare ESP32-S3-Touch-LCD-3.5B-C (SKU 31334)** gồm màn hình cảm ứng 3.5", mic tích hợp, khe cắm thẻ microSDHC và vỏ hộp sẵn (~¥6.000).
  - Thẻ nhớ microSDHC 16GB (Akizuki ~¥1.450).
  - Pin sạc dự phòng 10.000 mAh DAISO PD20W (JAN 4562380816610 ~¥1.100).
  - Củ sạc USB-A+C và 2 cáp sạc dữ liệu Standard Products / DAISO (~¥990).
- **Cơ chế hoạt động**: Bấm giữ nút để nói, thả ra gửi âm thanh lên API qua WiFi/Hotspot điện thoại và phát âm thanh dịch ra loa I2S/MAX98357A.

---

## 4. Các lỗi kỹ thuật trọng yếu & Lịch sử xử lý

| Lỗi / Vấn đề | Thời điểm | Nguyên nhân | Giải pháp |
| :--- | :--- | :--- | :--- |
| **Quota 429 Gemini API** | 28/09/2026 | Bị ngắt vụn gửi quá nhiều request khi đọc vấp / micro ồn | Thêm VAD lọc khoảng lặng, bộ điều tiết nhịp gửi (scheduler), nút Dừng API thủ công |
| **Mất audio khi làm mới trang trên Web** | 03/10/2026 | Luồng ghi âm tách rời với lifecycle của trình duyệt | Gom audio toàn buổi vào IndexedDB, đồng bộ ngầm và hỗ trợ nghe lại sau reload |
| **OAuth Google `redirect_uri_mismatch`** | 04/10/2026 (~05:27) | Đăng nhập từ domain nhánh Vercel preview chưa khai báo trên Google Cloud | Chuyển sang đăng nhập từ domain chính thức `https://translate-ruby-phi.vercel.app/app` |
| **iPhone Safari/Chrome không thu âm (`AbortSignal.any is not a function`)** | 04/10/2026 (~05:48) | Nhân WebKit trên iOS < 17.4 chưa hỗ trợ native `AbortSignal.any` | Viết helper fallback `signalWithTimeout` (`web/src/shared/abort-signal.ts`), sửa toàn bộ recognizer và push commit `285b03d` |

---

## 5. Cấu hình triển khai & Vận hành

### Biến môi trường Production (`web/.env` trên Vercel)
- `AUTH_SECRET`: Khóa bí mật mã hóa JWT session.
- `AUTH_URL`: `https://translate-ruby-phi.vercel.app` (khớp với redirect URI Google Cloud).
- `OWNER_EMAIL`: Email chủ tài khoản được phép sử dụng.
- `AUTH_GOOGLE_ID` & `AUTH_GOOGLE_SECRET`: Cặp khóa Google OAuth 2.0.
- `GEMINI_API_KEY`: Khóa API Google Gemini.
- `SONIOX_API_KEY`: Khóa API Soniox (server-only, không dùng tiền tố `NEXT_PUBLIC_`).

### Hướng dẫn kiểm thử nhanh (Web)
```powershell
cd web
npm run typecheck    # Kiểm tra kiểu TypeScript
npm run lint         # Kiểm tra chuẩn mã nguồn
npm test             # Chạy 284 test unit & integration
npm run build        # Build production Next.js
```
*Lưu ý: Luôn tuân thủ quy chuẩn phát triển trong file `AGENTS.md`.*
