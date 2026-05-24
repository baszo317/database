require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');

const authRoutes         = require('./routes/auth');
const spacesRoutes       = require('./routes/spaces');
const transactionsRoutes = require('./routes/transactions');
const itemsRoutes        = require('./routes/items');
const debtsRoutes        = require('./routes/debts');
const budgetsRoutes      = require('./routes/budgets');
const categoriesRoutes   = require('./routes/categories');
const { errorHandler }   = require('./middleware/error');

const app = express();

// ── 全域中介層 ─────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: '*',
  credentials: false
}));
app.use(express.json());
app.use(morgan('dev'));

// ── 路由 ───────────────────────────────────────────────────────────────────
app.use('/api/auth',                                    authRoutes);
app.use('/api/spaces',                                  spacesRoutes);
app.use('/api/spaces/:spaceId/transactions',            transactionsRoutes);
app.use('/api/spaces/:spaceId/items',                   itemsRoutes);
app.use('/api/debts',                                   debtsRoutes);
app.use('/api/spaces/:spaceId/debts',                   debtsRoutes);
app.use('/api/spaces/:spaceId/budgets',                 budgetsRoutes);
app.use('/api/spaces/:spaceId/categories',              categoriesRoutes);

// ── 健康檢查 ───────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// ── 404 ────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ success: false, message: '找不到此 API 路徑' }));

// ── 錯誤處理 ───────────────────────────────────────────────────────────────
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅  S.P.L.I.T API 啟動於 http://localhost:${PORT}`));

module.exports = app;
