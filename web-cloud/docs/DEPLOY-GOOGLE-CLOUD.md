# Deploy bản `web-cloud` lên Google Cloud Run

`web-cloud/` là bản chạy bằng container, chỉ dùng dịch vụ theo chuẩn:

| Phần | Chuẩn | Gói đang dùng (gói 1) | Đổi sau này bằng |
|---|---|---|---|
| Chạy app | Docker | Google Cloud Run | AWS Lightsail Containers / ECS, Fly.io, Railway… |
| Database | Postgres (`DATABASE_URL`, driver `pg`) | Neon | Cloud SQL, AWS RDS, Supabase |
| Redis | Giao thức Redis (`REDIS_URL`) | Upstash | Memorystore, ElastiCache, Redis Cloud |
| Kho audio | S3 API (`S3_*`) | Cloudflare R2 | AWS S3, Google Cloud Storage, Backblaze B2 |

Đổi nhà cung cấp chỉ cần đổi biến môi trường (và chép dữ liệu nếu đổi database). Bản Vercel ở `web/` không bị ảnh hưởng.

## Chi phí ước tính (một người dùng, ~40 giờ ghi/tháng)

| Dịch vụ | Hạn miễn phí | Ước tính |
|---|---|---|
| Cloud Run | Hạn mức CPU/RAM hằng tháng; instance tắt khi không dùng | 0 USD |
| Cloud Build + Artifact Registry | Có hạn miễn phí; giữ 3 image gần nhất | 0–0,2 USD |
| Neon | Free plan (dung lượng nhỏ, đủ cho chữ/tóm tắt) | 0 USD |
| Upstash Redis | 500K lệnh/tháng, 256 MB | 0 USD |
| Cloudflare R2 | 10 GB lưu trữ, tải xuống miễn phí | 0 USD (dưới 10 GB, ~1 năm audio 32 kbps) |
| **Tổng** | | **≈ 0–1 USD/tháng** |

Cloud Run và R2 đều yêu cầu gắn thẻ thanh toán dù dùng trong hạn miễn phí. Đặt Budget alert (Google Cloud → Billing → Budgets & alerts, ví dụ 5 USD).

## Bước 1. Neon (database)

Bản cloud có thể dùng chung database với bản Vercel, nhưng nên tách một **branch** để hai bản không ghi đè audio metadata của nhau (audio Vercel nằm ở Vercel Blob, audio bản cloud nằm ở R2):

1. <https://console.neon.tech> → project đang dùng → **Branches** → **Create branch**, tên `cloud`, tạo từ `main` (copy toàn bộ dữ liệu hiện có).
2. Mở branch `cloud` → **Connect** → bật **Connection pooling** → chép connection string (có `-pooler` và `?sslmode=require`). Đây là `DATABASE_URL`.

Bảng tự tạo khi app chạy lần đầu.

## Bước 2. Upstash (Redis)

1. <https://console.upstash.com> → database Redis đang dùng (hoặc tạo mới, region Singapore).
2. Phần **Connect** → chọn kiểu **TCP / ioredis** → chép URL dạng `rediss://default:<password>@<host>.upstash.io:6379`. Đây là `REDIS_URL`.

Redis chỉ dùng để giới hạn tần suất gọi API; nếu thiếu, app tự dùng bộ đếm trong bộ nhớ.

## Bước 3. Cloudflare R2 (kho audio)

1. <https://dash.cloudflare.com> → **R2 Object Storage** → bật R2 (cần thêm phương thức thanh toán).
2. **Create bucket**: tên `translate-audio`, Location: Automatic (hoặc gợi ý Asia-Pacific). Không bật Public access.
3. **Manage API tokens** → **Create API token**: quyền **Object Read & Write**, giới hạn bucket `translate-audio`. Chép:
   - Access Key ID → `S3_ACCESS_KEY_ID`
   - Secret Access Key → `S3_SECRET_ACCESS_KEY`
   - Endpoint `https://<account_id>.r2.cloudflarestorage.com` → `S3_ENDPOINT`
4. Bucket → **Settings** → **CORS policy** → dán (sửa URL ở bước 7 sau khi có URL Cloud Run):

   ```json
   [
     {
       "AllowedOrigins": ["https://ĐỔI-THÀNH-URL-CLOUD-RUN", "http://localhost:3000"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["content-type"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

## Bước 4. Google Cloud project

1. <https://console.cloud.google.com> → tạo project (ví dụ `translate-web`) → gắn billing account.
2. Mở **Cloud Shell** (nút `>_` góc trên phải; có sẵn `gcloud`, đã đăng nhập):

   ```bash
   gcloud config set project translate-web          # thay bằng Project ID
   gcloud config set run/region asia-southeast1
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
   ```

## Bước 5. Biến môi trường

Trong Cloud Shell tạo `~/env.yaml` (không commit). Các key AI, Auth lấy từ Vercel → Settings → Environment Variables:

```yaml
NODE_ENV: production
TRANSLATION_USAGE_STORE: "on"
GOOGLE_API_KEY: "..."
OPENAI_API_KEY: "..."
SONIOX_API_KEY: "..."
DATABASE_URL: "postgresql://...-pooler...neon.tech/neondb?sslmode=require"
REDIS_URL: "rediss://default:...@....upstash.io:6379"
S3_ENDPOINT: "https://<account_id>.r2.cloudflarestorage.com"
S3_REGION: "auto"
S3_BUCKET: "translate-audio"
S3_ACCESS_KEY_ID: "..."
S3_SECRET_ACCESS_KEY: "..."
AUTH_SECRET: "..."
AUTH_URL: "https://placeholder.invalid"   # sửa ở bước 7
AUTH_GOOGLE_ID: "..."
AUTH_GOOGLE_SECRET: "..."
OWNER_EMAIL: "..."
# Thêm biến khác đang dùng: AI_*_MODEL, SUMMARY_*/IMAGE_*_API_KEY, NEMOTRON_*...
# Danh sách đầy đủ: web-cloud/.env.example
```

> Key lưu thành biến môi trường thường; người có quyền xem service trong project sẽ thấy. Muốn chặt hơn: đưa vào Secret Manager và dùng `--set-secrets`.

## Bước 6. Deploy

```bash
git clone https://github.com/tlerd/translate.git
cd translate/web-cloud
gcloud run deploy translate-web \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --env-vars-file ~/env.yaml \
  --memory 1Gi --cpu 1 \
  --timeout 300 \
  --min-instances 0 --max-instances 2 \
  --no-cpu-throttling
```

- `--source .` build bằng `Dockerfile` trên Cloud Build rồi deploy. Lần đầu hỏi tạo repository `cloud-run-source-deploy`: chọn `Y`.
- `--timeout 300`: các API nhận giọng/tách người nói chạy tới 5 phút.
- `--no-cpu-throttling`: giữ CPU sau khi trả response để `after()` ghi thống kê dịch.
- Repo private: khi `git clone`, đăng nhập GitHub bằng Personal Access Token.

Kết quả in ra `Service URL: https://translate-web-xxxxxxxx.asia-southeast1.run.app`.

## Bước 7. Gắn URL vào đăng nhập và R2

1. Cập nhật `AUTH_URL`:

   ```bash
   gcloud run services update translate-web --region asia-southeast1 \
     --update-env-vars AUTH_URL=https://translate-web-xxxxxxxx.asia-southeast1.run.app
   ```

2. Google Cloud project chứa OAuth client của `AUTH_GOOGLE_ID` → APIs & Services → Credentials → OAuth 2.0 Client → **Authorized redirect URIs** thêm `https://translate-web-xxxxxxxx.asia-southeast1.run.app/api/auth/callback/google` (giữ URI của Vercel).
3. R2 bucket → CORS policy: thay `https://ĐỔI-THÀNH-URL-CLOUD-RUN` bằng Service URL.
4. Mở `<Service URL>/app`, đăng nhập, thử dịch, ghi âm, đồng bộ, nghe lại audio trên thiết bị khác.

## Bước 8 (tùy chọn). Tự deploy khi push

Cloud Run → `translate-web` → **Set up continuous deployment** → GitHub → repo `tlerd/translate`, nhánh `^main$`, Build type **Dockerfile**, Source location `/web-cloud/Dockerfile`, build context `/web-cloud`. Biến môi trường giữ nguyên qua các lần deploy.

Thêm cleanup policy: Artifact Registry → `cloud-run-source-deploy` → Cleanup policies → "Keep most recent versions" = 3.

## Vận hành

- Cập nhật thủ công: `cd ~/translate && git pull && cd web-cloud && gcloud run deploy translate-web --source . --region asia-southeast1`.
- Log: Cloud Run → `translate-web` → Logs.
- Quay lại bản cũ: Cloud Run → Revisions → chọn revision → Manage traffic → 100%.
- Tên miền riêng: Cloud Run → Manage custom domains. Đổi tên miền thì cập nhật `AUTH_URL`, redirect URI và CORS của R2.

## Đổi nhà cung cấp sau này

- **Database sang Cloud SQL / RDS:** tạo Postgres mới, chép dữ liệu `pg_dump "$NEON_URL" -Fc -f db.dump && pg_restore -d "$NEW_URL" --no-owner db.dump`, đổi `DATABASE_URL`. Driver `pg` coi `sslmode=require` là kiểm tra chứng chỉ đầy đủ: Neon chạy ngay; Cloud SQL/RDS dùng chứng chỉ riêng thì thêm `sslrootcert=<file CA>` hoặc `&uselibpqcompat=true` vào URL. Mỗi instance Cloud Run giữ tối đa 5 kết nối (`DATABASE_POOL_MAX`).
- **Kho audio sang S3 / GCS:** tạo bucket private + CORS tương tự, chép object (`rclone sync r2:translate-audio s3:...`), đổi `S3_*`.
- **Sang AWS:** cùng `Dockerfile` chạy trên Lightsail Containers hoặc ECS Fargate; đặt cùng biến môi trường, cập nhật `AUTH_URL`, redirect URI, CORS.
