const express = require('express');
const { body, query } = require('express-validator');
const pool  = require('../db/pool');
const { authenticate }          = require('../middleware/auth');
const { requireSpaceMember }    = require('../middleware/space');
const { validate }              = require('../middleware/error');

const router = express.Router({ mergeParams: true });

// ─── GET /api/spaces/:spaceId/transactions ─────────────────────────────────
router.get(
  '/',
  authenticate,
  requireSpaceMember,
  async (req, res, next) => {
    const { type, category_id, start_date, end_date, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClauses = ['t.space_id = ?', 't.deleted_at IS NULL'];
    let params = [req.params.spaceId];

    if (type)        { whereClauses.push('t.transaction_type = ?'); params.push(type); }
    if (category_id) { whereClauses.push('t.category_id = ?');      params.push(category_id); }
    if (start_date)  { whereClauses.push('t.transaction_date >= ?'); params.push(start_date); }
    if (end_date)    { whereClauses.push('t.transaction_date <= ?'); params.push(end_date); }

    const where = whereClauses.join(' AND ');

    try {
      const [rows] = await pool.query(
        `SELECT t.*, u.username, c.category_name
         FROM Transactions t
         LEFT JOIN Users u      ON t.user_id      = u.user_id
         LEFT JOIN Categories c ON t.category_id  = c.category_id
         WHERE ${where}
         ORDER BY t.transaction_date DESC, t.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, parseInt(limit), offset]
      );

      const [[{ total }]] = await pool.query(
        `SELECT COUNT(*) AS total FROM Transactions t WHERE ${where}`,
        params
      );

      // 彙總收支
      const [[summary]] = await pool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN transaction_type='income'  THEN amount END), 0) AS total_income,
           COALESCE(SUM(CASE WHEN transaction_type='expense' THEN amount END), 0) AS total_expense
         FROM Transactions t WHERE ${where}`,
        params
      );

      res.json({
        success: true,
        transactions: rows,
        summary,
        pagination: { page: parseInt(page), limit: parseInt(limit), total },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/spaces/:spaceId/transactions ─────────────────────────────────
router.post(
  '/',
  authenticate,
  requireSpaceMember,
  [
    body('transaction_type').isIn(['income', 'expense']).withMessage('類型必須為 income 或 expense'),
    body('amount').isFloat({ gt: 0 }).withMessage('金額必須大於 0'),
    body('transaction_date').isDate().withMessage('日期格式不正確 (YYYY-MM-DD)'),
    body('currency').optional().isLength({ min: 3, max: 3 }),
  ],
  validate,
  async (req, res, next) => {
    const { transaction_type, amount, currency = 'TWD', description, transaction_date, category_id } = req.body;
    try {
      const [result] = await pool.query(
        `INSERT INTO Transactions
           (space_id, user_id, category_id, transaction_type, amount, currency, description, transaction_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.params.spaceId, req.user.user_id, category_id || null,
         transaction_type, amount, currency, description || null, transaction_date]
      );
      res.status(201).json({
        success: true,
        message: '交易紀錄新增成功',
        transaction_id: result.insertId,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/spaces/:spaceId/transactions/:txId ────────────────────────────
router.get('/:txId', authenticate, requireSpaceMember, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT t.*, u.username, c.category_name
       FROM Transactions t
       LEFT JOIN Users u      ON t.user_id     = u.user_id
       LEFT JOIN Categories c ON t.category_id = c.category_id
       WHERE t.transaction_id = ? AND t.space_id = ? AND t.deleted_at IS NULL`,
      [req.params.txId, req.params.spaceId]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, message: '找不到此交易紀錄' });
    res.json({ success: true, transaction: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/spaces/:spaceId/transactions/:txId ────────────────────────────
router.put(
  '/:txId',
  authenticate,
  requireSpaceMember,
  [
    body('transaction_type').optional().isIn(['income', 'expense']),
    body('amount').optional().isFloat({ gt: 0 }),
    body('transaction_date').optional().isDate(),
  ],
  validate,
  async (req, res, next) => {
    const { transaction_type, amount, currency, description, transaction_date, category_id } = req.body;
    try {
      // 只有建立者能修改
      const [rows] = await pool.query(
        'SELECT user_id FROM Transactions WHERE transaction_id = ? AND space_id = ? AND deleted_at IS NULL',
        [req.params.txId, req.params.spaceId]
      );
      if (rows.length === 0) return res.status(404).json({ success: false, message: '找不到此交易紀錄' });
      if (rows[0].user_id !== req.user.user_id && req.spaceRole !== 'owner') {
        return res.status(403).json({ success: false, message: '無此操作權限' });
      }

      await pool.query(
        `UPDATE Transactions SET
           transaction_type = COALESCE(?, transaction_type),
           amount           = COALESCE(?, amount),
           currency         = COALESCE(?, currency),
           description      = COALESCE(?, description),
           transaction_date = COALESCE(?, transaction_date),
           category_id      = COALESCE(?, category_id)
         WHERE transaction_id = ?`,
        [transaction_type, amount, currency, description, transaction_date, category_id, req.params.txId]
      );
      res.json({ success: true, message: '交易紀錄已更新' });
    } catch (err) {
      next(err);
    }
  }
);

// ─── DELETE /api/spaces/:spaceId/transactions/:txId ── 軟刪除 ───────────────
router.delete('/:txId', authenticate, requireSpaceMember, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT user_id FROM Transactions WHERE transaction_id = ? AND space_id = ? AND deleted_at IS NULL',
      [req.params.txId, req.params.spaceId]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, message: '找不到此交易紀錄' });
    if (rows[0].user_id !== req.user.user_id && req.spaceRole !== 'owner') {
      return res.status(403).json({ success: false, message: '無此操作權限' });
    }

    await pool.query(
      'UPDATE Transactions SET deleted_at = NOW() WHERE transaction_id = ?',
      [req.params.txId]
    );
    res.json({ success: true, message: '交易紀錄已刪除' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
