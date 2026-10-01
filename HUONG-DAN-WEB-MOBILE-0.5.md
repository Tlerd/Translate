# Model và bản Android 0.5

Đối chiếu tài liệu Google ngày 30/09/2026. Giá Standard trả phí, USD; giá text tính trên một triệu token vào/ra, không phải giá mỗi lần dịch.

| Thứ tự sử dụng | Model API | Giá vào / ra | Effort |
|---|---|---|---|
| Dịch mặc định, cân bằng tốc độ và chất lượng | `gemini-3.1-flash-lite` | $0.25 / $1.50 | minimal, low, medium, high |
| Dịch tiết kiệm, tài khoản cũ còn được Google hỗ trợ | `gemini-2.5-flash-lite` | $0.10 / $0.40 | tắt thinking hoặc budget theo mức hỗ trợ |
| Ảnh mặc định, tiết kiệm | `gemini-3.1-flash-lite-image` — Nano Banana 2 Lite | khoảng $0.0336 / ảnh 1K | minimal, high |
| Ảnh nhiều lựa chọn độ phân giải | `gemini-3.1-flash-image` — Nano Banana 2 | khoảng $0.067 / ảnh 1K | minimal, high |
| Ảnh đời cũ, chỉ để nhận diện cấu hình cũ | `gemini-2.5-flash-image` — Nano Banana | khoảng $0.039 / ảnh 1024px | không |

Nano Banana đời cũ ngừng hoạt động ngày 02/10/2026 nên không dùng cho bản ghi mới. Giá ảnh chưa tính token đầu vào và phần văn bản/thinking. Quota trong ảnh AI Studio là hạn mức của tài khoản, không phải bảng giá hoặc bảo đảm tốc độ. Effort cao có thể tăng thời gian và token; dịch trực tiếp nên bắt đầu ở minimal hoặc tắt thinking.

## Nguồn

- [Giá Google Gemini](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)
- [Thinking](https://ai.google.dev/gemini-api/docs/thinking)
- [Tạo ảnh native Gemini](https://ai.google.dev/gemini-api/docs/image-generation)

## Key trên Android

Mã nguồn mobile hiện nằm trong thư mục `app/` (Flutter). Cài APK, mở thiết lập AI, chọn Google và dán Gemini API key của mình. Key được lưu bằng `flutter_secure_storage` trên thiết bị; không nhúng key vào APK, mã nguồn hoặc bản xuất transcript. Web tiếp tục dùng key phía server trên Vercel.

Web bật tạo ảnh bằng biến server `AI_IMAGE_ENABLED=true`. Các mức suy luận của Gemini 2.5 được đổi thành budget: thấp 512, vừa 8192, cao 24576 token. Chế độ tự động dùng mặc định của model. Giá và effort không phải cam kết mọi câu sẽ có chất lượng hoặc thời gian giống nhau.

Khoảng nghỉ chốt câu mặc định 0,9 giây. Cho phép chỉnh theo cách đọc. Dùng bản ghi thật để kiểm tra micro và nhận dạng trên điện thoại vì test giả lập không chứng minh độ chính xác lời nói hay độ trễ mạng thực tế.

## Kiểm tra web ngày 01/10/2026

- TypeScript và ESLint qua; production build qua.
- 59/59 test unit/integration qua. SDK contract kiểm tra riêng budget Gemini 2.5, thinking level Gemini 3.1 và các trường native Interactions tạo ảnh 1K; hạn chế tài khoản được báo lỗi, không tự đổi model.
- 12/12 kiểm tra Playwright qua trên production build, gồm thứ tự model, effort theo model và lưu sau tải lại; popup sửa chữ; streaming trước khi hoàn tất; Dừng giữ câu/audio cuối; kết quả nhận dạng muộn.
- Các kiểm tra Playwright dùng phản hồi micro/STT/AI giả lập ở ranh giới; không coi thời gian fixture là độ trễ API thật.
- Git commit `30c47c8` đã triển khai production trên Vercel: `dpl_8uo8HS7u4ksxHorNbG46M5NpZX6w`, trạng thái Ready. Đã gọi Google thật qua UI: Gemini 3.1 Flash-Lite với effort minimal trả tóm tắt có dẫn nguồn; Nano Banana 2 Lite với effort minimal trả ảnh hiển thị và nút tải ảnh.
- Kiểm tra thật Gemini 2.5 Flash-Lite trả HTTP 404 với key hiện tại: Google báo không còn mở model cho người dùng mới. Giữ lựa chọn có nhãn tài khoản cũ; dùng Gemini 3.1 Flash-Lite trên tài khoản hiện tại. Giá có trong tài liệu không có nghĩa mọi key đều được quyền gọi model.
