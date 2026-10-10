#!/usr/bin/env bash
# Deploy web-cloud to Google Cloud Run. Run it in Google Cloud Shell (gcloud is already signed in):
#
#   gcloud config set project <PROJECT_ID>
#   bash web-cloud/scripts/deploy-cloud-run.sh
#
# Safe to re-run: keys go to Secret Manager the first time and are reused afterwards; plain settings
# are remembered in ~/.translate-web.conf (outside the repo). RESET=NAME asks for one key again.
set -euo pipefail

REGION="${REGION:-asia-southeast1}"
SERVICE="${SERVICE:-translate-web}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF="${CONF:-$HOME/.translate-web.conf}"

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
[ -n "$PROJECT" ] || die "Chưa chọn project. Chạy: gcloud config set project <PROJECT_ID>"
NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
URL="${SERVICE_URL:-https://${SERVICE}-${NUMBER}.${REGION}.run.app}"
RUNTIME_SA="${NUMBER}-compute@developer.gserviceaccount.com"
echo "Project: $PROJECT ($NUMBER)  Region: $REGION  URL: $URL"

say "1/6 Bật API (Cloud Run, Cloud Build, Artifact Registry, Secret Manager)"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com --project "$PROJECT"
# Source deploys build as the default compute service account; projects created after 2024 do not grant it this role.
gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$RUNTIME_SA" \
  --role roles/run.builder --condition None --quiet >/dev/null || true

say "2/6 Cấu hình thường (lưu ở $CONF)"
# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"
ask() { # ask VAR "prompt" [default]
  local var=$1 prompt=$2 default=${3:-} current=${!1:-}
  if [ -n "$current" ]; then echo "✓ $var=$current"; return; fi
  read -rp "$prompt${default:+ [$default]}: " current
  current=${current:-$default}
  [ -n "$current" ] || die "$var không được để trống."
  printf -v "$var" '%s' "$current"
  printf '%s=%q\n' "$var" "$current" >> "$CONF"
}
ask OWNER_EMAIL "Email Google được phép đăng nhập (OWNER_EMAIL)"
ask AUTH_GOOGLE_ID "Google OAuth Client ID (AUTH_GOOGLE_ID, dạng ...apps.googleusercontent.com)"
ask R2_ACCOUNT_ID "Cloudflare Account ID (trang R2 → Account Details)"
ask S3_BUCKET "Tên bucket audio" "translate-audio"
ask AI_IMAGE_ENABLED "Bật tạo ảnh minh họa? (true/false)" "false"
S3_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

say "3/6 Key bí mật → Secret Manager (gõ sẽ không hiện trên màn hình)"
SECRETS=()
secret_exists() { gcloud secrets describe "$1" --project "$PROJECT" >/dev/null 2>&1; }
store_secret() { # store_secret NAME VALUE
  if secret_exists "$1"; then
    printf '%s' "$2" | gcloud secrets versions add "$1" --project "$PROJECT" --data-file=- >/dev/null
  else
    printf '%s' "$2" | gcloud secrets create "$1" --project "$PROJECT" --replication-policy automatic --data-file=- >/dev/null
  fi
  gcloud secrets add-iam-policy-binding "$1" --project "$PROJECT" --member "serviceAccount:$RUNTIME_SA" \
    --role roles/secretmanager.secretAccessor --quiet >/dev/null
}
secret() { # secret NAME "prompt" required|optional
  local name=$1 prompt=$2 need=$3 value
  if secret_exists "$name" && [ "${RESET:-}" != "$name" ]; then
    echo "✓ $name đã có"; SECRETS+=("$name"); return
  fi
  local skip="SKIP_$name"
  if [ -n "${!skip:-}" ] && [ "${RESET:-}" != "$name" ]; then echo "- bỏ qua $name (RESET=$name để nhập)"; return; fi
  local hint=""; [ "$need" = optional ] && hint=" (Enter để bỏ qua)"
  read -rsp "$prompt$hint: " value; echo
  if [ -z "$value" ]; then
    [ "$need" = optional ] && { echo "  bỏ qua $name"; printf '%s=1\n' "$skip" >> "$CONF"; return; }
    die "$name không được để trống."
  fi
  store_secret "$name" "$value"; SECRETS+=("$name"); echo "  đã lưu $name"
}
if ! secret_exists AUTH_SECRET; then
  store_secret AUTH_SECRET "$(openssl rand -base64 32)"; echo "✓ Đã tạo AUTH_SECRET mới"
fi
SECRETS+=(AUTH_SECRET)
secret DATABASE_URL "Neon connection string (pooled, có -pooler và sslmode=require)" required
secret AUTH_GOOGLE_SECRET "Google OAuth Client Secret" required
secret GOOGLE_API_KEY "Gemini API key (Google AI Studio)" required
secret SONIOX_API_KEY "Soniox API key" optional
secret OPENAI_API_KEY "OpenAI API key" optional
secret S3_ACCESS_KEY_ID "R2 Access Key ID" required
secret S3_SECRET_ACCESS_KEY "R2 Secret Access Key" required
secret REDIS_URL "Redis URL rediss://... (Upstash)" optional

say "4/6 Tạo bucket R2 và CORS cho $URL"
R2_TMP="$(mktemp -d)"
cp "$APP_DIR/scripts/r2-setup.mjs" "$R2_TMP/"
npm install --prefix "$R2_TMP" --silent --no-audit --no-fund @aws-sdk/client-s3@3 >/dev/null
(
  cd "$R2_TMP"
  S3_ENDPOINT="$S3_ENDPOINT" S3_REGION=auto S3_BUCKET="$S3_BUCKET" CORS_ORIGINS="$URL,http://localhost:3000" \
  S3_ACCESS_KEY_ID="$(gcloud secrets versions access latest --secret S3_ACCESS_KEY_ID --project "$PROJECT")" \
  S3_SECRET_ACCESS_KEY="$(gcloud secrets versions access latest --secret S3_SECRET_ACCESS_KEY --project "$PROJECT")" \
  node r2-setup.mjs
) || die "Không tạo được bucket/CORS. Token R2 cần quyền Admin Read & Write."
rm -rf "$R2_TMP"

say "5/6 Build và deploy lên Cloud Run (lần đầu mất ~5–10 phút)"
# A YAML file avoids gcloud's delimiter parsing (emails contain "@", URLs contain ":" and "/").
ENV_FILE="$(mktemp)"
yaml() { local v=${2//\\/\\\\}; v=${v//\"/\\\"}; printf '%s: "%s"\n' "$1" "$v" >> "$ENV_FILE"; }
yaml NODE_ENV production
yaml TRANSLATION_USAGE_STORE "on"
yaml AUTH_URL "$URL"
yaml OWNER_EMAIL "$OWNER_EMAIL"
yaml AUTH_GOOGLE_ID "$AUTH_GOOGLE_ID"
yaml AI_IMAGE_ENABLED "$AI_IMAGE_ENABLED"
yaml S3_ENDPOINT "$S3_ENDPOINT"
yaml S3_REGION auto
yaml S3_BUCKET "$S3_BUCKET"
SECRET_FLAGS=""
for name in "${SECRETS[@]}"; do SECRET_FLAGS+="${SECRET_FLAGS:+,}$name=$name:latest"; done
gcloud run deploy "$SERVICE" --source "$APP_DIR" --project "$PROJECT" --region "$REGION" \
  --allow-unauthenticated --memory 1Gi --cpu 1 --timeout 300 \
  --min-instances 0 --max-instances 2 --no-cpu-throttling \
  --env-vars-file "$ENV_FILE" --set-secrets "$SECRET_FLAGS" --quiet
rm -f "$ENV_FILE"

say "6/6 Kiểm tra"
code="$(curl -s -o /dev/null -w '%{http_code}' "$URL/login" || true)"
echo "GET $URL/login → $code"
cat <<EOF

Xong. Còn 1 việc cần bạn tự làm (đăng nhập Google Cloud Console):
  APIs & Services → Credentials → OAuth client "$AUTH_GOOGLE_ID"
  → Authorized redirect URIs → thêm:
      $URL/api/auth/callback/google
  (giữ nguyên URI của Vercel), bấm Save, đợi 1–5 phút.

Sau đó mở: $URL/app
EOF
