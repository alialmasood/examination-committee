# OMR Python Service (Prototype)

نسخة تجريبية أولية تعمل على:
- صفحة واحدة فقط من PDF
- شيت واحد فقط
- قالب واحد ثابت

## التشغيل

```bash
cd services/omr-python
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8001 --reload
```

## Endpoints

- `GET /health`
- `POST /analyze-image` (النسخة الأولى المطلوبة لصورة واحدة)
- `POST /analyze-pdf`
- `POST /analyze-page`
- `POST /compare`

## analyze-image (MWV)

- Input: صورة شيت واحدة
- Pipeline:
  - grayscale
  - blur
  - threshold
  - detect page contour
  - perspective correction
  - resize to canonical A4
  - read student code
  - read answers 1..25
- Output: JSON structured
- Debug images: تحفظ في `services/omr-python/output/debug/<run>/`

## ملاحظة الربط مع Next.js

من جهة Next.js استخدم متغير البيئة:

`OMR_PYTHON_URL=http://127.0.0.1:8001`
