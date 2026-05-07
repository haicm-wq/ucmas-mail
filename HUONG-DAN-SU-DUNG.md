# 📧 UCMAS MAIL — Hệ Thống Email Marketing

> **Phiên bản:** 1.1.0  
> **Cập nhật:** 07/05/2026  
> **Nền tảng:** Web App (Vercel + Supabase + Resend)

---

## 📋 MỤC LỤC

1. [Giới thiệu](#1-giới-thiệu)
2. [Yêu cầu hệ thống](#2-yêu-cầu-hệ-thống)
3. [Cài đặt & Triển khai](#3-cài-đặt--triển-khai)
4. [Hướng dẫn sử dụng](#4-hướng-dẫn-sử-dụng)
5. [Mô tả tính năng chi tiết](#5-mô-tả-tính-năng-chi-tiết)
6. [Kiến trúc kỹ thuật](#6-kiến-trúc-kỹ-thuật)
7. [Xử lý sự cố](#7-xử-lý-sự-cố)

---

## 1. GIỚI THIỆU

**UCMAS MAIL** là công cụ email marketing nội bộ được xây dựng cho hệ thống UCMAS, cho phép:

- Quản lý danh sách học viên/phụ huynh theo cấp bậc (Level)
- Soạn email HTML chuyên nghiệp bằng visual editor hoặc code editor
- Gửi hàng loạt email marketing theo chiến dịch (Campaign)
- Theo dõi trạng thái email: đã gửi, đã mở, đã click, bounce, spam
- Tự động đồng bộ dữ liệu tracking từ Resend

### Điểm nổi bật

| Tính năng | Mô tả |
|-----------|-------|
| 🚀 Gửi hàng loạt | Gửi tới hàng nghìn email với rate limiting tự động |
| 🔄 Chống trùng lặp | Log ngay mỗi email, resume thông minh khi bị timeout |
| ⏹ Dừng/Tiếp tục | Chủ động dừng chiến dịch và gửi tiếp bất cứ lúc nào |
| 📊 Tracking realtime | Theo dõi delivered, opened, clicked, bounced qua webhook |
| 🎨 Drag & Drop Builder | GrapeJS email builder tích hợp sẵn |
| 📱 Import linh hoạt | Hỗ trợ CSV, XLSX, Google Sheets |

---

## 2. YÊU CẦU HỆ THỐNG

### Dịch vụ bên ngoài (bắt buộc)

| Dịch vụ | Mục đích | Đăng ký |
|---------|----------|---------|
| **Vercel** | Hosting web app + serverless API | [vercel.com](https://vercel.com) |
| **Supabase** | Database lưu contacts, campaigns, logs | [supabase.com](https://supabase.com) |
| **Resend** | Dịch vụ gửi email (API) | [resend.com](https://resend.com) |

### Thông tin cần chuẩn bị

- **Supabase URL** — URL của project Supabase (dạng `https://xxx.supabase.co`)
- **Supabase Service Role Key** — Key có quyền đọc/ghi database
- **Resend API Key** — Key gửi email (dạng `re_xxxxx`)
- **From Email** — Địa chỉ email người gửi (cần verify domain trên Resend)

---

## 3. CÀI ĐẶT & TRIỂN KHAI

### Bước 1: Clone dự án

```bash
git clone https://github.com/haicm-wq/ucmas-mail.git
cd ucmas-mail
npm install
```

### Bước 2: Tạo database trên Supabase

Truy cập Supabase Dashboard → SQL Editor → chạy các lệnh tạo bảng. App có sẵn phần **Database Setup** (tab ⚙ Settings → Database) với các câu SQL cần chạy:

**Các bảng cần tạo:**

| Bảng | Mục đích |
|------|----------|
| `levels` | Cấp bậc/nhóm học viên (VD: Level 1, Level 2,...) |
| `contacts` | Danh sách email người nhận (phụ huynh, học viên) |
| `templates` | Mẫu email HTML đã lưu |
| `campaigns` | Chiến dịch gửi email |
| `send_logs` | Log chi tiết từng email đã gửi |
| `email_events` | Sự kiện tracking (opened, clicked, bounced,...) |
| `workflows` | Workflow automation (nếu sử dụng) |

### Bước 3: Cấu hình biến môi trường

**Cách 1: Qua Vercel Dashboard** (khuyến nghị cho production)
```
Vercel → Project Settings → Environment Variables
- SUPABASE_URL = https://xxx.supabase.co
- SUPABASE_SERVICE_ROLE_KEY = eyJhbG...
- RESEND_API_KEY = re_xxxxx
- FROM_EMAIL = info@yourdomain.com
```

**Cách 2: Qua giao diện app** (cho lần đầu sử dụng)
- Mở app → bấm ⚙ Settings → nhập các thông tin kết nối
- Dữ liệu lưu trong localStorage của trình duyệt

### Bước 4: Cài đặt Webhook (tracking)

1. Vào **Resend Dashboard** → Settings → Webhooks
2. Thêm endpoint: `https://your-domain.vercel.app/api/webhooks`
3. Chọn events: `email.delivered`, `email.opened`, `email.clicked`, `email.bounced`, `email.complained`
4. Lưu lại

### Bước 5: Deploy

```bash
# Deploy lên Vercel
vercel --prod

# Hoặc chạy local để test
npm run dev
```

---

## 4. HƯỚNG DẪN SỬ DỤNG

### 4.1 Dashboard (Trang chủ)

Trang tổng quan hiển thị:
- **Thống kê contacts** theo từng level (Level 1, 2, 3, 4,...)
- **Chiến dịch gần đây** với trạng thái (draft, sending, completed, paused)
- **Sidebar bên trái** hiển thị cây level và số lượng contacts

### 4.2 Quản lý Contacts

**Xem danh sách:**
- Bấm tab **"Contacts"** trên thanh navigation
- Lọc theo level bằng cách bấm vào chip hoặc sidebar
- Tìm kiếm bằng tên hoặc email
- Phân trang: chọn số contacts/trang (200, 500, 1000)

**Import contacts:**

| Cách | Hướng dẫn |
|------|-----------|
| **Upload file** | Kéo thả hoặc bấm vào vùng upload → chọn file CSV/XLSX |
| **Google Sheets** | Bấm "📊 Google Sheets" → dán link Sheet (phải public) |
| **Thêm nhanh** | Bấm "⚡ Quick Add" → nhập dạng `tên, email, level` mỗi dòng |

**Định dạng file import** (cần 3 cột bắt buộc):

```
name,email,level
Nguyễn Văn A,nguyenvana@gmail.com,LEVEL 1
Trần Thị B,tranthib@yahoo.com,LEVEL 2
```

Cột tùy chọn: `company`, `phone`

> **Lưu ý:** Khi import email đã tồn tại, hệ thống sẽ **cập nhật thông tin mới** (tên, level, company,...) thay vì tạo trùng.

**Thao tác hàng loạt:**
- Tick chọn nhiều contacts → thanh bulk actions hiện ra
- **Đổi level hàng loạt**: chọn level mới từ dropdown
- **Xóa hàng loạt**: bấm nút "Xóa đã chọn"

**Xem lịch sử email:**
- Bấm nút **"📧 Lịch sử"** bên cạnh mỗi contact
- Hiển thị tất cả email đã gửi cho contact đó, kèm trạng thái

### 4.3 Quản lý Levels

**Tạo level mới:**
- Tab **"Levels"** → form "Tạo nhanh" bên phải
- Nhập tên, chọn màu, chọn level cha (nếu là sub-level)
- Bấm "Tạo Level"

**Cấu trúc level:**
```
Level 1 (gốc)
  ├── Level 1A (sub)
  └── Level 1B (sub)
Level 2 (gốc)
  ├── Level 2A (sub)
  └── Level 2B (sub)
```

### 4.4 Soạn Email Templates

App cung cấp **4 chế độ soạn email**:

| Chế độ | Mô tả |
|--------|-------|
| **Visual** | Soạn trực tiếp như Word, có toolbar formatting |
| **Code** | Viết HTML thuần, có syntax highlighting |
| **Split** | Visual + Code song song, đồng bộ realtime |
| **Preview** | Xem trước email với dữ liệu mẫu |

**Tạo template mới:**
1. Tab **"Templates"** → bấm **"+ New"**
2. Nhập tên template
3. Soạn nội dung email
4. Bấm **"💾 Lưu"**

**Sử dụng biến template:**
- `{{name}}` — Tên người nhận
- `{{email}}` — Email người nhận
- `{{level}}` — Level/cấp bậc
- `{{company}}` — Công ty
- `{{date}}` — Ngày gửi

**Ví dụ:**
```html
<h2>Xin chào {{name}}!</h2>
<p>Cảm ơn bạn đã đăng ký khóa học {{level}} tại UCMAS.</p>
```

**GrapeJS Drag & Drop Builder:**
- Bấm **"🏗 Builder"** để mở trình soạn kéo thả chuyên nghiệp
- Hỗ trợ responsive (Desktop/Tablet/Mobile)
- Kéo thả các block: text, image, button, column, divider
- Undo/Redo, xóa canvas
- Lưu trực tiếp thành template

**Chèn thành phần:**
- **🔗 Link**: chèn đường dẫn với text tùy chỉnh
- **🖼 Ảnh**: upload hoặc dán URL ảnh, chọn kích thước
- **🔘 Button**: tạo nút CTA với màu sắc, border radius tùy chỉnh

### 4.5 Tạo & Gửi Campaign

**Bước 1: Cấu hình campaign**
1. Tab **"Campaign"**
2. Nhập **Subject** email (tiêu đề)
3. Nhập **Tên người gửi** (From Name)
4. Chọn **Template** hoặc soạn trực tiếp
5. Tick chọn **Level** muốn gửi (có thể chọn nhiều)

**Bước 2: Preview & Gửi**
1. Xem preview bên phải (thay biến template bằng dữ liệu mẫu)
2. Kiểm tra thông tin tổng kết: số contacts, levels đã chọn
3. Bấm **"🚀 Gửi Campaign"**

**Trong quá trình gửi:**
- Thanh tiến trình hiển thị: `Đang gửi 150/2016...`
- Thông báo mỗi batch 10 email
- Nút **"⏹ Dừng gửi"** để tạm dừng bất cứ lúc nào

**Gửi tiếp campaign bị dừng:**
- Vào tab **History** → bấm vào campaign có trạng thái `paused` hoặc `sending`
- Bấm **"▶ Gửi tiếp"**
- Hệ thống tự động bỏ qua email đã gửi, chỉ gửi phần còn lại

### 4.6 Theo dõi Tracking (History)

**Trang History hiển thị:**
- Danh sách tất cả campaigns đã gửi
- Trạng thái: `draft` | `sending` | `paused` | `completed`
- Số liệu: Sent, Delivered, Opened, Clicked, Bounced

**Xem chi tiết campaign:**
- Bấm vào tên campaign để mở chi tiết
- Thống kê: tỷ lệ mở (open rate), tỷ lệ click (click rate)
- Danh sách từng email đã gửi kèm trạng thái

**Đồng bộ dữ liệu từ Resend:**
- Bấm **"🔄 Đồng bộ trạng thái từ Resend"**
- Hệ thống quét Resend API và cập nhật trạng thái mới nhất
- Hỗ trợ 2 chế độ:
  - **Có log**: fetch trạng thái theo resend_id
  - **Không có log**: tìm kiếm theo subject + recipient

**Export logs:**
- Bấm **"📥 Export CSV"** để tải danh sách gửi thành file CSV

### 4.7 Workflow Automation

> Tính năng xây dựng workflow tự động hóa quy trình gửi email.

**Giao diện workflow builder:**
- Sidebar trái: danh sách workflows
- Canvas chính: flow chart các bước

**Các loại node:**
- **Trigger**: Điều kiện kích hoạt (VD: khi thêm tag, khi đăng ký)
- **Email**: Gửi email theo template
- **Delay**: Chờ một khoảng thời gian
- **Condition**: Rẽ nhánh theo điều kiện
- **Tag**: Gắn tag cho contact

### 4.8 Settings (Cài đặt)

Bấm **⚙** trên thanh navigation để mở cài đặt:

| Mục | Nội dung |
|-----|----------|
| **Supabase URL** | URL project Supabase |
| **Supabase Key** | Service Role Key |
| **Resend API Key** | Key gửi email |
| **From Email** | Địa chỉ người gửi |
| **Test Connection** | Kiểm tra kết nối |

---

## 5. MÔ TẢ TÍNH NĂNG CHI TIẾT

### 5.1 Hệ thống gửi email

```
[Bấm Gửi] → Lấy contacts theo level → Loop từng email:
  1. Kiểm tra đã gửi chưa (trong send_logs)
  2. Nếu chưa → gửi qua Resend API
  3. Log ngay vào send_logs (resend_id, status, email)
  4. Delay 150ms giữa mỗi email (rate limiting)
  5. Thông báo tiến trình mỗi 10 email
```

**Chống trùng lặp:**
- Mỗi email gửi xong được log ngay lập tức vào database
- Khi resume: kiểm tra send_logs → bỏ qua email đã có
- Kể cả Vercel timeout ở giữa → không bao giờ gửi trùng

**Dừng gửi:**
- Bấm "⏹ Dừng" → campaign chuyển sang `paused`
- Gửi tiếp bất cứ lúc nào → chỉ gửi phần còn lại

### 5.2 Hệ thống Tracking

**Webhook (realtime):**
```
Resend gửi email → Người nhận mở/click → Resend gửi webhook 
→ POST /api/webhooks → Lưu vào bảng email_events
```

Các sự kiện được tracking:
- `delivered` — Email đã đến hộp thư
- `opened` — Người nhận đã mở email
- `clicked` — Người nhận đã click link trong email
- `bounced` — Email bị trả lại (địa chỉ không tồn tại)
- `complained` — Người nhận báo spam

**Backfill (đồng bộ thủ công):**
- Dùng khi webhook bị miss hoặc campaign cũ không có log
- Quét Resend API theo subject + recipient để tìm email
- Loại bỏ duplicate tự động

### 5.3 Import Contacts

**Từ file (CSV/XLSX):**
- Upload file lên → parse → validate → upsert vào database
- Email trùng → cập nhật thông tin mới (tên, level, phone,...)
- Báo lỗi cụ thể từng dòng nếu thiếu dữ liệu

**Từ Google Sheets:**
- Dán link Google Sheets (phải ở chế độ "Anyone with the link can view")
- Hệ thống tự export CSV → parse → import
- Không cần publish sheet

**Quick Add:**
- Nhập nhanh dạng text: `Tên, email, level` mỗi dòng
- Preview trước khi thêm

### 5.4 Visual Email Editor

**4 chế độ editor:**
- **Visual**: WYSIWYG editor (What You See Is What You Get)
- **Code**: HTML editor thuần
- **Split**: Visual + Code song song, đồng bộ 2 chiều
- **Preview**: Xem kết quả cuối cùng với dữ liệu mẫu

**GrapeJS Builder:**
- Drag & drop builder chuyên nghiệp cho email HTML
- Hỗ trợ responsive preview: Desktop, Tablet, Mobile
- Blocks có sẵn: text, image, button, columns, divider
- Undo/Redo, clear canvas
- Export thành template

---

## 6. KIẾN TRÚC KỸ THUẬT

### Cấu trúc thư mục

```
ucmas-mail/
├── ucmas-mail.html      # Giao diện HTML (2,016 dòng)
├── styles.css           # Toàn bộ CSS (2,726 dòng)
├── app.js               # Toàn bộ JavaScript (2,710 dòng)
├── package.json         # Dependencies
├── vercel.json          # Vercel routing config
│
├── api/                 # Serverless API (Vercel Functions)
│   ├── _utils.js        # Helpers: ok/err/cors/getDB
│   ├── campaigns.js     # GET campaigns, POST test email
│   ├── campaigns-send.js# Gửi/resume/dừng campaign
│   ├── config.js        # Kiểm tra trạng thái config
│   ├── contacts.js      # CRUD contacts
│   ├── contacts-import.js# Upload file import
│   ├── levels.js        # CRUD levels
│   ├── sheets-proxy.js  # Import từ Google Sheets
│   ├── stats.js         # Thống kê dashboard
│   ├── templates.js     # CRUD templates
│   ├── tracking.js      # Tracking & backfill
│   ├── webhooks.js      # Nhận webhook từ Resend
│   └── workflows.js     # CRUD workflows
│
└── lib/                 # Shared libraries
    ├── csvParser.js     # Parse CSV/XLSX
    ├── email.js         # Gửi email qua Resend
    ├── importHelper.js  # Logic import dùng chung
    └── supabase.js      # Tất cả Supabase CRUD operations
```

### Tech Stack

| Layer | Công nghệ |
|-------|-----------|
| **Frontend** | Vanilla HTML/CSS/JS, GrapeJS |
| **Backend** | Vercel Serverless Functions (Node.js) |
| **Database** | Supabase (PostgreSQL) |
| **Email Service** | Resend API |
| **Hosting** | Vercel |
| **Font** | Google Fonts (Montserrat) |

### Database Schema

```
levels          contacts         templates
├── id          ├── id           ├── id
├── name        ├── name         ├── name
├── color       ├── email        ├── icon
├── parent_id   ├── level_id     ├── description
├── description ├── company      ├── body
└── sort_order  ├── phone        ├── tags[]
                ├── status       └── created_at
                ├── last_sent_at
                └── created_at

campaigns        send_logs         email_events
├── id           ├── id            ├── id
├── name         ├── campaign_id   ├── resend_email_id
├── subject      ├── contact_id    ├── event_type
├── body         ├── email         ├── recipient_email
├── from_name    ├── level         ├── metadata (json)
├── target_levels├── status        └── created_at
├── status       ├── resend_id
├── sent_count   ├── error_msg
├── failed_count └── sent_at
├── sent_at
└── created_at
```

### API Endpoints

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/config` | Kiểm tra cấu hình server |
| GET | `/api/stats` | Thống kê dashboard |
| GET | `/api/levels` | Lấy danh sách levels |
| POST | `/api/levels` | Tạo level mới |
| DELETE | `/api/levels?id=xxx` | Xóa level |
| GET | `/api/contacts` | Lấy contacts (có phân trang) |
| POST | `/api/contacts?action=bulk` | Import contacts hàng loạt |
| PATCH | `/api/contacts?action=level` | Đổi level cho contact |
| DELETE | `/api/contacts?id=xxx` | Xóa contact |
| POST | `/api/contacts-import` | Upload file CSV/XLSX |
| GET | `/api/sheets-proxy?url=xxx` | Import từ Google Sheets |
| GET | `/api/templates` | Lấy danh sách templates |
| POST | `/api/templates` | Tạo template mới |
| PUT | `/api/templates?id=xxx` | Sửa template |
| DELETE | `/api/templates?id=xxx` | Xóa template |
| GET | `/api/campaigns` | Lấy danh sách campaigns |
| POST | `/api/campaigns?action=test` | Gửi email test |
| POST | `/api/campaigns-send` | Gửi campaign |
| POST | `/api/campaigns-send?resume=id` | Gửi tiếp campaign |
| POST | `/api/campaigns-send?stop=id` | Dừng campaign |
| GET | `/api/tracking?summary` | Lấy tracking overview |
| POST | `/api/tracking?backfill=id` | Đồng bộ từ Resend |
| POST | `/api/webhooks` | Nhận webhook từ Resend |
| GET | `/api/workflows` | Lấy danh sách workflows |
| POST | `/api/workflows` | Tạo workflow |
| PUT | `/api/workflows?id=xxx` | Sửa workflow |
| DELETE | `/api/workflows?id=xxx` | Xóa workflow |

---

## 7. XỬ LÝ SỰ CỐ

### Campaign gửi bị dừng giữa chừng

**Nguyên nhân:** Vercel có giới hạn thời gian chạy (60s cho serverless function). Nếu campaign có >400 email, có thể bị timeout.

**Cách xử lý:**
1. Vào tab **History** → tìm campaign bị dừng (trạng thái `sending` hoặc `paused`)
2. Bấm **"▶ Gửi tiếp"**
3. Hệ thống sẽ tự bỏ qua email đã gửi và tiếp tục phần còn lại
4. Có thể phải bấm gửi tiếp nhiều lần cho campaign lớn (>2000 email)

### Tracking không hiển thị

**Nguyên nhân:** Webhook chưa được cấu hình đúng, hoặc campaign cũ không có send_logs.

**Cách xử lý:**
1. Kiểm tra Webhook URL trên Resend Dashboard
2. Bấm **"🔄 Đồng bộ trạng thái từ Resend"** trên campaign
3. Mở Console (F12) để xem log debug nếu vẫn không hoạt động

### Import file lỗi

**Kiểm tra:**
- File phải có 3 cột: `name`, `email`, `level`
- Tên level phải khớp chính xác với level đã tạo trong hệ thống (không phân biệt hoa thường)
- Email phải có ký tự `@`

### Webhook URL hiển thị "Method not allowed"

**Đây là bình thường!** Endpoint `/api/webhooks` chỉ chấp nhận method POST từ Resend. Khi mở bằng trình duyệt (GET), nó sẽ trả về lỗi 405 — điều này không ảnh hưởng đến chức năng.

### Kết nối xoay tròn mãi

**Cách xử lý:**
1. Kiểm tra Supabase URL và Key trong Settings (⚙)
2. Bấm "Test Connection" để kiểm tra
3. Đảm bảo Supabase project chưa bị pause (free tier tự pause sau 1 tuần không dùng)

---

## 📞 HỖ TRỢ

Nếu gặp vấn đề, kiểm tra:
1. **Console trình duyệt** (F12 → Console) — xem lỗi JavaScript
2. **Vercel Logs** — xem lỗi API server
3. **Supabase Dashboard** — kiểm tra dữ liệu trong database

---

*Tài liệu này được tạo tự động và cập nhật cùng với code. Phiên bản: 1.1.0*
