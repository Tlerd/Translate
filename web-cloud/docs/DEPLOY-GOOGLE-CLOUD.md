# Deploy bản `web-cloud` lên Google Cloud Run

`web-cloud/` là bản chạy bằng container, chỉ dùng dịch vụ theo chuẩn:

| Phần | Chuẩn | Gói đang dùng (gói 1) | Đổi sau này bằng |
|---|---|---|---|
| Chạy app | Docker | Google Cloud Run | AWS Lightsail Containers / ECS, Fly.io, Railway… |
| Database | Postgres (`DATABASE_URL`, driver `pg`) | Neon | Cloud SQL, AWS RDS, Supabase |
| Redis (tùy chọn) | Giao thức Redis (`REDIS_URL`) | không dùng; app tự đếm trong bộ nhớ | Upstash, Memorystore, ElastiCache |
| Kho audio | S3 API (`S3_*`) | Cloudflare R2 | AWS S3, Google Cloud Storage, Backblaze B2 |

Đổi nhà cung cấp chỉ cần đổi biến môi trường (và chép dữ liệu nếu đổi database). Bản Vercel ở `web/` không bị ảnh hưởng.

## Chi phí ước tính (một người dùng, ~40 giờ ghi/tháng)

| Dịch vụ | Hạn miễn phí | Ước tính |
|---|---|---|
| Cloud Run | Hạn mức CPU/RAM hằng tháng; instance tắt khi không dùng | 0 USD |
| Cloud Build + Artifact Registry | Có hạn miễn phí; nên giữ 3 image gần nhất | 0–0,2 USD |
| Secret Manager | 6 phiên bản key miễn phí, sau đó ~0,06 USD/key | 0–0,2 USD |
| Neon | Free plan | 0 USD |
| Cloudflare R2 | 10 GB lưu trữ, tải xuống miễn phí | 0 USD (dưới 10 GB) |
| **Tổng** | | **≈ 0–1 USD/tháng** |

Google Cloud và R2 đều bắt buộc gắn thẻ thanh toán dù dùng trong hạn miễn phí. Nên đặt Budget alert (Billing → Budgets & alerts, ví dụ 5 USD).

## Chưa có tên miền

Không cần. Cloud Run cấp sẵn địa chỉ https miễn phí, cố định theo project:
`https://translate-web-<PROJECT_NUMBER>.asia-southeast1.run.app`.
Sau này mua tên miền thì sửa 3 chỗ: `AUTH_URL`, redirect URI của Google OAuth, CORS của bucket R2.

## A. Việc bạn tự làm (cần đăng nhập/thanh toán)

Chuẩn bị các giá trị sau. Chúng chỉ được nhập vào script ở bước B (gõ ẩn), không gửi cho ai.

1. **Google Cloud**: <https://console.cloud.google.com> → tạo project (ví dụ `translate-web`) → gắn billing account.
2. **Neon** (database): Vercel → project `translatees` → **Storage** → database Neon → **Open in Neon** →
   **Branches** → **Create branch** tên `cloud` (copy từ `main`) → **Connect** → bật **Connection pooling** →
   chép chuỗi `postgresql://...-pooler...?sslmode=require`.
   Branch riêng giúp bản cloud không lẫn metadata audio với bản Vercel.
3. **Cloudflare R2** (kho audio): <https://dash.cloudflare.com> → **R2 Object Storage** → bật R2 (cần thẻ) →
   **Manage API tokens** → **Create API token** → quyền **Admin Read & Write** → chép **Access Key ID**,
   **Secret Access Key**, và **Account ID** (hiện ở trang R2). Script tự tạo bucket và CORS.
4. **Google OAuth** (đăng nhập): Google Cloud project đang chứa OAuth client của bản Vercel →
   **APIs & Services → Credentials** → OAuth 2.0 Client → chép **Client ID**; bấm **Add secret** để lấy
   **Client secret** mới (secret cũ không xem lại được).
5. **Gemini API key**: <https://aistudio.google.com/apikey> → chép key (hoặc tạo key mới).
6. **Soniox API key** (nếu dùng Soniox): <https://console.soniox.com> → API keys.

Key trên Vercel đặt chế độ *sensitive* nên không đọc lại được; phải lấy từ nguồn như trên.

## B. Chạy script (tự động)

Mở **Cloud Shell** (nút `>_` góc trên phải console, đã đăng nhập sẵn) rồi chạy:

```bash
gcloud config set project translate-web            # thay bằng Project ID của bạn
git clone https://github.com/Tlerd/Translate.git
cd Translate
bash web-cloud/scripts/deploy-cloud-run.sh
```

(Nếu PR `web-cloud` chưa merge vào `main`, thêm `-b claude/stoic-einstein-ydz9dn` vào lệnh `git clone`.)

Script `web-cloud/scripts/deploy-cloud-run.sh` làm:

1. Bật API Cloud Run, Cloud Build, Artifact Registry, Secret Manager; cấp quyền build cho service account mặc định.
2. Hỏi cấu hình thường (email chủ, Client ID, Account ID R2, tên bucket) và lưu ở `~/.translate-web.conf`.
3. Hỏi key bí mật (gõ ẩn) và lưu vào **Secret Manager**; `AUTH_SECRET` tự sinh.
4. Tạo bucket R2 private và CORS cho đúng địa chỉ Cloud Run.
5. Build bằng `web-cloud/Dockerfile` và deploy: Singapore, 1 vCPU, 1 GiB, timeout 300 giây, 0–2 instance, giữ CPU sau response.
6. Kiểm tra trang đăng nhập và in việc còn lại.

Chạy lại bất cứ lúc nào để cập nhật code: key đã lưu được dùng lại. Nhập lại một key: `RESET=GOOGLE_API_KEY bash web-cloud/scripts/deploy-cloud-run.sh`.

## C. Việc cuối (cần đăng nhập Google Cloud Console)

Script in ra redirect URI. Vào OAuth client ở bước A.4 → **Authorized redirect URIs** → thêm
`https://translate-web-<PROJECT_NUMBER>.asia-southeast1.run.app/api/auth/callback/google` (giữ URI của Vercel) → **Save**.
Đợi vài phút rồi mở `<URL>/app`, đăng nhập, thử dịch, ghi âm, đồng bộ, nghe lại trên thiết bị khác.

## Tự deploy khi push (tùy chọn)

Cloud Run → `translate-web` → **Set up continuous deployment** → GitHub → repo `Tlerd/Translate`, nhánh `^main$`,
Build type **Dockerfile**, Source location `/web-cloud/Dockerfile`, build context `/web-cloud`. Biến môi trường và key giữ nguyên.

Artifact Registry → `cloud-run-source-deploy` → **Cleanup policies** → "Keep most recent versions" = 3.

## Vận hành

- Log: Cloud Run → `translate-web` → **Logs**.
- Quay lại bản cũ: Cloud Run → **Revisions** → chọn revision → **Manage traffic** → 100%.
- Tên miền riêng: Cloud Run → **Manage custom domains**; sau đó sửa `AUTH_URL`, redirect URI, chạy lại script để cập nhật CORS với `SERVICE_URL=https://ten-mien-cua-ban`.

## Đổi nhà cung cấp sau này

- **Database sang Cloud SQL / RDS:** tạo Postgres mới, chép dữ liệu `pg_dump "$NEON_URL" -Fc -f db.dump && pg_restore -d "$NEW_URL" --no-owner db.dump`, rồi `RESET=DATABASE_URL` chạy lại script. Driver `pg` coi `sslmode=require` là kiểm tra chứng chỉ đầy đủ: Neon chạy ngay; Cloud SQL/RDS dùng chứng chỉ riêng thì thêm `sslrootcert=<file CA>` hoặc `&uselibpqcompat=true`. Mỗi instance giữ tối đa 5 kết nối (`DATABASE_POOL_MAX`).
- **Kho audio sang S3 / GCS:** tạo bucket private + CORS tương tự (`web-cloud/scripts/r2-setup.mjs` dùng được với mọi kho chuẩn S3), chép object (`rclone sync`), đổi `S3_*`.
- **Sang AWS:** cùng `Dockerfile` chạy trên Lightsail Containers hoặc ECS Fargate; đặt cùng biến môi trường, cập nhật `AUTH_URL`, redirect URI, CORS.
