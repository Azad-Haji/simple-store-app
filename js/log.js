import { Invoices, Products, Customers, AppState, normalizeText } from './db.js';

let showToast = () => {};
let openReportFn = () => {};

function el(id) {
  return document.getElementById(id);
}

function escapeHtml(str) {
  return (str || '')
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderResults(invoices) {
  const container = el('log-results');
  if (invoices.length === 0) {
    container.innerHTML = `<div class="empty-state">لا توجد نتائج</div>`;
    return;
  }
  container.innerHTML = invoices
    .map(
      (inv) => `
      <div class="log-result-row" data-number="${inv.invoiceNumber}">
        <span class="col-customer">${escapeHtml(inv.customer)}</span>
        <span class="col-number">${inv.invoiceNumber}</span>
        <span class="col-date">${escapeHtml(inv.date)}</span>
      </div>`
    )
    .join('');
}

async function runSearch() {
  const numberQuery = el('log-invoice-number').value.trim();
  const customerQuery = el('log-customer').value.trim();

  let all = await Invoices.getAll();
  all.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

  if (numberQuery) {
    all = all.filter((inv) => String(inv.invoiceNumber).startsWith(numberQuery));
  }
  if (customerQuery) {
    const norm = normalizeText(customerQuery);
    all = all.filter((inv) => normalizeText(inv.customer).includes(norm));
  }

  renderResults(all.slice(0, 50));
}

async function showRecent() {
  const all = await Invoices.getAll();
  all.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  renderResults(all.slice(0, 30));
}

async function initLogPage(opts = {}) {
  showToast = opts.showToast || showToast;
  openReportFn = opts.openReport || openReportFn;

  el('log-search-btn').addEventListener('click', runSearch);

  el('log-clear-btn').addEventListener('click', () => {
    el('log-invoice-number').value = '';
    el('log-customer').value = '';
    showRecent();
  });

  el('log-results').addEventListener('click', (e) => {
    const row = e.target.closest('[data-number]');
    if (!row) return;
    openReportFn(Number(row.dataset.number));
  });

  el('reset-invoices-btn').addEventListener('click', async () => {
    const ok = window.confirm(
      'سيتم حذف كل الفواتير نهائيًا وإعادة الترقيم من 1001. المواد والزبائن لن تتأثرا. هل تريد المتابعة؟'
    );
    if (!ok) return;

    await Invoices.clearAll();
    await AppState.set('currentInvoiceNumber', 1001);
    await AppState.set('invoiceSaved', false);
    showToast('تم حذف كل الفواتير');
    location.reload();
  });

  el('reset-all-btn').addEventListener('click', async () => {
    const ok = window.confirm(
      'تحذير: سيتم حذف كل البيانات نهائيًا — الفواتير والمواد والزبائن — ولا يمكن التراجع عن هذا. هل أنت متأكد؟'
    );
    if (!ok) return;
    const ok2 = window.confirm('تأكيد أخير: كل شيء سيُحذف بلا رجعة. متابعة؟');
    if (!ok2) return;

    await Promise.all([Products.clearAll(), Customers.clearAll(), Invoices.clearAll()]);
    await AppState.set('currentInvoiceNumber', 1001);
    await AppState.set('invoiceSaved', false);
    await AppState.set('lastExchangeRate', '');
    showToast('تم حذف كل البيانات');
    location.reload();
  });

  await showRecent();
}

/** يُستدعى من app.js عند العودة إلى صفحة السجل، لتحديث القائمة الافتراضية */
async function refreshLogDefaults() {
  if (!el('log-invoice-number').value.trim() && !el('log-customer').value.trim()) {
    await showRecent();
  }
}

export { initLogPage, refreshLogDefaults };
