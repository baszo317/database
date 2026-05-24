const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { body } = require('express-validator');
const pool    = require('../db/pool');
const { validate }      = require('../middleware/error');
const { authenticate }  = require('../middleware/auth');

const router = express.Router();

// ─── POST /api/auth/register ───────────────────────────────────────────────
router.post(
  '/register',
  [
    body('user_name').trim().isLength({ min: 2, max: 50 }).withMessage('使用者名稱需 2-50 字'),
    body('email').isEmail().normalizeEmail().withMessage('Email 格式不正確'),
    body('password').isLength({ min: 6 }).withMessage('密碼至少 6 碼'),
  ],
  validate,
  async (req, res, next) => {
    const { user_name, email, password } = req.body;
    try {
      // 重複帳號檢查
      const [existing] = await pool.query(
        'SELECT user_id FROM Users WHERE email = ? OR username = ?',
        [email, user_name]
      );
      if (existing.length > 0) {
        return res.status(409).json({ success: false, message: 'Email 或使用者名稱已被使用' });
      }

      const hash = await bcrypt.hash(password, 12);
      const [result] = await pool.query(
        'INSERT INTO Users (username, email, password_hash) VALUES (?, ?, ?)',
        [user_name, email, hash]
      );

      const token = jwt.sign(
        { user_id: result.insertId, username: user_name, email },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );

      res.status(201).json({
        success: true,
        message: '註冊成功',
        token,
        user: { user_id: result.insertId, username: user_name, email },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/login ──────────────────────────────────────────────────
router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail().withMessage('Email 格式不正確'),
    body('password').notEmpty().withMessage('請輸入密碼'),
  ],
  validate,
  async (req, res, next) => {
    const { email, password } = req.body;
    try {
      const [rows] = await pool.query(
        'SELECT user_id, username, email, password_hash, is_active FROM Users WHERE email = ?',
        [email]
      );
      if (rows.length === 0) {
        return res.status(401).json({ success: false, message: 'Email 或密碼錯誤' });
      }

      const user = rows[0];
      if (!user.is_active) {
        return res.status(403).json({ success: false, message: '帳號已停用' });
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ success: false, message: 'Email 或密碼錯誤' });
      }

      const token = jwt.sign(
        { user_id: user.user_id, username: user.username, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );

      res.json({
        success: true,
        message: '登入成功',
        token,
        user: { user_id: user.user_id, username: user.username, email: user.email },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/auth/me ──────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT user_id, username, email, created_at FROM Users WHERE user_id = ?',
      [req.user.user_id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, message: '使用者不存在' });
    res.json({ success: true, user: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
