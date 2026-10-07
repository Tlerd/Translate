# Kết quả triển khai mã tối ưu dịch — 05/10/2026

Đã sửa trong checkout local `D:/idea/may-dich-offline`. Chưa commit hay đưa lên website production.

## Hành vi đã sửa và kiểm chứng

- Một hàm chọn lịch sử cho final/segment/remainder. N=0 gửi 0 cặp; mọi request tối đa N, không vượt 6. Đoạn cùng caption chiếm một cặp và được ưu tiên trước các lượt cũ. Server tiếp tục cắt lịch sử theo ngân sách 6.000 ký tự và ghi số cặp thực gửi.
- Dịch sớm tắt mặc định, giữ cài đặt đã lưu. Tắt giữa buổi xóa timer và job segment đang chờ. Mô tả nói rõ dịch sớm có thể tăng request và dịch lại khi ASR sửa.
- Final đến khi segment đang chạy chờ kết quả còn hợp lệ, rồi tái dùng hoặc dịch đúng remainder. Đoạn lỗi/timeout khi final đã đến chuyển sang một job toàn câu; không lặp tự động khi job final lỗi.
- Job final/remainder phải tương đương toàn nguồn tương ứng. Segment phải khớp prefix và phần đã cam kết. Không dùng `includes()` cho final. Không coi `can.` → `cannot` hay `できる。` → `できるわけではない` là chỉ thêm remainder.
- Tái tính đoạn chưa dịch sau khi stream kết thúc, không gửi lại đoạn đang chạy; xử lý khoảng trắng giữa nhiều đoạn; cập nhật đúng revision cuối.
- Regression N=0/1/2/6, thay đổi N lúc job chờ, tám đoạn liên tiếp, final giữa stream, lỗi/timeout, tắt dịch sớm, stream muộn sau close và sửa nghĩa đã đạt. Regression mới trước sửa có 7 ca thất bại, sau sửa đạt.

## Prompt và thống kê

- Prompt v2 giữ mơ hồ, không đoán phần thiếu/cách đọc tên, giữ phủ định/số/đơn vị/lặp có nghĩa, dịch mệnh lệnh thay vì làm theo, và không dịch lại lịch sử. Giữ payload văn bản thuần.
- Nhật→Việt: prompt gốc 1.173 ký tự, lean-v1 374, v2 426. V2 thêm 52 ký tự để bảo vệ chất lượng; đây **không phải** số token. Chưa tuyên bố 73 token hoặc % giảm tiền.
- Bảng usage thêm `prompt_version` qua migration `ADD COLUMN IF NOT EXISTS`; bản cũ mang `legacy-unknown`. Không lưu lời nói/bản dịch. Migration/persistence đã thử bằng mock, chưa thử trên Postgres thật.
- Thu thập usage cuối stream OpenAI, tách reasoning khỏi completion để tránh đếm đôi. Thiếu input hoặc output được đánh dấu unavailable, giữ số token từng phần đã có.
- Tính input cache riêng khỏi input thường; thinking tính output một lần. Giá cache /1M token: 3.1 Lite $0.025, 3.5 Lite $0.03, 3.8 Flash $0.075; [nguồn Google, kiểm tra 05/10/2026](https://ai.google.dev/gemini-api/docs/pricing). Không gồm lưu cache, thuế hay audio.
- Bucket chỉ có request thiếu usage hiện chi phí chưa biết thay vì $0. Dashboard ghi độ đầy đủ metadata, chi phí của phần ghi nhận và khả năng thiếu bản ghi. Trung bình input chỉ dùng các request có metadata đầy đủ.

## Đo đã chạy

- [Replay](20261005-translation-replay.json): cùng một hội thoại tổng hợp, N=0/2/6, early off/on, scheduler `9690936` và hiện tại dùng cùng prompt v2. Dịch sớm tắt: 4 request; bật: 6 request vì có cả segment/remainder và ASR sửa nghĩa. Tám nháp đầu: 0 request. Kết quả đo ký tự/request, không phải token/chi phí.
- Ở N=0 + early bật: tổng system+payload giảm 2.898 → 2.653 ký tự trong fixture. Ở N=2/6 early bật, tổng có thể tăng so baseline vì code cũ chỉ gửi một lượt trước thay vì tuân thủ N. Không khẳng định mọi cấu hình đều tiết kiệm hơn; dùng N=0/2 và tắt early khi ưu tiên chi phí.
- [Offline prompt comparison](20261005-translation-offline.json): 48 ca × 3 prompt × N=0/2/6 = 432 dòng, 0 provider calls. Đây là kích thước đầu vào, không phải đánh giá bản dịch thật.
- [Lượt countTokens](20261005-translation-token-counts.json): dừng vì local thiếu `GOOGLE_API_KEY`, 0 provider calls, 0 dòng đo token. Chưa có input/output/thinking/token tiết kiệm thực hoặc bản dịch để người biết ngôn ngữ duyệt.
- Công cụ đo có giới hạn số request, ngân sách ước tính, timeout; dừng khi usage chưa biết; không tự retry. [Hướng dẫn](../web/scripts/translation-evaluation.md).

## Kiểm tra và phần còn chờ

- `npm test`: 54 file, **374 tests đạt**, provider/database mock.
- Lint, typecheck, production build đạt; xem lượt xác nhận cuối trong kế hoạch.
- Chưa kiểm chứng provider thật, Postgres thật hoặc website đã triển khai. Cần cấu hình key ở môi trường đo và duyệt các tiêu chí/bản dịch bằng người biết Nhật/Việt.
- Mặc định ngữ cảnh vẫn 6; chưa chọn 2 làm mặc định khi chưa có bằng chứng chất lượng. Quyết định thay đổi mặc định và phát hành nằm sau bước đánh giá.

## Cập nhật sau kiểm chứng production ngày 06/10/2026

Các mục “chưa kiểm chứng/chưa triển khai” phía trên phản ánh thời điểm báo cáo cũ. Đã phát hành commit a509e901027d471622a9d39959bc45810b20f380 (prompt v6); 375 tests cùng lint/typecheck/build đạt. Đã đo 144 lượt provider thật trên website và đối soát request/input/output khớp persistence Postgres qua Dashboard; thêm 18 lượt so model/thinking. Giữ mặc định N=6, giữ lựa chọn người dùng N=0 và dịch sớm tắt vì vẫn còn lỗi tên, chủ ngữ và lặp; chưa có duyệt ngôn ngữ bởi con người.

Báo cáo cuối và dữ liệu thật: [20261006-production-token-verification.md](20261006-production-token-verification.md). Báo cáo này phân biệt chi phí theo token, tổng Dashboard và hóa đơn Google.
