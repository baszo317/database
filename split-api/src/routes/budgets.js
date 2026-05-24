const express = require('express');
const { body } = require('express-validator');
const pool  = require('../db/pool');
const { authenticate }       = require('../middleware/auth');
const { requireSpaceMember } = require('../middleware/space');
const { validate }           = require('../middleware/error');

const router = express.Router({ mergeParams: true });

// ─── GET /api/spaces/:spaceId/budgets ── 取得所有預算（含消費進度）─────────
router.get('/', authenticate, requireSpaceMember, async (req, res, next) => {
  try {
    const [budgets] = await pool.query(
      `SELECT b.*,
              c.category_name,
              COALESCE(SUM(CASE WHEN t.deleted_at IS NULL
                                 AND t.transaction_type = 'expense'
                                 AND t.transaction_date BETWEEN b.start_date AND b.end_date
                            THEN t.amount END), 0) AS spent_amount
       FROM Budgets b
       LEFT JOIN Categories c    ON b.category_id   = c.category_id
       LEFT JOIN Transactions t  ON t.space_id       = b.space_id
                                AND (b.category_id IS NULL OR t.category_id = b.category_id)
       WHERE b.space_id = ?
       GROUP BY b.budget_id
       ORDER BY b.start_date DESC`,
      [req.params.spaceId]
    );

    // 加入進度百分比
    const result = budgets.map(b => ({
      ...b,
      remaining: parseFloat(b.budget_amount) - parseFloat(b.spent_amount),
      progress_pct: Math.min(
        ((parseFloat(b.spent_amount) / parseFloat(b.budget_amount)) * 100).toFixed(1),
        100
      ),
      is_exceeded: parseFloat(b.spent_amount) > parseFloat(b.budget_amount),
    }));

    res.json({ success: true, budgets: result });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/spaces/:spaceId/budgets ─────────────────────────────────────
router.post(
  '/',
  authenticate,
  requireSpaceMember,
  [
    body('budget_name').trim().isLength({ min: 1, max: 100 }).withMessage('預算名稱不可為空'),
    body('budget_amount').isFloat({ gt: 0 }).withMessage('預算金額必須大於 0'),
    body('start_date').isDate().withMessage('開始日期格式不正確'),
    body('end_date').isDate().withMessage('結束日期格式不正確'),
  ],
  validate,
  async (req, res, next) => {
    const { budget_name, category_id, budget_amount, start_date, end_date } = req.body;

    if (new Date(end_date) < new Date(start_date)) {
      return res.status(400).json({ success: false, message: '結束日期不得早於開始日期' });
    }

    try {
      const [result] = await pool.query(
        `INSERT INTO Budgets (space_id, budget_name, category_id, budget_amount, start_date, end_date)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [req.params.spaceId, budget_name, category_id || null, budget_amount, start_date, end_date]
      );
      res.status(201).json({
        success: true,
        message: '預算設定成功',
        budget_id: result.insertId,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/spaces/:spaceId/budgets/:budgetId ─────────────────────────────
router.get('/:budgetId', authenticate, requireSpaceMember, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.*, c.category_name,
              COALESCE(SUM(CASE WHEN t.deleted_at IS NULL
                                 AND t.transaction_type = 'expense'
                                 AND t.transaction_date BETWEEN b.start_date AND b.end_date
                            THEN t.amount END), 0) AS spent_amount
       FROM Budgets b
       LEFT JOIN Categories c   ON b.category_id  = c.category_id
       LEFT JOIN Transactions t ON t.space_id      = b.space_id
                               AND (b.category_id IS NULL OR t.category_id = b.category_id)
       WHERE b.budget_id = ? AND b.space_id = ?
       GROUP BY b.budget_id`,
      [req.params.budgetId, req.params.spaceId]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, message: '找不到此預算' });

    const b = rows[0];
    res.json({
      success: true,
      budget: {
        ...b,
        remaining:    parseFloat(b.budget_amount) - parseFloat(b.spent_amount),
        progress_pct: Math.min(((parseFloat(b.spent_amount) / parseFloat(b.budget_amount)) * 100).toFixed(1), 100),
        is_exceeded:  parseFloat(b.spent_amount) > parseFloat(b.budget_amount),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/spaces/:spaceId/budgets/:budgetId ─────────────────────────────
router.put(
  '/:budgetId',
  authenticate,
  requireSpaceMember,
  [
    body('budget_amount').optional().isFloat({ gt: 0 }),
    body('start_date').optional().isDate(),
    body('end_date').optional().isDate(),
  ],
  validate,
  async (req, res, next) => {
    const { budget_name, category_id, budget_amount, start_date, end_date } = req.body;
    try {
      await pool.query(
        `UPDATE Budgets SET
           budget_name   = COALESCE(?, budget_name),
           category_id   = COALESCE(?, category_id),
           budget_amount = COALESCE(?, budget_amount),
           start_date    = COALESCE(?, start_date),
           end_date      = COALESCE(?, end_date)
         WHERE budget_id = ? AND space_id = ?`,
        [budget_name, category_id, budget_amount, start_date, end_date,
         req.params.budgetId, req.params.spaceId]
      );
      res.json({ success: true, message: '預算已更新' });
    } catch (err) {
      next(err);
    }
  }
);

// ─── DELETE /api/spaces/:spaceId/budgets/:budgetId ──────────────────────────
router.delete('/:budgetId', authenticate, requireSpaceMember, async (req, res, next) => {
  try {
    await pool.query(
      'DELETE FROM Budgets WHERE budget_id = ? AND space_id = ?',
      [req.params.budgetId, req.params.spaceId]
    );
    res.json({ success: true, message: '預算已刪除' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
