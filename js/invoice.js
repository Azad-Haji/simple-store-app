import { Products, Customers, Invoices, AppState } from './db.js';
import { isVoiceSupported, startDictation } from './voice.js';
import { ICON_TRASH } from './icons.js';

let showToast = () => {};

let invoiceNumber = 1001;
let items = []; // { name, qty, price } — price هو سعر الكمية كاملة بالدولار
let isDirty = false; // هل هناك تعديلات لم تُحفظ منذ آخر حفظ/فاتورة جديدة
let selectedProductPrice = null; // dozenPrice للمادة المختارة حاليًا من الاقتراحات
let currentDictation = null;

function el(id) {
  return document.getElementById(id);
}

/* ---------------------------------------------------------------------- */
/* أدوات تنسيق                                                            */
/* ---------------------------------------------------------------------- */

/** تنسيق دولار: خانتان عشريتان كحد أقصى، بدون أصفار زائدة غير ضرورية */
function formatUSD(value) {
  const rounded = Math.round(value * 100) / 100;
  return rounded % 1 === 0 ? String(rounded) : rounded.toFixed(2);
}

/** تنسيق ليرة سورية: عدد صحيح مع فواصل الآلاف */
function formatSYP(value) {
  const rounded = Math.round(value);
  return rounded.toLocaleString('en-US');
}

function formatDate(date) {
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function nextInvoiceNumber(n) {
  return n >= 9999 ? 1001 : n + 1;
}

/* ---------------------------------------------------------------------- */
/* تتبّع حالة "غير محفوظ" (dirty)                                          */
/* ---------------------------------------------------------------------- */

function markDirty() {
  if (isDirty) return;
  isDirty = true;
  AppState.set('invoiceSaved', false).catch(() => {});
}

/* ---------------------------------------------------------------------- */
/* حساب البند والمجاميع                                                   */
/* ---------------------------------------------------------------------- */

function computeLinePrice(dozenPrice, qty) {
  return (dozenPrice / 12) * qty;
}

function renderItems() {
  const list = el('items-list');
  if (items.length === 0) {
    list.innerHTML = `<div class="empty-state">لا توجد بنود في الفاتورة بعد</div>`;
    return;
  }
  list.innerHTML = items
    .map(
      (item, index) => `
      <div class="item-row" data-index="${index}">
        <span class="item-name">${escapeHtml(item.name)}</span>
        <span class="item-qty">${item.qty}</span>
        <span class="item-price">${formatUSD(item.price)}</span>
        <button class="delete-btn" data-action="delete-item" data-index="${index}" aria-label="حذف">${ICON_TRASH}</button>
      </div>`
    )
    .join('');
}

function recomputeTotals() {
  const subtotal = items.reduce((sum, it) => sum + it.price, 0);
  const discountPercent = parseFloat(el('discount-input').value) || 0;
  const net = subtotal * (1 - discountPercent / 100);
  const exchangeRate = parseFloat(el('exchange-rate').value) || 0;
  const netLocal = net * exchangeRate;

  el('total-usd').value = formatUSD(net);
  el('total-syp').value = formatSYP(netLocal);

  return { subtotal, discountPercent, net, exchangeRate, netLocal };
}

/* ---------------------------------------------------------------------- */
/* الاقتراحات (Autocomplete)                                               */
/* ---------------------------------------------------------------------- */

function wireSuggestions(inputEl, listEl, fetchFn, onSelect) {
  let items = [];

  async function open(query) {
    items = await fetchFn(query);
    if (items.length === 0) {
      listEl.classList.remove('open');
      listEl.innerHTML = '';
      return;
    }
    listEl.innerHTML = items
      .map((it, i) => `<div data-i="${i}">${escapeHtml(it.name)}</div>`)
      .join('');
    listEl.classList.add('open');
  }

  function close() {
    listEl.classList.remove('open');
    listEl.innerHTML = '';
  }

  inputEl.addEventListener('input', () => {
    const q = inputEl.value.trim();
    if (!q) {
      close();
      return;
    }
    open(q);
  });

  inputEl.addEventListener('blur', () => {
    // تأخير بسيط للسماح بحدث click على الاقتراح قبل إغلاقه
    setTimeout(close, 150);
  });

  listEl.addEventListener('mousedown', (e) => {
    const target = e.target.closest('[data-i]');
    if (!target) return;
    const item = items[Number(target.dataset.i)];
    if (item) onSelect(item);
    close();
  });

  return { close };
}

/* ---------------------------------------------------------------------- */
/* منطق البنود                                                             */
/* ---------------------------------------------------------------------- */

function maybeAutoFillPrice() {
  const qty = parseFloat(el('item-qty').value);
  if (selectedProductPrice != null && Number.isFinite(qty) && qty > 0) {
    el('item-price').value = formatUSD(computeLinePrice(selectedProductPrice, qty));
  }
}

function selectProduct(product) {
  el('item-material').value = product.name;
  selectedProductPrice = product.dozenPrice;
  maybeAutoFillPrice();
}

function addItem() {
  const name = el('item-material').value.trim();
  const qty = parseFloat(el('item-qty').value);
  const price = parseFloat(el('item-price').value);

  if (!name) {
    showToast('أدخل اسم المادة');
    return;
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    showToast('أدخل كمية صحيحة');
    return;
  }
  if (!Number.isFinite(price) || price < 0) {
    showToast('أدخل سعرًا صحيحًا');
    return;
  }

  items.push({ name, qty, price });
  markDirty();
  renderItems();
  recomputeTotals();

  el('item-material').value = '';
  el('item-qty').value = '';
  el('item-price').value = '';
  selectedProductPrice = null;
  el('item-material').focus();
}

function deleteItem(index) {
  items.splice(index, 1);
  markDirty();
  renderItems();
  recomputeTotals();
}

/* ---------------------------------------------------------------------- */
/* حفظ / مسح / فاتورة جديدة                                                */
/* ---------------------------------------------------------------------- */

async function saveInvoice() {
  if (items.length === 0) {
    showToast('أضف مادة واحدة على الأقل قبل الحفظ');
    return;
  }

  const customerRaw = el('customer-name').value.trim();
  const customer = customerRaw || 'زبون';
  const { subtotal, discountPercent, net, exchangeRate, netLocal } = recomputeTotals();

  const invoice = {
    invoiceNumber,
    date: el('invoice-date').textContent,
    customer,
    exchangeRate,
    items: items.map((it) => ({ ...it })),
    subtotal,
    discountPercent,
    netTotal: net,
    netTotalLocal: netLocal,
    savedAt: Date.now(),
  };

  await Invoices.save(invoice);
  if (customerRaw) await Customers.addIfNotExists(customerRaw);

  await AppState.set('lastExchangeRate', exchangeRate);
  await AppState.set('invoiceSaved', true);
  isDirty = false;

  showToast('تم حفظ الفاتورة');
}

async function clearForm() {
  items = [];
  el('customer-name').value = '';
  el('item-material').value = '';
  el('item-qty').value = '';
  el('item-price').value = '';
  el('discount-input').value = '0';
  selectedProductPrice = null;
  renderItems();
  recomputeTotals();
  markDirty();
}

async function newInvoice() {
  invoiceNumber = nextInvoiceNumber(invoiceNumber);
  el('invoice-number').textContent = invoiceNumber;
  el('invoice-date').textContent = formatDate(new Date());

  // إظهار آخر سعر صرف مستخدم تلقائيًا عند إنشاء الفاتورة التالية (قسم 16)
  const lastRate = await AppState.get('lastExchangeRate', '');
  el('exchange-rate').value = lastRate;

  await clearForm();
  isDirty = false;
  await AppState.set('currentInvoiceNumber', invoiceNumber);
  await AppState.set('invoiceSaved', false);
}

/* ---------------------------------------------------------------------- */
/* الميكروفون (بحث عن مادة فقط، بدون فصل سعر — راجع قسم 19 من البرومبت)     */
/* ---------------------------------------------------------------------- */

function startItemDictation() {
  if (!isVoiceSupported()) {
    showToast('التعرف على الصوت غير مدعوم في هذا المتصفح');
    return;
  }
  el('item-mic').classList.add('listening');

  currentDictation = startDictation({
    lang: 'ar-SA',
    async onResult(text) {
      el('item-material').value = text;
      const exact = await Products.findByExactName(text);
      if (exact) {
        selectProduct(exact);
      } else {
        selectedProductPrice = null;
        // أظهر مواد مشابهة كما لو أن المستخدم كتب النص يدويًا
        el('item-material').dispatchEvent(new Event('input'));
      }
    },
    onEnd() {
      el('item-mic').classList.remove('listening');
      currentDictation = null;
    },
    onError() {
      showToast('تعذّر التعرف على الصوت');
      el('item-mic').classList.remove('listening');
      currentDictation = null;
    },
  });
}

/* ---------------------------------------------------------------------- */
/* بدء تشغيل الصفحة وتحديد حالة رقم الفاتورة عند فتح التطبيق                */
/* ---------------------------------------------------------------------- */

async function resolveInvoiceNumberOnStartup() {
  let number = await AppState.get('currentInvoiceNumber', null);
  let wasSaved = await AppState.get('invoiceSaved', null);

  if (number == null) {
    // أول تشغيل للتطبيق على الإطلاق
    number = 1001;
    await AppState.set('currentInvoiceNumber', number);
    await AppState.set('invoiceSaved', false);
  } else if (wasSaved) {
    // آخر فاتورة كانت محفوظة ولم تُعدَّل بعدها → فاتورة جديدة فارغة بالرقم التالي
    number = nextInvoiceNumber(number);
    await AppState.set('currentInvoiceNumber', number);
    await AppState.set('invoiceSaved', false);
  }
  // وإلا (لم تُحفظ): نفتح بنفس الرقم وفاتورة فارغة (لا نُعيد تحميل بنود قديمة)

  invoiceNumber = number;
  isDirty = false;
}

async function initInvoicePage(opts = {}) {
  showToast = opts.showToast || showToast;

  await resolveInvoiceNumberOnStartup();

  el('invoice-number').textContent = invoiceNumber;
  el('invoice-date').textContent = formatDate(new Date());

  const lastRate = await AppState.get('lastExchangeRate', '');
  el('exchange-rate').value = lastRate;

  // اقتراحات الزبائن
  wireSuggestions(
    el('customer-name'),
    el('customer-suggestions'),
    (q) => Customers.search(q),
    (customer) => {
      el('customer-name').value = customer.name;
    }
  );

  // اقتراحات المواد
  wireSuggestions(
    el('item-material'),
    el('material-suggestions'),
    (q) => Products.search(q),
    (product) => selectProduct(product)
  );

  // أي تعديل يدوي على اسم المادة يُلغي الربط بسعر المادة المختارة سابقًا
  el('item-material').addEventListener('input', () => {
    selectedProductPrice = null;
  });
  el('item-qty').addEventListener('input', maybeAutoFillPrice);

  el('item-add').addEventListener('click', addItem);
  el('items-list').addEventListener('click', (e) => {
    const target = e.target.closest('[data-action="delete-item"]');
    if (!target) return;
    deleteItem(Number(target.dataset.index));
  });

  el('discount-input').addEventListener('input', () => {
    markDirty();
    recomputeTotals();
  });
  el('exchange-rate').addEventListener('input', () => {
    markDirty();
    recomputeTotals();
  });
  el('customer-name').addEventListener('input', markDirty);

  el('invoice-save').addEventListener('click', saveInvoice);
  el('invoice-clear').addEventListener('click', clearForm);
  el('invoice-new').addEventListener('click', newInvoice);

  el('item-mic').addEventListener('click', () => {
    if (currentDictation) {
      currentDictation.stop();
      currentDictation = null;
      el('item-mic').classList.remove('listening');
    } else {
      startItemDictation();
    }
  });

  renderItems();
  recomputeTotals();
}

export { initInvoicePage };
