/**
 * Import Helper — Logic dùng chung cho contacts-import.js và sheets-proxy.js
 * Chuyển đổi parsed rows → contacts sẵn sàng upsert vào DB
 */

/**
 * Map rows từ CSV/XLSX sang contacts có level_id, sẵn sàng upsert.
 * @param {Object} db - Database instance (từ makeDB)
 * @param {Array} rows - Parsed rows [{name, email, level, company, phone}]
 * @returns {{ toUpsert: Array, unresolved: string[] }}
 */
export async function resolveContactLevels(db, rows) {
  const levels = await db.getLevels();
  const levelMap = {};
  levels.forEach(l => { levelMap[l.name.toUpperCase()] = l.id; });

  const toUpsert = [];
  const unresolved = [];

  for (const row of rows) {
    const levelId = levelMap[row.level];
    if (!levelId) {
      unresolved.push(`Level "${row.level}" không tìm thấy (${row.email})`);
      continue;
    }
    toUpsert.push({
      name: row.name,
      email: row.email,
      level_id: levelId,
      company: row.company || '',
      phone: row.phone || '',
      status: 'active',
    });
  }

  return { toUpsert, unresolved };
}

/**
 * Upsert contacts và trả về kết quả import.
 */
export async function importContacts(db, rows) {
  const { toUpsert, unresolved } = await resolveContactLevels(db, rows);
  const inserted = toUpsert.length > 0 ? await db.upsertContacts(toUpsert) : [];
  return {
    imported: inserted.length,
    skipped: unresolved.length,
    levelErrors: unresolved,
  };
}
