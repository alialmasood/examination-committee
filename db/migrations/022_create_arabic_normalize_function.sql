-- إنشاء دالة لتطبيع النص العربي (توحيد الهمزة)
CREATE OR REPLACE FUNCTION normalize_arabic(input_text TEXT)
RETURNS TEXT AS $$
BEGIN
    IF input_text IS NULL THEN
        RETURN NULL;
    END IF;
    
    RETURN 
        TRIM(
            REPLACE(
                REPLACE(
                    REPLACE(
                        REPLACE(input_text, 'أ', 'ا'),
                        'إ', 'ا'
                    ),
                    'آ', 'ا'
                ),
                'ى', 'ي'
            )
        );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- إنشاء فهرس على القيم المعدلة لتحسين الأداء (اختياري)
COMMENT ON FUNCTION normalize_arabic IS 'دالة لتطبيع النص العربي عبر توحيد أنواع الألف والياء';

