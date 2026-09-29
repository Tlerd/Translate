# Máy Dịch Lớp Học & Đọc (Web Responsive Rebuild)

Ứng dụng web responsive (Next.js App Router + TypeScript) dịch sát nút lời nói trong lớp học, ghi âm lưu trữ cục bộ, tóm tắt tổng quan bài giảng và tạo ảnh minh họa theo yêu cầu.

## 1. Kiến trúc & Quyết định cốt lõi

### Hai phần sản phẩm độc lập
1. **Phần A: Dịch sát nút (Live Translation):**
   - Ưu tiên model chi phí thấp, phản hồi nhanh theo từng cụm câu nói.
   - Nhận giọng bằng **Web Speech API** (SpeechRecognition) trên trình duyệt.
   - Ghi âm đồng thời từng chunk vào IndexedDB (Dexie) bằng **MediaRecorder**.
   - Live scheduler kiểm soát: tối đa 1 request dịch đang chạy + 1 snapshot mới nhất chờ; tự động loại bỏ snapshot cũ quá hạn; đối chiếu nghĩa tương đương để không gọi dịch lại vô ích.
   - Hai chế độ thu: `lecture` (giảng bài: ngắt câu theo ngữ đoạn) và `readingPractice` (luyện đọc: ghép các quãng dừng 1–3 giây không ngắt hàng mới).

2. **Phần B: Tóm tắt rồi tạo ảnh (Summary & Image Generation):**
   - Dùng model phân tích chất lượng cao, **bắt buộc khác model dịch của Phần A** (server kiểm tra và trả lỗi `AI_MODEL_ROLE_CONFLICT` nếu cấu hình trùng model).
   - Chỉ chạy khi người dùng bấm nút **Tóm tắt**; chỉ hỗ trợ một preset **Mặc định** duy nhất.
   - Trích xuất tiêu đề, đoạn tổng quan và các đề mục có dẫn nguồn `captionIds` chuẩn xác từ transcript đã lưu.
   - **Tạo ảnh:** Bước sau của phần B, có model sinh ảnh riêng (Google Gemini Flash Image / OpenAI Images). Chỉ tạo ảnh khi người dùng chủ động bấm sau khi đã có bản tóm tắt.

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

# Đăng nhập và bộ đếm (tùy chọn trong môi trường dev, áp dụng khi deploy production)
AUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
OWNER_EMAIL=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

*Lưu ý an toàn:* Không commit file `.env.local` hoặc bất kỳ secret key nào lên GitHub repository.

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
