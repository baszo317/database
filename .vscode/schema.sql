CREATE DATABASE IF NOT EXISTS finance_space_system
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
 
USE finance_space_system;
 
-- =========================================================
-- 1. 使用者 (Users)
-- =========================================================
CREATE TABLE IF NOT EXISTS Users (
    user_id      BIGINT       PRIMARY KEY AUTO_INCREMENT,
    username     VARCHAR(50)  NOT NULL UNIQUE,
    email        VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_active    BOOLEAN      DEFAULT TRUE,
    created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
 
-- =========================================================
-- 2. 空間/群組 (Spaces)
-- =========================================================
CREATE TABLE IF NOT EXISTS Spaces (
    space_id    BIGINT       PRIMARY KEY AUTO_INCREMENT,
    space_name  VARCHAR(100) NOT NULL,
    created_by  BIGINT       NOT NULL,
    is_public   BOOLEAN      DEFAULT FALSE,
    -- 改善: invite_code 從 20 延長為 64，減少暴力猜測風險
    invite_code VARCHAR(128)  UNIQUE,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
 
    CONSTRAINT fk_spaces_created_by
        FOREIGN KEY (created_by) REFERENCES Users(user_id)
        ON DELETE RESTRICT
);
 
-- =========================================================
-- 3. 空間成員關聯 (SpaceUsers)
-- =========================================================
CREATE TABLE IF NOT EXISTS SpaceUsers (
    space_id  BIGINT   NOT NULL,
    user_id   BIGINT   NOT NULL,
    role      ENUM('owner', 'member') DEFAULT 'member',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
 
    PRIMARY KEY (space_id, user_id),
 
    CONSTRAINT fk_spaceusers_space
        FOREIGN KEY (space_id) REFERENCES Spaces(space_id) ON DELETE CASCADE,
    CONSTRAINT fk_spaceusers_user
        FOREIGN KEY (user_id)  REFERENCES Users(user_id)  ON DELETE CASCADE
);
 
-- =========================================================
-- 4. 交易分類 (Categories)
-- =========================================================
CREATE TABLE IF NOT EXISTS Categories (
    category_id   BIGINT      PRIMARY KEY AUTO_INCREMENT,
    category_name VARCHAR(50) NOT NULL,
    space_id      BIGINT      NULL DEFAULT NULL,
 
    UNIQUE KEY uq_category_space (category_name, space_id),
 
    CONSTRAINT fk_categories_space
        FOREIGN KEY (space_id) REFERENCES Spaces(space_id)
        ON DELETE CASCADE
);
 
-- =========================================================
-- 5. 交易紀錄 (Transactions)
-- =========================================================
CREATE TABLE IF NOT EXISTS Transactions (
    transaction_id   BIGINT       PRIMARY KEY AUTO_INCREMENT,
    space_id         BIGINT       NOT NULL,
    user_id          BIGINT       NOT NULL,
    category_id      BIGINT,
 
    transaction_type ENUM('income', 'expense') NOT NULL,
    amount           DECIMAL(12,2) NOT NULL,
    currency         CHAR(3)       NOT NULL DEFAULT 'TWD',
    description      TEXT,
    transaction_date DATE          NOT NULL,
 
    -軟刪除
    deleted_at  DATETIME     DEFAULT NULL,
 
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 金額必須大於 0
    CONSTRAINT chk_transactions_amount CHECK (amount > 0),
 
    CONSTRAINT fk_transactions_space
        FOREIGN KEY (space_id)    REFERENCES Spaces(space_id)     ON DELETE RESTRICT,
    CONSTRAINT fk_transactions_user
        FOREIGN KEY (user_id)     REFERENCES Users(user_id)       ON DELETE RESTRICT,
    CONSTRAINT fk_transactions_category
        FOREIGN KEY (category_id) REFERENCES Categories(category_id) ON DELETE SET NULL,
 
    INDEX idx_transaction_date    (transaction_date),
    -- 改善: 補充高頻查詢索引
    INDEX idx_transactions_space  (space_id),
    INDEX idx_transactions_user   (user_id),
    INDEX idx_transactions_deleted (deleted_at)
);
 
-- =========================================================
-- 6. 共享項目/分帳明細 (SharedItems)
-- =========================================================
CREATE TABLE IF NOT EXISTS SharedItems (
    item_id    BIGINT        PRIMARY KEY AUTO_INCREMENT,
    space_id   BIGINT        NOT NULL,
    item_name  VARCHAR(100)  NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL,
    quantity   DECIMAL(10,2) NOT NULL,
    buyer_id   BIGINT        NOT NULL,
    holder_id  BIGINT        NOT NULL,
 
    -- 改善: 軟刪除
    deleted_at DATETIME      DEFAULT NULL,
 
    created_at DATETIME      DEFAULT CURRENT_TIMESTAMP,
 
    -- 改善: 金額與數量必須大於 0
    CONSTRAINT chk_shareditems_price    CHECK (unit_price > 0),
    CONSTRAINT chk_shareditems_quantity CHECK (quantity > 0),
 
    CONSTRAINT fk_shareditems_space
        FOREIGN KEY (space_id)  REFERENCES Spaces(space_id) ON DELETE RESTRICT,
    CONSTRAINT fk_shareditems_buyer
        FOREIGN KEY (buyer_id)  REFERENCES Users(user_id)   ON DELETE RESTRICT,
    CONSTRAINT fk_shareditems_holder
        FOREIGN KEY (holder_id) REFERENCES Users(user_id)   ON DELETE RESTRICT
);
 
-- =========================================================
-- 7. 債務/結算狀態 (Debts)
-- =========================================================
CREATE TABLE IF NOT EXISTS Debts (
    debt_id          BIGINT        PRIMARY KEY AUTO_INCREMENT,
    space_id         BIGINT        NOT NULL,
    creditor_id      BIGINT        NOT NULL,
    debtor_id        BIGINT        NOT NULL,
 
    original_amount  DECIMAL(12,2) NOT NULL,
    remaining_amount DECIMAL(12,2) NOT NULL,
 
    -- 改善: 追蹤債務來源（可為 NULL，代表手動建立）
    source_item_id   BIGINT        NULL DEFAULT NULL,
 
    -- 改善: 貨幣欄位
    currency         CHAR(3)       NOT NULL DEFAULT 'TWD',
 
    status     ENUM('pending', 'partial', 'paid') DEFAULT 'pending',
    visibility ENUM('public', 'private')          DEFAULT 'public',
 
    -- 改善: 軟刪除
    deleted_at DATETIME      DEFAULT NULL,
 
    created_at DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 
    -- 改善: 剩餘金額不得為負
    CONSTRAINT chk_debts_remaining CHECK (remaining_amount >= 0),
    -- 改善: 不可自己欠自己
    CONSTRAINT chk_debts_self      CHECK (creditor_id != debtor_id),
 
    CONSTRAINT fk_debts_space
        FOREIGN KEY (space_id)      REFERENCES Spaces(space_id)      ON DELETE RESTRICT,
    CONSTRAINT fk_debts_creditor
        FOREIGN KEY (creditor_id)   REFERENCES Users(user_id)        ON DELETE RESTRICT,
    CONSTRAINT fk_debts_debtor
        FOREIGN KEY (debtor_id)     REFERENCES Users(user_id)        ON DELETE RESTRICT,
    -- 改善: 來源共享項目關聯
    CONSTRAINT fk_debts_source_item
        FOREIGN KEY (source_item_id) REFERENCES SharedItems(item_id) ON DELETE SET NULL,
 
    -- 改善: 補充高頻查詢索引
    INDEX idx_debts_status   (status),
    INDEX idx_debts_creditor (creditor_id),
    INDEX idx_debts_debtor   (debtor_id),
    INDEX idx_debts_deleted  (deleted_at)
);
 
-- =========================================================
-- 8. 預算設定 (Budgets)
-- =========================================================
CREATE TABLE IF NOT EXISTS Budgets (
    budget_id     BIGINT        PRIMARY KEY AUTO_INCREMENT,
    space_id      BIGINT        NOT NULL,
    budget_name   VARCHAR(100)  NOT NULL,
    category_id   BIGINT        NULL,
    budget_amount DECIMAL(12,2) NOT NULL,
    start_date    DATE          NOT NULL,
    end_date      DATE          NOT NULL,
    created_at    DATETIME      DEFAULT CURRENT_TIMESTAMP,
 
    -- 改善: 預算金額大於 0
    CONSTRAINT chk_budgets_amount CHECK (budget_amount > 0),
    -- 改善: 結束日期不得早於開始日期
    CONSTRAINT chk_budgets_dates  CHECK (end_date >= start_date),
 
    CONSTRAINT fk_budgets_space
        FOREIGN KEY (space_id)    REFERENCES Spaces(space_id)        ON DELETE CASCADE,
    CONSTRAINT fk_budgets_category
        FOREIGN KEY (category_id) REFERENCES Categories(category_id) ON DELETE SET NULL
);