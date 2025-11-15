# إنشاء أيقونات PWA

## الخطوات المطلوبة:

1. استخدم شعار الكلية الموجود في `public/logos/college-logo.png`
2. قم بتحويله إلى الأحجام التالية ووضعها في `public/icons/`:

   - icon-72x72.png (72x72 pixels)
   - icon-96x96.png (96x96 pixels)
   - icon-128x128.png (128x128 pixels)
   - icon-144x144.png (144x144 pixels)
   - icon-152x152.png (152x152 pixels)
   - icon-192x192.png (192x192 pixels)
   - icon-384x384.png (384x384 pixels)
   - icon-512x512.png (512x512 pixels)

## أدوات يمكن استخدامها:

### أونلاين:
- https://realfavicongenerator.net/
- https://www.pwabuilder.com/imageGenerator
- https://favicon.io/favicon-generator/

### Command Line:
إذا كنت تستخدم ImageMagick:
```bash
for size in 72 96 128 144 152 192 384 512; do
  convert public/logos/college-logo.png -resize ${size}x${size} public/icons/icon-${size}x${size}.png
done
```

### Node.js:
يمكن استخدام package مثل `sharp`:
```javascript
const sharp = require('sharp');
const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

sizes.forEach(size => {
  sharp('public/logos/college-logo.png')
    .resize(size, size)
    .toFile(`public/icons/icon-${size}x${size}.png`);
});
```

## ملاحظة:
يمكنك استخدام أي صورة مربعة كأيقونة. الأيقونة يجب أن تكون:
- مربعة (1:1 aspect ratio)
- PNG format
- بأحجام مختلفة حسب المتطلبات

