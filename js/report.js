import { Invoices } from './db.js';

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

function formatUSD(v) {
  const r = Math.round(v * 100) / 100;
  return r % 1 === 0 ? String(r) : r.toFixed(2);
}

function formatLocal(v) {
  return Math.round(v).toLocaleString('en-US');
}

/**
 * يجلب الفاتورة من التخزين ويبني محتوى الإيصال داخل #page-report.
 * لا علاقة لهذه الدالة بالتنقل/الـ History — هذا مسؤولية app.js فقط
 * (راجع البرومبت قسم 29: التنقل يجب أن يعمل مع Browser History بشكل صحيح).
 * يعيد true إذا وُجدت الفاتورة، false إذا لم تُوجد.
 */
async function renderReport(invoiceNumber) {
  const invoice = await Invoices.getByNumber(invoiceNumber);
  if (!invoice) {
    el('report-meta').innerHTML = `<div class="empty-state">لم يتم العثور على الفاتورة</div>`;
    el('report-items').innerHTML = '';
    el('report-totals').innerHTML = '';
    return false;
  }

  el('report-meta').innerHTML = `
    <div><span>رقم:</span><span>${invoice.invoiceNumber}</span></div>
    <div><span>التاريخ:</span><span>${escapeHtml(invoice.date)}</span></div>
    <div><span>الزبون:</span><span>${escapeHtml(invoice.customer)}</span></div>
  `;

  el('report-items').innerHTML = invoice.items
    .map(
      (it) => `
      <tr>
        <td style="text-align:right;">${escapeHtml(it.name)}</td>
        <td>${it.qty}</td>
        <td>${formatUSD(it.price / it.qty)}</td>
        <td>${formatUSD(it.price)}</td>
      </tr>`
    )
    .join('');

  const discountAmount = invoice.subtotal - invoice.netTotal;

  el('report-totals').innerHTML = `
    <div><span>الإجمالي</span><span>${formatUSD(invoice.subtotal)}$</span></div>
    <div><span>الخصم ${invoice.discountPercent || 0}%</span><span>${formatUSD(discountAmount)}$</span></div>
    <div class="report-net"><span>الصافي</span><span>${formatLocal(invoice.netTotalLocal)} ل.س / ${formatUSD(invoice.netTotal)}$</span></div>
  `;

  return true;
}

export { renderReport };
