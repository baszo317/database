const jwt = require('jsonwebtoken');

/**
 * Middleware: 驗證 JWT，將 decoded payload 掛到 req.user
 */
const authenticate = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: '未提供身份憑證' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { user_id, username, email }
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token 無效或已過期' });
  }
};

module.exports = { authenticate };
