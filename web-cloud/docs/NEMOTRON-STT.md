# Nemotron 3.5 ASR với NeMo-Speech.cpp

Ứng dụng có lựa chọn **Nemotron 3.5 ASR · máy chủ riêng · trực tiếp** trong **Cài đặt → Cấu hình AI → Nhận giọng**. Model chuyển giọng nói thành chữ; phần dịch chữ tiếp tục dùng model dịch đã chọn. Không cần huấn luyện lại cho tiếng Việt hoặc tiếng Nhật.

## Chạy trên Windows

Yêu cầu Node.js 22 trở lên và PowerShell 7 (`pwsh`). Bản CUDA cần GPU NVIDIA cùng driver phù hợp; có thể dùng bản CPU nếu không có GPU.

Trong thư mục `web`, chạy một lần:

```powershell
npm install
npm run speech:nemotron:setup
```

Script tải bản Windows CUDA của **NeMo-Speech.cpp v0.2.0** và model **Nemotron 3.5 ASR Streaming 0.6B Q8_0**, kiểm tra SHA-256 rồi lưu vào `.cache/nemotron/`. Model khoảng 742 MB (708 MiB). Script bổ sung cấu hình Nemotron còn thiếu vào `.env.local`, giữ nguyên các giá trị đã có. Cả cache và `.env.local` đều được Git bỏ qua.

Nếu cần bản CPU:

```powershell
npm run speech:nemotron:setup -- -Backend cpu
```

Mỗi lần sử dụng, mở hai terminal trong `web`:

```powershell
# Terminal 1: model ASR và gateway WebSocket
npm run speech:nemotron

# Terminal 2: ứng dụng
npm run dev -- --hostname 127.0.0.1
```

Mở ứng dụng tại `http://localhost:3000/settings`, chọn Nemotron, bấm **Lưu cài đặt** rồi **Kiểm tra API nhận giọng**. Quay về màn hình thu, chọn ngôn ngữ đầu vào và bắt đầu. Phải khởi động lại Next.js sau khi thay đổi cấu hình server trong `.env.local`.

Launcher giữ model và gateway chạy đến khi nhấn Ctrl+C. Model nhận âm thanh mono PCM16 ở 16 kHz qua WebSocket. Ứng dụng lấy PCM từ cùng micro đang dùng để lưu audio; không xin thêm một micro. Khi dừng hoặc đổi bộ nhận giọng, ứng dụng chờ kết quả cuối và xác nhận commit tối đa 5 giây. Đổi khoảng nghỉ hoặc chế độ lớp học/đọc sẽ mở phiên Nemotron mới với cài đặt mới, giữ micro đang thu.

## Cấu hình server

| Biến | Mục đích | Giá trị local mặc định |
| --- | --- | --- |
| `NEMOTRON_BASE_URL` | Next.js kiểm tra `/ready`; gateway kết nối tới NeMo | `http://127.0.0.1:8080` |
| `NEMOTRON_WEBSOCKET_URL` | Địa chỉ gateway mà trình duyệt truy cập được | `ws://127.0.0.1:8081/speech` |
| `NEMOTRON_GATEWAY_SECRET` | Khóa HMAC dùng chung giữa Next.js và gateway, ít nhất 32 ký tự | Script tạo ngẫu nhiên |
| `NEMOTRON_API_KEY` | Khóa Bearer giữa gateway/Next.js và NeMo | Script tạo ngẫu nhiên |

Không đưa khóa cố định xuống client. Route `/api/speech/nemotron/session` dùng cơ chế xác thực chủ ứng dụng hiện có, kiểm tra model ASR sẵn sàng rồi cấp ticket một lần, dùng để mở kết nối trong 60 giây. Ticket ràng buộc origin, ngôn ngữ và khoảng nghỉ. Phiên tối đa 10 phút; controller tự gia hạn trước giới hạn này. Gateway giới hạn mặc định 4 kết nối đồng thời.

`NEMOTRON_GATEWAY_PORT` đổi cổng gateway local (mặc định 8081); cập nhật `NEMOTRON_WEBSOCKET_URL` tương ứng. Khi đã có runtime/model riêng, có thể dùng `NEMOTRON_EXECUTABLE` và `NEMOTRON_MODEL_PATH` thay cho manifest cài đặt. Launcher tích hợp chỉ phục vụ backend ở loopback. Với một backend từ xa, chạy gateway riêng bằng `npm run speech:nemotron:gateway`; dùng `NEMOTRON_GATEWAY_HOST` để chọn địa chỉ bind nếu cần reverse proxy trên host khác.

## Dùng với web đã deploy

Vercel chạy phần web và route cấp ticket. Tiến trình C++ cùng gateway phải chạy trên máy hoặc server riêng; việc chọn model trong UI không tự tạo một GPU server.

Đặt reverse proxy HTTPS cho API NeMo (Next.js cần truy cập `/ready`) và WSS cho gateway `/speech`. API NeMo giữ cơ chế Bearer; gateway giữ kiểm tra ticket/origin. Cấu hình Next.js trên Vercel và gateway với cùng `NEMOTRON_GATEWAY_SECRET`, địa chỉ backend, và `NEMOTRON_API_KEY`. Cấu hình `NEMOTRON_WEBSOCKET_URL` trên Vercel thành địa chỉ **wss://** công khai của gateway. Không công khai cổng NeMo thiếu xác thực. Địa chỉ `127.0.0.1` trên Vercel không trỏ về laptop của bạn.

## Phạm vi và kiểm tra

Danh mục chọn đầu vào có 31 locale dùng ngay theo model card (bỏ `hi-IN`), gồm `vi-VN` và `ja-JP`. Các ngôn ngữ chỉ dành cho adaptation như tiếng Thái không xuất hiện trong danh mục. Phiên hiện dùng `verbatim`, dấu câu tự động; không tải model phân biệt người nói nên gán Speaker thủ công. Không có phí API STT theo phút; vẫn có chi phí phần cứng/hosting và chi phí model dịch, tóm tắt hoặc ảnh nếu sử dụng.

Kiểm tra tự động:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Các test Nemotron bao gồm hủy phiên, PCM/resampling, chữ tạm/chữ cuối, commit khi dừng, đổi model, tạm dừng/tiếp tục, cập nhật khoảng nghỉ, bảo vệ ticket/origin/replay và giữ khóa server. Kiểm tra âm thanh thật cần runtime đang chạy; test trình duyệt Nemotron nằm trong `scripts/nemotron-browser-smoke.cjs` và dùng sample WAV riêng để không gọi API dịch trả phí.

Sau `npm run build`, giữ `npm run speech:nemotron` chạy, mở `node scripts/serve-fixture.cjs` ở terminal khác rồi chạy `npm run test:nemotron:browser`. Test tải WAV JFK từ repo NVIDIA nếu cache chưa có, chạy STT thật và mô phỏng dịch/cloud. Server fixture bind `127.0.0.1:3100`, dùng tài khoản test và ngăn nạp các khóa AI/cloud thật. Ảnh cùng kết quả nằm trong `test-results/nemotron/`. Đây là kiểm tra đường đi của âm thanh và dữ liệu; không phải phép đo chất lượng tiếng Việt/Nhật.

Nguồn: [model card NVIDIA](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b), [NeMo-Speech.cpp](https://github.com/NVIDIA/NeMo-Speech.cpp), [API v0.2.0](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.2.0/docs/api.md). Bản GGUF được ghim tại revision `ea30d66debe3740a08b573244286791d423d6b3e`; checksum model `3fc991d3badad7277c11030a7519832cddaf2057aafed6d4b25147e953a070b1`.
