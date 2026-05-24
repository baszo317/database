const express = require('express');
const { body } = require('express-validator');
const pool  = require('../db/pool');
const { authenticate }       = require('../middleware/auth');
const { requireSpaceMember } = require('../middleware/space');
const { validate }           = require('../middleware/error');

const router = express.Router({ mergeParams: true });

// ─── GET /api/spaces/:spaceId/items ─────────────────────────────────────────
router.get('/', authenticate, requireSpaceMember, async (req, res, next) => {
  try {
    const [items] = await pool.query(
      `SELECT si.*,
              buyer.username  AS buyer_name,
              holder.username AS holder_name
       FROM SharedItems si
       JOIN Users buyer  ON si.buyer_id  = buyer.user_id
       JOIN Users holder ON si.holder_id = holder.user_id
       WHERE si.space_id = ? AND si.deleted_at IS NULL
       ORDER BY si.created_at DESC`,
      [req.params.spaceId]
    );
    res.json({ success: true, items });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/spaces/:spaceId/items ── 新增分攤項目並自動建立 Debt ──────────
router.post(
  '/',
  authenticate,
  requireSpaceMember,
  [
    body('item_name').trim().isLength({ min: 1, max: 100 }).withMessage('項目名稱不可為空'),
    body('unit_price').isFloat({ gt: 0 }).withMessage('單價必須大於 0'),
    body('quantity').isFloat({ gt: 0 }).withMessage('數量必須大於 0'),
    body('holder_id').isInt().withMessage('需指定持有者'),
    body('split_with').optional().isArray().withMessage('分攤成員需為陣列'),
  ],
  validate,
  async (req, res, next) => {
    const { item_name, unit_price, quantity, holder_id, split_with = [] } = req.body;
    const buyerId  = req.user.user_id;
    const spaceId  = req.params.spaceId;
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      // 建立 SharedItem
      const [result] = await conn.query(
        `INSERT INTO SharedItems (space_id, item_name, unit_price, quantity, buyer_id, holder_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [spaceId, item_name, unit_price, quantity, buyerId, holder_id]
      );
      const itemId   = result.insertId;
      const total    = parseFloat(unit_price) * parseFloat(quantity);

      // 自動分攤 Debt
      // split_with = [{ user_id, share_amount }] 或平均分
      let debtsCreated = 0;
      if (split_with.length > 0) {
        for (const entry of split_with) {
          const debtorId    = entry.user_id;
          const shareAmount = entry.share_amount || (total / (split_with.length + 1));

          if (debtorId === buyerId) continue; // 自己不欠自己

          await conn.query(
            `INSERT INTO Debts
               (space_id, creditor_id, debtor_id, original_amount, remaining_amount, source_item_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [spaceId, buyerId, debtorId, shareAmount, shareAmount, itemId]
          );
          debtsCreated++;
        }
      }

      await conn.commit();
      res.status(201).json({
        success: true,
        message: `分攤項目新增成功，已自動建立 ${debtsCreated} 筆債務`,
        item_id: itemId,
        total,
      });
    } catch (err) {
      await conn.rollback();
      next(err);
    } finally {
      conn.release();
    }
  }
);

// ─── DELETE /api/spaces/:spaceId/items/:itemId ── 軟刪除 ────────────────────
router.delete('/:itemId', authenticate, requireSpaceMember, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT buyer_id FROM SharedItems WHERE item_id = ? AND space_id = ? AND deleted_at IS NULL',
      [req.params.itemId, req.params.spaceId]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, message: '找不到此項目' });
    if (rows[0].buyer_id !== req.user.user_id && req.spaceRole !== 'owner') {
      return res.status(403).json({ success: false, message: '無此操作權限' });
    }

    await pool.query('UPDATE SharedItems SET deleted_at = NOW() WHERE item_id = ?', [req.params.itemId]);
    res.json({ success: true, message: '項目已刪除' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
