# Kế hoạch rebuild web/mobile: dịch, bản ghi, tóm tắt và tạo ảnh

Cập nhật 30/09/2026. **Lượt này chỉ cập nhật kế hoạch cho model triển khai sau; không sửa code app, khởi tạo Git, commit/push, build hoặc deploy.** Người dùng đã xác nhận yêu cầu GitHub/Vercel dưới đây chỉ được bổ sung vào kế hoạch.

Tài liệu này là hướng triển khai web hiện tại, thay các đề xuất trước nếu chúng mâu thuẫn. Ảnh đính kèm chỉ là tham khảo cách tổ chức thanh bên và bản ghi; không phải yêu cầu dựng lại toàn bộ giao diện LilysAI. Các đoạn hướng dẫn trong tài liệu cũ không tự mở rộng phạm vi lần này.

Đọc theo thứ tự: mục 1–3 để hiểu sản phẩm, mục 4 để tự cấu hình/code AI, mục 5 để đưa mã lên GitHub/Vercel, mục 7 để biết phần bỏ, mục 8–10 để triển khai đúng file và đúng thứ tự. Cây `web/` là cấu trúc mục tiêu; đã có một số file khởi tạo, cần đọc và tiếp tục trên các file hiện có, không tạo lại hoặc ghi đè mù.

## 1. Phạm vi và quyết định kiến trúc

- Rebuild một web responsive dùng chung trên điện thoại và máy tính, ưu tiên Chrome Android; có thể cài ra màn hình chính dưới dạng PWA. Đây không phải thao tác `flutter build web` trên app hiện tại, cũng chưa bao gồm APK mới.
- Chọn Next.js App Router + TypeScript trong `D:/idea/may-dich-offline/web/`, một package npm. Mã web đưa lên repo `Tlerd/Translate`, dùng lại dự án Vercel đang liên kết ở mục 5. Dùng CSS Modules/CSS dùng chung, icon Lucide; không cần monorepo, microservice hoặc một backend triển khai riêng.
- Hai phần sản phẩm độc lập: **A. Dịch sát nút** dùng model ưu tiên rẻ, dịch bám sát lời nói và hiện nhanh trong lúc thu; **B. Tóm tắt rồi tạo ảnh** dùng model tóm tắt mạnh hoặc đủ tốt, chỉ bắt đầu khi bấm **Tóm tắt**. Model dịch và model tóm tắt **bắt buộc khác nhau, không dùng chung**. STT vẫn là Web Speech API; tạo ảnh là bước tiếp theo của phần B, có API/model ảnh riêng.
- Giữ cách dùng và thuật ngữ của app hiện tại: chữ gốc/bản dịch, chọn chiều Nhật/Việt/Anh, hai chế độ `lecture` và `readingPractice`, Bắt đầu/Kết thúc, nghe lại, xuất và xóa bản ghi. Không thêm một đợt thiết kế giao diện mới.
- Dừng bằng tay; không tự kết thúc ở phút 60. Không tự dịch bù khi nối mạng, mở bản ghi, đổi model hoặc kết thúc buổi. Âm thanh, chữ gốc, bản dịch, tóm tắt và ảnh đã có chỉ xóa theo thao tác người dùng.
- Bản đầu phục vụ một chủ ứng dụng. Dữ liệu buổi học ở máy qua IndexedDB; server chỉ xử lý yêu cầu AI và kiểm soát truy cập. Đăng nhập trên hai thiết bị không có nghĩa bản ghi được đồng bộ.

Luồng chính:

```text
Mic -> MediaRecorder -> lưu audio theo chunk ở IndexedDB
Trình duyệt nhận giọng -> chữ gốc + revision -> gom câu -> hàng dịch giới hạn
                                                          |
                                                          v
                                              POST /api/translate
                                                          |
                                              model A: ưu tiên rẻ
                                                          |
                                              bản dịch + lưu cục bộ

Buổi đã dừng -> bấm Tóm tắt -> POST /api/summarize -> model B: mạnh/ổn -> tóm tắt mặc định
Tóm tắt đã có -> chọn model + bấm Tạo ảnh -> POST /api/images -> ảnh minh họa
```

Model A và B là hai model văn bản khác nhau. Phần B không nằm trong hàng dịch trực tiếp, không tự chạy theo câu mới hoặc sau khi Kết thúc. Model sinh ảnh phục vụ bước ảnh của phần B, không thay model dịch.

Đường nhận giọng và đường ghi âm cần thử đồng thời trên máy thật; sơ đồ không có nghĩa SpeechRecognition luôn dùng chính audio track của MediaRecorder. Web Speech không phải Google Cloud Speech-to-Text miễn phí và không cho chọn model Gemini để nhận giọng. [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition).

## 2. Điều kiện kỹ thuật phải giữ

1. Trình duyệt phải hỗ trợ nhận giọng, quyền mic và ghi âm đồng thời. Kiểm tra trước khi Bắt đầu; nếu thiếu thì báo chức năng không hỗ trợ, không âm thầm chuyển sang STT trả phí.
2. Bản thử yêu cầu trang ở trước, màn hình bật. Xử lý `end`, lỗi quyền, mất mạng, đổi thiết bị âm thanh và khóa màn hình bằng trạng thái thật. `continuous` không bảo đảm nhận liên tục một giờ.
3. Controller sở hữu phiên thu ở layout dùng chung. Chuyển bản ghi/sidebar không được hủy controller, mở thêm mic hay dừng buổi đang thu. Sau Kết thúc, mọi callback hoặc reconnect đến muộn phải bị vô hiệu bằng `sessionEpoch`.
4. Chữ gốc hiện dần; bản dịch cập nhật theo cụm ổn định. Mỗi phiên chỉ một request dịch đang chạy và một snapshot mới nhất chờ. Bản tạm thay bản tạm trước, không nối lặp; kết quả cũ không ghi đè revision mới.
5. Mốc im lặng 10 giây chỉ đóng nhóm nội dung. Không dùng thời gian không có callback STT làm bằng chứng chắc chắn về im lặng; đo mức âm trên luồng ghi bằng Web Audio nếu cần mốc này. `readingPractice` ghép các khoảng ngừng ngắn 1–3 giây, không biến từng mảnh thành dòng mới.
6. Audio được ghi tuần tự thành chunk, hàng ghi có giới hạn; không giữ cả giờ âm thanh trong RAM. Dung lượng cạn/lỗi ghi phải báo gián đoạn và giữ phần đã lưu. Không tự xóa bản cũ để lấy chỗ.
7. MIME/codec được kiểm tra bằng `MediaRecorder.isTypeSupported()`. Bản web đầu xuất JSON + audio đúng định dạng đã thu; WAV từ APK vẫn được nhập/phát lại. Xuất WAV từ bản web là hạng mục chuyển đổi thật cần kiểm tra riêng, không đổi đuôi WebM thành WAV. [Kiểm tra định dạng](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static).
8. Không suy thời lượng từ số chunk hoặc `timeslice`; browser có thể trả chunk muộn/lớn khi bị gián đoạn. Timestamp STT là gần đúng, không hứa chính xác từng từ. [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event).
9. Xin lưu bền bằng `navigator.storage.persist()` và kiểm tra dung lượng; vẫn cần xuất bản sao. Quyền lưu bền có thể không được cấp và người dùng vẫn có thể xóa dữ liệu trình duyệt. [Lưu bền](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist).

Mốc đo ban đầu: bản dịch đầu trong khoảng 1–3 giây sau khi có cụm ổn định. Đây là mục tiêu thử, chưa phải kết quả; chất lượng mạng, quota và việc câu Nhật chưa hoàn chỉnh đều ảnh hưởng. Không gọi model theo từng token STT.

## 3. Ý tưởng sidebar và bản ghi từ ảnh tham khảo

Chỉ lấy cách tổ chức, giữ ngôn ngữ thiết kế hiện tại của app khi triển khai:

- Sidebar trái gồm nút tạo buổi mới, tìm kiếm, danh sách bản ghi và Cấu hình AI. Mỗi dòng bản ghi có tên, thời gian, thời lượng và trạng thái đang thu/đã dừng/gián đoạn; hỗ trợ đổi tên, chọn nhiều, xuất và xóa thủ công.
- Danh sách bản ghi nằm ngay trong sidebar, không bắt đi qua một trang lịch sử riêng mới mở được buổi. Mục đang xem được đánh dấu; buổi đang thu luôn dễ quay lại và không được xóa.
- Vùng chính mở nội dung buổi được chọn: thanh phát audio, chữ gốc/bản dịch theo thời gian, tab **Bản dịch** và **Tóm tắt**. Ảnh minh họa gắn với tóm tắt của buổi đó.
- Desktop: sidebar thu gọn được, cột nội dung co giãn. Mobile: sidebar thành ngăn kéo, đóng sau khi chọn bản ghi; nội dung một cột, nút Kết thúc của buổi đang thu luôn truy cập được. Không ép ba cột của ảnh lên điện thoại.
- Chỉ giữ một hành động Tóm tắt với kiểu Mặc định. Bỏ các lựa chọn Ngắn/Dài/Dễ/Mở rộng, bộ sưu tập, chia sẻ công khai, nâng cấp, đăng ký, quảng bá và các mục phụ không phục vụ app.
- Không chép logo, màu thương hiệu, minh họa hay giao diện nguyên mẫu. Không hiển thị `Speaker 1` như kết quả nhận diện người nói khi Web Speech chưa cung cấp dữ liệu đó.

Mở bản ghi chỉ đọc dữ liệu đã lưu. Tóm tắt/tạo ảnh phải do người dùng bấm, không chạy ngầm khi vào tab hoặc khi buổi kết thúc. Sidebar chỉ quản lý bản ghi; thêm nguồn, tìm nguồn, nhập URL và thư viện tài liệu không nằm trong bản đầu.

## 4. AI: chọn model, API riêng và nơi tự cấu hình

### 4.1 Hai phần tách biệt, hai model văn bản khác nhau

**Phần A: Dịch sát nút.** Ưu tiên model rẻ, phản hồi nhanh và dịch sát nghĩa từng cụm đang nói; không tóm lược hay viết lại thành bài tổng hợp. Luồng này hoạt động trong lúc thu.

**Phần B: Tóm tắt rồi tạo ảnh.** Dùng một model văn bản khác, ưu tiên chất lượng tổng hợp mạnh hoặc đủ tốt. Chỉ nút **Tóm tắt** mới khởi chạy; lấy chữ gốc đã lưu, tạo tóm tắt Mặc định. Sau đó người dùng có thể bấm **Tạo ảnh** bằng model sinh ảnh đã chọn. Mở tab, nhận câu mới hoặc dừng buổi đều không tự gọi phần B.

| Nhiệm vụ | Cấu hình | Cách dùng trong bản đầu |
|---|---|---|
| Nhận giọng | Trình duyệt + locale | Không có API key/model STT trên UI |
| Dịch sát nút, phần A | Provider + model văn bản ưu tiên rẻ | Chọn trong nhóm model dịch; không cho chọn model đang dành cho tóm tắt |
| Tóm tắt, phần B | Provider + model mạnh/ổn, khác model dịch | Một kiểu Mặc định; chỉ gọi khi bấm Tóm tắt; cấu hình model tại server |
| Tạo ảnh, bước sau của phần B | Provider + model hỗ trợ đầu ra ảnh | Chọn model ảnh; chỉ tạo khi bấm sau khi đã có tóm tắt |

"Mặc định" là **kiểu tóm tắt duy nhất**, không phải cố định vĩnh viễn model. `AI_TRANSLATION_MODEL` và `AI_SUMMARY_MODEL` phải trỏ tới hai model thực khác nhau; không được chỉ tách prompt/API nhưng dùng cùng model. Model tóm tắt đổi ở `AI_SUMMARY_MODEL`; đổi lựa chọn dịch không đổi model tóm tắt/ảnh. Có thể cùng provider; key xác thực dùng chung hay riêng không làm thay đổi yêu cầu hai model khác nhau.

### 4.2 Danh mục model

Chỉ triển khai hai Adapter thật là Google và OpenAI trước, phù hợp với app đang có. Danh sách là allowlist ở server, không nhận tên model/base URL bất kỳ từ client. Dùng khóa nội bộ `provider:model-id` để tránh trùng tên.

| Khóa cấu hình gợi ý | Vai trò cấu hình trong app | Ghi chú |
|---|---|---|
| `google:gemini-3.5-flash-lite` | Dịch sát nút, phần A | Mặc định đề xuất cho nhánh ưu tiên chi phí thấp; kiểm tra quota/chất lượng thực tế |
| `openai:gpt-4o-mini` | Dịch sát nút, phần A | Lựa chọn model dịch rẻ để so sánh; không tự chuyển provider |
| `google:gemini-3.8-flash` | Tóm tắt, phần B | Mặc định đề xuất cho nhánh ưu tiên chất lượng tổng hợp; chỉ gọi khi bấm Tóm tắt |
| `google:gemini-3.1-flash-image` | Tạo ảnh | Mốc mặc định đề xuất cho phần ảnh |
| `openai:gpt-image-2.5-sunburst` | Tạo ảnh | Lựa chọn ảnh qua Images API riêng |

Đây là phân vai của ứng dụng, không phải khẳng định model chỉ có một khả năng kỹ thuật. Flash-Lite là ứng viên cho nhánh dịch tiết kiệm; không khẳng định rẻ nhất mọi provider. So sánh giá/quota và câu dịch thực trước khi chốt. [Giá Gemini](https://ai.google.dev/gemini-api/docs/pricing). Khi thêm lựa chọn tóm tắt mạnh hơn, giữ riêng nhóm tóm tắt và không đổi model dịch theo.

Các ID trên được đối chiếu tài liệu ngày 30/09/2026, chưa gọi bằng tài khoản của người dùng. Danh sách công khai không chứng minh tài khoản có quyền hoặc free tier. Kiểm tra quyền, giá, quota và lifecycle trước khi bật từng model; không tự chuyển model/provider hoặc bật thanh toán. Không giữ bảng giá cũ trong mã làm bằng chứng chi phí hiện tại. Gemini 2.5 chỉ là lựa chọn bổ sung khi tài khoản còn quyền, không làm default cho project mới. [Model Google](https://ai.google.dev/gemini-api/docs/models), [GPT-4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini), [ảnh Google](https://ai.google.dev/gemini-api/docs/image-generation), [ảnh OpenAI](https://developers.openai.com/api/docs/guides/image-generation).

### 4.3 Bảng chỉ đúng file cần sửa

Tất cả đường dẫn trong bảng tính từ `D:/idea/may-dich-offline/`.

| Muốn thay đổi | File dự kiến | Nội dung chịu trách nhiệm |
|---|---|---|
| Nhập key thật trên máy | `web/.env.local` | Secret; không commit, không đưa vào browser |
| Khai báo các biến phải điền | `web/.env.example` | Tên biến, ví dụ không chứa key thật |
| Thêm/bỏ model hoặc khả năng | `web/src/config/ai-models.ts` | Provider, model ID, capabilities, allowedTasks, endpoint kind, giới hạn và enabled |
| Chọn default dịch/tóm tắt/ảnh | `web/src/config/ai.server.ts` | Đọc ba biến model; chặn model dịch trùng model tóm tắt; giải quyết key, policy và timeout |
| Kiểm tra biến môi trường | `web/src/config/env.server.ts` | Validate secret và cấu hình; thông báo thiếu rõ ràng |
| Đổi quy tắc dịch | `web/src/server/ai/prompts/translation.ts` | Chỉ dịch phát ngôn hiện tại, glossary và ngữ cảnh giới hạn |
| Đổi khuôn tóm tắt Mặc định | `web/src/server/ai/prompts/summary.ts` | Ý chính, mục nội dung, dẫn lại caption gốc; không thêm style |
| Đổi yêu cầu ảnh minh họa | `web/src/server/ai/prompts/image.ts` | Biến nội dung tóm tắt thành yêu cầu ảnh bằng template |
| Đổi cách gọi Google/OpenAI | `web/src/server/ai/providers/google.ts`, `web/src/server/ai/providers/openai.ts` | SDK, xác thực, stream, parse kết quả, lỗi và hủy request |
| Đổi xử lý từng tác vụ | `web/src/server/ai/translate.ts`, `web/src/server/ai/summarize.ts`, `web/src/server/ai/generate-image.ts` | Kiểm tra model, dựng prompt, gọi Adapter, chuẩn hóa kết quả |
| Đổi dữ liệu gửi/nhận | `web/src/shared/ai-contracts.ts` | Zod schema và type dùng chung; không import secret |
| Đổi danh sách model trên UI | `web/src/app/api/models/route.ts` | Chỉ trả model/capability/configured/default cần cho UI |
| Đổi API công khai | `web/src/app/api/translate/route.ts`, `web/src/app/api/summarize/route.ts`, `web/src/app/api/images/route.ts` | Route mỏng: guard -> validate -> tác vụ -> response |
| Đổi lựa chọn trên UI | `web/src/features/settings/ai-settings.tsx` | Provider/model dịch, glossary, ngữ cảnh; chỉ lưu tùy chọn không bí mật |
| Đổi nhịp dịch live | `web/src/features/recording/translation-scheduler.ts` | Một đang chạy + một mới nhất chờ, revision, hủy và backoff |

`ai-models.ts`, `ai.server.ts`, `env.server.ts` và `server/` phải đánh dấu `server-only`. UI lấy danh mục từ `/api/models`, không import cấu hình server. Client không tự gọi SDK của nhà cung cấp.

Ví dụ cấu trúc một mục registry, chỉ minh họa hợp đồng:

```ts
{
  key: "google:gemini-3.8-flash",
  provider: "google",
  modelId: "gemini-3.8-flash",
  capabilities: ["translate", "summarize"],
  allowedTasks: ["summarize"],
  endpointKind: "google-interactions",
  enabled: true,
  maxSummaryChars: 60000,
}
```

`capabilities` mô tả khả năng kỹ thuật; `allowedTasks` quy định vai trò được dùng trong app. Ví dụ trên dành model 3.8 Flash cho tóm tắt dù về kỹ thuật có thể dịch. Registry của model dịch đặt `allowedTasks: ["translate"]`; model ảnh đặt `allowedTasks: ["image"]`. Mỗi model ảnh phải có capability `image`, không suy đoán từ tên có chữ `vision`. Giữ riêng tham số thật sự được từng model hỗ trợ.

### 4.4 Biến môi trường và thứ tự cấu hình

Ví dụ nội dung **sẽ tạo** trong `web/.env.example`:

```dotenv
# Key chung cho hai provider; chi dien provider se su dung.
GOOGLE_API_KEY=
OPENAI_API_KEY=

# Tuy chon: key rieng cho tom tat/anh, cung provider voi model da chon.
SUMMARY_GOOGLE_API_KEY=
SUMMARY_OPENAI_API_KEY=
IMAGE_GOOGLE_API_KEY=
IMAGE_OPENAI_API_KEY=

AI_TRANSLATION_MODEL=google:gemini-3.5-flash-lite
AI_SUMMARY_MODEL=google:gemini-3.8-flash
AI_IMAGE_MODEL=google:gemini-3.1-flash-image
AI_IMAGE_ENABLED=false

# Dang nhap mot chu ung dung va bo dem dung chung khi deploy.
AUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
OWNER_EMAIL=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

1. Model triển khai tạo `.env.example`; người vận hành điền key thật vào `.env.local` hoặc Vercel Environment Variables. Không đưa secret vào chat, JSON xuất phiên, log, localStorage, IndexedDB hay biến `NEXT_PUBLIC_*`.
2. Thêm model vào `ai-models.ts`, chọn default bằng ba biến `AI_*_MODEL`. Kiểm tra provider/capability/allowedTasks khớp và model dịch khác model tóm tắt. Nếu cùng model thực, kể cả qua hai alias, trả lỗi `AI_MODEL_ROLE_CONFLICT`; không dùng chung hoặc tự fallback.
3. `ai.server.ts` dùng key theo nhiệm vụ: tóm tắt ưu tiên `SUMMARY_<PROVIDER>_API_KEY`, ảnh ưu tiên `IMAGE_<PROVIDER>_API_KEY`; nếu để trống mới dùng key chung cùng provider. Một override đã điền nhưng sai không được âm thầm fallback.
4. `/api/models` lọc allowlist và khả năng cấu hình hiện có; trả `configured` theo từng nhiệm vụ vì key dịch/tóm tắt/ảnh có thể khác nhau. Trạng thái này không chứng minh quyền gọi thực tế. Không gọi API có phí mỗi lần mở dropdown. Thiếu key một provider không làm hỏng các provider khác hoặc chức năng xem bản ghi.
5. Dropdown dịch chỉ lấy nhóm `allowedTasks: translate`, loại model tóm tắt; `/api/translate` kiểm tra lại phía server cho cả `modelKey` client gửi. Chọn model áp dụng cho nội dung mới. Khi đổi giữa buổi: hủy request cũ, tăng `configRevision`, bỏ hàng chờ cũ, giữ bản dịch đã lưu và gắn model thực tế vào kết quả mới.
6. Kiểm tra tóm tắt độc lập bằng key/model của nó. Chỉ bật `AI_IMAGE_ENABLED=true` khi đã cấu hình và thử model ảnh; trạng thái tắt phải được báo rõ, không tạo kết quả giả.

`AI_IMAGE_ENABLED=false` là trạng thái trước khi cấu hình, không phải bỏ tính năng. Điều kiện hoàn thành phần ảnh là bật trong môi trường kiểm thử có quyền và tạo/lưu/mở lại được ảnh thật.

### 4.5 Hợp đồng API tối thiểu

Mọi endpoint AI yêu cầu đăng nhập chủ ứng dụng và giới hạn gọi tại server. Dùng cùng origin, `Cache-Control: no-store`, schema Zod strict. Server không đọc được IndexedDB của client: phải gửi phần văn bản cần xử lý, không chỉ gửi `recordingId`.

| Endpoint | Dữ liệu gửi | Dữ liệu trả |
|---|---|---|
| `GET /api/models` | Không có key từ client | `models`, defaults theo nhiệm vụ, `imageEnabled`; không lộ secret |
| `POST /api/translate` | `requestId`, `recordingId`, `captionId`, `sessionEpoch`, `revision`, `configRevision`, `modelKey`, `sourceLanguage`, `targetLanguage`, `text`, `context`, `glossary`, `previousTurns` | SSE `delta`, `done`, `error`; kèm các ID/revision và model thực tế |
| `POST /api/summarize` | `requestId`, `recordingId`, `sourceHash`, `targetLanguage`, danh sách `captions: [{id, startMs, endMs, source, revision, isFinal}]` | JSON `requestId`, `title`, `overview`, `sections: [{heading, bullets, captionIds}]`, `modelKey`, `sourceHash`, `generatedAt` |
| `POST /api/images` | `requestId`, `recordingId`, `summaryId`, `sourceHash`, `summaryHash`, `modelKey`, `summary: {title, overview, sections}` | Một ảnh binary chuẩn hóa; header `X-Request-Id`, `X-Model-Key`, `X-Source-Hash`, `X-Summary-Hash`; lỗi vẫn là JSON |

Không nhận `summaryModel`, độ dài hay style từ UI tóm tắt trong bản đầu; server luôn dùng `AI_SUMMARY_MODEL` và preset Mặc định. Dùng SHA-256 trên JSON có thứ tự trường cố định: `sourceHash` từ snapshot captions đã sắp thứ tự cùng ngôn ngữ đầu ra, `summaryHash` từ nội dung tóm tắt. Route tóm tắt tính lại `sourceHash`; route ảnh tính lại `summaryHash`, còn `sourceHash` ở route ảnh chỉ là metadata liên kết vì route này không nhận transcript. Hai hash dùng phát hiện kết quả cũ, không thay xác thực người dùng.

Quy tắc triển khai:

- `translate.ts`: chỉ dịch `text`, giữ tối đa 6 lượt ngữ cảnh và 6.000 ký tự như prompt Flutter hiện tại. SSE được đọc bằng `fetch` + stream parser, không dùng `EventSource` cho POST. `delta` chỉ là chữ dịch; `done` là bản đầy đủ chuẩn, `error` là lỗi có cấu trúc.
- Tất cả sự kiện dịch có đủ ID/revision để client loại phản hồi đến muộn. Sau khi stream đã mở, lỗi gửi bằng event `error`; trước đó dùng HTTP status. Client hủy/timeout phải truyền `AbortSignal` xuống SDK.
- `summarize.ts`: chỉ chạy theo nút bấm trên buổi đã dừng hoặc gián đoạn, dùng chữ gốc đã lưu; ngôn ngữ đầu ra theo buổi, mặc định Việt. Không suy ra phần bị thiếu từ audio và không gọi dịch bù.
- Tóm tắt Mặc định có tiêu đề, đoạn tổng quan và các ý chính có mục. `captionIds` phải thuộc nguồn đầu vào để mở/nhảy về đoạn gốc. Nguồn rỗng, output sai schema hoặc dẫn nguồn sai phải báo lỗi; không lưu như kết quả thành công.
- V1 xử lý một snapshot trong một request tóm tắt, mặc định tối đa 60.000 ký tự và giới hạn thấp hơn nếu registry yêu cầu. Trả `413 INPUT_TOO_LARGE` nếu vượt, không cắt mất nội dung âm thầm. P0/P5 phải thử transcript một buổi 60 phút; nếu không vừa giới hạn thì bổ sung chia đoạn trước khi tuyên bố đáp ứng buổi 60 phút.
- `generate-image.ts`: nhận nội dung tóm tắt, ghép template cố định, gọi đúng Adapter ảnh một lần. Không thêm một lần gọi model văn bản ẩn để viết prompt. Không tự tạo ảnh sau tóm tắt; mặc định một ảnh mỗi thao tác.
- Ảnh do server chuẩn hóa bằng `sharp` về WebP tối đa 1.024 px cạnh dài, dưới 3 MiB trước khi trả. Client lưu Blob vào IndexedDB, không chỉ lưu URL tạm của provider. Không gửi audio hoặc base64 ảnh lớn trong JSON.
- Chặn bấm lặp khi đang chạy. Với tóm tắt/ảnh, giữ trạng thái theo `owner + task + requestId` và hash đầu vào trong Redis TTL 15 phút; đặt khóa nguyên tử trước khi gọi provider. Request lặp không tạo lần gọi mới, cùng ID nhưng khác đầu vào trả `409`. Mất response sau khi provider đã chạy thì báo chưa xác định, không tự gọi lại; người dùng có thể chủ động tạo yêu cầu mới.
- Lỗi JSON chung: `{ error: { code, message, retryAfterMs?, requestId } }`. Phân biệt chưa đăng nhập, thiếu cấu hình, model không hỗ trợ, thiếu quyền, quota/tốc độ, input quá lớn, timeout, output sai và lỗi upstream.
- Rate limit/quota của dịch, tóm tắt và ảnh tách theo tác vụ; nhận biết cả quota dùng chung của provider/key. Không hứa đổi key/model sẽ bỏ được 429. Tắt retry ngầm của SDK; chỉ backoff có giới hạn và chỉ tiếp tục từ nội dung hiện tại.

Policy khởi điểm tại `ai.server.ts`: dịch timeout 12 giây, tóm tắt 90 giây, ảnh 180 giây; giới hạn payload JSON lần lượt 64 KiB/512 KiB/64 KiB, output tóm tắt khoảng 2.000 token. Đây là cấu hình app cần đo, không phải giới hạn công bố của provider. Scheduler khởi điểm debounce 700 ms, khoảng cách request 2 giây; điều chỉnh theo quota tài khoản, không sao chép cứng nhịp 6 giây của controller cũ.

### 4.6 Cách tự code phần AI

1. Viết `shared/ai-contracts.ts` trước để thống nhất request/response và lỗi. Viết fixture chữ Nhật có tên riêng, số, phủ định và một đoạn không nghe rõ.
2. Viết `config/ai-models.ts`, `env.server.ts`, `ai.server.ts`. Hàm `resolveTaskConfig(task, modelKey?)` kiểm tra vai trò và hai model văn bản khác nhau, trả model hợp lệ, key cùng provider và policy; chỉ chạy ở server. Không dùng một biến `AI_MODEL` chung cho dịch và tóm tắt.
3. Viết hai Adapter `google.ts`, `openai.ts`: `streamText`, `generateText`, `generateImage` nhận model đã giải quyết, system prompt, input và signal. Dùng SDK chính thức `@google/genai`, `openai`; UI không biết JSON wire của provider.
4. Google dùng endpoint/SDK Interactions phù hợp model được chọn; OpenAI văn bản dùng Chat Completions streaming và ảnh dùng Images API. Cô lập sự khác nhau trong Adapter, kiểm tra version SDK và mẫu chính thức trước khi khóa dependency. [Google text](https://ai.google.dev/gemini-api/docs/text-generation), [OpenAI image](https://developers.openai.com/api/docs/guides/image-generation).
5. Viết ba prompt riêng. Dịch giữ nghĩa, số, phủ định, tên riêng; tóm tắt chỉ dựa nguồn; ảnh chỉ minh họa nguồn. Transcript/glossary/nội dung tóm tắt là dữ liệu, không được làm theo chỉ dẫn chèn trong đó. Không bật tools, web search hoặc agent cho các tác vụ này.
6. Viết ba file tác vụ, sau đó ba route mỏng. Output được render dưới dạng text/structured data; không thực thi HTML từ model. Thiếu cấu hình một tác vụ chỉ làm tác vụ đó không khả dụng.
7. Test qua hợp đồng với fake Adapter trước, sau đó thử từng provider thực tế bằng một mẫu nhỏ được phép. Ghi rõ provider/model nào mới qua mock và cái nào đã gọi thật. Không dùng kết quả mock để tuyên bố AI sẵn sàng.

## 5. Đẩy mã lên GitHub và deploy Vercel

### 5.1 Đích phát hành đã chốt

| Thành phần | Giá trị |
|---|---|
| GitHub repository | [Tlerd/Translate](https://github.com/Tlerd/Translate) |
| Git remote URL | `https://github.com/Tlerd/Translate.git` |
| Thư mục gốc Git dự kiến | `D:/idea/may-dich-offline/`, không khởi tạo Git riêng lồng trong `web/` |
| Vercel Production URL | [translate-psi-khaki.vercel.app](https://translate-psi-khaki.vercel.app/) |
| Vercel Root Directory | `web` |
| Nhánh phát hành đề xuất | `main`; kiểm tra Production Branch của dự án Vercel trước lần push đầu |

Người dùng xác nhận repo đã liên kết Vercel. Dùng lại liên kết và URL này, không tạo repo/dự án Vercel khác. Lúc bổ sung kế hoạch, GitHub repo đang trống và thư mục gốc local chưa có Git; chưa kiểm chứng cấu hình nội bộ hoặc deployment thành công của Vercel. Model triển khai phải kiểm tra lại trạng thái thực trước khi chạy lệnh.

### 5.2 Cấu hình Vercel

- Vercel Project dùng Framework Preset Next.js, Root Directory `web`, cài bằng `npm ci`, build bằng `npm run build`, output để mặc định của framework. Không đặt `output: 'export'` vì app có API server.
- Node.js runtime cho các route AI. Dự kiến `maxDuration` 30/120/240 giây cho dịch/tóm tắt/ảnh, dài hơn timeout tác vụ tương ứng; xác minh gói Vercel và cấu hình dự án lúc deploy. Không duy trì một Function suốt buổi học.
- Route nhận chữ, không nhận audio một giờ. Giới hạn request/response công bố hiện là 4,5 MB; giữ policy nội bộ thấp hơn, đặc biệt ảnh binary dưới 3 MiB. Không phụ thuộc các mức beta lớn hơn. [Giới hạn Vercel](https://vercel.com/docs/functions/limitations).
- Đặt secret cho Development/Preview/Production đúng môi trường, deploy lại khi thay đổi. Build và xem bản ghi không được yêu cầu gọi model. Preview cần tên miền ổn định để thử mic, OAuth và lưu dữ liệu theo origin. [Biến môi trường Vercel](https://vercel.com/docs/environment-variables).
- Chọn Auth.js + Google đăng nhập, JWT session và allowlist `OWNER_EMAIL`; không cần database tài khoản cho bản một chủ. Khai báo callback URL `/api/auth/callback/google` đúng localhost/Preview/Production. Guard server kiểm tra session và email ở từng API, không chỉ ẩn nút trên UI. [Google provider](https://authjs.dev/getting-started/providers/google).
- Redis dùng cho bộ đếm/quota và chặn request lặp; không chứa audio hay transcript. Có thể dùng Upstash REST. Cấu hình quota theo tài khoản ở `ai.server.ts`; không dùng biến RAM của Function làm giới hạn toàn hệ thống. Production thiếu auth/Redis phải chặn gọi AI với lỗi cấu hình; local test dùng fake.
- POST kiểm tra origin và giới hạn body trước khi đọc payload; log chỉ metadata cần chẩn đoán như requestId, task, model, thời lượng, status. Không log key hoặc toàn bộ nội dung học.
- HTTPS là điều kiện thử mic trên điện thoại. PWA chỉ bổ sung manifest/icon/cài màn hình chính; không hứa STT chạy offline hay khi khóa màn. Nếu thêm service worker sau, không cache API AI/auth và không ép reload giữa phiên thu. [PWA Next.js](https://nextjs.org/docs/app/guides/progressive-web-apps).

Git integration sẽ tạo deployment theo push; nhánh Production Branch quyết định bản phát hành chính. Kiểm tra Git repository đúng `Tlerd/Translate`, Root Directory đúng `web`, nhánh phát hành và env/auth callback trước khi push. Không cần thêm GitHub Actions deploy trùng với liên kết Vercel đang có. [Vercel for GitHub](https://vercel.com/docs/git/vercel-for-github).

### 5.3 Quy trình Git và theo dõi đến khi hoàn thành

Các lệnh sau là hướng dẫn cho **lượt triển khai**, không chạy trong lượt sửa kế hoạch này.

1. Tại `D:/idea/may-dich-offline/`, kiểm tra Git root, remote, nhánh, thay đổi local và nhánh trên GitHub. Giữ các file/mã đang làm dở. Nếu đã có repo thì tiếp tục repo đó; không `git init` lồng hoặc tạo lại lịch sử.
2. Nếu local chưa có Git và remote vẫn trống như lúc khảo sát, khởi tạo đúng gốc và gắn remote:

```powershell
Set-Location 'D:/idea/may-dich-offline'
git init -b main
git remote add origin https://github.com/Tlerd/Translate.git
```

3. Nếu remote đã có commit khi bắt đầu triển khai, fetch và đối chiếu lịch sử trước khi tích hợp mã local; xử lý xung đột có giữ dữ liệu. Không force-push, reset cứng hoặc ghi đè mã trên GitHub. Nếu `origin` đã tồn tại, kiểm tra URL trước, không chạy lại `remote add` một cách mù quáng.
4. Tạo/rà `.gitignore` ở gốc trước khi stage. Không đưa `.env`/`.env.*` thật, `.vercel/`, `node_modules/`, `.next/`, cache/build, APK, khóa ký hay bản ghi cá nhân lên repo; cho phép `.env.example` không chứa secret. Phạm vi push của đợt web gồm mã `web/`, lockfile, cấu hình mẫu và tài liệu liên quan. `app/` và `releases/` vẫn giữ local để đối chiếu, không tự stage cả thư mục gốc.
5. Hoàn thành mã cần phát hành, chạy các kiểm tra ở mục 10, kiểm tra staged diff và secret trước khi commit. Với lần đầu remote trống, chỉ push `main` khi bản web đã build được; không push bộ khung chưa hoàn thiện để coi là hoàn thành.

```powershell
git add -- .gitignore web DINH-HUONG-APP-WEB-VA-MODEL.md
git diff --cached --check
git diff --cached --stat
git commit -m "Add translator web app and deployment plan"
git push -u origin main
```

6. Khi đã có lịch sử, commit/push tiếp các thay đổi hoàn chỉnh trên nhánh phù hợp; dùng Preview để kiểm tra trước khi đưa vào Production Branch. Xác minh commit đã lên đúng repo, không chỉ thấy lệnh commit local thành công.
7. Sau mỗi push phát hành, theo dõi deployment tương ứng đúng commit trên dự án Vercel hiện có. Nếu lỗi build/runtime, đọc log, sửa nguyên nhân trong phạm vi, kiểm tra lại, commit và push bản sửa; tiếp tục vòng này đến khi deployment đạt `READY` và bản Production hoạt động đúng. Push thành công hoặc trang trả HTTP 200 riêng lẻ chưa đủ chứng minh xong.
8. Bàn giao URL GitHub, nhánh/commit cuối, trạng thái deployment và URL Production đã kiểm tra; nêu rõ kết quả thử desktop/mobile, auth và từng tác vụ AI. Chỉ báo hoàn thành khi mã cuối đã có trên GitHub và Vercel triển khai đúng commit đó. Nếu thiếu quyền/secret hoặc thử máy thật cần người dùng tham gia, báo đúng điều còn thiếu và hoàn thành phần còn làm được, không tuyên bố thành công giả.

Trình tự nghiệm thu vẫn là local -> Preview nếu có -> kiểm tra mobile, lưu/xuất, auth/quota, AI -> Production tại URL đã chốt. Không tự bật billing/nâng gói. Việc này là yêu cầu cho model triển khai sau; lượt hiện tại không thực hiện Git hoặc deployment.

## 6. Mic và xử lý âm thanh

Ưu tiên mic tương thích, vị trí thu và tín hiệu không bị vỡ. Bản web chỉ dùng xử lý nhẹ sẵn có và đo âm lượng; thử bật/tắt khử nhiễu trên cùng thiết bị. Gain không tự chọn giọng thầy/cô. Không mang bộ lọc hồ sơ giọng, tách người nói chồng hoặc model âm thanh nặng vào bản đầu.

Lỗi nhận giọng/API không được làm dừng nhánh ghi audio nếu mic/lưu trữ vẫn hoạt động. Nếu browser không cho ghi và nhận đồng thời ổn định trên Realme C3, ghi lại kết quả và giữ APK làm phương án sử dụng; không báo web đã thay thế đầy đủ chỉ vì desktop chạy được.

## 7. Tinh gọn theo hướng web

| Xử lý | Phần tương ứng |
|---|---|
| Không mang sang web | Gemini Live/OpenAI live STT, upload audio để STT trả phí, model Whisper/ML Kit tải về máy, PCM resampler phục vụ live provider, Android foreground service |
| Không làm trong bản đầu | Hồ sơ giọng thầy/cô, tách giọng, ESP32, Claude Adapter chưa có nhu cầu thực, BYOK trên browser, đồng bộ cloud, nguồn URL/tài liệu, các tính năng phụ của LilysAI |
| Giữ và chuyển hành vi | Prompt dịch, glossary/ngữ cảnh có giới hạn, hai chế độ học, ghép câu/revision, một request + một chờ, xử lý quota, ghi/lưu/phát/xuất/xóa thủ công |
| Bổ sung đúng yêu cầu | Sidebar trái chứa bản ghi, chọn model dịch, tóm tắt Mặc định qua API riêng, chọn model tạo ảnh qua API riêng |

`app/` và `releases/` là nguồn đối chiếu/khôi phục trong đợt rebuild; không có phần nào bị xóa ở lượt lập kế hoạch. Khi triển khai, chỉ xóa mã/phụ thuộc **trong web** đã chứng minh không dùng. Việc gỡ APK/Flutter cũ là quyết định riêng sau nghiệm thu.

## 8. Tổ chức file gọn và trách nhiệm rõ

### 8.1 Cây thư mục mục tiêu

```text
may-dich-offline/
  DINH-HUONG-APP-WEB-VA-MODEL.md       # kế hoạch gốc để bàn giao
  .gitignore                        # loại secret, dữ liệu cá nhân và build khỏi Git
  app/                              # Flutter 0.4.0 hiện tại
  releases/                         # bản phát hành hiện tại
  web/
    README.md                       # chạy local, cấu hình, deploy, giới hạn
    .env.example
    .gitignore
    package.json
    package-lock.json
    next.config.ts
    tsconfig.json
    eslint.config.mjs
    public/icons/                   # icon ứng dụng, không sao chép thương hiệu
    src/
      auth.ts
      app/
        layout.tsx
        globals.css
        manifest.ts
        (workspace)/
          layout.tsx                # giữ AppShell và RecordingProvider
          page.tsx                  # buổi mới / quay lại buổi đang thu
          recordings/[id]/page.tsx   # xem một buổi; refresh vẫn đọc được IDB
          settings/page.tsx
        api/
          auth/[...nextauth]/route.ts
          models/route.ts
          translate/route.ts
          summarize/route.ts
          images/route.ts
      components/
        app-shell.tsx
        app-shell.module.css
        ui/                         # chỉ primitive thực sự dùng chung
      features/
        library/
          library-sidebar.tsx
          recording-list.tsx
        recording/
          recording-context.tsx
          recording-workspace.tsx
          recorder-toolbar.tsx
          transcript-pane.tsx
          controller.ts
          speech-recognition.ts
          audio-recorder.ts
          utterance-assembler.ts
          translation-scheduler.ts
        summary/summary-panel.tsx
        images/image-panel.tsx
        settings/ai-settings.tsx
      storage/
        db.ts
        recordings.ts
        export-import.ts
      config/
        env.server.ts
        ai-models.ts
        ai.server.ts
      server/
        http/
          guard.ts
          rate-limit.ts
        ai/
          translate.ts
          summarize.ts
          generate-image.ts
          providers/
            google.ts
            openai.ts
          prompts/
            translation.ts
            summary.ts
            image.ts
      shared/
        recording.ts
        ai-contracts.ts
      lib/api-client.ts             # fetch, SSE, lỗi; không chứa key
    tests/
      recording.test.ts
      ai.test.ts
      storage.test.ts
      app.spec.ts                   # Playwright
```

File CSS riêng và cấu hình test tạo cạnh phần sở hữu khi cần; không tạo cả cây file rỗng từ đầu. Không thêm `services/`, `managers/`, `utils/` tổng hợp hoặc lớp trung gian chỉ chuyển tiếp lời gọi.

### 8.2 Quy tắc phụ thuộc

- `app/` chỉ khai báo route/layout và ráp màn hình; logic thu/dịch không đặt trong `page.tsx` hoặc `route.ts`.
- `features/recording/controller.ts` là Module điều khiển buổi với Interface nhỏ: `start`, `stop`, `snapshot`, `subscribe`, `setTranslationModel`. UI không tự giữ mic hoặc gọi provider.
- `storage/recordings.ts` là Module lưu trữ: tạo buổi, thêm chunk/caption, liệt kê phân trang, đổi tên, lưu kết quả AI, xóa audio hoặc cả buổi. Dùng Dexie cho IndexedDB; không tự viết wrapper tổng quát nhiều tầng.
- `server/ai/` biết provider; `features/` chỉ biết hợp đồng ở `shared/`. Server không import browser storage; client không import server/config secret.
- Các browser API chỉ khởi tạo ở client sau tương tác người dùng, không truy cập `window`, IndexedDB hay mic trong lúc SSR. Đổi route không được tạo lại owner đang thu.
- Dùng React Context và subscription cho phiên hoạt động; chưa cần thêm global state library. Chỉ hai Adapter provider thực; fake Adapter nằm trong test.

Quy ước App Router, route groups và cách tách `src/app` khỏi mã tính năng theo [cấu trúc Next.js](https://nextjs.org/docs/app/getting-started/project-structure). Cấu trúc trên là lựa chọn của dự án, không phải tất cả đều do framework bắt buộc.

### 8.3 File Flutter để đối chiếu, không chép trực tiếp sang web

| File hiện có dưới `app/lib/` | Phần đối chiếu | Đích web |
|---|---|---|
| `ai_config.dart`, `ai_settings_page.dart` | Provider/model, glossary, ngữ cảnh; key cũ ở secure storage | `config/`, `features/settings/` |
| `ai_client.dart`, `translation_prompt.dart` | Dịch streaming và quy tắc giữ nghĩa | `server/ai/`, ba prompt tách riêng |
| `live_utterance_assembler.dart`, `live_translation_scheduler.dart` | Hai chế độ, caption/revision, chống kết quả cũ | `features/recording/` |
| `classroom_controller.dart`, `classroom_session_owner.dart` | Vòng đời phiên, dừng thủ công, owner độc lập page | `controller.ts`, `recording-context.tsx` |
| `session_store.dart`, `history_store.dart`, `session_history_page.dart` | Lưu, xóa audio riêng, export JSON/WAV, bản ghi cũ | `storage/`, `features/library/` |
| `gemini_streaming_recognizer.dart`, `openai_streaming_recognizer.dart`, `pcm_resampler.dart` | Thuộc pipeline live STT cũ | Không port; thay bằng Web Speech |

Nền Flutter đã kiểm tra là `0.4.0+6000`, SQLite schema version 5. Khi bổ sung mục GitHub/Vercel ngày 30/09/2026, `web/` đã có các file cấu hình khởi tạo, thư mục gốc local chưa là Git repository và repo `Tlerd/Translate` đang trống. Chưa xác nhận phần web đã triển khai đủ. Model tiếp theo đọc trạng thái mới nhất, giữ mã đang có và thực hiện quy trình Git ở mục 5.3.

## 9. Dữ liệu bản ghi và chuyển từ APK

Schema web độc lập, không dùng số version SQLite cũ làm version IndexedDB:

| Kho dữ liệu | Trường tối thiểu |
|---|---|
| `recordings` | `id`, `title`, `createdAt`, `endedAt`, `mode`, cặp ngôn ngữ, `state`, `durationMs`, `audioState`, cấu hình không bí mật |
| `audioChunks` | Khóa `[recordingId, sequence]`, Blob, MIME, thời gian ghi; không ghép cả buổi vào RAM lúc thu |
| `captions` | `id`, `recordingId`, `blockId`, `startMs`, `endMs`, `source`, `revision`, `isFinal`, `translation`, `targetSourceRevision`, `translationModelKey`, trạng thái |
| `summaries` | `id`, `recordingId`, snapshot/hash nguồn, `preset: default`, model, kết quả có cấu trúc, thời gian tạo |
| `images` | `id`, `recordingId`, `summaryId`, hash tóm tắt, model, Blob/MIME, kích thước, thời gian tạo |
| `settings` | Model dịch/ảnh đã chọn, locale, glossary/ngữ cảnh; không chứa key |

- Audio chunk của MediaRecorder không nhất thiết phát riêng được: phát lại ghép đúng thứ tự của cùng stream; kiểm thử seek và file sau gián đoạn. Export dữ liệu dài phải kiểm tra RAM trên điện thoại, dùng đường ghi theo luồng nếu API hỗ trợ; nếu không đủ tài nguyên, báo giới hạn thay vì mất dữ liệu.
- Lưu kết quả AI đúng `recordingId` đã gửi dù người dùng chuyển trang. Tóm tắt mới chỉ thay kết quả đang hiển thị sau khi lưu thành công; nếu nguồn đổi thì đánh dấu cũ. Kết quả đang trả về không được hồi sinh buổi đã bị xóa.
- Xóa audio giữ captions/tóm tắt/ảnh; xóa cả buổi xóa các dữ liệu con theo một giao dịch. Buổi đang thu bị chặn xóa; với tác vụ AI đang chạy, hủy và vô hiệu response trước khi xóa.
- Khi reload sau lỗi: buổi chưa đóng được chuyển sang gián đoạn với phần đã lưu. Không tự bật mic, dịch lại, tóm tắt hoặc tạo ảnh. Không tự nâng dữ liệu cũ thành dữ liệu đầy đủ.
- Export web có `schemaVersion`, metadata, captions, tóm tắt, ảnh và audio có định dạng thật; không chứa secret. Import validate schema/ID/kích thước trước khi ghi; ID trùng tạo ID mới và sửa khóa tham chiếu.
- Chuyển dữ liệu APK qua thao tác xuất `conversation.json` + `conversation.wav`, rồi nhập ở web. Importer đọc schema thật trong `app/lib/session_store.dart`, đổi sample index 16 kHz sang millisecond, giữ phần thiếu/đã xóa và bỏ cấu hình live/key. Không sửa database APK tại chỗ.
- Preview URL, Production URL và thiết bị khác nhau có kho browser khác nhau. Chuyển qua xuất/nhập thủ công; đồng bộ đa thiết bị không thuộc bản đầu. Web/PWA ở đây không được quảng cáo là hệ thống dịch hoàn toàn offline.

## 10. Thứ tự giao việc cho model triển khai

Chia thành các bước nhỏ có đầu ra rõ. Model hoàn thành và báo kiểm tra của một bước trước khi mở rộng sang bước tiếp theo; không bắt đầu bằng dựng lại giao diện theo ảnh.

| Bước | Việc làm và file chính | Điều kiện hoàn thành |
|---|---|---|
| P0: Xác minh nền | Đối chiếu app, thử Web Speech + MediaRecorder, MIME và lưu chunk trên Chrome Android/Realme C3; kiểm tra model/SDK/quota hiện có | Có bảng đạt/chưa đạt, mẫu transcript và audio phát được; biết hạn chế browser trước khi hứa thay APK |
| P1: Khung web và dữ liệu | Tiếp tục `web/` đã có, bổ sung cấu hình npm/TS/Next, `shared/recording.ts`, `storage/`, AppShell và sidebar; chuẩn bị Git/ignore theo mục 5.3 | Tạo/đổi tên/mở/xuất/nhập/xóa bản ghi bằng dữ liệu mẫu; refresh và chuyển route ổn; chưa cần AI |
| P2: Thu và nhận giọng | `features/recording/` trừ gọi model thật | Hai chế độ ghép câu, ghi đủ chunk, Kết thúc vô hiệu callback muộn; chuyển sidebar không mất buổi |
| P3: AI server và dịch | `config/`, `shared/ai-contracts.ts`, auth/guard/quota, hai Adapter, prompt dịch, models/translate routes, scheduler | Nhánh dịch ưu tiên model rẻ, sát lời nói; chặn dùng model tóm tắt; SSE/revision/cancel/429 đúng; không dịch bù |
| P4: Tóm tắt và ảnh | Hai prompt/tác vụ/route còn lại, hai panel, lưu kết quả | Model tóm tắt mạnh/ổn khác model dịch, chỉ chạy khi bấm; một preset Mặc định; sau đó tạo ảnh bằng model ảnh đã chọn; lưu/mở lại được |
| P5: Nghiệm thu mobile/web | Test chức năng rủi ro + kiểm tra browser desktop/mobile + buổi 60 phút | Qua các ca bên dưới; giới hạn còn lại ghi rõ trong README; chưa đạt thì chưa thay APK |
| P6: GitHub/Vercel/PWA | Hoàn thành mục 5.3: init Git nếu thiếu, commit/push vào `Tlerd/Translate`, kiểm tra env/auth callback và manifest/icon, theo dõi/sửa deployment đến khi đạt | Commit cuối đã lên GitHub; Vercel `READY` đúng commit; `https://translate-psi-khaki.vercel.app/` hoạt động đúng; báo rõ kết quả từng provider và thiết bị |

Kiểm tra tập trung:

- `recording.test.ts`: interim/final không lặp, revision/epoch/model đổi không ghi đè sai, một active + một pending, stop thắng reconnect đến muộn, không tự chạy hàng cũ sau mất mạng.
- `ai.test.ts`: allowlist/capability/allowedTasks/key theo nhiệm vụ; chặn hai default trùng model và request dịch cố dùng model tóm tắt. Kiểm tra auth/quota, schema tóm tắt và caption reference, stream lỗi/hủy, idempotency, payload/timeout. Dùng fake cho tình huống lỗi; có smoke test nhỏ riêng cho tài khoản thật.
- `storage.test.ts`: migration không mất dữ liệu, chunk ghi theo thứ tự, thiếu dung lượng, xóa audio/cả buổi, export/import kể cả JSON/WAV từ APK, response muộn sau xóa.
- `app.spec.ts`: sidebar và đổi bản ghi, chọn model, hai chế độ học; xác nhận không gọi `/api/summarize` trước khi bấm Tóm tắt và không gọi `/api/images` trước khi bấm Tạo ảnh. Kiểm tra lưu/mở lại, trạng thái thiếu cấu hình; viewport 360/390 px và desktop 1.366 px không tràn/chồng nội dung. Automation giả STT không thay thử mic thật.
- Trên máy thật: quyền mic từ chối/thu hồi, mất mạng, khóa màn/chuyển app, cuộc gọi đến, đổi tai nghe/mic ngoài, ghi 60 phút, nghe/seek/xuất audio, dung lượng và RAM. Ghi riêng điều đã thử, điều chưa thử và điều browser không đáp ứng.

Lệnh kiểm tra sẽ khai báo trong `web/package.json`: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build`. Khóa version dependency trong lockfile sau P0. Không chạy test Flutter để tuyên bố web đã đạt.

### Prompt bàn giao ngắn

> Đọc `D:/idea/may-dich-offline/DINH-HUONG-APP-WEB-VA-MODEL.md` và triển khai lần lượt P0–P6 khi được giao triển khai. Đây là rebuild web responsive trong `web/`, giữ `app/` và `releases/` làm đối chiếu. Hai phần độc lập: A dịch sát nút bằng model ưu tiên rẻ; B chỉ khi bấm Tóm tắt mới gọi model mạnh/ổn khác model dịch, tạo một preset Mặc định rồi cho phép tạo ảnh. Hai model dịch/tóm tắt bắt buộc khác nhau, không dùng chung dù khác prompt/API; server phải kiểm tra điều này. STT dùng Web Speech; ảnh có API/model sinh ảnh riêng trong phần B. Dùng cây file mục 8, hợp đồng mục 4 và nghiệm thu mục 10. Chỉ lấy ý tưởng sidebar chứa bản ghi từ ảnh, không thiết kế lại toàn bộ giao diện. Giữ dừng thủ công, hai chế độ học, bản gốc/dịch, không dịch bù, không tự xóa. Báo rõ phần mock và phần đã thử thật; không tự bật dịch vụ trả phí. Nếu thiếu tài khoản/quyền cho kiểm thử thực, hoàn thành phần độc lập và ghi điều kiện còn thiếu, không tuyên bố đã deploy hoặc hoạt động thực.

> Phần phát hành bắt buộc của cùng công việc: đưa mã web lên `https://github.com/Tlerd/Translate`. Nếu gốc `D:/idea/may-dich-offline/` chưa có Git thì `git init` tại đó, kiểm tra remote/lịch sử trước khi gắn `origin`, commit và push theo mục 5.3. Dùng dự án Vercel người dùng đã liên kết, Root Directory `web`, URL Production `https://translate-psi-khaki.vercel.app/`. Theo dõi đúng commit, sửa lỗi rồi commit/push tiếp đến khi mã cuối đã lên repo và deployment hoạt động; không dừng ở việc chỉ hướng dẫn người dùng tự push. Nội dung này chỉ được thực hiện khi nhận nhiệm vụ triển khai, không trong lượt lập kế hoạch.

**Trạng thái cuối tài liệu: đã bổ sung kế hoạch GitHub/Vercel; lượt này không init Git, commit, push hoặc deploy. P0–P6 chưa được nghiệm thu qua lượt cập nhật tài liệu này.**
