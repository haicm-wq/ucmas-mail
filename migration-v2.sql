-- ============================================
-- UCMAS MAIL — Migration v2: Performance & Data Integrity
-- Chạy SQL này trong Supabase SQL Editor
-- ============================================

-- ★ 1. Thêm indexes cho tracking queries (10-50x nhanh hơn)
CREATE INDEX IF NOT EXISTS idx_send_logs_resend ON send_logs(resend_id);
CREATE INDEX IF NOT EXISTS idx_send_logs_email ON send_logs(email);
CREATE INDEX IF NOT EXISTS idx_events_resend ON email_events(resend_email_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON email_events(event_type);

-- ★ 2. Unique constraints — chống duplicate data
-- Lưu ý: nếu đã có data trùng, cần xóa trước khi tạo constraint
-- Xóa duplicate events trước
DELETE FROM email_events a USING email_events b
WHERE a.id > b.id
  AND a.resend_email_id = b.resend_email_id
  AND a.event_type = b.event_type;

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_unique
ON email_events(resend_email_id, event_type);

-- Xóa duplicate send_logs (giữ record đầu tiên)
DELETE FROM send_logs a USING send_logs b
WHERE a.id > b.id
  AND a.campaign_id = b.campaign_id
  AND a.email = b.email;

CREATE UNIQUE INDEX IF NOT EXISTS idx_send_logs_unique
ON send_logs(campaign_id, email);

-- ★ 3. SQL function đếm contacts theo level — thay thế fetch toàn bộ
CREATE OR REPLACE FUNCTION count_contacts_per_level()
RETURNS TABLE(level_id uuid, count bigint) AS $$
  SELECT level_id, COUNT(*) FROM contacts
  WHERE level_id IS NOT NULL
  GROUP BY level_id;
$$ LANGUAGE sql STABLE;
