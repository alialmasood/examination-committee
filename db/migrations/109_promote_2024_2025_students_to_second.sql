-- ترحيل طلبة العام الدراسي 2024-2025 من المرحلة الأولى إلى المرحلة الثانية
-- السبب: دفعة 2024-2025 أصبحت حالياً في المرحلة الثانية، بينما 2025-2026 تبقى أولى

UPDATE student_affairs.students
SET
  admission_type = 'second',
  updated_at = NOW()
WHERE academic_year = '2024-2025'
  AND admission_type = 'first';
