/* ============================================================
   CUSTOM SELECT ENHANCER
   Mengubah semua elemen <select> (termasuk yang dibuat secara
   dinamis oleh script.js lewat innerHTML/appendChild) menjadi
   dropdown custom bergaya "Horizon", tanpa mengubah logic yang
   sudah ada. <select> asli tetap dipertahankan (disembunyikan
   secara visual) sehingga semua kode yang membaca/mengubah
   `.value`, listener 'change', dan `required` tetap berfungsi.
   ============================================================ */
(function () {
  'use strict';

  // Patch setter `.value` bawaan select supaya perubahan value yang
  // dilakukan lewat script.js (mis. $('#profile-gender').value = '...')
  // otomatis menyinkronkan tampilan custom dropdown.
  function patchSelectValueSetter() {
    var proto = HTMLSelectElement.prototype;
    if (proto.__csPatched) return;

    var ownDesc = Object.getOwnPropertyDescriptor(proto, 'value');
    var desc = ownDesc || Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'value');
    if (!desc || !desc.set || !desc.configurable) return;

    Object.defineProperty(proto, 'value', {
      get: desc.get,
      set: function (v) {
        desc.set.call(this, v);
        if (this.__csSync) this.__csSync();
      },
      configurable: true
    });
    proto.__csPatched = true;
  }

  function optionLabel(select) {
    var opt = select.options[select.selectedIndex];
    return opt ? opt.textContent : '';
  }

  function buildCustomSelect(select) {
    if (!select || select.dataset.csEnhanced) return;
    if (select.dataset.csSkip) return; // select ini sengaja tetap native (lihat penanda data-cs-skip)
    if (select.closest && select.closest('.custom-select')) return;
    select.dataset.csEnhanced = '1';

    var wrapper = document.createElement('div');
    wrapper.className = 'custom-select';
    if (select.disabled) wrapper.classList.add('disabled');

    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);
    select.tabIndex = -1;

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.innerHTML =
      '<span class="custom-select-label"></span>' +
      '<svg class="custom-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<polyline points="6 9 12 15 18 9"/></svg>';

    var panel = document.createElement('div');
    panel.className = 'custom-select-panel';
    panel.setAttribute('role', 'listbox');

    wrapper.appendChild(trigger);
    document.body.appendChild(panel);
    wrapper.__csPanel = panel;
    panel.__csWrapper = wrapper;

    function renderPanel() {
      panel.innerHTML = '';
      var options = Array.prototype.slice.call(select.options);

      if (!options.length) {
        var empty = document.createElement('div');
        empty.className = 'custom-select-empty';
        empty.textContent = 'Tidak ada pilihan';
        panel.appendChild(empty);
      }

      options.forEach(function (opt) {
        var item = document.createElement('div');
        item.className = 'custom-select-option';
        if (opt.disabled) item.classList.add('disabled');
        if (opt.value === select.value) item.classList.add('selected');
        item.setAttribute('role', 'option');
        item.dataset.value = opt.value;
        item.textContent = opt.textContent;

        item.addEventListener('click', function () {
          if (opt.disabled) return;
          var changed = select.value !== opt.value;
          select.value = opt.value;
          if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
          closePanel();
        });

        panel.appendChild(item);
      });

      syncLabel();
    }

    function syncLabel() {
      var label = optionLabel(select);
      var labelEl = trigger.querySelector('.custom-select-label');
      var isPlaceholder = !select.value;
      labelEl.textContent = label || '';
      labelEl.classList.toggle('placeholder', isPlaceholder);

      var opts = panel.querySelectorAll('.custom-select-option');
      for (var i = 0; i < opts.length; i++) {
        opts[i].classList.toggle('selected', opts[i].dataset.value === select.value);
      }
    }

    function closeAllExcept(except) {
      document.querySelectorAll('.custom-select.open').forEach(function (w) {
        if (w !== except) {
          w.classList.remove('open');
          if (w.__csPanel) w.__csPanel.classList.remove('open');
        }
      });
    }

    function positionPanel() {
      var rect = trigger.getBoundingClientRect();
      var vh = window.innerHeight;
      var margin = 8;
      var minH = 140; // tinggi minimum supaya panel tidak pernah "hilang" (0/negatif) walau ruang sempit
      var maxH = 240;

      var spaceBelow = vh - rect.bottom - margin;
      var spaceAbove = rect.top - margin;

      panel.style.left = rect.left + 'px';
      panel.style.width = rect.width + 'px';

      // Pilih arah yang ruangnya lebih luas; kalau dua-duanya sempit, tetap buka ke
      // arah yang lebih besar dan biarkan panel overlap konten lain (lebih baik
      // daripada dropdown kelihatan kosong/tidak bisa dipakai).
      var openDown = spaceBelow >= spaceAbove;
      var available = openDown ? spaceBelow : spaceAbove;
      var finalH = Math.min(maxH, Math.max(minH, available));
      // Jangan sampai melebihi tinggi viewport itu sendiri (kasus viewport sangat pendek)
      finalH = Math.min(finalH, vh - margin * 2);

      if (openDown) {
        panel.style.bottom = '';
        panel.style.top = (rect.bottom + 6) + 'px';
        panel.style.maxHeight = finalH + 'px';
        panel.classList.remove('drop-up');
      } else {
        panel.style.top = '';
        panel.style.bottom = (vh - rect.top + 6) + 'px';
        panel.style.maxHeight = finalH + 'px';
        panel.classList.add('drop-up');
      }
    }

    function openPanel() {
      if (select.disabled) return;
      closeAllExcept(wrapper);
      positionPanel();
      wrapper.classList.add('open');
      panel.classList.add('open');
    }

    function closePanel() {
      wrapper.classList.remove('open');
      panel.classList.remove('open');
    }

    function togglePanel(e) {
      e.stopPropagation();
      if (wrapper.classList.contains('open')) closePanel();
      else openPanel();
    }

    trigger.addEventListener('click', togglePanel);

    trigger.addEventListener('keydown', function (e) {
      var options = panel.querySelectorAll('.custom-select-option:not(.disabled)');
      var currentIdx = -1;
      options.forEach(function (o, i) { if (o.classList.contains('highlighted')) currentIdx = i; });

      if (e.key === 'Escape') { closePanel(); }
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (wrapper.classList.contains('open') && currentIdx >= 0) {
          options[currentIdx].click();
        } else {
          openPanel();
        }
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!wrapper.classList.contains('open')) { openPanel(); return; }
        if (!options.length) return;
        options.forEach(function (o) { o.classList.remove('highlighted'); });
        var next = e.key === 'ArrowDown' ? currentIdx + 1 : currentIdx - 1;
        if (next < 0) next = options.length - 1;
        if (next >= options.length) next = 0;
        options[next].classList.add('highlighted');
        options[next].scrollIntoView({ block: 'nearest' });
      }
    });

    // Sinkronisasi saat opsi berubah (populate dinamis lewat innerHTML/appendChild)
    var optionsObserver = new MutationObserver(renderPanel);
    optionsObserver.observe(select, { childList: true });

    // Sinkronisasi saat atribut disabled berubah
    var attrObserver = new MutationObserver(function () {
      wrapper.classList.toggle('disabled', select.disabled);
    });
    attrObserver.observe(select, { attributes: true, attributeFilter: ['disabled'] });

    // Dipanggil oleh patched value-setter ketika script.js set `.value` langsung
    select.__csSync = syncLabel;

    // Jaga-jaga bila ada kode yang tetap memicu 'change' native
    select.addEventListener('change', syncLabel);

    renderPanel();
  }

  function enhanceAllIn(root) {
    root.querySelectorAll('select:not([data-cs-enhanced]):not([data-cs-skip])').forEach(buildCustomSelect);
  }

  function init() {
    patchSelectValueSetter();
    enhanceAllIn(document);

    var bodyObserver = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          if (node.matches && node.matches('select')) buildCustomSelect(node);
          if (node.querySelectorAll) enhanceAllIn(node);
        });
        m.removedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          var selects = [];
          if (node.matches && node.matches('select[data-cs-enhanced]')) selects.push(node);
          if (node.querySelectorAll) selects = selects.concat(
            Array.prototype.slice.call(node.querySelectorAll('select[data-cs-enhanced]'))
          );
          selects.forEach(function (sel) {
            var wrapper = sel.closest ? sel.closest('.custom-select') : null;
            // PENTING: saat select baru pertama kali di-enhance, ia juga "dipindah"
            // (insertBefore + appendChild) ke dalam wrapper-nya sendiri — perpindahan
            // ini turut tercatat sebagai mutation "removedNodes" oleh observer yang
            // sama, padahal select-nya masih ada di halaman (cuma pindah wadah).
            // Kalau langsung dibersihkan di sini, panel yang baru saja dibuat malah
            // ikut terhapus. Makanya cek dulu: wrapper-nya masih nempel ke dokumen
            // atau tidak (isConnected). Hanya bersihkan panel kalau wrapper-nya
            // benar-benar sudah lepas dari halaman (mis. baris tabelnya dihapus).
            if (wrapper && !wrapper.isConnected && wrapper.__csPanel && wrapper.__csPanel.parentNode) {
              wrapper.__csPanel.parentNode.removeChild(wrapper.__csPanel);
            }
          });
        });
      });
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });

    document.addEventListener('click', function (e) {
      document.querySelectorAll('.custom-select.open').forEach(function (w) {
        var p = w.__csPanel;
        var insideWrapper = w.contains(e.target);
        var insidePanel = p && p.contains(e.target);
        if (!insideWrapper && !insidePanel) {
          w.classList.remove('open');
          if (p) p.classList.remove('open');
        }
      });
    });

    function closeAllOpenPanels() {
      document.querySelectorAll('.custom-select.open').forEach(function (w) {
        w.classList.remove('open');
        if (w.__csPanel) w.__csPanel.classList.remove('open');
      });
    }

    window.addEventListener('scroll', function (e) {
      if (e.target && e.target.closest && e.target.closest('.custom-select-panel')) return;
      closeAllOpenPanels();
    }, true);
    window.addEventListener('resize', closeAllOpenPanels);

    // FIX: panel custom-select di-append ke document.body (supaya position:fixed
    // tidak terpotong container), sehingga saat pindah halaman (navigateTo() di
    // script.js hanya toggle class 'active' pada .view) panel yang masih terbuka
    // akan "bocor" tetap tampil menimpa halaman lain. Solusi: pantau perubahan
    // class pada elemen .view manapun, lalu tutup semua panel yang terbuka.
    var viewObserver = new MutationObserver(function (mutations) {
      var viewChanged = mutations.some(function (m) {
        return m.target.classList && m.target.classList.contains('view');
      });
      if (viewChanged) closeAllOpenPanels();
    });
    document.querySelectorAll('.view').forEach(function (viewEl) {
      viewObserver.observe(viewEl, { attributes: true, attributeFilter: ['class'] });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
