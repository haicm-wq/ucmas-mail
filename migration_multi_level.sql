-- ═══════════════════════════════════════════════════════════
-- Migration: Multi-Level Contacts
-- Thêm cột level_ids (uuid[]) để hỗ trợ 1 contact thuộc nhiều levels
-- ═══════════════════════════════════════════════════════════

-- 1. Thêm cột level_ids
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS level_ids uuid[] DEFAULT '{}';

-- 2. Sync dữ liệu hiện có: copy level_id vào level_ids
UPDATE contacts 
SET level_ids = ARRAY[level_id] 
WHERE level_id IS NOT NULL 
  AND (level_ids IS NULL OR level_ids = '{}');

-- 3. Tạo GIN index cho level_ids (tăng tốc query overlaps/contains)
CREATE INDEX IF NOT EXISTS idx_contacts_level_ids ON contacts USING GIN (level_ids);

-- 4. Tạo function đếm contacts per level từ level_ids
CREATE OR REPLACE FUNCTION count_contacts_per_level_v2()
RETURNS TABLE(level_id uuid, count bigint) AS $$
  SELECT unnest(level_ids) as level_id, count(*) as count
  FROM contacts
  WHERE status = 'active' AND level_ids IS NOT NULL AND level_ids != '{}'
  GROUP BY level_id;
$$ LANGUAGE sql STABLE;
