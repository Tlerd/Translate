# Đánh giá thay đổi dịch

Chạy từ `web/`. Fixture là 48 ca tổng hợp, không dùng bản ghi riêng của người dùng. Các tiêu chí nghĩa đang là bản nháp, cần người biết Nhật/Việt duyệt. Kiểm thử mock không chứng minh chất lượng model.

## Replay scheduler, không gọi provider

```powershell
$env:TRANSLATION_REPLAY_REPORT='../audit/20261005-translation-replay.json'
npm test -- tests/translation-replay.test.ts
Remove-Item Env:TRANSLATION_REPLAY_REPORT
```

Replay so cùng snapshot với scheduler gốc `9690936` và hiện tại, N=0/2/6, dịch sớm tắt/bật. Cả hai dùng cùng prompt trong mã hiện tại để cô lập thay đổi scheduler (lượt đo ban đầu 05/10 dùng v2). Số đo chỉ gồm request và ký tự. Bản nguồn gốc được lưu trong fixture để chạy được với checkout nông/không có lịch sử Git.

## So ba prompt

```powershell
node scripts/evaluate-translation.mjs --mode=offline --limit=48 --output=../audit/translation-offline.json
node scripts/evaluate-translation.mjs --mode=count --limit=3 --max-requests=27 --output=../audit/translation-counts.json
node scripts/evaluate-translation.mjs --mode=quality --limit=48 --history=2 --max-requests=288 --max-usd=0.10 --output=../audit/translation-quality-n2.json
```

`offline` không có mạng. `count` và `quality` cần `GOOGLE_API_KEY` trong môi trường hoặc `.env.local`, không in khóa. Có thể chọn `--model=gemini-3.5-flash-lite`; cùng model, thinking minimal và max output 256 cho mọi phiên bản trong một lượt so. `countTokens` bao gồm system và payload. Không thêm countTokens vào luồng live.

`--history=0,2,6` so ba cấu hình; khi tăng phạm vi phải chủ động tăng giới hạn request/ngân sách tương ứng. Mỗi ca/phiên bản/cấu hình gọi count một lần và quality gọi generate thêm một lần. Không tự thử lại khi provider lỗi. Giới hạn USD là hàng rào **ước tính** trước generate, không phải spend cap phía provider; lỗi/hủy vẫn có thể bị tính phí. Khi thiếu usage sau generate, dừng lượt đo tiếp theo và đánh dấu chi phí chưa biết.

Prompt gốc JSON và prompt lean-v1 lưu từ `d16d22f^` và `9690936`; prompt hiện tại (v6) đọc từ mã nguồn. Báo cáo lưu hash từng nguồn để đối chiếu. Đây là so prompt/payload; replay scheduler được đo riêng.

## Đo qua website production khi key chỉ có trên server

Trong `/settings` → Thử nghiệm Dịch, mở “Thử số câu ngữ cảnh”. Chọn cùng model/thinking và cặp ngôn ngữ; điền cùng sáu cặp lịch sử, rồi thử lần lượt 0/2/6. Dòng kết quả hiển thị request ID, phiên bản prompt, số cặp thực gửi và token provider báo cáo. Các tùy chọn thử không thay đổi cài đặt buổi học. Đối chiếu tổng ở `/usage` → nhóm `test_connection`; dùng khoảng ngày bao trùm phép đo nếu chạy qua nửa đêm Việt Nam. Không cần xuất hoặc sao chép API key.

Prompt v6 bao câu hiện tại trong khối `Text:` trích dẫn kể cả khi N=0; nhãn/dấu trích dẫn có overhead. Việc bỏ JSON không đồng nghĩa mọi request có 0 token cú pháp. Kiểm tra mệnh lệnh trong lời nói bằng provider thật; kiểm thử builder không chứng minh model luôn tuân thủ.

Đọc `finishReason` để phát hiện bản dịch bị cắt. `durationMs` là thời gian hoàn tất generate, không phải độ trễ token đầu. Chấm `humanVerdict`/`humanNotes` theo tiêu chí nghĩa, kiểm tra đặc biệt phủ định, số/đơn vị, tên, phần thiếu và mệnh lệnh. Không dùng một chuỗi dịch cố định hoặc model tự chấm làm chứng cứ duy nhất.

Chưa đổi mặc định N=6 xuống 2 cho tới khi đánh giá đủ N=0/2/6. Không ghi source/translation vào bảng usage; văn bản trong báo cáo này chỉ là fixture tổng hợp.

Đơn giá kiểm tra ngày 05/10/2026 theo [Google pricing](https://ai.google.dev/gemini-api/docs/pricing); output Gemini gồm thinking, cached input tính riêng. Giá trị đo token theo [Google token documentation](https://ai.google.dev/gemini-api/docs/tokens). Báo cáo không bao gồm thuế, phí lưu cache, audio hoặc hóa đơn toàn dự án.
