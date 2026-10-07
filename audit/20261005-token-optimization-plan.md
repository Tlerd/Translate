# Kế hoạch tối ưu token dịch và kiểm chứng chất lượng

Phạm vi: ba vấn đề của báo cáo mới — dịch sớm, giới hạn ngữ cảnh và prompt ngắn. Đây là kế hoạch, chưa phải thay đổi mã hoặc triển khai.

## 1. Sửa hành vi và lời mô tả trước

- Giữ dịch sớm tắt mặc định. Sửa mô tả trong Cài đặt: dịch sớm ưu tiên độ trễ; có thể tăng request, lặp prompt/ngữ cảnh và dịch lại khi ASR sửa nội dung.
- Quy định `translationHistoryTurns = N` là số cặp nguồn/bản dịch tối đa được gửi trong mỗi request, áp dụng cho final, segment và remainder. Với N = 0, không gửi lịch sử, kể cả các đoạn cùng câu đã dịch.
- Khi N > 0, ưu tiên các đoạn gần nhất của câu hiện tại rồi bổ sung lượt trước trong phần hạn mức còn lại; giữ thứ tự thời gian, không vượt 6 cặp và ngân sách 6.000 ký tự đã có. Không gửi toàn bộ caption hiện tại lần nữa như lịch sử của chính nó.
- Mỗi cặp nguồn/bản dịch của một đoạn cùng câu cũng chiếm một lượt trong N. Chưa gom đoạn để tránh làm lựa chọn N có nghĩa khác nhau giữa các loại request; chỉ xét gom sau nếu phép đo chứng minh cần thiết.
- Dùng cùng một hàm chọn ngữ cảnh cho ba loại request. Đo và ghi số lượt thực sự được gửi sau khi server cắt ngân sách.
- Kiểm tra stream còn hiệu lực theo loại job: final cần nguồn tương đương; segment/remainder cần khớp đúng phần đã cam kết. Không dùng `includes()` để suy ra câu chốt cũ còn đúng nghĩa khi ASR thêm phủ định.
- Không tự đổi lựa chọn 0–6 đã lưu của người dùng. Chỉ quyết định mặc định cho cài đặt mới sau đánh giá chất lượng.

Tệp chính: translation-scheduler.ts, stable-segmenter.ts, ai-settings.tsx, prompts/translation.ts.

Điều kiện đạt: kiểm thử N = 0, 1, 2, 6 cho final/segment/remainder; thay đổi N giữa buổi; bản nhận dạng sửa phủ định; final đến khi segment đang chạy; Pause/Stop và stream cũ; dịch sớm tắt tạo 0 request nháp, một câu chốt không đổi chỉ tạo một request.

## 2. Khôi phục quy tắc chất lượng bằng prompt gọn

- Giữ prompt ngắn và payload văn bản thuần. Không cố đạt một số ký tự/token bằng mọi giá.
- Bổ sung ngắn gọn: không bịa cách đọc tên riêng; giữ mơ hồ; không đoán phần câu thiếu; chỉ dịch câu hiện tại, không dịch lại lịch sử.
- Giữ bảo vệ trước mệnh lệnh nằm trong lời nói và giữ phủ định, số lượng, đơn vị, mức lịch sự, dấu [không nghe rõ].
- Sửa tên/comment kiểm thử đang gọi số ký tự là số token hoặc khẳng định 0 overhead cho mọi request.
- Chuẩn bị khoảng 40–60 ca Nhật–Việt, có thể thêm chiều Việt–Nhật nếu sản phẩm sử dụng: chủ ngữ bị lược bỏ, đại từ, tên chưa biết cách đọc, phủ định, số/ngày/đơn vị, câu dang dở, câu mơ hồ, lặp có ý nghĩa và prompt injection. Dùng tiêu chí chấm nghĩa; không chỉ so một chuỗi dịch duy nhất.
- So prompt trước rút gọn, hiện tại và đề xuất trên cùng model, cấu hình thinking và dữ liệu. Ca tên riêng/mơ hồ cần người biết ngôn ngữ kiểm tra; không coi model tự chấm là bằng chứng duy nhất.

Điều kiện đạt: các lỗi trọng yếu như đảo phủ định, sai số lượng, bịa tên/chi tiết hoặc thực thi mệnh lệnh trong câu nói không xuất hiện trong bộ ca đã duyệt. Báo cáo phạm vi kiểm tra, không suy rộng thành bảo đảm cho mọi hội thoại.

## 3. Đo tiết kiệm trước/sau có thể tái lập

- Tạo bộ replay snapshot ASR có interim, final, sửa dấu câu, sửa nội dung và đoạn nói dài. Chạy qua scheduler thật với runner mock để so số request, văn bản và lịch sử thực tế được gửi.
- Cố định cùng đầu vào, model, thinking, số câu ngữ cảnh và cách chốt câu khi so các phiên bản. So riêng: prompt cũ/mới, N = 0/2/6, dịch sớm tắt/bật.
- Dùng countTokens của đúng model để đo đầu vào gồm system và payload; không dùng ký tự/4 hoặc tokenizer khác model để khẳng định số token. Đo offline chỉ được ghi là kích thước/số request, không ghi thành token chính xác.
- Với bộ đánh giá gọi model, lấy usage thực tế cho input/output/thinking/cache và trạng thái completed/failed/aborted. Không coi hủy request hoặc thiếu metadata là miễn phí.
- Báo cáo theo toàn bộ một đoạn hội thoại: tổng request, input, output, thinking, chi phí ước tính, độ trễ và lỗi nghĩa. Không chỉ đo một request có prompt ngắn.
- Gọi provider chỉ trong lượt đo có chủ đích; không thêm countTokens vào mọi request live. Giới hạn số ca và ngân sách lượt đo, ghi phiên bản model và ngày đơn giá. Không dùng lời nói riêng của người dùng cho fixture mặc định.

Điều kiện đạt: kết quả có thể tái chạy, tách số đo thực/ước tính/chưa biết, và không công bố % tiết kiệm tổng trước khi có số đo so sánh.

## 4. Dashboard và xác nhận phát hành

- Dashboard vẫn là chi phí dịch ước tính, không phải tổng hóa đơn provider. Hiển thị độ đầy đủ metadata; thiếu usage không được diễn đạt thành 0 chi phí thực.
- Ghi phiên bản prompt/cấu hình ngữ cảnh vào metadata nếu cần so dữ liệu trước/sau, không ghi nội dung câu nói/bản dịch vào bảng usage.
- Kiểm tra cách tính cached input và thinking theo provider; tách nội dung báo cáo token khỏi quy tắc giá, không lấy input rate thường cho mọi loại cache nếu provider có đơn giá khác.
- Đề xuất trải nghiệm ban đầu: dịch sớm tắt; đánh giá 2 lượt ngữ cảnh để cân bằng nghĩa và token. Không áp dụng mặc định mới trước khi có kết quả so N = 0/2/6.
- Chạy regression liên quan và lint/typecheck/test/build. Trước triển khai, kiểm tra bản build/commit thực tế; sau triển khai đối chiếu một phiên có kiểm soát. Kế hoạch này không tự triển khai.

Thứ tự: (1) hành vi/ngữ cảnh + kiểm thử → (2) prompt/fixture → (3) đo token và nghĩa → (4) chọn mặc định và phát hành. Effort high phù hợp cho sửa và đánh giá; max chỉ cần nếu xuất hiện race condition khó tái hiện hoặc kết quả chất lượng mâu thuẫn.

## Quyết định chốt và cách dùng CLI

- Phạm vi sửa trước: giới hạn ngữ cảnh, tính hợp lệ của job/stream và chống request lặp; sau đó prompt và độ tin cậy của thống kê. Giữ payload văn bản thuần cùng nhãn Context/Text.
- Phần đo thực gọi model là bước riêng, không chạy trong lượt lập kế hoạch này. Khi đo tác động của prompt phải giữ cùng dữ liệu, model, thinking và ngữ cảnh.
- Có thể dùng `agy --mode plan --effort high` để rà soát; khi thực hiện mã, giao cùng repository và kế hoạch, giới hạn phạm vi, yêu cầu kết quả diff + lệnh kiểm thử + lỗi còn lại. Agent chính đọc diff và chạy kiểm tra độc lập trước khi báo hoàn thành.
- Không để hai agent cùng sửa các tệp này đồng thời. Phiên CLI không mặc nhiên nhận toàn bộ hội thoại ở đây; kế hoạch và chỉ dẫn giao việc là thông tin đầu vào của nó.
- Điều kiện hoàn thành phần sửa: regression bắt được lỗi trước sửa rồi đạt sau sửa; kiểm tra dự án đạt; phân biệt rõ những gì đã đo với phần chất lượng/chi phí còn chưa xác nhận. Bước chốt kế hoạch không tự commit hoặc triển khai.

Kiểm tra CLI thực tế: máy có agy.exe và codex.exe. Đã gọi agy với `--mode plan --effort high --print-timeout 90s`; CLI trả thông báo hết thời gian khi turn còn đang chạy và chưa trả nội dung review. Vì vậy không coi đây là một review đã hoàn thành hoặc một lần sửa mã thành công. Kế hoạch chốt ở trên do agent chính lập dựa trên mã và kiểm thử đã kiểm tra.

## Trạng thái thực hiện theo yêu cầu ngày 05/10/2026

- Đã sửa mã phần 1: giới hạn lịch sử cho tất cả loại request, chống stream cũ/job trùng, xử lý final giữa segment và fallback khi segment lỗi/timeout.
- Phần 2: đã bổ sung prompt v2, sửa mô tả ký tự/token, tạo 48 ca cùng tiêu chí nghĩa; chưa gọi model và chưa duyệt ngôn ngữ.
- Phần 3: đã chạy replay baseline/hiện tại và 432 dòng so kích thước prompt offline. countTokens dừng do local thiếu GOOGLE_API_KEY; 0 provider calls. Công cụ đo thật đã có, chưa có bằng chứng token/chi phí/chất lượng thực.
- Phần 4: đã sửa tính cache/thinking, đánh dấu usage chưa đủ, ghi prompt_version, cải thiện Dashboard. Không đổi mặc định N=6; không commit hoặc đưa lên production.
- Kiểm thử toàn dự án: 54 file, 374 tests đạt; lint, typecheck và production build đạt. Postgres/provider thật và phiên sau phát hành còn chờ.
- Báo cáo: [20261005-token-optimization-implementation.md](D:/idea/may-dich-offline/audit/20261005-token-optimization-implementation.md). Hướng dẫn chạy đo: [translation-evaluation.md](D:/idea/may-dich-offline/web/scripts/translation-evaluation.md).

## Cập nhật sau kiểm chứng production ngày 06/10/2026

Các mục “chưa kiểm chứng/chưa triển khai” phía trên phản ánh thời điểm báo cáo cũ. Đã phát hành commit a509e901027d471622a9d39959bc45810b20f380 (prompt v6); 375 tests cùng lint/typecheck/build đạt. Đã đo 144 lượt provider thật trên website và đối soát request/input/output khớp persistence Postgres qua Dashboard; thêm 18 lượt so model/thinking. Giữ mặc định N=6, giữ lựa chọn người dùng N=0 và dịch sớm tắt vì vẫn còn lỗi tên, chủ ngữ và lặp; chưa có duyệt ngôn ngữ bởi con người.

Báo cáo cuối và dữ liệu thật: [20261006-production-token-verification.md](20261006-production-token-verification.md). Báo cáo này phân biệt chi phí theo token, tổng Dashboard và hóa đơn Google.
