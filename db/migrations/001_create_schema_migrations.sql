-- إنشاء جدول لتتبع migrations
CREATE TABLE IF NOT EXISTS platform.schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT NOW()
);

-- إنشاء فهرس لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at 
ON platform.schema_migrations(applied_at);
