-- ============================================
-- UCMAS MAIL — Migration v5: Thêm trường "Tên con" (child_name)
-- Chạy SQL này trong Supabase SQL Editor
-- ============================================

-- Thêm cột child_name vào bảng contacts
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS child_name TEXT DEFAULT '';
