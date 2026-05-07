-- ============================================
-- UCMAS MAIL — Migration v3: Tags & Segment System
-- Chạy SQL này trong Supabase SQL Editor
-- ============================================

-- ★ 1. Thêm cột tags nếu chưa có (text[] array)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';

-- ★ 2. GIN index cho tag search — O(1) thay vì O(n) scan
CREATE INDEX IF NOT EXISTS idx_contacts_tags ON contacts USING GIN (tags);

-- ★ 3. Function lấy tất cả tags unique trong hệ thống
CREATE OR REPLACE FUNCTION get_all_tags()
RETURNS TABLE(tag text, count bigint) AS $$
  SELECT unnest(tags) AS tag, COUNT(*) AS count
  FROM contacts
  WHERE tags IS NOT NULL AND array_length(tags, 1) > 0
  GROUP BY tag
  ORDER BY count DESC;
$$ LANGUAGE sql STABLE;
