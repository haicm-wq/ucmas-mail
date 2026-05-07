# 📧 UCMAS MAIL — Hệ Thống Email Marketing

> **Phiên bản:** 2.0.0  
> **Cập nhật:** 07/05/2026  
> **Nền tảng:** Vercel + GitHub + Supabase + Resend

---

## 📋 MỤC LỤC

1. [Giới thiệu](#1-giới-thiệu)
2. [Kiến trúc hệ thống](#2-kiến-trúc-hệ-thống)
3. [Vai trò từng thành phần](#3-vai-trò-từng-thành-phần)
4. [Giới hạn của từng nền tảng](#4-giới-hạn-của-từng-nền-tảng)
5. [Cài đặt & Triển khai](#5-cài-đặt--triển-khai)
6. [Hướng dẫn sử dụng](#6-hướng-dẫn-sử-dụng)
7. [Cơ chế gửi email](#7-cơ-chế-gửi-email)
8. [API Endpoints](#8-api-endpoints)
9. [Xử lý sự cố](#9-xử-lý-sự-cố)

---

## 1. GIỚI THIỆU

**UCMAS MAIL** là công cụ email marketing nội bộ cho hệ thống UCMAS, cho phép:

- Quản lý danh sách học viên/phụ huynh theo cấp bậc (Level) và Segment
- Soạn email HTML chuyên nghiệp bằng visual editor, code editor hoặc drag & drop builder
- Gửi hàng loạt email theo chiến dịch (Campaign) — **đảm bảo mỗi người chỉ nhận đúng 1 email**
- Theo dõi trạng thái email: delivered, opened, clicked, bounced, spam
- Dừng khẩn cấp toàn hệ thống bằng 1 nút khi phát hiện bất thường
- Tự động tiếp tục gửi khi bị timeout (không cần thao tác thủ công)

---

## 2. KIẾN TRÚC HỆ THỐNG

```
┌─────────────────────────────────────────────────────────────┐
│                        NGƯỜI DÙNG                           │
│                    (Trình duyệt web)                        │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                       VERCEL                                │
│  ┌─────────────────┐    ┌──────────────────────────────┐   │
│  │  Static Files   │    │    Serverless Functions      │   │
│  │  ucmas-mail.html│    │    /api/*.js  (12 functions) │   │
│  │  styles.css     │    │                              │   │
│  │  app.js         │    │  campaigns-send.js           │   │
│  └─────────────────┘    │  contacts.js                 │   │
│                         │  tracking.js ...             │   │
│                         └──────────┬─────────────────-─┘   │
└─────────────────────────────────────────────────────────────┘
                 │                   │
                 ▼                   ▼
┌───────────────────┐    ┌───────────────────────────────────┐
│     SUPABASE      │    │              RESEND               │
│  (PostgreSQL DB)  │    │         (Email Service)           │
│                   │    │                                   │
│  contacts         │    │  POST /emails  → gửi email        │
│  campaigns        │    │  Webhooks      → tracking events  │
│  send_logs        │    │  GET /emails   → backfill data    │
│  email_events     │    └───────────────────────────────────┘
│  levels           │
│  templates        │
│  workflows        │
│  segments         │
└───────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                        GITHUB                               │
│  Repository: haicm-wq/ucmas-mail                           │
│  → Push code → Vercel tự động deploy                       │
└─────────────────────────────────────────────────────────────┘
```

### Luồng dữ liệu chính

```
1. IMPORT CONTACTS:
   File CSV/XLSX → API contacts-import → Supabase contacts table

2. GỬI CAMPAIGN:
   User click → API campaigns-send → Resend API → Email đến inbox
                                  ↓
                            Supabase send_logs (log ngay mỗi email)

3. TRACKING:
   Người nhận mở email → Resend → Webhook POST /api/webhooks
                                → Supabase email_events

4. RESUME (khi timeout):
   Frontend phát hiện ngắt kết nối → đọc send_logs (ai đã nhận)
   → gọi ?resume=id → chỉ gửi phần còn lại
```

---

## 3. VAI TRÒ TỪNG THÀNH PHẦN

### 🐙 GitHub
**Vai trò:** Lưu trữ và quản lý source code

- Repository: `https://github.com/haicm-wq/ucmas-mail`
- Branch chính: `master`
- **Kết nối với Vercel:** Mỗi khi push code lên GitHub → Vercel tự động build và deploy
- Không cần thao tác thủ công trên Vercel sau khi đã liên kết

---

### ▲ Vercel
**Vai trò:** Hosting toàn bộ ứng dụng (frontend + backend)

Vercel phục vụ 2 loại nội dung:

**1. Static files (frontend):**
- `ucmas-mail.html` — giao diện người dùng
- `styles.css` — toàn bộ CSS
- `app.js` — toàn bộ JavaScript logic phía client

**2. Serverless Functions (backend API):**
- 12 file trong thư mục `/api/` — mỗi file là 1 API endpoint độc lập
- Chạy Node.js, xử lý request → truy vấn Supabase → gọi Resend API
- Không có server thường trực — mỗi request tạo 1 function instance mới

**Cách kết nối:**
```
GitHub push → Vercel webhook → Build → Deploy production
URL: https://ucmas-mail.vercel.app
```

**Environment Variables trên Vercel:**
```
SUPABASE_URL               = https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY  = eyJhbG...
RESEND_API_KEY             = re_xxxxx
FROM_EMAIL                 = info@yourdomain.com
```

---

### 🗄️ Supabase
**Vai trò:** Database lưu trữ toàn bộ dữ liệu của ứng dụng

Supabase là PostgreSQL database được host trên cloud. Các bảng:

| Bảng | Lưu trữ |
|------|---------|
| `levels` | Cấp bậc học viên (Level 1, Level 2,...) |
| `contacts` | Danh sách email người nhận |
| `templates` | Mẫu email HTML |
| `campaigns` | Chiến dịch gửi email + kill switch |
| `send_logs` | Log chi tiết từng email đã gửi |
| `email_events` | Sự kiện tracking (opened, clicked,...) |
| `segments` | Nhóm contacts theo rule |
| `workflows` | Quy trình tự động hóa |

**Cách kết nối:**
- Vercel Functions gọi Supabase qua REST API (supabase-js client)
- Xác thực bằng `Service Role Key` — có quyền đọc/ghi toàn bộ

**Lưu ý quan trọng:**
- Supabase Free Tier sẽ **tự pause project** sau 1 tuần không có request
- Khi project bị pause → app mất kết nối → cần vào Supabase Dashboard để restore

---

### 📨 Resend
**Vai trò:** Dịch vụ gửi email thực tế

Resend nhận lệnh gửi email từ Vercel Function và thực hiện:
- Gửi email đến inbox người nhận
- Tracking delivery, open, click
- Gửi webhook về app khi có sự kiện mới

**Cách kết nối:**
```
Vercel Function (campaigns-send.js)
  → POST https://api.resend.com/emails
  → Resend gửi email
  → Resend POST webhook đến /api/webhooks (tracking)
```

**Cần cấu hình trên Resend:**
1. Verify domain gửi email
2. Tạo API Key
3. Cấu hình Webhook URL: `https://ucmas-mail.vercel.app/api/webhooks`

---

### 🌐 Trình duyệt (Frontend)
**Vai trò:** Giao diện người dùng, điều phối luồng gửi email

`app.js` chạy trên trình duyệt thực hiện:
- Render toàn bộ UI (contacts, campaigns, history,...)
- Gọi `/api/*` endpoints trên Vercel
- **Quản lý auto-resume:** khi connection bị ngắt (Vercel timeout), frontend phát hiện và tự gọi `?resume=id` sau 3 giây
- Hiển thị tiến trình gửi realtime qua SSE (Server-Sent Events)
- Lưu cấu hình kết nối trong localStorage (khi không dùng Vercel env vars)

---

## 4. GIỚI HẠN CỦA TỪNG NỀN TẢNG

### ▲ Vercel (Hobby Plan — Miễn phí)

| Giới hạn | Giá trị | Ảnh hưởng |
|----------|---------|-----------|
| **Serverless Functions** | **Tối đa 12 functions** | Không được tạo thêm file trong `/api/` |
| **Thời gian chạy tối đa** | **300 giây/request** | Campaign ~200-300 email/lần |
| **Bandwidth** | 100 GB/tháng | Thường không chạm |
| **Build time** | 45 phút/build | Thường build xong trong <1 phút |
| **Concurrent requests** | Không giới hạn | OK |

> ⚠️ **Quan trọng:** Giới hạn 12 functions là cứng — nếu thêm file `.js` vào `/api/` sẽ build lỗi ngay.  
> Giải pháp: gộp nhiều tính năng vào 1 file dùng query params (VD: `?action=stop`, `?emergency=status`).

**Tốc độ gửi thực tế:**
- Mỗi request gửi được ~100-300 email (tùy tốc độ Resend)
- Campaign 2000 email cần ~7-20 lần request (tự động resume)
- Tổng thời gian: ~20-40 phút cho 2000 email

---

### 🗄️ Supabase (Free Tier)

| Giới hạn | Giá trị | Ảnh hưởng |
|----------|---------|-----------|
| **Số project** | 2 projects | Đủ dùng |
| **Database size** | 500 MB | ~5 triệu dòng send_logs |
| **Bandwidth** | 5 GB/tháng | Thường đủ |
| **Row limit** | Không giới hạn | OK |
| **Concurrent connections** | 60 | Đủ cho Vercel functions |
| **Auto-pause** | **Sau 1 tuần không dùng** | Project bị đóng băng, cần restore thủ công |

> ⚠️ **Auto-pause:** Nếu app không có request trong 7 ngày, Supabase sẽ pause project. Vào Supabase Dashboard → bấm "Restore" để khôi phục.

---

### 📨 Resend (Free Tier)

| Giới hạn | Giá trị | Ảnh hưởng |
|----------|---------|-----------|
| **Email/tháng** | **3,000 email** | Đủ cho test, cần nâng cấp cho production lớn |
| **Email/ngày** | 100 email | Giới hạn chặt với free plan |
| **Domain** | 1 domain | Đủ dùng |
| **Webhook** | Có | Tracking hoạt động đầy đủ |
| **API rate limit** | 10 req/giây | Gửi tuần tự 1 email không vấn đề |

> ⚠️ **Nếu vượt 100 email/ngày (free):** Resend sẽ từ chối, email bị log là `failed`. Nâng lên plan trả phí để gửi không giới hạn.

---

### 🐙 GitHub (Free)

| Giới hạn | Giá trị | Ảnh hưởng |
|----------|---------|-----------|
| **Repository** | Không giới hạn | OK |
| **File size** | 100 MB/file | Không liên quan |
| **Actions** | 2,000 phút/tháng | Không dùng Actions |

Không có giới hạn đáng lo ngại với cách dùng hiện tại.

---

## 5. CÀI ĐẶT & TRIỂN KHAI

### Bước 1: Clone dự án

```bash
git clone https://github.com/haicm-wq/ucmas-mail.git
cd ucmas-mail
npm install
```

### Bước 2: Tạo database trên Supabase

Vào Supabase Dashboard → SQL Editor → chạy theo thứ tự:
1. `migration-v2.sql` — bảng cơ bản
2. `migration-v3-tags.sql` — hệ thống tags
3. `migration-v4-segments.sql` — hệ thống segments

### Bước 3: Cấu hình Vercel

```
Vercel Dashboard → Project → Settings → Environment Variables:

SUPABASE_URL               = https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY  = eyJhbG...
RESEND_API_KEY             = re_xxxxx
FROM_EMAIL                 = info@yourdomain.com
```

### Bước 4: Liên kết GitHub → Vercel

1. Vào Vercel → Import Project → chọn GitHub repo `ucmas-mail`
2. Sau đó mỗi lần `git push` → Vercel tự build và deploy

### Bước 5: Cấu hình Webhook Resend

1. Resend Dashboard → Settings → Webhooks
2. Add endpoint: `https://ucmas-mail.vercel.app/api/webhooks`
3. Chọn events: `email.delivered`, `email.opened`, `email.clicked`, `email.bounced`, `email.complained`

---

## 6. HƯỚNG DẪN SỬ DỤNG

### 6.1 Dashboard

- Thống kê contacts theo level
- Chiến dịch gần đây
- Số liệu tổng quan

### 6.2 Quản lý Contacts

**Import:**
| Cách | Hướng dẫn |
|------|-----------|
| File CSV/XLSX | Kéo thả → tự động parse |
| Google Sheets | Dán link public sheet |
| Quick Add | Nhập `tên, email, level` mỗi dòng |

**Format file:**
```
name,email,level
Nguyễn Văn A,a@gmail.com,LEVEL 1
```

**Thao tác hàng loạt (bulk actions):**
- Tick chọn nhiều contacts → thanh bulk hiện ra
- Đổi level hàng loạt
- Gắn tag hàng loạt
- **📂 Thêm vào Segment:** chọn segment có sẵn hoặc tạo mới
- Xóa hàng loạt

### 6.3 Templates

4 chế độ soạn:
- **Visual** — WYSIWYG như Word
- **Code** — HTML thuần
- **Split** — Visual + Code song song
- **Preview** — Xem kết quả cuối

Biến template: `{{name}}`, `{{email}}`, `{{level}}`, `{{company}}`, `{{date}}`

### 6.4 Gửi Campaign

1. Tab **Campaign** → nhập Subject, From Name, chọn Template
2. Chọn Level(s) muốn gửi
3. Bấm **🚀 Gửi Campaign**
4. Theo dõi tiến trình realtime

**Khi campaign bị dừng giữa chừng:**
- Vào **History** → bấm **▶ Gửi tiếp**
- Hệ thống tự bỏ qua email đã gửi, gửi tiếp phần còn lại
- Có thể cần bấm nhiều lần với campaign lớn (mỗi lần ~100-300 email)

### 6.5 Nút Dừng Khẩn Cấp ⛔

Nút đỏ **"Dừng khẩn cấp"** ở góc trên phải:

- **Khi nhấn:** Dừng TẤT CẢ campaigns đang gửi trên toàn hệ thống
- Banner đỏ xuất hiện trên toàn trang
- Trạng thái lưu vào DB — reload trang vẫn giữ nguyên
- **Để mở lại:** Bấm nút xanh **"✅ Mở khoá hệ thống"**

### 6.6 History & Tracking

- Danh sách campaigns với số liệu: Sent, Opened, Clicked, Bounced
- Bấm vào campaign để xem chi tiết từng email
- Nút **🔄 Đồng bộ** để backfill từ Resend
- Nút **📥 Export CSV**
- Nút **⏹ Dừng** (với campaign đang `sending`)
- Nút **▶ Gửi tiếp** (với campaign `partial`/`paused`)

### 6.7 Segments

Nhóm contacts theo rule động (level + tag):
- Tạo segment → thêm rule (level hoặc tag)
- Contacts tự động match theo rule
- Dùng để gửi campaign cho nhóm phức tạp

---

## 7. CƠ CHẾ GỬI EMAIL

### Gửi tuần tự — đảm bảo không trùng lặp

```
[Bắt đầu Campaign]
       ↓
Lấy contacts theo level (từ Supabase)
       ↓
Email 1 → Gửi qua Resend → Log ngay vào send_logs ✓
       ↓
Email 2 → Gửi qua Resend → Log ngay vào send_logs ✓
       ↓
       ...
       ↓
Email 100 → [Vercel timeout sau 300s]
       ↓
Frontend phát hiện mất kết nối → chờ 3 giây
       ↓
Gọi ?resume=campaign_id
       ↓
Backend đọc send_logs → thấy 99 email đã gửi → BỎ QUA
       ↓
Tiếp tục từ email 100 → 101 → 102...
       ↓
[Timeout lại] → Resume lại → ... → XONG
```

### 3 lớp bảo vệ chống gửi trùng

| Lớp | Cơ chế |
|-----|--------|
| **Set trong RAM** | Load toàn bộ email đã `sent` vào Set khi resume — check trước khi gửi |
| **logSend idempotent** | Nếu DB đã có record `status=sent` → không ghi đè, bỏ qua |
| **Server lock** | Nếu campaign đang `sending` → từ chối request resume mới (HTTP 409) |

### Kill Switch (cơ chế dừng khẩn cấp)

- Mỗi 10 email, backend query DB kiểm tra trạng thái kill switch
- Nếu kill switch active → dừng ngay, cập nhật campaign thành `paused`
- Frontend cũng dừng timer auto-resume

---

## 8. API ENDPOINTS

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/config` | Kiểm tra cấu hình server |
| GET | `/api/stats` | Thống kê dashboard |
| GET/POST/DELETE | `/api/levels` | CRUD levels |
| GET/POST/PATCH/DELETE | `/api/contacts` | CRUD contacts + bulk actions |
| POST | `/api/contacts-import` | Upload file CSV/XLSX |
| GET | `/api/sheets-proxy?url=xxx` | Import từ Google Sheets |
| GET/POST/PUT/DELETE | `/api/templates` | CRUD templates |
| GET/POST | `/api/campaigns` | Lấy campaigns, gửi test email |
| POST | `/api/campaigns-send` | Gửi campaign mới |
| POST | `/api/campaigns-send?resume=id` | Gửi tiếp campaign |
| POST | `/api/campaigns-send?stop=id` | Dừng campaign |
| GET | `/api/campaigns-send?emergency=status` | Kiểm tra kill switch |
| POST | `/api/campaigns-send?emergency=stop` | Kích hoạt kill switch |
| POST | `/api/campaigns-send?emergency=resume` | Tắt kill switch |
| GET | `/api/tracking?summary` | Lấy tracking overview |
| POST | `/api/tracking?backfill=id` | Đồng bộ từ Resend |
| POST | `/api/webhooks` | Nhận webhook từ Resend |
| GET/POST/PUT/DELETE | `/api/workflows` | CRUD workflows |

---

## 9. XỬ LÝ SỰ CỐ

### Campaign bị stuck / không tiến trình

1. Kiểm tra **Vercel Logs** — xem có lỗi API không
2. Vào **History** → bấm **▶ Gửi tiếp**
3. Mỗi lần resume gửi ~100-300 email rồi tự tiếp tục

### Email bị gửi trùng (lịch sử)

Đã được fix hoàn toàn trong v2.0. Nếu vẫn xảy ra:
1. Nhấn **⛔ Dừng khẩn cấp** ngay
2. Kiểm tra Resend Dashboard xem số lượng thực tế
3. Kiểm tra `send_logs` trong Supabase — đảm bảo có UNIQUE constraint trên `(campaign_id, email)`

### Tracking không hiển thị

1. Kiểm tra Webhook URL trên Resend: `https://ucmas-mail.vercel.app/api/webhooks`
2. Bấm **🔄 Đồng bộ** để backfill thủ công
3. Mở Console (F12) để xem lỗi

### Supabase mất kết nối

1. Vào [supabase.com](https://supabase.com) kiểm tra project có bị pause không
2. Nếu có → bấm **Restore project**
3. Free tier pause sau 1 tuần không có request

### Vercel build lỗi "Too many functions"

- Hobby plan giới hạn **12 Serverless Functions**
- Không được thêm file `.js` mới vào `/api/`
- Gộp tính năng mới vào file API hiện có dùng query params

### Kết nối xoay tròn / không load được

1. Bấm **⚙ Settings** → kiểm tra Supabase URL và Key
2. Bấm **Test Connection**
3. Đảm bảo Service Role Key (không phải anon key)

---

## 📁 CẤU TRÚC CODE

```
ucmas-mail/
├── ucmas-mail.html      # Giao diện chính (HTML)
├── styles.css           # Toàn bộ CSS
├── app.js               # Toàn bộ JavaScript frontend
├── vercel.json          # Cấu hình Vercel (maxDuration: 300s)
├── package.json
│
├── api/                 # 12 Serverless Functions
│   ├── _utils.js        # Helpers dùng chung (không phải function)
│   ├── campaigns-send.js# Gửi/resume/dừng/kill-switch
│   ├── campaigns.js     # Lấy campaigns, test email
│   ├── config.js        # Kiểm tra cấu hình
│   ├── contacts.js      # CRUD contacts + bulk + segments
│   ├── contacts-import.js
│   ├── levels.js
│   ├── sheets-proxy.js
│   ├── stats.js
│   ├── templates.js
│   ├── tracking.js
│   ├── webhooks.js
│   └── workflows.js
│
├── lib/                 # Shared libraries
│   ├── email.js         # Gọi Resend API
│   ├── supabase.js      # Tất cả Supabase CRUD + kill switch
│   ├── csvParser.js     # Parse CSV/XLSX
│   └── importHelper.js
│
├── migration-v2.sql     # Tạo bảng cơ bản
├── migration-v3-tags.sql
└── migration-v4-segments.sql
```

---

*Tài liệu cập nhật: 07/05/2026 — Phiên bản 2.0.0*
