# Deploy lên Google Cloud Run

Bản Vercel vẫn chạy như cũ. Cloud Run là bản thứ hai, chạy cùng code từ `web/Dockerfile`.

## Cái gì giữ nguyên, cái gì đổi

| Thành phần | Trên Cloud Run |
|---|---|
| Neon Postgres (`DATABASE_URL`) | Giữ nguyên, dùng chung với Vercel. |
| Vercel Blob (`BLOB_READ_WRITE_TOKEN`) | Giữ nguyên. Thư viện `@vercel/blob` gọi được từ mọi nơi bằng token. |
| Upstash Redis | Giữ nguyên. |
| Đăng nhập Google (Auth.js) | Phải thêm redirect URI mới và đổi `AUTH_URL` (bước 5). |
| `maxDuration` trong route | Cloud Run bỏ qua; thay bằng `--timeout=300`. |
| `after()` (ghi thống kê dịch) | Cần `--no-cpu-throttling` để chạy sau khi trả response. |
| Dọn audio mồ côi | Cho phép (không có `VERCEL_ENV`), giống bản production. |

Region nên dùng: `asia-southeast1` (Singapore), gần Việt Nam và cùng vùng với Blob store (SIN1).

## Chi phí

- Cần tài khoản billing (thẻ) dù chỉ dùng phần miễn phí.
- Cấu hình bên dưới (`min-instances=0`, tối đa 2 instance, 1 vCPU, 1 GiB) với một người dùng thường nằm trong hạn mức miễn phí hằng tháng của Cloud Run. Instance tắt khi không có ai dùng; lần mở đầu sau khi tắt chậm vài giây (cold start).
- Cloud Build và Artifact Registry (nơi lưu image) cũng có hạn mức miễn phí. Mỗi lần deploy tạo một image mới, nên đặt cleanup policy (bước 7) để không tích lũy.
- Nên tạo **Budget alert** (Billing → Budgets & alerts), ví dụ 5 USD, để được báo qua email.

## 1. Chuẩn bị dự án (làm một lần, trên web)

1. Vào <https://console.cloud.google.com>, tạo project mới, ví dụ `translate-web`.
2. Billing → gắn billing account vào project.
3. Mở Cloud Shell (biểu tượng `>_` góc trên phải). Cloud Shell có sẵn `gcloud` và đã đăng nhập, không cần cài gì trên máy.

## 2. Bật API

Trong Cloud Shell:

```bash
gcloud config set project translate-web          # thay bằng Project ID của bạn
gcloud config set run/region asia-southeast1
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

## 3. Chuẩn bị biến môi trường

Lấy giá trị từ Vercel: Project `translatees` → Settings → Environment Variables (chọn Production). Tạo file `env.yaml` **chỉ trong Cloud Shell**, không commit lên git:

```yaml
NODE_ENV: production
GOOGLE_API_KEY: "..."
OPENAI_API_KEY: "..."
SONIOX_API_KEY: "..."
DATABASE_URL: "..."
BLOB_READ_WRITE_TOKEN: "..."
AUTH_SECRET: "..."
AUTH_URL: "https://placeholder.invalid"   # sửa ở bước 5
AUTH_GOOGLE_ID: "..."
AUTH_GOOGLE_SECRET: "..."
OWNER_EMAIL: "..."
UPSTASH_REDIS_REST_URL: "..."
UPSTASH_REDIS_REST_TOKEN: "..."
# Thêm các biến khác bạn đang dùng trên Vercel: TRANSLATION_USAGE_STORE, AI_*_MODEL,
# SUMMARY_*/IMAGE_*_API_KEY, NEMOTRON_* ... Danh sách đầy đủ ở web/.env.example.
```

Không cần chép các biến `VERCEL_*` hay `POSTGRES_*` do Vercel tự sinh, trừ khi app chỉ có `POSTGRES_URL` mà không có `DATABASE_URL`.

> Cách này lưu key thành biến môi trường thường; ai có quyền xem service trong project sẽ thấy. Với project cá nhân là đủ. Muốn chặt hơn thì đưa key vào Secret Manager và dùng `--set-secrets` thay cho `--env-vars-file`.

## 4. Deploy lần đầu

```bash
git clone https://github.com/tlerd/translate.git
cd translate/web
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

- `--source .` gửi code lên Cloud Build, build bằng `Dockerfile`, đẩy image vào Artifact Registry rồi deploy. Lần đầu nó hỏi tạo repository `cloud-run-source-deploy`: chọn `Y`.
- `--allow-unauthenticated` để trình duyệt mở được trang; app vẫn tự bắt đăng nhập bằng `OWNER_EMAIL`.
- Repo private: Cloud Shell hỏi đăng nhập GitHub khi `git clone`; dùng Personal Access Token làm mật khẩu.

Khi xong, lệnh in ra `Service URL: https://translate-web-xxxxxxxx.asia-southeast1.run.app`.

## 5. Sửa đăng nhập Google

1. Sửa `AUTH_URL` thành Service URL vừa nhận (không thêm `/app`):

   ```bash
   gcloud run services update translate-web --region asia-southeast1 \
     --update-env-vars AUTH_URL=https://translate-web-xxxxxxxx.asia-southeast1.run.app
   ```

2. Mở project Google Cloud đang chứa OAuth client của `AUTH_GOOGLE_ID` (có thể là project khác) → APIs & Services → Credentials → OAuth 2.0 Client ID → **Authorized redirect URIs**, thêm:

   ```
   https://translate-web-xxxxxxxx.asia-southeast1.run.app/api/auth/callback/google
   ```

   Giữ nguyên URI của Vercel để cả hai bản cùng đăng nhập được.

3. Mở `<Service URL>/app`, đăng nhập, thử dịch, ghi âm, đồng bộ.

## 6. Tự deploy khi push lên GitHub (tùy chọn)

Cloud Run console → service `translate-web` → **Set up continuous deployment** → GitHub → chọn repo `tlerd/translate`, nhánh `^main$`, Build type **Dockerfile**, đường dẫn `/web/Dockerfile`, build context `/web`. Biến môi trường đã đặt ở bước 4 được giữ qua các lần deploy.

## 7. Dọn image cũ

Artifact Registry → repository `cloud-run-source-deploy` → Cleanup policies → thêm policy "Keep most recent versions" = 3.

## Cập nhật thủ công

```bash
cd ~/translate && git pull && cd web
gcloud run deploy translate-web --source . --region asia-southeast1
```

Lần sau không cần lặp lại các flag; Cloud Run giữ cấu hình của revision trước.

## Xem log và quay lại bản cũ

- Log: Cloud Run → `translate-web` → Logs, hoặc `gcloud run services logs read translate-web --region asia-southeast1`.
- Quay lại: Cloud Run → `translate-web` → Revisions → chọn revision cũ → Manage traffic → 100%.

## Tên miền riêng (tùy chọn)

Cloud Run → Manage custom domains, hoặc đặt Cloud Run sau Firebase Hosting. Khi đổi tên miền nhớ cập nhật `AUTH_URL` và redirect URI ở bước 5.
