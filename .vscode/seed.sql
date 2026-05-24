USE finance_space_system;
-- 寫入預設分類 (使用 INSERT IGNORE 避免重複執行時報錯)
INSERT IGNORE INTO Categories (category_name)
VALUES
    ('Food'), 
    ('Transportation'), 
    ('Entertainment'), 
    ('Shopping'), 
    ('Salary'), 
    ('Utilities');