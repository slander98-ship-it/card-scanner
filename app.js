/* Card Scanner — collectibles/card collection PWA.
 * Pure vanilla JS. No network requests at runtime.
 * Persistence: localStorage JSON under "cardScanner.v1".
 */

'use strict';

/* ---------------- Constants ---------------- */
var STORE_KEY = 'cardScanner.v1';
var EBAY_SELL_URL = 'https://www.ebay.com/sl/sell';
var MAX_IMG = 1200;          // longest side of stored photos, px
var JPEG_QUALITY = 0.82;

var CATEGORIES = ['Baseball', 'Football', 'Basketball', 'Soccer', 'Hockey', 'TCG/Gaming', 'Other'];

/* ---------------- Small helpers ---------------- */

// Get an element by id.
function $(id) { return document.getElementById(id); }

// Escape user text before injecting into HTML.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Format a number as dollars, e.g. 25 -> "$25", 25.5 -> "$25.50".
function money(n) {
  n = Number(n) || 0;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Generate a unique id for a new item.
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Toast message (auto-hides). Used for "Copied", storage errors, etc.
var toastTimer = null;
function toast(msg) {
  var t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2600);
}

/* ---------------- Storage ---------------- */

function loadStore() {
  try {
    var raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { items: [] };
    var data = JSON.parse(raw);
    if (!data || !Array.isArray(data.items)) return { items: [] };
    return data;
  } catch (e) {
    return { items: [] }; // corrupted or unavailable storage -> start empty
  }
}

function saveStore() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    return true;
  } catch (e) {
    // Most likely quota exceeded (photos are big). Friendly message, no crash.
    toast('Storage is full — delete an old photo or item, then try again.');
    return false;
  }
}

/* ---------------- State ---------------- */

var store = loadStore();          // { items: [...] }
var editingId = null;             // id being edited, or null when adding
var detailId = null;              // id shown in detail view
var selectedIds = {};             // lot multi-select: id -> true
var pendingPhotos = { front: null, back: null }; // data URLs being added/edited

/* ---------------- View switching ---------------- */

function showView(name) {
  ['view-list', 'view-form', 'view-detail'].forEach(function (id) {
    $(id).classList.toggle('hidden', id !== 'view-' + name);
  });
  window.scrollTo(0, 0);
}

/* ---------------- Collection list ---------------- */

function filteredItems() {
  var q = $('search').value.trim().toLowerCase();
  var cat = $('filter-category').value;
  var sort = $('sort-by').value;

  var items = store.items.filter(function (it) {
    if (cat && it.category !== cat) return false;
    if (q) {
      var hay = [it.title, it.brand, it.year, it.cardNumber, it.notes].join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });

  items.sort(function (a, b) {
    if (sort === 'value') return (Number(b.value) || 0) - (Number(a.value) || 0);
    if (sort === 'title') return String(a.title).localeCompare(String(b.title));
    return (b.createdAt || 0) - (a.createdAt || 0); // newest
  });
  return items;
}

function renderList() {
  var items = filteredItems();
  var list = $('item-list');
  list.innerHTML = '';

  $('empty-state').classList.toggle('hidden', store.items.length > 0);

  var count = store.items.length;
  var total = store.items.reduce(function (s, it) { return s + (Number(it.value) || 0); }, 0);
  $('totals-count').textContent = count;
  $('totals-value').textContent = money(total);

  items.forEach(function (it) {
    var li = document.createElement('li');
    li.className = 'item-row';

    var thumb = it.front
      ? '<img class="item-thumb" src="' + it.front + '" alt="">'
      : '<span class="item-thumb placeholder" aria-hidden="true">🃏</span>';

    var sub = [it.category, it.year, it.brand].filter(Boolean).join(' · ');
    var cond = it.condition ? ' — ' + it.condition : '';

    li.innerHTML =
      '<input type="checkbox" class="item-check" aria-label="Select for lot"' +
      (selectedIds[it.id] ? ' checked' : '') + '>' +
      thumb +
      '<div class="item-meta">' +
        '<div class="item-title">' + esc(it.title) + '</div>' +
        '<div class="item-sub">' + esc(sub + cond) + '</div>' +
      '</div>' +
      '<div class="item-value">' + money(it.value) + '</div>';

    // Checkbox selects for the lot; tapping the row opens details.
    var check = li.querySelector('.item-check');
    check.addEventListener('click', function (e) { e.stopPropagation(); });
    check.addEventListener('change', function () {
      if (check.checked) selectedIds[it.id] = true;
      else delete selectedIds[it.id];
      renderLotPanel();
    });
    li.addEventListener('click', function () { openDetail(it.id); });
    list.appendChild(li);
  });

  renderLotPanel();
}

/* ---------------- Detail view ---------------- */

function openDetail(id) {
  var it = store.items.find(function (x) { return x.id === id; });
  if (!it) return;
  detailId = id;

  function photoFig(dataUrl, label) {
    if (!dataUrl) return '';
    return '<figure><img src="' + dataUrl + '" alt="' + label + ' photo"><figcaption>' + label + '</figcaption></figure>';
  }
  var photosHtml = photoFig(it.front, 'Front') + photoFig(it.back, 'Back');
  var photos = photosHtml ? '<div class="detail-photos">' + photosHtml + '</div>' : '';

  var rows = [
    ['Category', it.category],
    ['Year', it.year],
    ['Brand / Set', it.brand],
    ['Card #', it.cardNumber],
    ['Condition', it.condition + (it.grade ? ' (' + it.grade + ')' : '')]
  ].filter(function (r) { return r[1]; })
   .map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; })
   .join('');

  $('detail-body').innerHTML =
    photos +
    '<h2 class="detail-title">' + esc(it.title) + '</h2>' +
    '<div class="detail-value">' + money(it.value) + ' <span style="font-size:1rem;font-weight:400;color:#4a5560">est. value</span></div>' +
    (rows ? '<dl class="detail-grid">' + rows + '</dl>' : '') +
    (it.notes ? '<div class="detail-notes">' + esc(it.notes) + '</div>' : '') +
    '<div class="detail-actions">' +
      '<button id="d-share" class="btn btn-secondary" type="button">Share</button>' +
      '<button id="d-copy" class="btn btn-secondary" type="button">Copy listing</button>' +
      '<button id="d-ebay" class="btn btn-ebay" type="button">List on eBay</button>' +
      '<button id="d-edit" class="btn btn-secondary" type="button">Edit</button>' +
      '<button id="d-delete" class="btn btn-danger" type="button">Delete</button>' +
    '</div>';

  $('d-share').addEventListener('click', function () { shareItem(it); });
  $('d-copy').addEventListener('click', function () { copyText(listingText(it)); });
  $('d-ebay').addEventListener('click', function () { listOnEbay(listingText(it)); });
  $('d-edit').addEventListener('click', function () { openForm(it.id); });
  $('d-delete').addEventListener('click', function () {
    if (confirm('Delete "' + it.title + '"? This cannot be undone.')) {
      store.items = store.items.filter(function (x) { return x.id !== id; });
      delete selectedIds[id];
      saveStore();
      showView('list');
      renderList();
      toast('Deleted.');
    }
  });

  showView('detail');
}

/* ---------------- Add / edit form ---------------- */

function openForm(id) {
  editingId = id || null;
  var it = id ? store.items.find(function (x) { return x.id === id; }) : null;

  $('form-title').textContent = it ? 'Edit card' : 'Add card';
  $('f-title').value = it ? it.title : '';
  $('f-category').value = it ? it.category : 'Baseball';
  $('f-year').value = it ? (it.year || '') : '';
  $('f-cardnum').value = it ? (it.cardNumber || '') : '';
  $('f-brand').value = it ? (it.brand || '') : '';
  $('f-condition').value = it ? it.condition : 'Near Mint';
  $('f-grade').value = it ? (it.grade || '') : '';
  $('f-value').value = it && it.value ? it.value : '';
  $('f-notes').value = it ? (it.notes || '') : '';
  $('form-error').classList.add('hidden');

  // Keep existing photos when editing; start empty when adding.
  pendingPhotos.front = it ? (it.front || null) : null;
  pendingPhotos.back = it ? (it.back || null) : null;
  updatePhotoPreviews();
  $('photo-front').value = '';
  $('photo-back').value = '';

  showView('form');
}

function updatePhotoPreviews() {
  [['front', 'preview-front'], ['back', 'preview-back']].forEach(function (pair) {
    var img = $(pair[1]);
    if (pendingPhotos[pair[0]]) {
      img.src = pendingPhotos[pair[0]];
      img.classList.remove('hidden');
    } else {
      img.removeAttribute('src');
      img.classList.add('hidden');
    }
  });
}

// Resize an image file client-side: max 1200px on the long side, JPEG ~0.82.
function fileToDataUrl(file) {
  return new Promise(function (resolve, reject) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      var scale = Math.min(1, MAX_IMG / Math.max(img.width, img.height));
      var w = Math.round(img.width * scale);
      var h = Math.round(img.height * scale);
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
    };
    img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}

function bindPhotoInput(inputId, slot) {
  $(inputId).addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    toast('Processing photo…');
    fileToDataUrl(file).then(function (dataUrl) {
      pendingPhotos[slot] = dataUrl;
      updatePhotoPreviews();
    }).catch(function () {
      toast('Could not read that photo. Try another.');
    });
  });
}

function saveForm(e) {
  e.preventDefault();
  var title = $('f-title').value.trim();
  if (!title) {
    $('form-error').classList.remove('hidden');
    $('f-title').focus();
    return;
  }

  var record = {
    id: editingId || newId(),
    title: title,
    category: $('f-category').value,
    year: $('f-year').value.trim(),
    cardNumber: $('f-cardnum').value.trim(),
    brand: $('f-brand').value.trim(),
    condition: $('f-condition').value,
    grade: $('f-grade').value.trim(),
    value: parseFloat($('f-value').value) || 0,
    notes: $('f-notes').value.trim(),
    front: pendingPhotos.front,
    back: pendingPhotos.back,
    createdAt: editingId
      ? (store.items.find(function (x) { return x.id === editingId; }) || {}).createdAt || Date.now()
      : Date.now(),
    updatedAt: Date.now()
  };

  if (editingId) {
    var i = store.items.findIndex(function (x) { return x.id === editingId; });
    if (i > -1) store.items[i] = record;
  } else {
    store.items.push(record);
  }

  if (saveStore()) {
    toast('Saved.');
    showView('list');
    renderList();
  }
  // If saveStore() failed (storage full), stay on the form so nothing is lost.
}

/* ---------------- Listing text, share, copy, eBay ---------------- */

// "Title\nYear Brand #Num\nCondition: X (Grade)\nEstimated value: $Y\nNotes\n\nCard Scanner collection"
function listingText(it) {
  var lines = [it.title];
  var idLine = [it.year, it.brand, it.cardNumber].filter(Boolean).join(' ');
  if (idLine) lines.push(idLine);
  var cond = 'Condition: ' + (it.condition || '—');
  if (it.grade) cond += ' (' + it.grade + ')';
  lines.push(cond);
  lines.push('Estimated value: ' + money(it.value));
  if (it.notes) lines.push(it.notes);
  lines.push('');
  lines.push('Card Scanner collection');
  return lines.join('\n');
}

function copyText(text) {
  function done() { toast('Listing copied — paste it anywhere.'); }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
  } else {
    fallbackCopy(text);
    done();
  }
}

// Old-school copy fallback (execCommand) for browsers without the Clipboard API.
function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* ignore */ }
  document.body.removeChild(ta);
}

// Share via the phone's share sheet; fall back to copying the text.
function shareText(title, text) {
  if (navigator.share) {
    navigator.share({ title: title, text: text, url: location.href })
      .catch(function () { /* user cancelled — nothing to do */ });
  } else {
    copyText(text);
  }
}

function shareItem(it) { shareText(it.title, listingText(it)); }

// Copy the listing, then open eBay's sell page so the user can paste it.
// Photos are always added on eBay itself — the app can't upload them there.
function listOnEbay(text) {
  copyText(text);
  toast('Listing copied — add your photos on eBay.');
  window.open(EBAY_SELL_URL, '_blank', 'noopener');
}

/* ---------------- Sell as lot ---------------- */

function selectedItems() {
  return store.items.filter(function (it) { return selectedIds[it.id]; });
}

function renderLotPanel() {
  var items = selectedItems();
  var panel = $('lot-panel');
  if (items.length === 0) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  $('lot-count').textContent = items.length;
  var total = items.reduce(function (s, it) { return s + (Number(it.value) || 0); }, 0);
  $('lot-value').textContent = money(total);
}

function lotListingText() {
  var items = selectedItems();
  var title = $('lot-title').value.trim() || 'Card lot (' + items.length + ' items)';
  var price = parseFloat($('lot-price').value);
  var total = items.reduce(function (s, it) { return s + (Number(it.value) || 0); }, 0);

  var lines = [title, ''];
  lines.push(items.length + ' items — combined est. value ' + money(total));
  if (!isNaN(price) && price > 0) lines.push('Asking price: ' + money(price));
  lines.push('');
  items.forEach(function (it, i) {
    var bits = [it.year, it.brand, it.cardNumber].filter(Boolean).join(' ');
    lines.push((i + 1) + '. ' + it.title + (bits ? ' — ' + bits : '') +
      ' (' + (it.condition || '—') + ', ' + money(it.value) + ')');
  });
  lines.push('');
  lines.push('Card Scanner collection');
  return lines.join('\n');
}

/* ---------------- Wiring ---------------- */

document.addEventListener('DOMContentLoaded', function () {
  // iPhone users hit an Apple bug where the in-app camera can open black;
  // show them the Camera-app + Photo Library workaround hint.
  if (/iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    var iosHint = $('ios-camera-hint');
    if (iosHint) iosHint.hidden = false;
  }

  $('btn-add').addEventListener('click', function () { openForm(null); });
  $('btn-form-back').addEventListener('click', function () { showView('list'); renderList(); });
  $('btn-detail-back').addEventListener('click', function () { showView('list'); renderList(); });
  $('item-form').addEventListener('submit', saveForm);

  bindPhotoInput('photo-front', 'front');
  bindPhotoInput('photo-back', 'back');

  $('search').addEventListener('input', renderList);
  $('filter-category').addEventListener('change', renderList);
  $('sort-by').addEventListener('change', renderList);

  // Lot panel actions
  $('btn-lot-share').addEventListener('click', function () {
    var items = selectedItems();
    shareText($('lot-title').value.trim() || 'Card lot', lotListingText());
  });
  $('btn-lot-copy').addEventListener('click', function () { copyText(lotListingText()); });
  $('btn-lot-ebay').addEventListener('click', function () { listOnEbay(lotListingText()); });
  $('btn-lot-clear').addEventListener('click', function () {
    selectedIds = {};
    renderList();
  });

  renderList();
  showView('list');

  // Magic-link pre-fill: a link like
  //   ?new=1&title=...&category=Baseball&year=...&brand=...&cardNumber=...&condition=...&grade=...&value=...&notes=...
  // opens the add form with every field already filled in. The assistant sends
  // these links after identifying a card from photos, so nothing is typed by hand.
  (function () {
    var q = new URLSearchParams(window.location.search);
    if (q.get('new') !== '1') return;
    openForm(null);
    function setText(id, val) { if (val !== null && val !== '') $(id).value = val; }
    function setSelect(id, val) {
      if (!val) return;
      var sel = $(id);
      for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === val || sel.options[i].text === val) {
          sel.value = sel.options[i].value;
          return;
        }
      }
    }
    setText('f-title', q.get('title'));
    setSelect('f-category', q.get('category'));
    setText('f-year', q.get('year'));
    setText('f-cardnum', q.get('cardNumber'));
    setText('f-brand', q.get('brand'));
    setSelect('f-condition', q.get('condition'));
    setText('f-grade', q.get('grade'));
    setText('f-value', q.get('value'));
    setText('f-notes', q.get('notes'));
    toast('Details filled in — add your photos and tap Save.');
    // Clean the URL so a refresh doesn't reopen the form.
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  })();
});
