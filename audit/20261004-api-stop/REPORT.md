# Kiểm tra Dừng API và kết thúc buổi — 04/10/2026

## Kết luận theo bằng chứng

Buổi chính đã ngừng tạo bản dịch quanh phút thứ 2, trong khi ghi âm tiếp tục đến khi kết thúc. Không thấy request dịch chạy liên tục trong hơn 5 phút chờ kết thúc. Việc số tiền tăng sau thao tác dừng phù hợp nhất với chi phí đã phát sinh được Google cập nhật muộn, cộng với phần chốt câu cũ và một phiên thu riêng được mở sau đó. Chưa có trace WebSocket trực tiếp từ iPhone tại thời điểm người dùng bấm dừng, nên không khẳng định đã chứng minh mọi kết nối trên mọi thiết bị đều đóng.

## Buổi đã đối chiếu

- Website: https://translate-ruby-phi.vercel.app
- Recording ID: `16236675-6883-4c52-b3ae-2bf66b973ebf`.
- Người dùng xác nhận bấm Dừng API từ phút 2, rồi kết thúc/lưu khoảng 5 phút sau.
- Metadata đã đồng bộ: tạo lúc 23:48:17.553 ngày 03/10/2026; kết thúc lúc 23:56:01.782; thời lượng audio 462.100 ms (7 phút 42 giây); state `stopped`. Giờ trong báo cáo dùng Asia/Saigon, GMT+7. Thời lượng có thể lệch nhẹ với createdAt vì tính từ lúc micro sẵn sàng.
- 14 câu; câu cuối bắt đầu ở 119.906 ms (01:59), kết quả cuối có endMs 125.011 ms (02:05). Mốc kết quả cuối có thể bao gồm thời gian chốt nhận giọng; không dùng nó để khẳng định có audio mới sau click.

## Log production thực tế

Đọc dashboard Vercel của project `translatees`, workspace `group4's projects`. Lọc riêng request path, không nhầm request đồng bộ với AI. Timeline được đọc chứa cả buổi học và khoảng sau kết thúc, đến khoảng 00:07 ngày 04/10.

- Request dịch cuối: `POST /api/translate`, 200, lúc **23:50:25.521 ngày 03/10**.
- Request ID: `7zqbp-1791046225521-59c5c669062b`.
- Function thực thi 521 ms; response hoàn tất 694 ms. Không phải request chạy kéo dài đến khi kết thúc buổi.
- User-Agent của request này là iPhone Safari (iOS 16.7.16), không phải request thử do phiên kiểm tra này tạo.
- External API: `gemini-3.1-flash-lite:streamGenerateContent`.
- Deployment: `dpl_2X8s2aorsa8ZixWv6c6qrVaGC86h`, production, branch main. Không xác nhận commit source của deployment qua connector: connector Vercel trả 404/không thấy project; bằng chứng log lấy trực tiếp từ dashboard đã đăng nhập.
- Không thấy request dịch sau 23:50:25 trong timeline đã đọc, bao gồm hơn 5 phút trước khi buổi chính đóng lúc 23:56:01.
- Token của buổi chính được cấp lúc 23:48:19.75. Không có token mới trong khoảng chờ từ phút 2 đến khi đóng buổi.
- Có token riêng lúc **23:58:29.61**. IndexedDB có buổi khác `7d46fa7d-5c92-4927-bf4b-00bf3828245d`: tạo 23:58:27.274, kết thúc 23:58:33.270, audio 3.720 ms, state `stopped`. Đây là một lần bắt đầu khác sau khi buổi chính đóng, có thể phát sinh chi phí riêng.

## Kiểm tra tab Chrome đang mở

- Sau khi buổi chính đã đóng, Chrome không có instance WebSocket còn sống trong trang kiểm tra.
- Kiểm tra heap không có instance micro track, AudioContext hoặc MediaRecorder còn giữ lại. Trang /app hiển thị Sẵn sàng.
- Theo dõi Network chỉ thấy request đọc đồng bộ chữ/audio, xác thực và tải trang; không thấy /api/translate hoặc /api/speech mới trong khoảng quan sát ban đầu.
- Hai endpoint đồng bộ /api/recordings/sync và /api/recordings/audio vẫn được hỏi định kỳ. Chúng không phải lời gọi Gemini nhận giọng/dịch; cần phân biệt với chi phí Google trong ảnh.
- Các kết quả runtime này áp dụng cho tab Chrome kiểm tra; không thay thế phép đo trực tiếp micro/socket trên iPhone.

## Số tiền và độ trễ Google

- Trang Spend ban đầu hiển thị **38.569đ / 68.000đ**, trùng số cao nhất trong ảnh người dùng.
- Sau khi tải lại trang Spend trong phiên kiểm tra, số vẫn là **38.569đ**.
- Google ghi rõ độ trễ xử lý dữ liệu tính phí khoảng 10 phút. Biểu đồ tổng chi phí có thể cập nhật muộn đến 24 giờ. Không suy ra API đang chạy chỉ từ việc tổng tiền tăng sau click.
- Nguồn chính thức: https://ai.google.dev/gemini-api/docs/billing#processing-times và https://ai.google.dev/gemini-api/docs/billing#project-spend-caps.

## Luồng dừng trong mã hiện tại

Local HEAD khi kiểm tra: `f9dcd67`. Đọc repository AGENTS.md. Codebase-memory MCP không được cung cấp trong bộ công cụ phiên này; dùng rg và đọc file làm phương án thay thế.

- `web/src/features/recording/controller.ts`: pauseApiInternal đặt pausing, chặn PCM, xóa queue/pre-roll, xóa timer nhận giọng; recognizer cũ chốt kết quả ở nền, UI chuyển paused. MediaRecorder vẫn thu toàn buổi theo yêu cầu sản phẩm.
- `web/src/features/recording/gemini-live-recognition.ts`: stop ngừng nhận PCM, gửi audioStreamEnd, chờ tối đa 5 giây cho kết quả cuối rồi close socket. Vì vậy Dừng API không có nghĩa mọi công việc/cước đã nhận trước đó biến mất ngay tại click.
- `web/src/features/recording/gemini-transcribe-recognition.ts`: chế độ theo đoạn chốt audio đã thu và xử lý queue, giới hạn chờ kết quả cuối 20 giây. Không tạo audio mới khi paused.
- `controller.ts` stopInternal: chặn PCM và timer; dừng PCM capture; dừng recorder và micro tracks; lưu endedAt/state stopped; chờ recognizer và dịch các câu đã nhận; đóng scheduler. Không tự động gửi toàn bộ file ghi âm vào Gemini khi lưu audio.
- `web/src/features/recording/audio-recorder.ts`: stop gọi track.stop sau khi chốt MediaRecorder; `gemini-pcm-capture.ts` ngắt processor/source và đóng AudioContext.

## Kiểm chứng

Hai nhóm kiểm tra chạy thành công, tổng 77 test tại các phần liên quan. API/provider đều mock; phiên kiểm tra không bắt đầu buổi thu mới hay gọi AI tính phí để thử.

```text
npm test -- --run tests/controller-pause.test.ts tests/gemini-live-recognition.test.ts tests/gemini-transcribe-recognition.test.ts tests/speech-recognition-regression.test.ts
Test Files  4 passed (4)
Tests       33 passed (33)

npm test -- --run tests/controller-google.test.ts tests/controller.test.ts tests/translate-route.test.ts tests/speech-transcribe-route.test.ts tests/audio-recorder.test.ts
Test Files  5 passed (5)
Tests       44 passed (44)
```

Các test kiểm tra PCM không được gửi khi pause, socket thực sự được close trong recognizer, callback cũ không hồi sinh phiên, ngừng capture trước khi chờ kết quả cuối, hủy provider request và chốt câu/audio cuối. Không tái hiện được lỗi gửi âm thanh/dịch liên tục sau dừng. Do không có trace thời điểm click trên iPhone, không suy đoán thành lỗi đã xác nhận và không sửa source/deploy trong lần kiểm tra này.

## Bằng chứng đã lưu

- [Log request dịch cuối](last-translation.jpg).
- [Chi phí sau tải lại](billing.jpg).

Chỉ tạo báo cáo và ảnh bằng chứng trên máy. Không sửa source ứng dụng, dữ liệu bản ghi, cấu hình billing; không commit, push hay deploy.
