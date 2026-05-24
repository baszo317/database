const { validationResult } = require('express-validator');

/**
 * express-validator 結果檢查：有錯誤就 400
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

/**
 * 全域錯誤處理
 */
const errorHandler = (err, req, res, _next) => {
  console.error('[ERROR]', err);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || '伺服器內部錯誤',
  });
};

module.exports = { validate, errorHandler };
