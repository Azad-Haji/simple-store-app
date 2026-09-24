import { openDB, Invoices } from './db.js';
import { initMaterialsPage } from './materials.js';
import { initInvoicePage } from './invoice.js';
import { initLogPage, refreshLogDefaults } from './log.js';
import { renderReport } from './report.js';

const PAGE_TITLES = {
  invoice: 'فاتورة مبيعات',
  materials: 'قائمة المواد',
  log: 'سجل الفواتير',
};

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 1800);
}

/** يعرض إحدى التبويبات الثلاث الرئيسية (وليس الـ Report) */
function showTab(pageKey, { push = false } = {}) {
  document.body.classList.remove('report-mode');

  document.querySelectorAll('.app-page').forEach((el) => {
    el.classList.toggle('active', el.id === `page-${pageKey}`);
  });
  document.querySelectorAll('.bottom-nav button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.page === pageKey);
  });
  document.getElementById('app-title').textContent = PAGE_TITLES[pageKey];

  const state = { page: pageKey };
  if (push) window.history.pushState(state, '', `#${pageKey}`);
  else window.history.replaceState(state, '', `#${pageKey}`);

  if (pageKey === 'log') refreshLogDefaults();
}

/**
 * يفتح صفحة الـ Report فوق كل شيء (بدون رأس أو تنقل سفلي)، ويضيف إدخالًا
 * حقيقيًا في Browser History حتى يعمل زر/حركة الرجوع في الهاتف للعودة إلى
 * السجل (راجع البرومبت قسم 29).
 */
async function openReport(invoiceNumber, { push = true } = {}) {
  const found = await renderReport(invoiceNumber);
  if (!found) {
    showToast('لم يتم العثور على الفاتورة');
    return;
  }

  document.querySelectorAll('.app-page').forEach((el) => {
    el.classList.toggle('active', el.id === 'page-report');
  });
  document.body.classList.add('report-mode');

  if (push) {
    window.history.pushState({ page: 'report', invoiceNumber }, '', `#report-${invoiceNumber}`);
  }
}

function initNav() {
  document.querySelectorAll('.bottom-nav button').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.page, { push: false }));
  });
}

/** التعامل مع زر/حركة الرجوع في الهاتف */
window.addEventListener('popstate', (e) => {
  const state = e.state;
  if (state && state.page === 'report' && state.invoiceNumber) {
    openReport(state.invoiceNumber, { push: false });
  } else {
    const pageKey = (state && state.page) || 'invoice';
    showTab(PAGE_TITLES[pageKey] ? pageKey : 'invoice', { push: false });
  }
});

async function init() {
  await openDB();
  // تنظيف الفواتير الأقدم من سنة (راجع البرومبت قسم 30)
  Invoices.pruneOlderThanOneYear().catch(() => {});

  initNav();
  await initInvoicePage({ showToast });
  initMaterialsPage({ showToast });
  await initLogPage({ showToast, openReport });

  const startPage = (location.hash || '#invoice').replace('#', '');
  showTab(PAGE_TITLES[startPage] ? startPage : 'invoice', { push: false });
}

window.showToast = showToast;
document.addEventListener('DOMContentLoaded', init);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
