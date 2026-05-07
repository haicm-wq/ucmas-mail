-- ============================================
-- UCMAS MAIL — Migration v4: Tags Table & Segments
-- Chạy trong Supabase SQL Editor
-- ============================================

-- ★ 1. Bảng tags (quản lý tag như level)
CREATE TABLE IF NOT EXISTS tags (
  id          uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  name        text          NOT NULL UNIQUE,
  color       text          DEFAULT '#a78bfa',
  description text,
  created_at  timestamptz   DEFAULT now()
);

-- ★ 2. Bảng segments (lưu điều kiện lọc khách hàng)
CREATE TABLE IF NOT EXISTS segments (
  id          uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  name        text          NOT NULL,
  description text,
  color       text          DEFAULT '#60a5fa',
  rules       jsonb         NOT NULL DEFAULT '[]',
  -- rules format: [{ type: 'level'|'tag', value: 'id_or_name', mode: 'include'|'exclude' }]
  logic       text          DEFAULT 'and',  -- 'and' | 'or' giữa level và tag
  tag_mode    text          DEFAULT 'or',   -- 'and' | 'or' giữa nhiều tags
  created_at  timestamptz   DEFAULT now()
);

-- ★ 3. Enable RLS
ALTER TABLE tags     ENABLE ROW LEVEL SECURITY;
ALTER TABLE segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all_tags"     ON tags     FOR ALL TO authenticated USING (true);
CREATE POLICY "auth_all_segments" ON segments FOR ALL TO authenticated USING (true);

-- ★ 4. Cập nhật function get_all_tags để join với bảng tags
CREATE OR REPLACE FUNCTION get_all_tags()
RETURNS TABLE(tag text, color text, description text, count bigint) AS $$
  SELECT
    t.name AS tag,
    t.color,
    t.description,
    COUNT(c.id) AS count
  FROM tags t
  LEFT JOIN contacts c ON c.tags @> ARRAY[t.name]
  GROUP BY t.name, t.color, t.description
  ORDER BY count DESC;
$$ LANGUAGE sql STABLE;
