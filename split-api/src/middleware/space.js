const pool = require('../db/pool');

/**
 * Middleware: 驗證目前使用者是否為指定 space 的成員
 * 需在路由中先定義 :spaceId 參數
 */
const requireSpaceMember = async (req, res, next) => {
  const spaceId = req.params.spaceId;
  const userId  = req.user.user_id;

  try {
    const [rows] = await pool.query(
      'SELECT role FROM SpaceUsers WHERE space_id = ? AND user_id = ?',
      [spaceId, userId]
    );
    if (rows.length === 0) {
      return res.status(403).json({ success: false, message: '無此空間的存取權限' });
    }
    req.spaceRole = rows[0].role; // 'owner' | 'member'
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Middleware: 限定 owner 才能操作
 */
const requireSpaceOwner = async (req, res, next) => {
  const spaceId = req.params.spaceId;
  const userId  = req.user.user_id;

  try {
    const [rows] = await pool.query(
      "SELECT role FROM SpaceUsers WHERE space_id = ? AND user_id = ? AND role = 'owner'",
      [spaceId, userId]
    );
    if (rows.length === 0) {
      return res.status(403).json({ success: false, message: '僅空間擁有者可執行此操作' });
    }
    req.spaceRole = 'owner';
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { requireSpaceMember, requireSpaceOwner };
