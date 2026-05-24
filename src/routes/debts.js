const express = require('express');
const { body } = require('express-validator');
const pool  = require('../db/pool');
const { authenticate }       = require('../middleware/auth');
const { requireSpaceMember } = require('../middleware/space');
const { validate }           = require('../middleware/error');

const router = express.Router({ mergeParams: true });

// ─── GET /api/spaces/:spaceId/debts ─────────────────────────────────────────
router.get('/', authenticate, requireSpaceMember, async (req, res, next) => {
  const { status, view = 'all' } = req.query; // view: all | mine | owed
  const userId = req.user.user_id;

  let whereClauses = ['d.space_id = ?', 'd.deleted_at IS NULL'];
  let params = [req.params.spaceId];

  if (status) { whereClauses.push('d.status = ?'); params.push(status); }
  if (view === 'mine') {
    whereClauses.push('d.debtor_id = ?');
    params.push(userId);
  } else if (view === 'owed') {
    whereClauses.push('d.creditor_id = ?');
    params.push(userId);
  }

  try {
    const [debts] = await pool.query(
      `SELECT d.*,
              creditor.username AS creditor_name,
              debtor.username   AS debtor_name,
              si.item_name      AS source_item_name
       FROM Debts d
       JOIN Users creditor ON d.creditor_id    = creditor.user_id
       JOIN Users debtor   ON d.debtor_id      = debtor.user_id
      LEFT JOIN SharedItems si ON d.source_item_id = si.item_id AND si.deleted_at IS NULL
       WHERE ${whereClauses.join(' AND ')}
       ORDER BY d.created_at DESC`,
      params
    );

    // 彙總：我欠多少 / 別人欠我多少
    const [[myDebtSummary]] = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN debtor_id   = ? THEN remaining_amount END), 0) AS i_owe,
         COALESCE(SUM(CASE WHEN creditor_id = ? THEN remaining_amount END), 0) AS owed_to_me
       FROM Debts
       WHERE space_id = ? AND deleted_at IS NULL AND status != 'paid'`,
      [userId, userId, req.params.spaceId]
    );

    res.json({ success: true, debts, summary: myDebtSummary });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/spaces/:spaceId/debts ── 手動建立債務 ────────────────────────
router.post(
  '/',
  authenticate,
  requireSpaceMember,
  [
    body('debtor_id').isInt().withMessage('需指定借款人'),
    body('original_amount').isFloat({ gt: 0 }).withMessage('金額必須大於 0'),
    body('currency').optional().isLength({ min: 3, max: 3 }),
    body('visibility').optional().isIn(['public', 'private']),
  ],
  validate,
  async (req, res, next) => {
    const { debtor_id, original_amount, currency = 'TWD', visibility = 'public' } = req.body;
    const creditorId = req.body.creditor_id || req.user.user_id;

    if (parseInt(debtor_id) === creditorId) {
      return res.status(400).json({ success: false, message: '不可建立與自己的債務' });
    }

    try {
      const [result] = await pool.query(
        `INSERT INTO Debts
           (space_id, creditor_id, debtor_id, original_amount, remaining_amount, currency, visibility)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [req.params.spaceId, creditorId, debtor_id, original_amount, original_amount, currency, visibility]
      );
      res.status(201).json({
        success: true,
        message: '債務記錄已建立',
        debt_id: result.insertId,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/spaces/:spaceId/debts/:debtId/settle ── 還款/結清 ────────────
router.post(
  '/:debtId/settle',
  authenticate,
  requireSpaceMember,
  [body('amount').isFloat({ gt: 0 }).withMessage('還款金額必須大於 0')],
  validate,
  async (req, res, next) => {
    const { amount } = req.body;
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const [rows] = await conn.query(
        `SELECT * FROM Debts WHERE debt_id = ? AND space_id = ? AND deleted_at IS NULL`,
        [req.params.debtId, req.params.spaceId]
      );
      if (rows.length === 0) return res.status(404).json({ success: false, message: '找不到此債務' });

      const debt = rows[0];
      // 只有債務人或 owner 可以還款
      if (debt.debtor_id !== req.user.user_id && req.spaceRole !== 'owner') {
        return res.status(403).json({ success: false, message: '無此操作權限' });
      }
      if (debt.status === 'paid') {
        return res.status(400).json({ success: false, message: '此債務已結清' });
      }

      const payAmount    = Math.min(parseFloat(amount), parseFloat(debt.remaining_amount));
      const newRemaining = parseFloat(debt.remaining_amount) - payAmount;
      const newStatus    = newRemaining <= 0 ? 'paid' : 'partial';

      await conn.query(
        'UPDATE Debts SET remaining_amount = ?, status = ? WHERE debt_id = ?',
        [newRemaining, newStatus, req.params.debtId]
      );

      await conn.commit();
      res.json({
        success: true,
        message: newStatus === 'paid' ? '債務已完全結清！' : `已還款，剩餘 ${newRemaining}`,
        remaining_amount: newRemaining,
        status: newStatus,
      });
    } catch (err) {
      await conn.rollback();
      next(err);
    } finally {
      conn.release();
    }
  }
);

// ─── DELETE /api/spaces/:spaceId/debts/:debtId ── 軟刪除 ────────────────────
router.delete('/:debtId', authenticate, requireSpaceMember, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT creditor_id FROM Debts WHERE debt_id = ? AND space_id = ? AND deleted_at IS NULL',
      [req.params.debtId, req.params.spaceId]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, message: '找不到此債務' });
    if (rows[0].creditor_id !== req.user.user_id && req.spaceRole !== 'owner') {
      return res.status(403).json({ success: false, message: '無此操作權限' });
    }

    await pool.query('UPDATE Debts SET deleted_at = NOW() WHERE debt_id = ?', [req.params.debtId]);
    res.json({ success: true, message: '債務記錄已刪除' });
  } catch (err) {
    next(err);
  }
});
// ─── GET /api/debts/all ── 查詢目前使用者所有空間的債務 ────────────────────
router.get('/all', authenticate, async (req, res, next) => {
  const userId = req.user.user_id;
  try {
    const [debts] = await pool.query(
      `SELECT d.*,
              creditor.username AS creditor_name,
              debtor.username   AS debtor_name,
              si.item_name      AS source_item_name,
              s.space_name
       FROM Debts d
       JOIN Users creditor ON d.creditor_id = creditor.user_id
       JOIN Users debtor   ON d.debtor_id   = debtor.user_id
       JOIN Spaces s        ON d.space_id    = s.space_id
       LEFT JOIN SharedItems si ON d.source_item_id = si.item_id AND si.deleted_at IS NULL
       WHERE (d.creditor_id = ? OR d.debtor_id = ?)
         AND d.deleted_at IS NULL
       ORDER BY d.created_at DESC`,
      [userId, userId]
    );

    const [[summary]] = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN debtor_id   = ? THEN remaining_amount END), 0) AS i_owe,
         COALESCE(SUM(CASE WHEN creditor_id = ? THEN remaining_amount END), 0) AS owed_to_me
       FROM Debts
       WHERE (creditor_id = ? OR debtor_id = ?)
         AND deleted_at IS NULL AND status != 'paid'`,
      [userId, userId, userId, userId]
    );

    res.json({ success: true, debts, summary });
  } catch (err) {
    next(err);
  }
});
module.exports = router;
