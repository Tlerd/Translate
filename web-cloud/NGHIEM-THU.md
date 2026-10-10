# Kết quả sửa và kiểm tra — 30/09/2026

Đã triển khai các sửa đổi tại `web`, giao phần triển khai cho GPT-6-Luna và kiểm tra lại toàn bộ ở luồng tích hợp. Khoảng nghỉ chốt câu luyện đọc mặc định **0,9 giây**, theo lựa chọn của người dùng.

## Kế hoạch và kết quả

| Hạng mục | Thay đổi | Bằng chứng |
|---|---|---|
| 1. Audio cuối khi Dừng | Chờ sự kiện `stop`, nhận `dataavailable` cuối và chờ các lần ghi IndexedDB; đổi epoch sau khi xử lý xong dữ liệu hợp lệ. | Test tái hiện mất chunk đã đỏ trước sửa, sau sửa qua; Playwright xác nhận audio cuối tồn tại sau Dừng. |
| 2. Chốt câu theo khoảng nghỉ | Nối controller với việc đóng câu; giữ thanh chỉnh khoảng nghỉ, lưu thiết lập qua lần tải lại. Kết quả ASR muộn sửa đúng dòng cũ, giữ những đoạn khác trong câu. | Test controller/assembler và Playwright kiểm tra chốt theo khoảng nghỉ, Dừng, kết quả muộn không tạo dòng trùng. |
| 3. Dịch trực tiếp đầy đủ | Chữ gốc hiện ngay, delta SSE cập nhật UI trước khi request hoàn tất. Giữ hàng đợi câu chốt; coalesce các bản tạm/các revision của cùng câu. Lỗi giữ chữ và bản dịch tạm, báo failed; stream hủy truyền signal tới provider. | Test hàng đợi ba câu khi API bận đã đỏ trước sửa; test chia SSE ở từng byte UTF-8, lỗi/abort, done rồi error, request/stream cancel và trình duyệt đã qua. |
| 4. Guard | Xác minh token mã hóa Auth.js, hạn dùng và email chủ tài khoản; Google sign-in yêu cầu email đã xác minh. Production thiếu cấu hình từ chối gọi AI. | Test dùng token tạo bằng Auth.js thật: header tùy ý, cookie không liên quan/sai, token sửa/hết hạn, sai chủ bị từ chối; session hợp lệ được chấp nhận. |
| 5. Bằng chứng test | Bổ sung assertion cho stale snapshot; sửa tên test 500 snapshot để mô tả đúng phạm vi. Bỏ kết quả giả tự động trong runtime Google/OpenAI; fixture chỉ nằm ở test SDK. | 57 test qua, 11 kiểm tra Playwright qua. Không coi 500 snapshot là một giờ thu âm hoặc chứng minh không tăng bộ nhớ. |
| 6. Ảnh Gemini | Dùng native `interactions.create` với `gemini-3.1-flash-image`, đọc `output_image.data`; kiểm tra ảnh rỗng/MIME/safety và lỗi provider. | Đối chiếu [tài liệu Google](https://ai.google.dev/gemini-api/docs/image-generation) và kiểu SDK đã cài; SDK contract test kiểm tra đúng method/payload và chuẩn hóa ảnh fixture hợp lệ. Chưa gọi Google thật vì chưa có API key. |
| Popup theo ảnh tham khảo | Cửa sổ trắng, nền mờ, dòng đánh số, tìm/thay thế, đóng/Hủy/Lưu; khóa sửa khi đang thu. Lưu tăng revision, giữ ID/thời gian/bản dịch cũ và báo tóm tắt cần tạo lại. | Playwright kiểm tra keyboard focus, Escape/Hủy, câu rỗng, tìm/thay thế, Lưu/tải lại, tạo lại dùng chữ/hash mới, viewport desktop và 390×844. |
| Giữ bản ghi cũ | Sửa khóa caption từ `id` thành `[recordingId+id]`; sao chép sang store `captionItems` mới trước khi bỏ bảng cũ. | Test giữ câu #1 của hai bản ghi độc lập, nâng database v1 và mở lại giữ đủ dữ liệu. Dữ liệu đã bị ghi đè trong bản cũ không thể khôi phục từ migration. |

## Lệnh đã chạy thành công

```powershell
npm run lint
npm run typecheck
npm test -- --reporter=dot
npm run test:browser
npm run build
```

- **Unit/integration:** 11 file, **57/57 test qua**.
- **Playwright:** **11/11 kiểm tra qua**, không có lỗi JavaScript chưa xử lý. Đây là ứng dụng/DOM/IndexedDB thật với micro, SpeechRecognition và phản hồi AI được mô phỏng tại ranh giới.
- **Lint:** không lỗi hoặc cảnh báo từ ESLint.
- **TypeScript:** qua.
- **Production build:** qua, tạo đầy đủ trang và API routes.
- **API local thật khi thiếu key:** `/api/translate` trả SSE `error` về `GOOGLE_API_KEY`, không trả bản dịch giả hoặc sự kiện `done` thành công.

Ảnh và kết quả Playwright:

- [Popup desktop](test-results/browser/popup-desktop.png)
- [Popup điện thoại](test-results/browser/popup-mobile.png)
- [Kết quả JSON](test-results/browser/results.json)

Trong fixture cuối, chữ gốc hiện sau 49 ms và delta đầu sau 98 ms; AI được cố ý trì hoãn hoàn tất tới 1.200 ms. Số này kiểm chứng UI không chờ sự kiện hoàn tất, **không phải** đo tốc độ dịch từ Google/OpenAI.

## Phạm vi chưa kiểm chứng

Môi trường hiện chưa cấu hình Google/OpenAI API key và OAuth chủ tài khoản. Do đó chưa kiểm tra đăng nhập Google qua trình duyệt, chất lượng/tốc độ dịch và ảnh bằng API thật. Bộ test xác minh token và adapter bằng dữ liệu hợp đồng, không thay thế phép thử nhà cung cấp thực tế.

Chưa chạy phiên micro thật liên tục 60 phút hay đo bộ nhớ một phiên thật. Không cam kết bộ nhận giọng sẽ nhận đúng 100% mọi từ; sửa đổi này ngăn các lỗi bỏ dữ liệu trong pipeline đã tái hiện. Trước khi nghiệm thu hiệu năng thực tế, cấu hình key và chạy bài đọc có số, tên riêng, phủ định, nghỉ ngắn và bấm Dừng giữa câu; đối chiếu âm thanh, chữ gốc và toàn bộ bản dịch. Chạy một phiên 60 phút và ghi lại RAM/heap, độ trễ cùng lỗi nhận giọng/API nếu nghiệm thu yêu cầu thời lượng đó.

## Chạy lại Playwright

Máy hiện có Playwright và Chromium, không cần cài thêm. Script tự tìm project package/runtime Codex và trình duyệt đã có.

```powershell
# Terminal 1
npm run dev -- --hostname 127.0.0.1 --port 3100

# Terminal 2
npm run test:browser
```

Nếu chạy trên máy chưa cài:

```powershell
npm install --save-dev playwright
npx playwright install chromium
npm run test:browser
```

Chi tiết cấu hình và guard có trong [README](README.md). Các sửa đổi đang ở workspace để xem xét; chưa đẩy lên GitHub hoặc triển khai website.
