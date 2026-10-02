# Máy Dịch Lớp Học & Đọc (Web Responsive Rebuild)

Ứng dụng web responsive (Next.js App Router + TypeScript) dịch sát nút lời nói trong lớp học, ghi âm lưu trữ cục bộ, tóm tắt tổng quan bài giảng và tạo ảnh minh họa theo yêu cầu.

## 1. Kiến trúc & Quyết định cốt lõi

### Hai phần sản phẩm độc lập
1. **Phần A: Dịch sát nút (Live Translation):**
   - Ưu tiên model chi phí thấp, phản hồi nhanh theo từng cụm câu nói.
   - Nhận giọng bằng **Web Speech API** (SpeechRecognition) trên trình duyệt.
   - Ghi âm đồng thời từng chunk vào IndexedDB (Dexie) bằng **MediaRecorder**.
   - Chữ gốc hiện ngay; các delta SSE cập nhật bản dịch khi request còn chạy. Scheduler giữ tối đa 1 request dịch đang chạy, gộp các bản chữ tạm và giữ hàng đợi câu đã chốt. Chỉ chữ tạm bị thay thế/quá hạn; các câu đã chốt được xử lý đầy đủ theo thứ tự.
   - Hai chế độ thu: `lecture` (giảng bài: ngắt câu theo ngữ đoạn) và `readingPractice` (luyện đọc: ghép các đoạn nhận giọng đến khi hết khoảng nghỉ đã chọn).
   - **Khoảng nghỉ để chốt câu:** mặc định 0,9 giây ở cả hai chế độ theo lựa chọn người dùng; điều chỉnh 0,6–2 giây khi giảng bài, 0,6–10 giây khi luyện đọc. Giá trị được lưu cục bộ qua lần tải lại.
   - Khi bấm **Kết thúc buổi**, micro dừng và ứng dụng chờ dữ liệu âm thanh/chữ cuối cùng, dịch nốt câu đã chốt rồi lưu. Nút báo **Đang kết thúc…** trong thời gian chờ. Lỗi dịch giữ chữ gốc và bản dịch tạm, hiển thị trạng thái lỗi.

2. **Phần B: Tóm tắt rồi tạo ảnh (Summary & Image Generation):**
   - Dùng model phân tích chất lượng cao, **bắt buộc khác model dịch của Phần A** (server kiểm tra và trả lỗi `AI_MODEL_ROLE_CONFLICT` nếu cấu hình trùng model).
   - Chỉ chạy khi người dùng bấm nút **Tóm tắt**; chỉ hỗ trợ một preset **Mặc định** duy nhất.
   - Trích xuất tiêu đề, đoạn tổng quan và các đề mục có dẫn nguồn `captionIds` chuẩn xác từ transcript đã lưu.
   - Nút **Chỉnh sửa kịch bản** mở popup sửa từng dòng và tìm/thay thế. **Hủy** không ghi dữ liệu; **Lưu** giữ số câu và thời gian, đánh dấu bản dịch cũ cần cập nhật. Tóm tắt cũ hiển thị cảnh báo và nút **Tạo lại** dùng bản ghi đã sửa. Ảnh minh họa cũ chỉ hiện nếu khớp nguồn hiện tại.
   - **Tạo ảnh:** Bước sau của phần B, có model sinh ảnh riêng (Google Gemini Flash Image / OpenAI Images). Chỉ tạo ảnh khi người dùng chủ động bấm sau khi đã có bản tóm tắt.

### Nhận giọng và người nói

Web hỗ trợ `gemini-3.5-transcribe-live` qua WebSocket, `gemini-3.5-transcribe` qua Interactions API và `gemini-3-flash-preview` qua Generate Content API. Flash nhận WAV theo đoạn (khoảng nghỉ hoặc tối đa khoảng 15 giây), dùng cùng `GOOGLE_API_KEY` và gửi audio inline, không cần upload lên Files API. Flash dùng prompt nguyên văn/smart, mức suy luận minimal; gán Speaker thủ công và lấy thời gian từ đoạn thu âm, không dùng cấu hình phiên âm chuyên biệt của Transcribe. Bảng giá Standard Flash: audio vào 1 USD / 1 triệu token (≈0,00192 USD/phút), text prompt vào 0,50 USD / 1 triệu token, chữ ra gồm thinking 3 USD / 1 triệu token. Không có giá tổng cố định theo phút.

Live hỗ trợ verbatim/smart; chưa có diarization trực tiếp, nên gán Speaker thủ công hoặc chạy phân biệt lại sau buổi verbatim (thêm phí API). Phiên Live tự gia hạn trước giới hạn 10 phút. Tại **Cấu hình AI** (`/settings`), chọn:

- **Verbatim** (mặc định): giữ nguyên lời nói, từ đệm và lặp từ; nhận nhãn người nói cùng timestamps trong cùng lượt API.
- **Smart**: làm sạch và định dạng lời nói; Google không hỗ trợ diarization hoặc timestamps ở chế độ này. Gán người nói thủ công cho từng câu sau khi kết thúc buổi.
- **Số người nói 1–8** (bắt buộc): giới hạn danh sách nhãn Speaker của ứng dụng. Google tự phát hiện giọng; API không có tham số ép số người nói. Từ 3 người trở lên đang ở mức thử nghiệm.

Nhãn tự động có phạm vi từng đoạn audio, nên Speaker 1 ở hai đoạn có thể là hai giọng khác nhau. Sau buổi verbatim, có thể bấm **Phân biệt lại người nói** để phân tích toàn buổi (audio cục bộ ≤4 MB, ≤30 phút; thêm một lượt API). Nhãn thủ công, chế độ và số người nói được lưu vào bản ghi và đồng bộ chữ lên cloud.

**Lưu cài đặt** cập nhật controller ngay qua `settingsUpdatedEvent`, không cần tải lại trang. Audio đang chờ được chốt bằng cấu hình cũ, các đoạn kế tiếp dùng cấu hình mới. Cấu hình Live được giữ lại; Web Speech cũ chuyển sang Transcribe. Đổi bộ nhận diện hoặc mode Live sẽ chốt phiên cũ rồi mở phiên mới, dùng chung micro đang thu.

Tham khảo [hướng dẫn phiên âm Google](https://ai.google.dev/gemini-api/docs/transcribe) và [bảng giá Google](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-transcribe). Ước tính theo đoạn là 0,005 USD/phút (5 giờ ≈1,50 USD), Live là 0,009 USD/phút (5 giờ ≈2,70 USD), chưa gồm dịch, tóm tắt, ảnh hay xử lý lại; phí thực tế dựa trên token.

## 2. Hướng dẫn chạy và kiểm thử Local

### Cài đặt dependencies
```bash
cd web
npm install
```

### Chạy kiểm thử tự động
```bash
# Kiểm tra type TypeScript
npm run typecheck

# Kiểm tra lint
npm run lint

# Chạy toàn bộ unit & integration tests
npm test

# Build production
npm run build
```

### Kiểm thử trình duyệt bằng Playwright

```powershell
# Terminal 1
npm run dev -- --hostname 127.0.0.1 --port 3100

# Terminal 2
npm run test:browser
```

Script sử dụng Playwright có trong project hoặc runtime Codex. Nếu máy khác chưa có:

```powershell
npm install --save-dev playwright
npx playwright install chromium
npm run test:browser
```

Có thể đặt `BASE_URL` nếu dùng cổng khác; `PLAYWRIGHT_MODULE_PATH`/`PLAYWRIGHT_CHROMIUM_EXECUTABLE` để chỉ định runtime. Kết quả và ảnh popup nằm trong `test-results/browser/`. Các test trình duyệt chạy ứng dụng và IndexedDB thật, mô phỏng micro/nhận giọng/AI ở ranh giới API. Chúng không chứng minh độ chính xác nhận giọng, tốc độ API thật hay độ ổn định sau 60 phút ghi âm thật. Test 500 snapshot chỉ chứng minh thứ tự và số câu. Xem [báo cáo kiểm tra](NGHIEM-THU.md).

### Chạy dev server
```bash
npm run dev
# Mở trình duyệt tại http://localhost:3000
```

## 3. Cấu hình biến môi trường (`.env.local`)

Tham khảo mẫu tại `.env.example`:
```dotenv
# Key chung cho hai provider; chỉ điền provider sẽ sử dụng
GOOGLE_API_KEY=
OPENAI_API_KEY=

# Tùy chọn: key riêng cho tóm tắt/ảnh nếu muốn tách hạn ngạch
SUMMARY_GOOGLE_API_KEY=
SUMMARY_OPENAI_API_KEY=
IMAGE_GOOGLE_API_KEY=
IMAGE_OPENAI_API_KEY=

# Model mặc định
AI_TRANSLATION_MODEL=google:gemini-3.5-flash-lite
AI_SUMMARY_MODEL=google:gemini-3.8-flash
AI_IMAGE_MODEL=google:gemini-3.1-flash-image
AI_IMAGE_ENABLED=false

# Đăng nhập: AUTH_SECRET và OWNER_EMAIL bắt buộc khi production;
# AUTH_GOOGLE_ID/SECRET cần để đăng nhập Google.
AUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
OWNER_EMAIL=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

*Lưu ý an toàn:* Không commit file `.env.local` hoặc bất kỳ secret key nào lên GitHub repository.

Guard giải mã và kiểm tra hạn token Auth.js cùng email chủ tài khoản; cookie/header tùy ý không cấp quyền. Production thiếu cấu hình xác thực trả lỗi và không gọi AI. Local development chỉ bỏ xác thực khi cả `AUTH_SECRET` và `OWNER_EMAIL` đều chưa cấu hình. Mở `/api/auth/signin` để đăng nhập Google; email đã xác minh phải khớp `OWNER_EMAIL`.

Các adapter không tự tạo kết quả giả khi thiếu API key. Test offline mock SDK rõ ràng. Gemini tạo ảnh native qua `interactions.create`, theo [hướng dẫn Google](https://ai.google.dev/gemini-api/docs/image-generation).

## 4. Danh mục Model được hỗ trợ

| Model Key | Nhiệm vụ cho phép | Ghi chú |
|---|---|---|
| `google:gemini-3.5-flash-lite` | `translate` | Mặc định đề xuất cho dịch sát nút chi phí thấp |
| `openai:gpt-4o-mini` | `translate` | Lựa chọn dịch tiết kiệm từ OpenAI |
| `google:gemini-3.8-flash` | `summarize` | Mặc định đề xuất cho tóm tắt tổng quan |
| `google:gemini-3.1-flash-image` | `image` | Mặc định sinh ảnh minh họa |
| `openai:gpt-image-2.5-sunburst` | `image` | Lựa chọn sinh ảnh qua OpenAI Images API |

## 5. Dữ liệu bản ghi & Chuyển đổi từ APK Flutter cũ

- **Lưu trữ cục bộ:** Sử dụng Dexie (IndexedDB), bao gồm các bảng: `recordings`, `audioChunks`, `captions`, `summaries`, `images`, `settings`.
- **Nhập/Xuất:**
  - Hỗ trợ xuất và nhập file bundle Web (`.json` + audio `.webm`/`.mp4`).
  - Hỗ trợ nhập trực tiếp dữ liệu từ app APK cũ: `conversation.json` + `conversation.wav`, tự động quy đổi số sample (16 kHz) sang millisecond (`ms = round(sample / 16)`).

## 6. Triển khai Vercel & Phát hành GitHub

- **GitHub Repository:** `https://github.com/Tlerd/Translate`
- **Root Directory:** `web`
- **Vercel Production URL:** `https://translate-psi-khaki.vercel.app/`
- **Quy trình:**
  Mọi commit đẩy lên nhánh `main` của repository GitHub sẽ tự động kích hoạt tiến trình build và deploy trên Vercel theo thiết lập Git integration.
