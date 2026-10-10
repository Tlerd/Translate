# Soniox STT trực tiếp trên web

Provider `soniox` dùng model cố định `stt-rt-v5`, đầu vào Nhật (`ja-JP`/`ja`) và Việt (`vi-VN`/`vi`). Soniox chỉ nhận giọng; dịch chữ tiếp tục qua model dịch đã chọn và `/api/translate`. Không bật dịch Soniox, endpointing hoặc diarization tự động. Danh sách người nói dùng để gán thủ công.

## Điền key phía server

Tạo key tại [Soniox Console](https://console.soniox.com), cấp quyền Temporary API keys và real-time speech-to-text. Chạy từ `web/`:

```powershell
node scripts/soniox-key-setup.cjs
```

Mở URL localhost được in ra, dán key vào ô mật khẩu và bấm **Lưu key**. Form chỉ ghi biến `SONIOX_API_KEY` vào `web/.env.local`, giữ các biến khác; không gọi provider hoặc in key. Trang tự hết hạn sau 30 phút. Có thể tự điền `SONIOX_API_KEY=...` vào file đó, rồi khởi động lại Next.js. Không dùng biến `NEXT_PUBLIC_*`, lưu key vào browser hoặc commit file `.env.local`.

Server owner-only cấp khóa tạm single-use với hạn mở stream 120 giây, trần stream 60 phút. Browser dùng khóa tạm trong bộ nhớ nối WebSocket trực tiếp tới Soniox. Không truyền audio qua Next.js. Gia hạn ở phút 55 giữ cùng bản ghi; Google vẫn gia hạn ở 8,5 phút.

## Thao tác thử

Chọn **Soniox → Lưu cài đặt → Kiểm tra API nhận giọng**. Kiểm tra không bật mic: gửi một giây PCM im lặng và chờ `finished`. Lượt này có thể tính phí; chỉ chạy khi bạn bấm nút, không tự chạy khi mở/lưu settings.

Chọn chiều Nhật–Việt hoặc Việt–Nhật, **Bắt đầu thu → Dừng API → Tiếp tục → Kết thúc buổi → Kết thúc và lưu**, reload rồi nghe audio của buổi đã lưu. API pause đóng stream sau drain tối đa 5 giây, còn audio tiếp tục ghi bằng cùng micro/MediaRecorder. Resume xin khóa/socket mới, không gửi lại audio khoảng pause. Kết thúc dừng mic ngay và chờ chữ, audio, hàng dịch cũ lưu nốt. Lỗi quyền/model/số dư không retry; lỗi mạng retry tối đa ba lần.

PCM16 LE mono 16 kHz được gửi liên tục khi API active. Âm lượng và khoảng nghỉ chỉ dùng manual finalize, không loại PCM im lặng. `<fin>`/`<end>` chốt câu; token final chưa chốt câu. `finished` kết thúc stream. Text token nối nguyên trạng, ID có mã kết nối riêng, timestamp lấy mốc PCM đầu tiên thực sự gửi trong đồng hồ toàn buổi.

## Chi phí và giới hạn xác minh

STT dự toán khoảng **0,12 USD/giờ phiên** (~120 USD/1.000 giờ); thực tế theo token và thời gian stream mở. Im lặng/keepalive không giảm thời gian phiên tính phí. Tổng bản này là **STT + model dịch chữ đang chọn**. Mốc ~0,18 USD/giờ khi thêm dịch Soniox là dự toán hạng mục sau, không phải giá trọn gói hoặc tính năng đã bật. Xem [bảng giá](https://soniox.com/pricing).

Test tự động mock toàn bộ route/socket Soniox; fixture server xóa credential Soniox và các provider khác khỏi môi trường. Mock kiểm tra giao thức ứng dụng, vòng đời, persistence, timer và UI; không chứng minh độ chính xác, độ trễ hoặc billing thật.

**Chưa kiểm chứng bằng key Soniox thật hoặc iPhone Safari thật trong nhiệm vụ triển khai này.** Sau đó thử tiếng Nhật/Việt 30–60 giây trên Chrome và Safari, pause giữa câu, resume, kết thúc/reload; đo chữ tạm đầu tiên, thời gian chốt câu, reconnect và xác nhận socket đóng trong Network. Không suy ra kết quả thực từ test mock.

## Kiểm tra kỹ thuật

Từ `web/`: `npm run typecheck`, `npm run lint`, `npm test -- --reporter=dot`, `npm run build`. Sau build chạy `node scripts/serve-fixture.cjs` và `npm run test:browser` với `BASE_URL=http://localhost:3100`. Fixture tuyệt đối không dùng key thật.

Terminal chạy browser cần cookie owner ký bằng credential fixture khớp server (đây là dữ liệu test, không phải key thật):

```powershell
$env:BROWSER_TEST_AUTH_SECRET = 'fixture-auth-secret-over-thirty-two-characters'
$env:BROWSER_TEST_OWNER_EMAIL = 'owner@example.com'
$env:BASE_URL = 'http://localhost:3100'
npm run test:browser
```
