# Ghi âm, đồng bộ và kiểm chứng phiên đăng nhập

Mã nguồn đợt sửa ngày 03/10/2026 nằm trong `web`. Web kiểm chứng đúng: [translate-ruby-phi.vercel.app/app](https://translate-ruby-phi.vercel.app/app). Các hướng dẫn phát hành trong tài liệu thiết kế cũ không phải kết quả triển khai của đợt sửa này.

## Cách lưu và đồng bộ

Một MediaRecorder thu xuyên suốt buổi, kể cả khoảng **Dừng API**. PCM gửi đến nhận giọng được dừng riêng; lời đã nhận và bản dịch đang xử lý vẫn được chốt. Stop chờ `dataavailable` cuối và toàn bộ thao tác lưu chunk trước khi đóng buổi.

Timeline bắt đầu khi MediaRecorder thực sự chạy, không gồm thời gian chờ quyền micro. Từng frame PCM gửi phiên âm có mốc thu trên file toàn buổi; việc VAD bỏ im lặng dài hoặc đổi bộ nhận diện không nén mốc câu lại. Hai regression trước sửa bắt được buổi thu 2 giây thành 9 giây do chờ micro 7 giây, và câu bắt đầu 10 giây bị tính theo audio đã gửi; sau sửa mốc thu được giữ.

Với nhận giọng Live không trả timestamp của lời nói, mốc câu vẫn là ước lượng theo thời điểm nhận kết quả; chưa có căn chỉnh chính xác từng từ trên audio. Phiên âm theo đoạn có timestamp dùng mốc thu PCM làm điểm bắt đầu.

Dexie/IndexedDB version 5 giữ chunk gốc, metadata đoạn cũ, file đã chuẩn hóa (`audioAssets`) và công việc cần upload/xóa (`audioJobs`). Worker Mediabunny đọc từng luồng theo thứ tự đoạn và sequence, chỉnh timeline, tính thời lượng Opus từ TOC khi container thiếu duration, xử lý riêng các luồng có độ trễ codec. Bản đóng gói được đọc lại để kiểm tra thời lượng metadata và packet khi remux; chỉ lưu file mới sau kiểm chứng. Nghe lại/tải xuống dùng một file; thời gian buổi học khác thời lượng thực được ghi riêng. [API packet Mediabunny](https://mediabunny.dev/guide/media-sources).

Neon PostgreSQL giữ `recording_sync` cho chữ/tóm tắt và `recording_audio` cho metadata audio độc lập: định dạng, thời lượng thực, kích thước, SHA-256, phiên bản file và trạng thái. Vercel Blob **private** giữ bytes. Quyền upload multipart chỉ cho đường dẫn đã đăng ký, định dạng/dung lượng đúng và tài khoản sở hữu; hết hạn sau một giờ. Upload trực tiếp trình duyệt → Blob; server kiểm tra lại size/MIME và hash bằng stream trước khi chuyển metadata sang `available`. [Signed URLs Vercel](https://vercel.com/docs/vercel-blob/vercel-signed-urls).

Sau stop, hàng đợi được ghi trước và chuẩn hóa chạy cả khi offline. Upload chạy sau đồng bộ chữ để server kiểm tra quyền sở hữu. Mở lại ứng dụng, quay lại tab, có mạng hoặc bấm nút đồng bộ đều tiếp tục hàng đợi; backoff 5 giây đến 5 phút. Trước upload lại, client thử xác nhận file đã có để xử lý trường hợp đóng tab ngay sau upload. Tên file theo checksum và phiên bản tránh tạo nhiều object cho cùng nội dung.

Audio cũ được đưa vào hàng đợi trên thiết bị còn giữ file gốc. Thiết bị khác chỉ tải bytes khi mở nghe, lấy quyền GET private 15 phút, thử lấy quyền mới khi URL hết hạn, kiểm SHA-256 rồi cache cục bộ. Upload thành công vẫn giữ file gốc trên A và file chuẩn hóa trên cả A/B.

Xuất bundle và phân biệt lại người nói cũng lấy cùng file đã kiểm chứng như trình phát, kể cả audio hiện chỉ có trên cloud. Phân biệt người nói kiểm giới hạn dung lượng trước download và dùng thời lượng file thực; không nối thô lại các container cũ. Các chunk gốc vẫn giữ sau khi xuất.

Xóa audio hoặc cả buổi tạo dấu xóa bền vững. Server ghi dấu xóa audio cùng CAS xóa chữ trong một câu SQL, kể cả client cũ chỉ dùng API chữ; CAS thất bại không xóa audio. Thiết bị khác áp dụng dấu xóa trước khi backfill và gỡ cache/chunk. Dấu xóa không được đổi lại thành file có sẵn. API xóa gỡ object ngay khi có thể; đường dẫn vẫn được giữ để dọn upload đến muộn sau khi quyền PUT hết hạn. Việc dọn được thử trong lần tải danh sách metadata tiếp theo. Audio sẵn có không có TTL tự xóa; giữ đến khi người dùng xóa.

## Cấu hình trước khi kiểm chứng cloud thật

1. Dự án Vercel đặt Root Directory `web`; URL app là URL ở đầu tài liệu.
2. Điền `DATABASE_URL` (hoặc `POSTGRES_URL`) của Neon. Tài khoản DB cần quyền tạo bảng; API tự tạo hai bảng khi dùng.
3. Trong [Storage của translatees](https://vercel.com/group4-s-projects/translatees/stores), tạo Blob store loại **private**, prefix `BLOB`, bật **Add a read-write token env var to this connection** để có `BLOB_READ_WRITE_TOKEN` cho server. Biểu mẫu hiện kết nối Production và Preview; chỉ có `BLOB_STORE_ID`/`BLOB_WEBHOOK_PUBLIC_KEY` chưa đủ cho adapter hiện tại. Giữ token ngoài Git và các biến `NEXT_PUBLIC_*`.
4. Đặt `AUTH_SECRET`, `OWNER_EMAIL`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`; production `AUTH_URL=https://translate-ruby-phi.vercel.app`, callback Google `/api/auth/callback/google` trên cùng origin. Local dùng origin local, không sao chép URL production vào server local.
5. Deploy mã và cấu hình cùng phiên bản, sau đó kiểm tra A/B dưới đây. Thiếu Blob không chặn lưu local hoặc đồng bộ chữ: UI báo audio chờ/lỗi, không báo đã đồng bộ audio.

Giới hạn hiện tại: 512 MiB/file, 24 giờ/file; chuẩn hóa và SHA-256 trên client còn dùng buffer của file nén. Cần thử thêm file dài trên điện thoại có ít RAM. File cũ mất metadata phân đoạn hoặc có codec hỏng có thể không chuẩn hóa được; UI báo lỗi và giữ chunk gốc. Không khôi phục được audio đã mất khỏi thiết bị chỉ từ chữ trên Neon.

## Kết quả đã kiểm tra

| Phần | Bằng chứng | Phạm vi |
|---|---|---|
| Lỗi ghép audio cũ | 3 file Opus thực có tổng 2,58 s; concat thô kết thúc 0,839 s. Worker cho file 2,58 s, decode và nghe HTML đều tới 2,58 s; tone 300/600/900 Hz đúng thứ tự. | Chrome, MediaRecorder thật, worker thật; không dùng micro người thật. |
| Codec/tail/chunk | Opus packet cuối không mất; stop chờ write đến muộn, sequence 0–10 đủ. Hai luồng MP4/AAC có tổng decode 1,16 s; chuẩn hóa/phát 1,18 s trong ngưỡng độ trễ codec. | Chrome/WebCodecs; chưa phải Safari iPhone. |
| Luồng ứng dụng | Một recorder/micro qua 3 lần pause/resume API, chuyển settings và quay lại; stop khi paused. File 5,22 s trong lần kiểm tra, đủ khoảng nghỉ, native player hữu hạn, tua 5%/50%/85%, download đúng bytes, chunk gốc và job còn giữ khi cloud lỗi. | App production local; media, worker và IndexedDB thật; OAuth/AI/cloud là fixture. |
| Ngôn ngữ/UI | Nhật → Việt mặc định; 83 mã Transcribe, 100 mã Flash Live, 180 lựa chọn đầu ra; search không dấu, swap, reload, khóa lúc thu và lưu pair vào buổi. Đổi model giữ đầu ra và chọn đầu vào được hỗ trợ. API nhận nguyên `yue-Hant-HK`; route nhận `es-419`, script và mã sai bị từ chối. Sidebar upload bỏ; menu desktop ẩn, phone đóng khi chọn/bấm ngoài; bản dịch đủ vùng cuộn ở 320×568/360×800. | Playwright Chrome; không chứng minh chất lượng ASR của mọi mã. |
| Đồng bộ A/B | Upload A → phát/cache B; URL cũ 403 lấy lại quyền; offline/restart xác nhận lại tránh upload trùng; xóa và upload đến muộn không hồi sinh file. | Hai database IndexedDB độc lập, transport Blob/Neon được mô phỏng ở ranh giới; chưa là hai thiết bị cloud production. |
| Quyền API | Session giả/wrong owner/hết hạn bị từ chối; grant giới hạn path/size/MIME; giả checksum không được complete; dấu xóa vẫn giữ khi storage lỗi; body quá lớn trả 413. | Vitest gọi route/service thật, SDK DB/Blob mock. |

Chạy `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`; sau build chạy `node scripts/serve-fixture.cjs` ở terminal riêng, rồi `node scripts/check-fixture.cjs auth`, `browser`, `ui`. `npm run test:audio` tự mở server tạm. Report và screenshot ở `test-results/auth`, `browser`, `ui`, `audio` (được Git ignore). Các fixture không gửi âm thanh tới Google hoặc kho Blob thật.

Kết quả bản mã cuối ngày 03/10/2026: lint, typecheck, build đạt; **210 kiểm thử Vitest trong 33 file** đạt. Các script auth, browser, ui và audio đạt. Kiểm tra UI dùng MediaRecorder/worker thật; kiểm tra audio gồm cả Opus và MP4/AAC. Quyền cloud, upload, retry và hai database A/B được kiểm bằng fixture, chưa bằng Neon/Blob production. Ảnh điện thoại chờ drawer đóng hẳn trước khi chụp; kiểm tra cả đóng khi bấm ngoài và chọn bản ghi.

## Đăng nhập: kết luận và phần còn chưa xác nhận

Layout, login, cấu hình Auth.js và guard dùng cùng tài khoản chủ/cách chọn secure cookie theo origin/proxy. Session giữ mặc định 30 ngày. SessionProvider gọi Auth.js khi quay lại tab và mỗi 5 phút lúc online; endpoint này có ghi lại `Set-Cookie`, khác với việc chỉ đọc token ở RSC/guard. Router refresh khi session được gia hạn để loại dữ liệu điều hướng cũ, giữ controller đang thu.

Regression bắt được trước sửa: cookie `__Secure-authjs.session-token` hợp lệ trên HTTPS ở môi trường không-production bị API guard trả 401 do guard chọn cookie bằng `NODE_ENV`; sau sửa được chấp nhận. Đây là lỗi cấu hình được chứng minh, chưa xác định là nguyên nhân báo cáo văng login trên Vercel.

Kiểm thử bản production local với JWT do Auth.js encode: layout/login/API cùng owner; anonymous, cookie giả, hết hạn, sai tài khoản, đăng xuất bị từ chối; cookie thật được endpoint Auth.js gia hạn 30 ngày. Reload, chuyển trang, Back/Forward nhiều vòng trên desktop và 390×844, nhiều tab và quay lại tab đều đạt.

Đã kiểm tra production cũ bằng phiên Google thật trong Chrome: cookie secure/HttpOnly/SameSite Lax tồn tại; ba vòng reload settings → app → Back → Forward không có redirect về login; kiểm tra ở viewport 390×844 cũng đạt. HTML/RSC phản hồi 200, RSC có private/no-store. Mở trực tiếp `/api/auth/session` trong trình duyệt đó bị `ERR_BLOCKED_BY_CLIENT`; chưa kết luận được nguồn chặn hay xem đó là nguyên nhân lỗi app. Không thay đổi phần mở rộng/bảo vệ trình duyệt. Vẫn chưa tái hiện được redirect sai của báo cáo ban đầu, vì vậy **chưa nghiệm thu lỗi văng login trên production**.

Mô tả bổ sung của người dùng: bấm chức năng bị đưa ra landing, bấm đăng nhập lại vào ngay. Đợt kiểm tra tiếp đã bấm tab bản dịch/tóm tắt, đổi Luyện đọc → Giảng bài, mở bản ghi đã lưu, mở sửa kịch bản rồi Hủy và vào Cấu hình AI bằng phiên Google thật. Không quan sát thấy về landing/login; các phản hồi RSC/API đã thu đều 200, các nút chức năng không nằm trong form đăng xuất. Chưa coi việc vào lại ngay là bằng chứng phiên hết hạn, và chưa kết luận được nguyên nhân. Bằng chứng đã loại giá trị cookie/token ở `test-results/setup/function-navigation.json` (Git ignore).

## Nghiệm thu còn cần môi trường thật

- Safari iPhone thật: ghi lời nói liên tục 10–30 phút, nghỉ API nhiều lần, kết thúc lúc nghỉ; không mất/lặp tiếng và tua đầu/giữa/cuối đúng. Kiểm tra khi đổi app, khóa màn hình, micro bị OS ngắt và browser báo quota. Không dùng viewport Chrome làm bằng chứng Safari.
- A/B cloud: cùng owner, thu ở A và nghe ở B khi A đóng tab; đối chiếu SHA-256/thời lượng và tiếng nói. Mất mạng trong upload, đóng tab sau upload trước confirm, mở lại; file chỉ có một object theo checksum. Thử URL nghe hết hạn và xóa từ cả hai phía.
- Dữ liệu cũ trên máy còn gốc: nhiều đoạn, đoạn nghỉ, chunk cuối đến muộn; nghe so sánh trước/sau với thời lượng decode và nội dung. Gốc còn giữ đến khi xác nhận.
- Login production: tải lại/chuyển trang/Back/Forward, nhiều tab, quay lại sau nghỉ dài trên desktop và iPhone. Bắt redirect sai bằng network log đã loại token/cookie value, đối chiếu cookie name/flags/expiry và session/Auth.js response trước/sau mới kết luận sửa xong.

Không có credential Neon/Blob production trong workspace. Đã mở đúng dự án `translatees` của `group4's projects` bằng Chrome và xác nhận Neon đang kết nối Preview/Production. Người dùng đã tạo Blob `translatees-audio-private` (`store_DjYt3cIiEMk10HAi`); đã xác nhận Private, Singapore (`sin1`) và kết nối `translatees` ở **Production, Preview** với các biến `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID`, `BLOB_WEBHOOK_PUBLIC_KEY`. Không mở hoặc sao chép giá trị token. Adapter hiện tại dùng `BLOB_READ_WRITE_TOKEN`, đúng biến của kết nối này. Ảnh kiểm chứng ở `test-results/setup/blob-private-connected.jpg` (Git ignore). Tại thời điểm kiểm tra cấu hình Blob, trước phát hành: mã API/cloud đã có và kho đã kết nối; chưa thử upload/phát/xóa qua API mới trên production và chưa nghiệm thu iPhone thật. Kết quả kiểm tra sau deploy phải được ghi riêng, không dùng fixture làm bằng chứng cloud thật.
