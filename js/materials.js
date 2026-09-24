import { Products } from './db.js';
import { isVoiceSupported, startDictation, splitNameAndPrice } from './voice.js';
import { ICON_MIC, ICON_TRASH } from './icons.js';

let showToast = () => {};
let editingId = null;
let currentDictation = null;

function el(id) {
  return document.getElementById(id);
}

function formatPrice(value) {
  // إلى خانتين عشريتين كحد أقصى، بدون أصفار زائدة غير ضرورية
  const rounded = Math.round(value * 100) / 100;
  return rounded % 1 === 0 ? String(rounded) : rounded.toFixed(2);
}

async function renderList(filterText = '') {
  const list = el('materials-list');
  const items = filterText.trim()
    ? await Products.search(filterText)
    : await Products.getAll();

  if (items.length === 0) {
    list.innerHTML = `<div class="empty-state">${
      filterText ? 'لا توجد مواد مطابقة' : 'لا توجد مواد مخزنة بعد'
    }</div>`;
    return;
  }

  list.innerHTML = items
    .map(
      (p) => `
      <div class="list-row" data-id="${p.id}">
        <span class="row-name" data-action="select" data-id="${p.id}">${escapeHtml(p.name)}</span>
        <span class="row-value">${formatPrice(p.dozenPrice)}</span>
        <button class="delete-btn" data-action="delete" data-id="${p.id}" aria-label="حذف">${ICON_TRASH}</button>
      </div>`
    )
    .join('');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function clearForm() {
  editingId = null;
  el('material-name').value = '';
  el('material-price').value = '';
  el('material-search').value = '';
  renderList('');
}

async function selectMaterial(id) {
  const product = await Products.getById(Number(id));
  if (!product) return;
  editingId = product.id;
  el('material-name').value = product.name;
  el('material-price').value = formatPrice(product.dozenPrice);
}

async function deleteMaterial(id) {
  const product = await Products.getById(Number(id));
  if (!product) return;
  const confirmed = window.confirm(`هل تريد حذف "${product.name}"؟`);
  if (!confirmed) return;
  await Products.remove(Number(id));
  if (editingId === Number(id)) clearForm();
  renderList(el('material-search').value);
}

async function saveMaterial() {
  const name = el('material-name').value.trim();
  const priceStr = el('material-price').value.trim();
  const price = parseFloat(priceStr);

  if (!name) {
    showToast('أدخل اسم المادة');
    return;
  }
  if (!Number.isFinite(price) || price < 0) {
    showToast('أدخل سعرًا صحيحًا');
    return;
  }

  await Products.save({ id: editingId, name, dozenPrice: price });
  showToast('تم الحفظ');
  clearForm();
  renderList(el('material-search').value);
}

function stopDictationIfRunning() {
  if (currentDictation) {
    currentDictation.stop();
    currentDictation = null;
  }
  el('material-mic').classList.remove('listening');
  el('search-mic').classList.remove('listening');
}

function startFormDictation() {
  if (!isVoiceSupported()) {
    showToast('التعرف على الصوت غير مدعوم في هذا المتصفح');
    return;
  }
  stopDictationIfRunning();
  el('material-mic').classList.add('listening');

  // جملة واحدة: "اسم المادة ثم السعر". يتوقف الاستماع تلقائيًا عند الصمت،
  // ثم نفصل الرقم في آخر الجملة (السعر) عمّا قبله (الاسم).
  currentDictation = startDictation({
    lang: 'ar-SA',
    onResult(text) {
      const { name, price } = splitNameAndPrice(text);
      el('material-name').value = name;
      if (price != null) el('material-price').value = price;
    },
    onEnd() {
      el('material-mic').classList.remove('listening');
      currentDictation = null;
    },
    onError() {
      showToast('تعذّر التعرف على الصوت');
      el('material-mic').classList.remove('listening');
      currentDictation = null;
    },
  });
}

function startSearchDictation() {
  if (!isVoiceSupported()) {
    showToast('التعرف على الصوت غير مدعوم في هذا المتصفح');
    return;
  }
  stopDictationIfRunning();
  el('search-mic').classList.add('listening');

  currentDictation = startDictation({
    lang: 'ar-SA',
    async onResult(text) {
      el('material-search').value = text;
      await renderList(text);

      const exact = await Products.findByExactName(text);
      if (exact) await selectMaterial(exact.id);
    },
    onEnd() {
      el('search-mic').classList.remove('listening');
      currentDictation = null;
    },
    onError() {
      showToast('تعذّر التعرف على الصوت');
      el('search-mic').classList.remove('listening');
      currentDictation = null;
    },
  });
}

function initMaterialsPage(opts = {}) {
  showToast = opts.showToast || showToast;

  el('material-mic').addEventListener('click', () => {
    if (currentDictation) stopDictationIfRunning();
    else startFormDictation();
  });

  el('search-mic').addEventListener('click', () => {
    if (currentDictation) stopDictationIfRunning();
    else startSearchDictation();
  });

  el('material-save').addEventListener('click', saveMaterial);
  el('material-clear').addEventListener('click', clearForm);

  el('material-search').addEventListener('input', (e) => {
    renderList(e.target.value);
  });

  el('materials-list').addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const { action, id } = target.dataset;
    if (action === 'delete') deleteMaterial(id);
    else if (action === 'select') selectMaterial(id);
  });

  renderList();
}

export { initMaterialsPage };
