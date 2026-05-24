const express = require('express');
const crypto  = require('crypto');
const { body, param } = require('express-validator');
const pool    = require('../db/pool');
const { authenticate }                    = require('../middleware/auth');
const { requireSpaceMember, requireSpaceOwner } = require('../middleware/space');
const { validate }                        = require('../middleware/error');

const router = express.Router();

// ─── GET /api/spaces ── 取得目前使用者所有空間 ──────────────────────────────
router.get('/', authenticate, async (req, res, next) => {
  try {
    const [spaces] = await pool.query(
      `SELECT s.space_id, s.space_name, s.is_public, s.created_at, su.role,
              u.username AS created_by_name,
              (SELECT COUNT(*) FROM SpaceUsers su2 WHERE su2.space_id = s.space_id) AS member_count
       FROM Spaces s
       JOIN SpaceUsers su ON s.space_id = su.space_id
       JOIN Users u       ON s.created_by = u.user_id
       WHERE su.user_id = ?
       ORDER BY s.created_at DESC`,
      [req.user.user_id]
    );
    res.json({ success: true, spaces });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/spaces ── 建立新空間 ────────────────────────────────────────
router.post(
  '/',
  authenticate,
  [body('space_name').trim().isLength({ min: 1, max: 100 }).withMessage('空間名稱不可為空')],
  validate,
  async (req, res, next) => {
    const { space_name, is_public = false } = req.body;
    const userId = req.user.user_id;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 產生唯一邀請碼
      const inviteCode = crypto.randomBytes(32).toString('hex');

      const [result] = await conn.query(
        'INSERT INTO Spaces (space_name, created_by, is_public, invite_code) VALUES (?, ?, ?, ?)',
        [space_name, userId, is_public, inviteCode]
      );
      const spaceId = result.insertId;

      // 建立者自動成為 owner
      await conn.query(
        "INSERT INTO SpaceUsers (space_id, user_id, role) VALUES (?, ?, 'owner')",
        [spaceId, userId]
      );

      await conn.commit();
      res.status(201).json({
        success: true,
        message: '空間建立成功',
        space: { space_id: spaceId, space_name, is_public, invite_code: inviteCode },
      });
    } catch (err) {
      await conn.rollback();
      next(err);
    } finally {
      conn.release();
    }
  }
);
// ─── GET /api/spaces/personal ── 取得或自動建立個人空間 ────────────────────
router.get('/personal', authenticate, async (req, res, next) => {
  const userId = req.user.user_id;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query(
      `SELECT s.space_id FROM Spaces s
       JOIN SpaceUsers su ON s.space_id = su.space_id
       WHERE su.user_id = ? AND s.space_name = '個人空間' AND su.role = 'owner'
       LIMIT 1`,
      [userId]
    );
    if (existing.length > 0) {
      await conn.commit();
      return res.json({ success: true, space_id: existing[0].space_id });
    }
    const inviteCode = crypto.randomBytes(32).toString('hex');
    const [result] = await conn.query(
      'INSERT INTO Spaces (space_name, created_by, is_public, invite_code) VALUES (?, ?, 0, ?)',
      ['個人空間', userId, inviteCode]
    );
    const spaceId = result.insertId;
    await conn.query(
      "INSERT INTO SpaceUsers (space_id, user_id, role) VALUES (?, ?, 'owner')",
      [spaceId, userId]
    );
    await conn.commit();
    res.json({ success: true, space_id: spaceId });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});
// ─── GET /api/spaces/:spaceId ── 取得單一空間詳情 ──────────────────────────
router.get(
  '/:spaceId',
  authenticate,
  requireSpaceMember,
  async (req, res, next) => {
    try {
      const [spaces] = await pool.query(
        `SELECT s.*, u.username AS created_by_name FROM Spaces s
         JOIN Users u ON s.created_by = u.user_id
         WHERE s.space_id = ?`,
        [req.params.spaceId]
      );
      const [members] = await pool.query(
        `SELECT u.user_id, u.username, u.email, su.role, su.joined_at
         FROM SpaceUsers su JOIN Users u ON su.user_id = u.user_id
         WHERE su.space_id = ?`,
        [req.params.spaceId]
      );
      res.json({ success: true, space: { ...spaces[0], members } });
    } catch (err) {
      next(err);
    }
  }
);

// ─── PUT /api/spaces/:spaceId ── 更新空間名稱 ──────────────────────────────
router.put(
  '/:spaceId',
  authenticate,
  requireSpaceOwner,
  [body('space_name').trim().isLength({ min: 1, max: 100 }).withMessage('空間名稱不可為空')],
  validate,
  async (req, res, next) => {
    try {
      await pool.query('UPDATE Spaces SET space_name = ? WHERE space_id = ?', [
        req.body.space_name,
        req.params.spaceId,
      ]);
      res.json({ success: true, message: '空間更新成功' });
    } catch (err) {
      next(err);
    }
  }
);

// ─── DELETE /api/spaces/:spaceId ── 刪除空間 ───────────────────────────────
router.delete(
  '/:spaceId',
  authenticate,
  requireSpaceOwner,
  async (req, res, next) => {
    try {
      await pool.query('DELETE FROM Spaces WHERE space_id = ?', [req.params.spaceId]);
      res.json({ success: true, message: '空間已刪除' });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/spaces/join ── 透過邀請碼加入空間 ───────────────────────────
router.post(
  '/join',
  authenticate,
  [body('invite_code').notEmpty().withMessage('請提供邀請碼')],
  validate,
  async (req, res, next) => {
    try {
      const [spaces] = await pool.query(
        'SELECT space_id, space_name FROM Spaces WHERE invite_code = ?',
        [req.body.invite_code]
      );
      if (spaces.length === 0) {
        return res.status(404).json({ success: false, message: '邀請碼無效' });
      }

      const { space_id, space_name } = spaces[0];
      const [existing] = await pool.query(
        'SELECT 1 FROM SpaceUsers WHERE space_id = ? AND user_id = ?',
        [space_id, req.user.user_id]
      );
      if (existing.length > 0) {
        return res.status(409).json({ success: false, message: '你已是此空間成員' });
      }

      await pool.query(
        "INSERT INTO SpaceUsers (space_id, user_id, role) VALUES (?, ?, 'member')",
        [space_id, req.user.user_id]
      );
      res.json({ success: true, message: `成功加入「${space_name}」`, space_id });
    } catch (err) {
      next(err);
    }
  }
);

// ─── DELETE /api/spaces/:spaceId/members/:userId ── 移除成員 / 離開空間 ────
router.delete(
  '/:spaceId/members/:userId',
  authenticate,
  requireSpaceMember,
  async (req, res, next) => {
    const targetId  = parseInt(req.params.userId);
    const requesterId = req.user.user_id;
    const spaceId   = req.params.spaceId;

    // 只有 owner 或自己才能移除
    if (req.spaceRole !== 'owner' && requesterId !== targetId) {
      return res.status(403).json({ success: false, message: '無此權限' });
    }
    try {
      await pool.query(
        'DELETE FROM SpaceUsers WHERE space_id = ? AND user_id = ?',
        [spaceId, targetId]
      );
      res.json({ success: true, message: '成員已移除' });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
