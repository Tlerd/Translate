# Nghiên cứu hội thoại hai chiều

Kiểm tra tài liệu Google ngày 03/10/2026. Đợt sửa hiện tại chưa thêm chế độ hội thoại hoặc phát giọng dịch. Đề xuất bước đầu là hai nút **A nói / B nói**, với hai ngôn ngữ chọn trước.

| Phương án | Cách vận hành | Lợi ích | Điểm cần kiểm chứng |
|---|---|---|---|
| Hai nút lượt A/B | A dùng ngôn ngữ A → B; B dùng B → A. Người dùng chọn lượt trước khi nói. | Chiều dịch rõ; dùng lại ASR, scheduler và bản ghi toàn buổi hiện có. | Chốt/drain lượt trước khi đổi; giữ timestamp trên timeline chung; không mất câu đến muộn. |
| Tự nhận ngôn ngữ rồi đảo chiều | Nhận mã ngôn ngữ của lượt nói, chọn chiều theo cặp đã cấu hình. | Ít thao tác. | Câu ngắn, tên riêng, ngôn ngữ giống nhau và câu trộn ngôn ngữ có thể nhận sai. Cần hiển thị chiều, cho sửa và fallback nút A/B; cần đo độ chính xác bằng audio người thật. |
| Gemini Live Translate | Luồng audio vào → audio dịch ra; dùng model riêng của Google. | Có giọng dịch trực tiếp. | Một ngôn ngữ đích mỗi phiên; hai chiều cần điều phối đổi phiên hoặc hai luồng có lọc. Cần chống micro thu lại tiếng loa, ngắt phát, reconnect và kiểm soát chi phí. |

Gemini `gemini-3.5-live-translate-preview` hỗ trợ hơn 70 ngôn ngữ. Cấu hình phiên đặt `targetLanguageCode`; `echoTargetLanguage` chỉ lặp lại hoặc im lặng với lời đã ở ngôn ngữ đích, không tự đảo chiều. Vì vậy việc đổi đích/tách hai luồng là đề xuất điều phối của ứng dụng, cần thử thực tế. [Hướng dẫn Live Translate](https://ai.google.dev/gemini-api/docs/live-api/live-translate).

Giá trả phí công bố xấp xỉ 0,0053 USD/phút đầu vào và 0,0315 USD/phút đầu ra. Một giờ audio vào và một giờ audio ra: `60 × (0,0053 + 0,0315) = 2,208 USD`, khoảng **2,21 USD**. Thời lượng hội thoại trên đồng hồ khác thời lượng audio bị tính phí; hai luồng hoặc thu lại tiếng loa có thể tăng chi phí. [Bảng giá Google](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-live-translate).

Phương án A/B nên giữ một MediaRecorder xuyên suốt. Mỗi lượt lưu `speakerSide`, `sourceLanguage`, `targetLanguage`, `startMs`, `endMs` cùng chữ gốc/bản dịch; scheduler nhận snapshot chiều của lượt để kết quả A đến muộn không bị dịch theo chiều B. Nút đổi lượt chốt nhận giọng cũ và drain kết quả, sau đó cấu hình ASR cho lượt mới; không tạo lại recorder. Đây là thiết kế cho đợt sau, chưa đổi schema câu trong đợt này.

Nếu thử Live Translate sau đó: audio vào PCM mono 16 kHz, audio ra mono 24 kHz; token tạm `v1beta` do server cấp và khóa model/chiều dịch. Model chỉ hỗ trợ audio đầu vào và không hỗ trợ system instructions/tools. [Cấu hình và token](https://ai.google.dev/gemini-api/docs/live-api/live-translate#use-ephemeral-tokens-in-client-side-applications).

Nghiệm thu bước A/B bằng các lượt Nhật → Việt → Nhật, lời cuối đến muộn, chuyển lượt nhanh, nói chồng, mất mạng, quay lại sau nghỉ và mở bản ghi ở thiết bị khác. Chỉ chuyển sang tự nhận ngôn ngữ khi có tập thử người thật và tỷ lệ lỗi chiều chấp nhận được.
