/**
 * voice.js
 * غلاف بسيط فوق Web Speech API (SpeechRecognition).
 * الميكروفون ميزة مساعدة اختيارية فقط — كل الوظائف يجب أن تعمل بالكتابة
 * إذا كانت هذه الخاصية غير متاحة (راجع البرومبت قسم 19).
 */

function isVoiceSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * يبدأ الاستماع لجملة واحدة ويتوقف تلقائيًا عندما يتوقف المستخدم عن الكلام
 * (هذا هو السلوك الافتراضي للمتصفح عندما continuous = false، وهو الأنسب
 * هنا بدل الاستماع المستمر الذي يحتاج إيقافًا يدويًا).
 *
 * onResult(text) يُستدعى مرة واحدة بالنص النهائي الكامل الذي قاله المستخدم.
 * يعيد كائن { stop() } لإلغاء الاستماع يدويًا إذا احتاج المستخدم ذلك.
 */
function startDictation({ onResult, onEnd, onError, lang = 'ar-SA' } = {}) {
  const SpeechRecognitionImpl =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognitionImpl) {
    onError && onError(new Error('SpeechRecognition غير مدعوم في هذا المتصفح'));
    return { stop() {} };
  }

  const recognition = new SpeechRecognitionImpl();
  recognition.lang = lang;
  recognition.continuous = false; // يتوقف تلقائيًا عند الصمت
  recognition.interimResults = false;

  recognition.onresult = (event) => {
    const text = event.results[0][0].transcript.trim();
    if (text) onResult && onResult(text);
  };

  recognition.onerror = (event) => {
    onError && onError(event.error);
  };

  recognition.onend = () => {
    onEnd && onEnd();
  };

  try {
    recognition.start();
  } catch (e) {
    onError && onError(e);
  }

  return {
    stop() {
      try {
        recognition.stop();
      } catch (e) {
        /* تجاهل */
      }
    },
  };
}

/** يحاول استخراج رقم من نص (يدعم الأرقام العربية والإنجليزية) */
function parseSpokenNumber(text) {
  const cleaned = text
    .toString()
    .replace(/[٠-٩]/g, (ch) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)))
    .replace(/,/g, '.')
    .match(/-?\d+(\.\d+)?/);
  if (!cleaned) return null;
  const num = parseFloat(cleaned[0]);
  return Number.isFinite(num) ? num : null;
}

/**
 * يفصل جملة منطوقة واحدة مثل "حمرة خد كلاسيكانا 24" إلى اسم المادة والسعر،
 * بأخذ الرقم في آخر الجملة كسعر وما تبقى قبله كاسم.
 * إذا لم يوجد رقم في آخر الجملة، تُعتبر الجملة كلها اسمًا (مفيد أيضًا لحقل
 * البحث الذي لا يحتاج سعرًا).
 */
function splitNameAndPrice(text) {
  const trimmed = text.trim();
  const match = trimmed.match(/^(.*?)[\s،,]*([٠-٩\d]+(?:[.,][٠-٩\d]+)?)\s*$/);
  if (!match || !match[1].trim()) {
    return { name: trimmed, price: null };
  }
  const price = parseSpokenNumber(match[2]);
  if (price == null) return { name: trimmed, price: null };
  return { name: match[1].trim(), price };
}

export { isVoiceSupported, startDictation, parseSpokenNumber, splitNameAndPrice };
