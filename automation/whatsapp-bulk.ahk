; سكربت AutoHotkey لإرسال رسائل واتساب جماعية عبر تطبيق سطح المكتب
; المتطلبات:
;  - تثبيت AutoHotkey v2 من https://www.autohotkey.com/
;  - فتح تطبيق WhatsApp Desktop وتسجيل الدخول مسبقاً
;  - ملف recipients.csv في نفس مجلد السكربت، بصيغة: phone,message
;     مثال:
;       phone,message
;       9647701234567,"مرحبا {{اسم_الطالب}}، نذكرك بالموعد غداً."
;  - يفضَّل تعطيل إعدادات النظام/التطبيق التي تغيّر تخطيط لوحة المفاتيح أثناء التشغيل

#Requires AutoHotkey v2.0

global CSV_FILE := A_ScriptDir "\recipients.csv"
global MESSAGE_PLACEHOLDER := "{{اسم_الطالب}}"
global SEND_DELAY := 500            ; ملي ثانية بين العمليات لتجنّب فقدان التركيز
global SEARCH_DELAY := 600
global MESSAGE_DELAY := 400
global ENTER_DELAY := 250

; ------------------------------------------------------------
; نقطة البداية
; ------------------------------------------------------------
Main()
{
    if !FileExist(CSV_FILE) {
        MsgBox "تعذر العثور على الملف recipients.csv في مجلد السكربت.`nضع الملف ثم أعد تشغيل السكربت.", "خطأ", 0x10
        ExitApp 1
    }

    if !WinExist("ahk_exe WhatsApp.exe") {
        MsgBox "تأكد من فتح تطبيق WhatsApp Desktop قبل تشغيل السكربت.", "تنبيه", 0x30
        ExitApp 1
    }

    if !WinActivate("ahk_exe WhatsApp.exe") {
        MsgBox "لم يتمكن السكربت من تفعيل نافذة واتساب. جرّب إغلاق النوافذ الأخرى وإعادة تشغيل السكربت.", "خطأ", 0x10
        ExitApp 1
    }

    recipients := LoadRecipients(CSV_FILE)
    if (!recipients.Length) {
        MsgBox "لم يتم العثور على أرقام صالحة في recipients.csv.", "تنبيه", 0x30
        ExitApp
    }

    MsgBox "سيبدأ السكربت بإرسال الرسائل لـ " recipients.Length " مستلم." . "`n`n"
        . "أبقِ واتساب في المقدمة ولا تستخدم لوحة المفاتيح أو الفأرة أثناء التنفيذ.", "بدء", 0x40

    For index, entry in recipients {
        SendToRecipient(entry.phone, entry.message)
        Sleep SEND_DELAY
    }

    MsgBox "اكتمل الإرسال لجميع المستلمين.", "نجاح", 0x40
    ExitApp
}

; ------------------------------------------------------------
; تحميل المستلمين من ملف CSV
; ------------------------------------------------------------
LoadRecipients(filePath)
{
    recipients := []

    loop read, filePath
    {
        if (A_Index = 1 && InStr(StrLower(A_LoopReadLine), "phone") && InStr(StrLower(A_LoopReadLine), "message")) {
            continue  ; تخطي العنوان
        }

        line := Trim(A_LoopReadLine)
        if (line = "")
            continue

        parsed := ParseCsvLine(line)
        phone := CleanPhone(parsed.phone)
        message := parsed.message ? parsed.message : ""

        if (phone = "")
            continue

        recipients.Push({phone: phone, message: message})
    }

    return recipients
}

; ------------------------------------------------------------
; إرسال رسالة لمستلم واحد
; ------------------------------------------------------------
SendToRecipient(phone, message)
{
    if !WinActivate("ahk_exe WhatsApp.exe") {
        MsgBox "فقد السكربت تركيز نافذة واتساب. سيتم الإيقاف.", "خطأ", 0x10
        ExitApp 1
    }

    ; فتح مربع البحث (Ctrl + F)
    Send "^f"
    Sleep SEARCH_DELAY

    ; لصق الرقم
    clipboardBackup := ClipboardAll()
    A_Clipboard := phone
    Sleep 50
    Send "^v"
    Sleep SEARCH_DELAY

    ; فتح المحادثة
    Send "{Enter}"
    Sleep SEARCH_DELAY

    ; لصق الرسالة
    A_Clipboard := message
    Sleep 50
    Send "^v"
    Sleep MESSAGE_DELAY

    ; إرسال الرسالة
    Send "{Enter}"
    Sleep ENTER_DELAY

    ; استعادة الحافظة
    A_Clipboard := clipboardBackup
}

; ------------------------------------------------------------
; أدوات مساعدة
; ------------------------------------------------------------
CleanPhone(phone)
{
    digits := RegExReplace(phone, "\D")
    if (digits = "")
        return ""
    return digits
}

ParseCsvLine(line)
{
    ; تفكيك بسيط لخط CSV (يدعم نصوصاً محاطة باقتباسات مزدوجة)
    values := []
    current := ""
    inQuotes := false
    loop parse, line
    {
        char := A_LoopField
        if (char = """") {
            if inQuotes && SubStr(line, A_Index + 1, 1) = """") {
                current .= """"
                A_Index += 1
            } else {
                inQuotes := !inQuotes
            }
        } else if (char = "," && !inQuotes) {
            values.Push(Trim(current))
            current := ""
        } else {
            current .= char
        }
    }
    values.Push(Trim(current))

    return {phone: values.Length >= 1 ? values[1] : "", message: values.Length >= 2 ? values[2] : ""}
}

; ------------------------------------------------------------
; تشغيل السكربت
; ------------------------------------------------------------
Main()

