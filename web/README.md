# Máy Dịch Lớp Học & Đọc (Web Responsive Rebuild)

Ứng dụng web responsive (Next.js App Router + TypeScript) dịch lời nói trong lớp học, lưu audio toàn buổi trên máy và tự đồng bộ lên cloud, tóm tắt bài giảng và tạo ảnh minh họa theo yêu cầu.

## 1. Kiến trúc & Quyết định cốt lõi

### Hai phần sản phẩm độc lập
1. **Phần A: Dịch sát nút (Live Translation):**
   - Ưu tiên model chi phí thấp, phản hồi nhanh theo từng cụm câu nói.
   - Nhận giọng bằng Gemini 3.5 Transcribe, Gemini 3.5 Transcribe Live (có dịch) hoặc Soniox; dịch theo luồng SSE.
   - Một **MediaRecorder** chạy liên tục từ đầu đến cuối buổi, lưu chunk vào IndexedDB (Dexie). **Dừng API** chỉ ngừng gửi audio mới; micro vẫn ghi, các câu đã nhận tiếp tục dịch.
   - Kết thúc buổi: worker Mediabunny chuẩn hóa metadata, timestamp và chỉ mục tua, kiểm chứng file rồi tự đưa vào hàng đợi upload private Blob. Một trình phát và nút **Tải toàn buổi** dùng thời lượng file thực; thời gian buổi học được hiển thị riêng nếu khác. Bản gốc trên máy được giữ.
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

**Nemotron 3.5 ASR + NeMo-Speech.cpp** đã có trong ô chọn **Nhận giọng**, dùng WebSocket với máy chủ riêng. Hỗ trợ 32 locale dùng ngay, gồm Việt và Nhật, không cần huấn luyện lại; phần dịch chữ vẫn dùng model dịch đã chọn. Xem [hướng dẫn cài, chạy GPU/CPU và kết nối web đã deploy](docs/NEMOTRON-STT.md).

Web hỗ trợ `gemini-3.5-transcribe-live` qua Live API WebSocket và `gemini-3.5-transcribe` qua Interactions API theo đoạn. Gemini chỉ dùng thế hệ 3.5: Gemini 3 Flash Live (`gemini-3.1-flash-live-preview`) đã bỏ, cấu hình cũ `google-flash`/`google-flash-live` tự chuyển sang Gemini 3.5 Transcribe. Dừng ngắt thu PCM ngay; Live chờ kết quả cuối tối đa 5 giây, Transcribe theo đoạn tối đa 20 giây rồi hủy phần nhận giọng còn chờ (audio vẫn lưu). Đoạn im lặng không được gửi đi phiên âm.


Live hỗ trợ verbatim/smart; chưa có diarization trực tiếp, nên gán Speaker thủ công hoặc chạy phân biệt lại sau buổi verbatim (thêm phí API). Phiên Live tự gia hạn trước giới hạn 10 phút. Tại **Cấu hình AI** (`/settings`), chọn:

- **Verbatim** (mặc định): giữ nguyên lời nói, từ đệm và lặp từ; nhận nhãn người nói cùng timestamps trong cùng lượt API.
- **Smart**: làm sạch và định dạng lời nói; Google không hỗ trợ diarization hoặc timestamps ở chế độ này. Gán người nói thủ công cho từng câu sau khi kết thúc buổi.
- **Số người nói 1–8** (bắt buộc): giới hạn danh sách nhãn Speaker của ứng dụng. Google tự phát hiện giọng; API không có tham số ép số người nói. Từ 3 người trở lên đang ở mức thử nghiệm.

Nhãn tự động có phạm vi từng đoạn audio, nên Speaker 1 ở hai đoạn có thể là hai giọng khác nhau. Sau buổi verbatim, có thể bấm **Phân biệt lại người nói** để phân tích toàn buổi (file đã chuẩn hóa trên máy hoặc tải từ cloud ≤4 MB, thời lượng thực ≤30 phút; thêm một lượt API). Nhãn thủ công, chế độ và số người nói được lưu vào bản ghi và đồng bộ chữ lên cloud.

**Lưu cài đặt** cập nhật controller ngay qua `settingsUpdatedEvent`, không cần tải lại trang. Audio đang chờ được chốt bằng cấu hình cũ, các đoạn kế tiếp dùng cấu hình mới. Cấu hình Live được giữ lại; Web Speech cũ chuyển sang Transcribe. Đổi bộ nhận diện hoặc mode Live sẽ chốt phiên cũ rồi mở phiên mới, dùng chung micro đang thu.

Tham khảo [hướng dẫn phiên âm Google](https://ai.google.dev/gemini-api/docs/transcribe) và [bảng giá Google](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-transcribe). Ước tính theo đoạn là 0,005 USD/phút (5 giờ ≈1,50 USD), Live là 0,009 USD/phút (5 giờ ≈2,70 USD), chưa gồm dịch, tóm tắt, ảnh hay xử lý lại; phí thực tế dựa trên token.

### Ngôn ngữ

Hai ô **Ngôn ngữ đầu vào / Ngôn ngữ đầu ra** có tìm theo tên tiếng Việt hoặc mã, nút đổi chiều và số lựa chọn thực tế. Mặc định Nhật (`ja-JP`) → Việt (`vi`); lưu lựa chọn qua tải lại và vào từng buổi, khóa khi thu. Màn hình điện thoại nhỏ hiện chiều dịch gọn trong lúc ghi âm. Danh mục trong `src/shared/languages.ts` lấy theo bảng Google: Transcribe có 83 mã không trùng; đầu ra có 180 mã. Đây là số lựa chọn gồm vùng/script, không phải 180 ngôn ngữ riêng biệt. Mã `es-419`, `yue-Hant-HK`, `cmn-Hans-CN` được giữ đầy đủ khi gửi API.

Hội thoại hai chiều hiện ở giai đoạn [nghiên cứu phương án A/B](docs/BIDIRECTIONAL-CONVERSATION.md).

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

Có thể đặt `BASE_URL` nếu dùng cổng khác; `PLAYWRIGHT_MODULE_PATH`/`PLAYWRIGHT_CHROMIUM_EXECUTABLE` để chỉ định runtime. Kết quả và ảnh popup nằm trong `test-results/browser/`. Các test này chạy ứng dụng và IndexedDB thật, mô phỏng micro/nhận giọng/AI ở ranh giới API.

Để kiểm tra bản production local có đăng nhập mà không dùng credential thật:

```powershell
# Terminal 1, sau npm run build: server chỉ bind 127.0.0.1:3100
node scripts/serve-fixture.cjs

# Terminal 2
node scripts/check-fixture.cjs auth
node scripts/check-fixture.cjs browser
node scripts/check-fixture.cjs ui
npm run test:audio
```

`ui` dùng MediaRecorder, worker và IndexedDB thật, với nguồn tone tổng hợp; các dịch vụ trả phí vẫn là fixture. `test:audio` tự mở server localhost tạm, tạo và giải mã file thực, tái hiện lỗi ghép bản cũ và kiểm tra tua. Cần Chrome hoặc cấu hình binary Playwright tương ứng. Các test không chứng minh chất lượng Google ASR, đồng bộ Blob production, ghi âm dài 60 phút hay Safari iPhone thật. Xem [kiểm tra audio, đăng nhập và cloud](docs/AUDIO-SYNC-AND-VERIFICATION.md) và [báo cáo trước đây](NGHIEM-THU.md).

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
AUTH_URL=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
OWNER_EMAIL=
DATABASE_URL=
BLOB_READ_WRITE_TOKEN=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

*Lưu ý an toàn:* Không commit file `.env.local` hoặc bất kỳ secret key nào lên GitHub repository.

Guard giải mã và kiểm tra hạn token Auth.js cùng email chủ tài khoản; cookie/header tùy ý không cấp quyền. Production thiếu cấu hình xác thực trả lỗi và không gọi AI. Local development chỉ bỏ xác thực khi cả `AUTH_SECRET` và `OWNER_EMAIL` đều chưa cấu hình. Mở `/api/auth/signin` để đăng nhập Google; email đã xác minh phải khớp `OWNER_EMAIL`.

Trên production, đặt `AUTH_URL=https://translate-ruby-phi.vercel.app` và callback Google `https://translate-ruby-phi.vercel.app/api/auth/callback/google`. Layout, login và API dùng cùng quy tắc tài khoản/cookie; Auth.js giữ thời hạn 30 ngày. Client gia hạn qua endpoint Auth.js có ghi cookie khi quay lại tab và mỗi 5 phút lúc có mạng. Nguyên nhân redirect sai trên production chưa được xác nhận; kết quả và giới hạn kiểm chứng có trong tài liệu nghiệm thu mới.

Neon dùng `DATABASE_URL` (hoặc `POSTGRES_URL`) cho chữ, tóm tắt và metadata audio. Tạo Vercel Blob **private** trong cùng dự án, gắn `BLOB_READ_WRITE_TOKEN` vào môi trường deploy; token không xuất ra client. Các bảng `recording_sync` và `recording_audio` tự tạo khi API được gọi, nên tài khoản DB cần quyền tạo bảng. Upload multipart đi trực tiếp trình duyệt → Blob bằng quyền ngắn hạn, không qua body của Next.js function. Thiếu Blob vẫn đồng bộ chữ, giữ audio và hàng đợi trên máy. Audio cloud không có TTL tự xóa; giữ tới khi người dùng xóa. Giới hạn metadata hiện tại: 512 MiB/file và 24 giờ/file.

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

- **Lưu trữ cục bộ:** Dexie/IndexedDB version 5: `recordings`, `audioChunks`, `audioSegments` (tương thích bản cũ), `audioAssets`, `audioJobs`, `captionItems`, `summaries`, `images`, `settings`.
- **Cloud:** Neon PostgreSQL lưu chữ/tóm tắt và metadata riêng; Vercel Blob private lưu audio. Thiết bị khác tải audio khi mở nghe, kiểm tra SHA-256 rồi giữ cache cục bộ. Hàng đợi thử lại khi có mạng, mở ứng dụng hoặc bấm đồng bộ. Xóa có dấu xóa riêng để thiết bị cũ không tải lại hoặc upload lại bản đã xóa.
- **Dữ liệu cũ:** Chỉ thiết bị còn giữ chunk gốc mới chuyển audio cũ lên cloud; ghép theo đoạn/sequence và chuẩn hóa trước upload. Không thể khôi phục audio đã mất chỉ từ chữ trên Neon.
- **Nhập/Xuất:**
  - Module nhập/xuất bundle Web và dữ liệu APK cũ vẫn có trong storage; nút upload dư ở sidebar đã bỏ. Xuất bundle và tải toàn buổi ở trình phát dùng cùng file đã chuẩn hóa, gồm cả audio tải từ cloud.

## 6. Triển khai Vercel & Phát hành GitHub

- **GitHub Repository:** `https://github.com/Tlerd/Translate`
- **Root Directory:** `web`
- **Vercel Production URL:** [translate-ruby-phi.vercel.app/app](https://translate-ruby-phi.vercel.app/app)
- **Quy trình:**
  Mọi commit đẩy lên nhánh `main` của repository GitHub sẽ tự động kích hoạt tiến trình build và deploy trên Vercel theo thiết lập Git integration.
# Soniox STT trực tiếp

Ô nhận giọng có **Soniox · stt-rt-v5** cho Nhật/Việt. Key `SONIOX_API_KEY` chỉ đặt phía server; dùng `node scripts/soniox-key-setup.cjs` để mở form localhost và lưu vào `.env.local`, rồi khởi động lại server. Chọn Soniox và Lưu trước khi kiểm tra. Test kết nối gửi 1 giây audio im lặng, có thể tính phí và không bật mic.

STT dự toán ~0,12 USD/giờ phiên, thực tế theo token/thời gian stream mở; phí dịch chữ tính riêng theo model đang chọn. Dừng API đóng stream nhưng audio vẫn ghi; Tiếp tục mở phiên mới. Xem [hướng dẫn Soniox](docs/SONIOX-STT.md) về cấu hình, thao tác, fixture và phần chưa thử với provider/Safari thật.
