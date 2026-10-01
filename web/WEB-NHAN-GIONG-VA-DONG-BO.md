# Sửa nhận giọng và đồng bộ web — 01/10/2026

## Nguyên nhân đã xác định

- Web cũ dùng Web Speech của trình duyệt để nhận giọng. GOOGLE_API_KEY chỉ được dùng cho dịch/tóm tắt/ảnh; nạp tiền cho key không cải thiện trực tiếp phần nhận giọng cũ.
- Các result index nhận giọng đồng thời bị gom dưới một ID, có thể khiến câu cuối đến muộn sửa nhầm dòng. Đã tách ID theo kết nối và result index, kiểm tra revision và giữ lịch sử của câu đã chốt.
- Chữ, bản dịch và tóm tắt trước đây chỉ nằm trong IndexedDB của từng trình duyệt. Chúng không thể tự xuất hiện trên thiết bị khác nếu chưa có cloud.
- Bố cục flex/chiều cao màn hình làm vùng phụ đề quá nhỏ trên điện thoại. Đã sửa vùng cuộn, min-height, chiều cao viewport và các điều khiển khi đang thu.

## Luồng nhận giọng mới

Mặc định dùng Gemini 3.5 Transcribe Live ở chế độ VERBATIM. Server giữ Google key, cấp token ngắn hạn dùng một lần; trình duyệt gửi PCM mono 16 kHz qua WebSocket. MediaRecorder và PCM dùng cùng một luồng micro. Web Audio được mở từ thao tác bấm nút để phù hợp iOS.

Chữ tạm và bản dịch từng phần được cập nhật ngay khi nhận dữ liệu. Câu đã chốt giữ ID; kết quả nhận giọng cuối chỉ sửa đúng câu đó. Khoảng nghỉ mặc định vẫn là 0,9 giây, có thể chỉnh. Mô hình dịch không được dùng để thay chữ gốc.

Phiên Google được nối lại trước giới hạn 10 phút. Audio chờ kết nối được giới hạn 10 giây; mất kết nối lâu hơn báo rõ nguy cơ thiếu chữ trực tiếp, audio vẫn được lưu tại máy. Khi Dừng, recorder lưu chunk cuối, nhận giọng chờ tối đa 5 giây cho kết quả cuối, rồi chốt dịch và lưu.

Thanh điều khiển có mức mic, trạng thái bật/tắt/ngắt/tạm dừng, tên đầu vào khi hệ điều hành cung cấp, thời lượng PCM đã thu, số kết quả và độ trễ đến phần dịch đầu tiên. Nút Bật lại micro phục hồi AudioContext bị tạm dừng. Cấu hình có nút Kiểm tra API nhận giọng để kiểm tra key/quyền và kết nối model thật.

Phân biệt người nói (speaker diarization) chạy sau khi Dừng, từ audio tại thiết bị: tối đa 4 MB và 30 phút. Nhãn dựa trên chú thích người nói/thời gian do Google trả về; câu có giọng chồng nhau có thể không được gán. Bước này giữ nguyên chữ đã lưu. Gemini Live hiện chưa hỗ trợ diarization trực tiếp.

## Đồng bộ chữ

Cloud dùng Neon Postgres khi DATABASE_URL/POSTGRES_URL được cấu hình. Chỉ gửi metadata, chữ, bản dịch và tóm tắt; audio và ảnh không đồng bộ. Tự chạy mỗi 30 giây, khi có mạng/trở lại tab và khi bấm nút Đồng bộ.

Danh sách cloud phân trang chỉ tải ID/version; chỉ bản mới hoặc đã thay đổi mới tải nội dung. Các lần ghi kiểm tra version. Sửa cùng lúc trên hai máy tạo bản sao xung đột; chỉnh sửa trong lúc tải không bị ghi đè. Khi cloud chưa được cấu hình hoặc có lỗi, UI báo trạng thái và giữ dữ liệu trên máy. Việc kích hoạt Neon cần hoàn tất bước chấp nhận điều khoản và chọn gói.

## Kiểm tra đã chạy

- 103 kiểm thử Vitest: nhận giọng theo ID/revision; kết quả cuối đến muộn; reconnect; PCM bị tạm dừng; lỗi khi Dừng; sourceHistory; token và diarization; xác thực; race/xung đột cloud; phân trang hơn 1.000 bản ghi.
- TypeScript, ESLint và Next.js production build đạt.
- Playwright: popup sửa chữ/lưu/tóm tắt lại; chữ và SSE trước khi hoàn tất; khoảng nghỉ 0,9 giây; audio cuối; bảo toàn dữ liệu; ô gốc/dịch ở 320×568 và 360×800; trang công khai, đăng nhập, cookie giả/sai chủ/hết hạn và đăng xuất.
- Các kiểm tra trình duyệt dùng microphone/AI fixtures. Thời gian từ fixtures không đại diện cho độ trễ Google hoặc lớp học thật. Chưa kiểm tra trực tiếp phần cứng iPhone/Realme C3 hay ghi âm 60 phút; không khẳng định đã đo bộ nhớ 60 phút.

## Kiểm tra mic trong lớp

Đặt điện thoại gần người nói, thử một đoạn ngắn và nghe lại audio ở cùng vị trí. Nếu audio nghe lại nhỏ/khó hiểu, cần cải thiện khoảng cách hoặc đầu vào trước. Nếu audio rõ nhưng PCM/kết quả nhận giọng dừng, xem trạng thái mic, mạng và kiểm tra API trong Cấu hình.

Chưa đủ bằng chứng để kết luận mic iPhone hỏng hoặc cần mua khử ồn. Nếu cần mic ngoài, chọn loại tương thích cổng iPhone, đặt gần người nói và kiểm tra đầu vào thực tế; với Bluetooth cũng phải thử bản thu vì đường âm thanh tùy hệ điều hành/trình duyệt. Máy quá nóng có thể tăng thời gian xử lý, nhưng chưa có phép đo để quy lỗi này cho nhiệt độ.

Tài liệu gốc: [Google Live Transcription](https://ai.google.dev/gemini-api/docs/live-api/live-transcribe), [giới hạn Transcribe/diarization](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe), [Apple: nhiệt độ iPhone](https://support.apple.com/118431), [Apple: ghi âm và mic tương thích](https://support.apple.com/guide/iphone/iph4d2a39a3b/ios).

Phạm vi lần sửa này là web. Chưa chỉnh app local Realme C3; mã nguồn mobile không được đưa lên Git.
