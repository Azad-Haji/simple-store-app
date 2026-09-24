/**
 * db.js
 * طبقة الوصول إلى IndexedDB لتطبيق "متجري البسيط".
 *
 * المخازن (Object Stores):
 *  - products  : المواد المخزنة { id, name, dozenPrice }
 *  - customers : أسماء الزبائن  { id, name }
 *  - invoices  : الفواتير       { invoiceNumber, date, customer, exchangeRate,
 *                                  items, subtotal, discountPercent, netTotal,
 *                                  netTotalLocal, savedAt }
 *  - appState  : حالة التطبيق (key/value) — رقم الفاتورة الحالي، حالة الحفظ،
 *                 آخر سعر صرف مستخدم ... إلخ.
 */

const DB_NAME = 'cosmetics_pos_db';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains('products')) {
        const products = db.createObjectStore('products', {
          keyPath: 'id',
          autoIncrement: true,
        });
        products.createIndex('name', 'name', { unique: false });
      }

      if (!db.objectStoreNames.contains('customers')) {
        const customers = db.createObjectStore('customers', {
          keyPath: 'id',
          autoIncrement: true,
        });
        customers.createIndex('name', 'name', { unique: true });
      }

      if (!db.objectStoreNames.contains('invoices')) {
        const invoices = db.createObjectStore('invoices', {
          keyPath: 'invoiceNumber',
        });
        invoices.createIndex('customer', 'customer', { unique: false });
        invoices.createIndex('date', 'date', { unique: false });
        invoices.createIndex('savedAt', 'savedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains('appState')) {
        db.createObjectStore('appState', { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });

  return dbPromise;
}

/** يحوّل عملية IDBRequest إلى Promise */
function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function tx(storeName, mode) {
  const db = await openDB();
  return db.transaction(storeName, mode).objectStore(storeName);
}

/* ---------------------------------------------------------------------- */
/* المواد (Products)                                                       */
/* ---------------------------------------------------------------------- */

const Products = {
  /** إرجاع كل المواد مرتبة أبجديًا بالاسم */
  async getAll() {
    const store = await tx('products', 'readonly');
    const all = await reqToPromise(store.getAll());
    return all.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  },

  async getById(id) {
    const store = await tx('products', 'readonly');
    return reqToPromise(store.get(id));
  },

  /** بحث عن تطابق تام (case/whitespace-insensitive) بالاسم */
  async findByExactName(name) {
    const norm = normalizeText(name);
    const all = await this.getAll();
    return all.find((p) => normalizeText(p.name) === norm) || null;
  },

  /** بحث جزئي: يعيد كل مادة يحتوي اسمها على النص المدخل */
  async search(query) {
    const norm = normalizeText(query);
    if (!norm) return [];
    const all = await this.getAll();
    return all.filter((p) => normalizeText(p.name).includes(norm));
  },

  /**
   * حفظ مادة: إذا وُجدت مادة بنفس الاسم (تطابق تام) يتم تحديث سعرها،
   * وإلا تُنشأ مادة جديدة. يعيد المادة المحفوظة.
   *
   * ملاحظة تقنية: يجب تحديد target id قبل فتح معاملة الكتابة، لأن أي await
   * لعملية IndexedDB أخرى (مثل findByExactName هنا) بين فتح المعاملة
   * واستخدامها يجعل IndexedDB يُنهي المعاملة تلقائيًا قبل أن نصل لعملية
   * الحفظ الفعلية (TransactionInactiveError صامت) — وهذا كان سبب تعطّل زر
   * الحفظ.
   */
  async save({ id, name, dozenPrice }) {
    name = name.trim();

    let targetId = id;
    if (targetId == null) {
      const existing = await this.findByExactName(name);
      if (existing) targetId = existing.id;
    }

    const store = await tx('products', 'readwrite');
    if (targetId != null) {
      const record = { id: targetId, name, dozenPrice };
      await reqToPromise(store.put(record));
      return record;
    }

    const newId = await reqToPromise(store.add({ name, dozenPrice }));
    return { id: newId, name, dozenPrice };
  },

  async remove(id) {
    const store = await tx('products', 'readwrite');
    await reqToPromise(store.delete(id));
  },

  async clearAll() {
    const store = await tx('products', 'readwrite');
    await reqToPromise(store.clear());
  },
};

/* ---------------------------------------------------------------------- */
/* الزبائن (Customers)                                                     */
/* ---------------------------------------------------------------------- */

const Customers = {
  async getAll() {
    const store = await tx('customers', 'readonly');
    const all = await reqToPromise(store.getAll());
    return all.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  },

  async search(query) {
    const norm = normalizeText(query);
    if (!norm) return [];
    const all = await this.getAll();
    return all.filter((c) => normalizeText(c.name).includes(norm));
  },

  /** يضيف الزبون إذا لم يكن موجودًا مسبقًا (تجاهل صامت إن كان موجودًا) */
  async addIfNotExists(name) {
    name = (name || '').trim();
    if (!name) return;
    const norm = normalizeText(name);
    const all = await this.getAll();
    if (all.some((c) => normalizeText(c.name) === norm)) return;

    const store = await tx('customers', 'readwrite');
    try {
      await reqToPromise(store.add({ name }));
    } catch (e) {
      // تجاهل تعارض unique index إن حدث بسبب سباق بين عمليتين
    }
  },

  async clearAll() {
    const store = await tx('customers', 'readwrite');
    await reqToPromise(store.clear());
  },
};

/* ---------------------------------------------------------------------- */
/* الفواتير (Invoices)                                                     */
/* ---------------------------------------------------------------------- */

const Invoices = {
  /** حفظ/تحديث فاتورة برقمها (put يستبدل أي فاتورة بنفس الرقم تلقائيًا) */
  async save(invoice) {
    const store = await tx('invoices', 'readwrite');
    await reqToPromise(store.put(invoice));
    return invoice;
  },

  async getByNumber(invoiceNumber) {
    const store = await tx('invoices', 'readonly');
    return reqToPromise(store.get(invoiceNumber));
  },

  async searchByCustomer(query) {
    const norm = normalizeText(query);
    const store = await tx('invoices', 'readonly');
    const all = await reqToPromise(store.getAll());
    return all
      .filter((inv) => normalizeText(inv.customer).includes(norm))
      .sort((a, b) => b.invoiceNumber - a.invoiceNumber);
  },

  async getAll() {
    const store = await tx('invoices', 'readonly');
    const all = await reqToPromise(store.getAll());
    return all.sort((a, b) => b.invoiceNumber - a.invoiceNumber);
  },

  /** حذف الفواتير الأقدم من سنة واحدة (يُستدعى عند بدء التطبيق) */
  async pruneOlderThanOneYear() {
    const store = await tx('invoices', 'readwrite');
    const all = await reqToPromise(store.getAll());
    const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
    for (const inv of all) {
      const savedAt = inv.savedAt || 0;
      if (savedAt < cutoff) {
        await reqToPromise(store.delete(inv.invoiceNumber));
      }
    }
  },

  async clearAll() {
    const store = await tx('invoices', 'readwrite');
    await reqToPromise(store.clear());
  },
};

/* ---------------------------------------------------------------------- */
/* حالة التطبيق (appState)                                                 */
/* ---------------------------------------------------------------------- */

const AppState = {
  async get(key, defaultValue = null) {
    const store = await tx('appState', 'readonly');
    const record = await reqToPromise(store.get(key));
    return record ? record.value : defaultValue;
  },

  async set(key, value) {
    const store = await tx('appState', 'readwrite');
    await reqToPromise(store.put({ key, value }));
  },
};

/* ---------------------------------------------------------------------- */
/* أدوات مساعدة                                                            */
/* ---------------------------------------------------------------------- */

/** تطبيع نص عربي بسيط لأغراض المقارنة/البحث (حذف تشكيل، توحيد أشكال الألف...) */
/**
 * تطبيع نص عربي بسيط لأغراض المقارنة/البحث: حذف التشكيل، توحيد أشكال
 * الألف/الياء/التاء المربوطة، وإزالة علامات الترقيم.
 *
 * إزالة الترقيم مهمة خصوصًا مع الإدخال الصوتي: متصفحات مثل Chrome تضيف
 * تلقائيًا نقطة أو علامة في نهاية الجملة المُتعرَّف عليها (مثلاً "بودرة
 * غابريني." بدل "بودرة غابريني")، فكانت تفشل المطابقة التامة مع نفس الاسم
 * المكتوب يدويًا بسبب هذا الفرق وحده.
 */
function normalizeText(text) {
  return (text || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u0652]/g, '') // إزالة التشكيل
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[.,،؛؛:؟!?٫٬"'`ـ]/g, '') // علامات ترقيم قد يضيفها التعرف على الصوت
    .replace(/\s+/g, ' ')
    .trim();
}

export { openDB, Products, Customers, Invoices, AppState, normalizeText };
