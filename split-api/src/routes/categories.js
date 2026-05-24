const express = require('express');
const { body } = require('express-validator');
const pool  = require('../db/pool');
const { authenticate }       = require('../middleware/auth');
const { requireSpaceMember } = require('../middleware/space');
const { validate }           = require('../middleware/error');

const router = express.Router({ mergeParams: true });

// GET /api/spaces/:spaceId/categories
router.get('/', authenticate, requireSpaceMember, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM Categories WHERE space_id = ? OR space_id IS NULL ORDER BY category_name`,
      [req.params.spaceId]
    );
    res.json({ success: true, categories: rows });
  } catch (err) { next(err); }
});

// POST /api/spaces/:spaceId/categories
router.post('/', authenticate, requireSpaceMember,
  [body('category_name').trim().isLength({ min: 1, max: 50 }).withMessage('分類名稱不可為空')],
  validate,
  async (req, res, next) => {
    try {
      const [result] = await pool.query(
        'INSERT INTO Categories (category_name, space_id) VALUES (?, ?)',
        [req.body.category_name, req.params.spaceId]
      );
      res.status(201).json({ success: true, category_id: result.insertId });
    } catch (err) { next(err); }
  }
);

// DELETE /api/spaces/:spaceId/categories/:categoryId
router.delete('/:categoryId', authenticate, requireSpaceMember, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM Categories WHERE category_id = ? AND space_id = ?',
      [req.params.categoryId, req.params.spaceId]);
    res.json({ success: true, message: '分類已刪除' });
  } catch (err) { next(err); }
});

module.exports = router;
