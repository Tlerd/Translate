# Kiểm chứng provider, Postgres và bản phát hành tối ưu dịch

Ngày thực hiện: 05–06/10/2026, múi giờ Việt Nam. Đây là phép đo trên production bằng Computer Use, với dữ liệu tổng hợp; không dùng nội dung các buổi học riêng làm fixture và không sao chép API key về máy.

## Phạm vi và bằng chứng

- Website: https://translate-ruby-phi.vercel.app. Google key tồn tại ở server Vercel; phép thử gọi `/api/translate` qua giao diện có đăng nhập.
- Model cố định: `google:gemini-3.1-flash-lite`, thinking `minimal`. Mỗi cấu hình 0/2/6 dùng cùng câu nguồn và cùng sáu cặp lịch sử tổng hợp; ca tham chiếu đặt lịch sử liên quan ở cuối.
- Bổ sung màn hình thử ngữ cảnh và event SSE `usage`: request ID, phiên bản prompt, số cặp thực gửi, token được provider báo cáo. Không chứa key, lời nói hay bản dịch trong event usage.
- Đã xác nhận persistence/readback Postgres qua ứng dụng: sau 60 lượt v2, tổng request tăng 80 → 140; nhóm `test_connection` tăng 1 → 61. Trước bộ v6, nhóm này có 287 request, input 49.755, output 3.154. Đây là kiểm chứng pipeline database thật qua Dashboard, không phải truy vấn trực tiếp console SQL.
- 375 kiểm thử / 54 file, lint, TypeScript và production build đã qua. Kiểm thử tự động dùng mock provider/database; phép thử UI thật được báo riêng.

## Các lỗi tìm được và sửa bằng dữ liệu thật

- v2: tự chọn cách đọc tên `東海林`/`生田`, tự thêm giới tính. Dừng sau 60 lượt.
- v3: đã hạn chế giới tính nhưng vẫn phiên âm tên dù chưa xác định cách đọc. Dừng sau 42 lượt.
- v4: bộ 48 ca × 0/2/6 = 144 lượt cho thấy tên được giữ nguyên, nhưng một số câu mệnh lệnh bị thực thi/refuse thay vì dịch; chiều Việt→Nhật cũng có lỗi chỉ trả `OK`. Có một lượt bổ sung ngoài ma trận khi sửa trạng thái bộ chạy, đã lưu riêng, không loại chi phí của nó khỏi đối soát.
- v5: cả 21 lượt mệnh lệnh được dịch đúng dạng câu nói; vẫn có một lượt `小鳥遊` bị dịch nghĩa thành “Tiểu Điểu Du” ở N=2. Dừng sau 39 lượt để bổ sung quy tắc chép nguyên tên, không dịch nghĩa.
- v6: prompt gộp quy tắc tên cá nhân, giữ mơ hồ/chủ ngữ thiếu, mệnh lệnh là lời nói. Payload văn bản thuần luôn có khối `Text:` trích dẫn, kể cả N=0. Overhead là có thật; không gọi việc bỏ JSON là “0 token cú pháp”.

Prompt Nhật→Việt v6: **717 ký tự**, so với prompt gốc 1.173 và lean-v1 374. Đây là ký tự, không phải token. V6 dài hơn lean-v1 để khắc phục lỗi quan sát được. Chưa đo token gốc bằng cùng provider nên không công bố % giảm token do riêng system prompt.

## Quyết định cấu hình

- Giữ dịch sớm tắt mặc định. N=0 không gửi lịch sử; mọi request final/segment/remainder tuân thủ N và ngân sách lịch sử.
- Giữ lựa chọn đã lưu của người dùng: N=0, dịch sớm tắt. Các phép thử ngữ cảnh không ghi đè cài đặt buổi học.
- Giữ N=6 cho cài đặt mới trong đợt phát hành này. Bộ ca ngắn không kiểm tra đủ tham chiếu xa và tiêu chí ngôn ngữ chưa được người biết Nhật/Việt duyệt. N=2 là phương án tiết kiệm có thể chọn, chưa được chứng minh là mặc định tối ưu cho mọi hội thoại.
- Đánh giá nghĩa do Codex/AI thực hiện theo rubric, **không phải duyệt bởi người bản ngữ**. Không coi số ca vượt qua là bảo đảm model không bao giờ dịch sai.

## Trạng thái bộ đo cuối

Commit v6 `a509e901027d471622a9d39959bc45810b20f380` đã push và deployment production đã READY. Bộ đo 48 câu × 3 mức ngữ cảnh đã hoàn tất, 144 request ID khác nhau.

| Số câu ngữ cảnh | Request | Input token | Output token | USD ước tính theo token báo cáo | Thời gian hoàn tất trung bình |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 | 48 | 8.394 | 509 | $0.002862 | 951 ms |
| 2 | 48 | 9.936 | 500 | $0.003234 | 1.049 ms |
| 6 | 48 | 12.336 | 496 | $0.003828 | 1.014 ms |

Trong bộ dữ liệu tổng hợp này, N=2 giảm **19,5% input token** và **15,5% chi phí ước tính** so với N=6. Tổng ma trận: 30.666 input, 1.505 output, $0.009924. Không suy rộng tỷ lệ này cho mọi buổi học và không quy phần giảm này cho riêng system prompt.

Đối soát Postgres qua Dashboard: `test_connection` tăng **287 → 431** request, input **49.755 → 80.421**, output **3.154 → 4.659**. Cả ba chênh lệch khớp chính xác ma trận. Sau 18 lượt so model/thinking, nhóm này đạt **449 request**, input **84.165**, output **4.880**, thinking được báo cáo **1.355**. Tất cả thử nghiệm, gồm các phiên bản prompt trước, ước tính **$0.03066355**. Dashboard tổng có thêm bản ghi khác, hiển thị 528 request và khoảng $0.04; không nhầm số đó với riêng chi phí thử nghiệm.

## Chất lượng còn hạn chế và so model

Đánh giá AI phát hiện các vấn đề còn lại ở v6:

- `names-1`: N=2 trả nguyên câu Nhật, N=6 đọc `小鳥遊` thành Takanashi trái quy tắc giữ nguyên tên.
- `ambiguity-fragments-4`: N=0/N=2 tự thêm chủ ngữ đang chờ là “tôi”/“họ”.
- `politeness-repetition-1`: N=0/N=2 bỏ một lần lặp có ý nghĩa.
- Hai trường hợp cần người biết ngôn ngữ xem thêm: N=2 thêm “một cái” và “quý khách” khi nguồn không xác định rõ.

Không quan sát lỗi nghiêm trọng trong nhóm phủ định, số/đơn vị và câu chứa mệnh lệnh trong lần đo này. Đây không phải chứng nhận tất cả 144 bản dịch đạt chất lượng.

So thêm 6 ca khó cho mỗi cấu hình: 3.1 `low` tốn $0.0024585 và báo cáo 1.355 thinking token, nhưng vẫn có câu tên riêng không được dịch; 3.5 `minimal` và `low` lần lượt $0.0005494/$0.0005619, vẫn tự chọn cách đọc tên và có trường hợp thêm chủ ngữ. Thinking không được báo cáo cho các lượt 3.5, không coi là chắc chắn bằng 0. Mẫu nhỏ chưa đủ để đổi model mặc định; giữ 3.1 `minimal`, lựa chọn người dùng N=0, dịch sớm tắt. Duyệt Nhật/Việt bởi con người vẫn chưa thực hiện.

## Dữ liệu tái kiểm tra

- `20261005-production-v2-results.json`, `20261005-production-v3-results.json`.
- `20261006-production-v4-results.json`, `20261006-production-v5-results.json`.
- `20261006-production-v6-results.json`: toàn bộ 144 kết quả và metadata request/token/thời gian.
- `20261006-production-model-comparison.json`: 18 lượt so model/thinking.
- `20261006-production-verification-summary.json`: số liệu tổng hợp, đối soát và quyết định cấu hình.
- `20261006-production-usage-proof.jpg`: ảnh Dashboard thật sau kiểm chứng, gồm cả bản ghi khác.
- `20261006-translation-offline-v6.json`: 432 dòng kích thước đầu vào, 0 provider calls; không phải token thật hay đánh giá chất lượng.
- `../web/scripts/translation-evaluation.md`: cách đo offline/count/generate và cách đo qua website khi key chỉ ở server.

Chi phí là ước tính dịch theo metadata token đã nhận, không phải hóa đơn tổng Google. Không gồm audio, thuế, lưu trữ cache hay dịch vụ khác; thiếu báo cáo thinking/cache không được gọi là bằng chứng chắc chắn bằng 0.
