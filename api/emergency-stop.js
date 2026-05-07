import { ok, err, allowCors, getDBFromReq } from './_utils.js';

export const config = { api: { bodyParser: true } };

/**
 * Emergency Stop API
 *
 * POST ?action=stop   → Dừng TẤT CẢ campaigns đang gửi, lưu trạng thái kill switch
 * POST ?action=resume → Xoá kill switch (cho phép gửi lại)
 * GET                 → Kiểm tra trạng thái kill switch hiện tại
 */
export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = getDBFromReq(req);
  const { action } = req.query;

  // GET — kiểm tra trạng thái
  if (req.method === 'GET') {
    try {
      const active = await db.getKillSwitch();
      return ok(res, { killSwitchActive: active });
    } catch (e) { return err(res, e.message, 500); }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // POST ?action=stop — kích hoạt kill switch
  if (action === 'stop') {
    try {
      // 1. Lưu trạng thái kill switch vào DB
      await db.setKillSwitch(true);

      // 2. Dừng TẤT CẢ campaigns đang sending/partial
      const paused = await db.pauseAllSendingCampaigns();

      return ok(res, {
        killSwitchActive: true,
        campaignsPaused: paused,
        message: `Đã dừng khẩn cấp. ${paused} campaign bị tạm dừng.`,
      });
    } catch (e) { return err(res, e.message, 500); }
  }

  // POST ?action=resume — tắt kill switch
  if (action === 'resume') {
    try {
      await db.setKillSwitch(false);
      return ok(res, {
        killSwitchActive: false,
        message: 'Kill switch đã được tắt. Hệ thống sẵn sàng gửi email.',
      });
    } catch (e) { return err(res, e.message, 500); }
  }

  return err(res, 'action không hợp lệ. Dùng ?action=stop hoặc ?action=resume');
}
