(function () {
'use strict';

/* ============================================ */
/* KONFIGURASI SUPABASE */
/* ============================================ */
const SUPABASE_URL = 'https://sicqlydgtteqzujvuaks.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpY3FseWRndHRlcXp1anZ1YWtzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NDE1MTcsImV4cCI6MjA5OTUxNzUxN30.CE1VbaKvb66fCrAYymTqQOEPiKG36-de5XoXGTUSOw8';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ============================================ */
/* STATE */
/* ============================================ */
const state = {
  user: null,
  profile: null,
  isAdmin: false,
  currentPage: 'beranda',
  realtimeChannels: [],
  selectedFile: null,
  chatAttachment: null,
  adminTable: {
    data: [],
    filtered: [],
    page: 1,
    perPage: 10,
    sortField: 'full_name',
    sortDirection: 'asc',
    search: '',
    filterStatus: '',
    filterStep: ''
  },
  adminDetail: { activeUserId: null, previewReturnsToDetail: false },
  adminChat: { userId: null, channel: null },
  adminChatTab: {
    conversations: [],   // [{ userId, fullName, email, lastMessage, lastAt, unreadCount }]
    search: '',
    activeUserId: null,
    activeName: '',
    activeEmail: '',
    attachment: null,
    allParticipants: null // cache daftar peserta untuk picker "Chat Baru"
  },
  adminVerifikasi: { data: [], search: '' },
  scheduleFilter: 'all',
  theme: localStorage.getItem('theme') || 'light',
  autoSaveTimers: {},
  dashboardInitializing: false,
  dashboardReady: false
};

const DOC_TYPES = [
  'KTP', 'KK', 'Akta', 'Ijazah', 'Paspor', 
  'SKCK', 'Sertifikat', 'Foto Close Up'
];

// Keyword cek OCR ringan (client-side, Tesseract.js). Bukan validasi resmi/legal —
// hanya sanity-check agar user tidak salah upload dokumen. Dokumen foto (tanpa teks
// baku) sengaja tidak dicek. Cocok jika minimal satu keyword per grup ditemukan.
const DOC_OCR_KEYWORDS = {
  'KTP': [['KARTU TANDA PENDUDUK', 'TANDA PENDUDUK'], ['NIK'], ['PROVINSI']],
  'KK': [['KARTU KELUARGA'], ['NO', 'NOMOR'], ['KEPALA KELUARGA']],
  'Akta': [['AKTA'], ['KELAHIRAN', 'LAHIR']],
  'Ijazah': [['IJAZAH', 'IJASAH']],
  'Paspor': [['PASPOR', 'PASSPORT'], ['REPUBLIK INDONESIA']],
  'SKCK': [['SKCK', 'KEPOLISIAN']],
  'Sertifikat': [['SERTIFIKAT', 'CERTIFICATE']]
};

// Worker Tesseract di-reuse antar pengecekan OCR (bukan dibuat ulang tiap upload).
// Tanpa ini, tiap kali user upload dokumen, browser mendownload ulang model bahasa
// OCR (~10-15MB) dan menginisialisasi worker dari nol -> ini penyebab utama loading
// lama saat upload dokumen, terutama di koneksi mobile. Dengan reuse, hanya upload
// PERTAMA dalam sesi yang lambat; upload berikutnya jauh lebih cepat.
let tesseractWorkerPromise = null;
function getTesseractWorker() {
  if (typeof Tesseract === 'undefined') return Promise.reject(new Error('Tesseract belum termuat'));
  if (!tesseractWorkerPromise) {
    tesseractWorkerPromise = Tesseract.createWorker('eng').catch((err) => {
      tesseractWorkerPromise = null; // reset supaya percobaan berikutnya bisa retry
      throw err;
    });
  }
  return tesseractWorkerPromise;
}

// Foto dari kamera HP biasanya jauh lebih besar (mis. 3000x4000px) daripada yang
// dibutuhkan untuk sekadar mendeteksi keyword. Waktu proses OCR kira-kira sebanding
// dengan jumlah piksel, jadi mengecilkan gambar dulu sebelum di-OCR mempercepat
// pengecekan secara signifikan tanpa mengubah file asli yang diupload ke server.
function downscaleImageForOcr(file, maxDim = 1400) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        if (scale >= 1) {
          URL.revokeObjectURL(url);
          resolve(file);
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          resolve(blob || file);
        }, 'image/jpeg', 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    } catch (err) {
      resolve(file);
    }
  });
}

// Foto asli dari kamera HP (bisa 3-8MB) adalah penyumbang terbesar lamanya waktu
// upload, karena itulah data yang benar-benar dikirim lewat jaringan ke server.
// Fungsi ini mengecilkan resolusi & kompres kualitas JPEG SEBELUM file dikirim,
// tanpa mengorbankan keterbacaan dokumen. File yang sudah kecil (<=800KB, mis.
// screenshot atau hasil kompresi kamera yang efisien) dilewati saja.
function compressImageForUpload(file, maxDim = 2000, quality = 0.82) {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/') || file.size <= 800 * 1024) {
      resolve(file);
      return;
    }
    try {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (!blob || blob.size >= file.size) {
            // Kompresi tidak membantu -> pakai file asli saja
            resolve(file);
            return;
          }
          const newName = file.name.replace(/\.(jpe?g|png)$/i, '') + '.jpg';
          resolve(new File([blob], newName, { type: 'image/jpeg' }));
        }, 'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    } catch (err) {
      resolve(file);
    }
  });
}

const TIMELINE_STEPS = [
  { step: 1, title: 'Pendaftaran', desc: 'Registrasi akun dan lengkapi data diri' },
  { step: 2, title: 'Verifikasi', desc: 'Verifikasi dokumen dan data peserta' },
  { step: 3, title: 'Interview', desc: 'Wawancara dengan pihak agensi' },
  { step: 4, title: 'Administrasi', desc: 'Pengurusan dokumen administrasi' },
  { step: 5, title: 'Medical', desc: 'Pemeriksaan kesehatan' },
  { step: 6, title: 'Penempatan', desc: 'Penempatan kerja dan pemberangkatan' }
];

/* ============================================ */
/* UTILITIES */
/* ============================================ */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function show(el) { if (el) el.classList.remove('hidden'); }
function hide(el) { if (el) el.classList.add('hidden'); }

function toast(type, title, message = '') {
  const container = $('#toast-container');
  const icons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `
    <div class="toast-icon">${icons[type] || icons.info}</div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      ${message ? `<div class="toast-message">${escapeHtml(message)}</div>` : ''}
    </div>
  `;
  container.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'slideIn 0.3s ease-out reverse';
    setTimeout(() => t.remove(), 300);
  }, 3500);
}

// Menyimpan fungsi cleanup dari confirmDialog yang sedang aktif, supaya bisa
// dibersihkan paksa kalau popup ditutup lewat cara lain (klik overlay/di luar)
// tanpa menekan OK/Batal — sebelumnya ini yang bikin listener lama menumpuk
// dan ikut ke-trigger bareng dialog konfirmasi berikutnya.
let activeConfirmCleanup = null;

function confirmDialog(title, message, onConfirm, onCancel) {
  // Bersihkan dulu listener dari dialog sebelumnya kalau masih nyangkut
  if (activeConfirmCleanup) activeConfirmCleanup();

  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  show($('#confirm-modal'));
  
  const okBtn = $('#confirm-ok');
  const cancelBtn = $('#confirm-cancel');
  
  const cleanup = () => {
    hide($('#confirm-modal'));
    okBtn.removeEventListener('click', handleOk);
    cancelBtn.removeEventListener('click', handleCancel);
    activeConfirmCleanup = null;
  };
  
  const handleOk = () => { cleanup(); onConfirm(); };
  const handleCancel = () => { cleanup(); if (typeof onCancel === 'function') onCancel(); };
  
  okBtn.addEventListener('click', handleOk);
  cancelBtn.addEventListener('click', handleCancel);

  activeConfirmCleanup = cleanup;
}

function setLoading(btn, loading) {
  if (!btn) return;
  const text = btn.querySelector('.btn-text');
  const loader = btn.querySelector('.btn-loader');
  if (loading) {
    btn.disabled = true;
    if (text) text.style.opacity = '0.5';
    if (loader) show(loader);
  } else {
    btn.disabled = false;
    if (text) text.style.opacity = '1';
    if (loader) hide(loader);
  }
}

function formatDate(d) {
  if (!d) return '-';
  const date = new Date(d);
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(d) {
  if (!d) return '';
  const date = new Date(d);
  return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function formatCurrency(amount, currency = 'IDR') {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: currency,
    maximumFractionDigits: 0
  }).format(amount);
}

// Selisih hari (dibulatkan ke atas, berbasis tanggal kalender bukan jam) dari
// hari ini menuju tanggal target. Dipakai untuk countdown keberangkatan di
// Beranda & halaman Progress peserta.
function daysUntilDate(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / 86400000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Debounce sederhana: dipakai supaya event realtime yang datang beruntun
// (mis. peserta upload banyak dokumen sekaligus, atau banyak pendaftar baru
// dalam waktu berdekatan) tidak memicu reload berkali-kali dalam waktu
// singkat -> cukup satu kali reload setelah jeda tenang.
function debounce(fn, wait = 400) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

function statusLabel(s) {
  const map = {
    pending: 'Menunggu',
    approved: 'Disetujui',
    rejected: 'Ditolak',
    in_progress: 'Diproses',
    completed: 'Selesai',
    failed: 'Gagal'
  };
  return map[s] || s;
}

/* ============================================ */
/* TITLE CASE AUTO-FORMAT UNTUK INPUT NAMA */
/* ============================================ */
function toTitleCase(str) {
  return str.replace(/\S+/g, function (word) {
    // Jaga huruf kecil di depan tanda kurung/kutip, dsb tetap wajar
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

function bindTitleCaseInput(input) {
  if (!input || input.__titleCaseBound) return;
  input.__titleCaseBound = true;
  input.addEventListener('input', function () {
    const start = this.selectionStart;
    const end = this.selectionEnd;
    const formatted = toTitleCase(this.value);
    if (formatted !== this.value) {
      this.value = formatted;
      this.setSelectionRange(start, end);
    }
  });
}

// Terapkan ke semua input nama yang sudah ada di halaman (statis)
function initTitleCaseInputs(root) {
  (root || document).querySelectorAll(
    'input[data-titlecase], #register-name, #profile-fullname, input[id*="fullname" i], input[id*="full-name" i], input[id*="nama" i]:not([id*="username" i])'
  ).forEach(bindTitleCaseInput);
}

initTitleCaseInputs(document);

// Modal/form dinamis (mis. via innerHTML) ikut otomatis ter-format title case
new MutationObserver(function (mutations) {
  mutations.forEach(function (m) {
    m.addedNodes.forEach(function (node) {
      if (node.nodeType !== 1) return;
      initTitleCaseInputs(node);
      if (node.matches && node.matches('input') &&
          (node.dataset.titlecase !== undefined || /fullname|full-name|nama/i.test(node.id || ''))) {
        bindTitleCaseInput(node);
      }
    });
  });
}).observe(document.body, { childList: true, subtree: true });

/* ============================================ */
/* THEME (DARK MODE) */
/* ============================================ */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  state.theme = theme;
  localStorage.setItem('theme', theme);
}

applyTheme(state.theme);

/* ============================================ */
/* OFFLINE DETECTION */
/* ============================================ */
function updateOnlineStatus() {
  if (navigator.onLine) {
    hide($('#offline-banner'));
  } else {
    show($('#offline-banner'));
  }
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

/* ============================================ */
/* PWA SERVICE WORKER */
/* ============================================ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Silent fail if SW registration fails
    });
  });
}

/* ============================================ */
/* TOMBOL INSTALL PWA */
/* ============================================ */
let deferredInstallPrompt = null;
const installBanner = $('#install-banner');
const installBtn = $('#install-btn');
const installDismiss = $('#install-dismiss');
const INSTALL_DISMISS_KEY = 'gw_install_dismissed';

function isStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;

  if (isStandaloneMode()) return; // sudah terinstall/berjalan sebagai app
  if (sessionStorage.getItem(INSTALL_DISMISS_KEY) === '1') return; // sudah ditutup sesi ini

  if (installBanner) show(installBanner);
});

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      hide(installBanner);
      return;
    }
    installBtn.disabled = true;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installBtn.disabled = false;
    hide(installBanner);
    if (outcome === 'accepted' && typeof toast === 'function') {
      toast('success', 'Aplikasi Terinstall', 'PT. Juara berhasil ditambahkan ke perangkat Anda.');
    }
  });
}

if (installDismiss) {
  installDismiss.addEventListener('click', () => {
    hide(installBanner);
    sessionStorage.setItem(INSTALL_DISMISS_KEY, '1');
  });
}

window.addEventListener('appinstalled', () => {
  hide(installBanner);
  deferredInstallPrompt = null;
});

// Request notification permission
async function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}

/* ============================================ */
/* SPLASH SCREEN */
/* ============================================ */
function hideSplash() {
  const splash = $('#splash-screen');
  if (splash) {
    splash.classList.add('fade-out');
    setTimeout(() => splash.remove(), 500);
  }
}

/* ============================================ */
/* FORM VALIDATION */
/* ============================================ */
function validateField(input) {
  const group = input.closest('.input-group');
  const errorEl = group?.querySelector('.field-error');
  let isValid = true;
  let message = '';
  
  if (input.required && !input.value.trim()) {
    isValid = false;
    message = 'Field ini wajib diisi';
  } else if (input.type === 'email' && input.value) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(input.value)) {
      isValid = false;
      message = 'Format email tidak valid';
    }
  } else if (input.type === 'tel' && input.value) {
    const phoneRegex = /^[0-9]{10,13}$/;
    if (!phoneRegex.test(input.value.replace(/\s/g, ''))) {
      isValid = false;
      message = 'Nomor telepon tidak valid (10-13 digit)';
    }
  } else if (input.minLength && input.value.length < input.minLength) {
    isValid = false;
    message = `Minimal ${input.minLength} karakter`;
  }
  
  if (errorEl) errorEl.textContent = message;
  if (group) {
    group.classList.toggle('error', !isValid);
    group.classList.toggle('success', isValid && input.value);
  }
  
  return isValid;
}

function validateForm(form) {
  const inputs = form.querySelectorAll('input[required], select[required], textarea[required]');
  let isValid = true;
  inputs.forEach(input => {
    if (!validateField(input)) isValid = false;
  });
  return isValid;
}

// Password strength checker
function checkPasswordStrength(password) {
  let strength = 0;
  if (password.length >= 6) strength++;
  if (password.length >= 10) strength++;
  if (/[A-Z]/.test(password)) strength++;
  if (/[0-9]/.test(password)) strength++;
  if (/[^A-Za-z0-9]/.test(password)) strength++;
  
  const fill = $('.strength-fill');
  const text = $('.strength-text');
  
  if (!fill || !text) return;
  
  fill.className = 'strength-fill';
  if (password.length === 0) {
    text.textContent = '';
  } else if (strength <= 2) {
    fill.classList.add('weak');
    text.textContent = 'Lemah';
  } else if (strength <= 3) {
    fill.classList.add('medium');
    text.textContent = 'Sedang';
  } else {
    fill.classList.add('strong');
    text.textContent = 'Kuat';
  }
}

const registerPassword = $('#register-password');
if (registerPassword) {
  registerPassword.addEventListener('input', (e) => checkPasswordStrength(e.target.value));
}

const resetPasswordInput = $('#reset-password');
if (resetPasswordInput) {
  resetPasswordInput.addEventListener('input', (e) => checkPasswordStrength(e.target.value));
}

// Real-time validation
$$('input, select, textarea').forEach(input => {
  input.addEventListener('blur', () => validateField(input));
  input.addEventListener('input', () => {
    const group = input.closest('.input-group');
    if (group?.classList.contains('error')) {
      validateField(input);
    }
  });
});

/* ============================================ */
/* AUTO SAVE FORM */
/* ============================================ */
function autoSaveForm(formKey, data) {
  if (!state.user) return;
  
  if (state.autoSaveTimers[formKey]) {
    clearTimeout(state.autoSaveTimers[formKey]);
  }
  
  state.autoSaveTimers[formKey] = setTimeout(async () => {
    try {
      await supabase.from('form_drafts').upsert({
        user_id: state.user.id,
        form_key: formKey,
        data: data,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,form_key' });
      
      const indicator = $(`#${formKey}-autosave`);
      if (indicator) {
        indicator.classList.add('show');
        setTimeout(() => indicator.classList.remove('show'), 2000);
      }
    } catch (err) {
      console.error('Auto-save failed:', err);
    }
  }, 1500);
}

async function loadFormDraft(formKey) {
  if (!state.user) return null;
  
  const { data } = await supabase
    .from('form_drafts')
    .select('data')
    .eq('user_id', state.user.id)
    .eq('form_key', formKey)
    .single();
  
  return data?.data || null;
}

/* ============================================ */
/* AUTH PAGES NAVIGATION */
/* ============================================ */
function showAuthPage(page) {
  $$('.auth-page').forEach(p => p.classList.remove('active'));
  $(`#page-${page}`).classList.add('active');
}

$$('[data-page]').forEach(el => {
  if (el.closest('.sidebar-nav') || el.closest('.bottom-nav') || el.closest('.quick-actions')) return;
  el.addEventListener('click', (e) => {
    e.preventDefault();
    const page = el.dataset.page;
    if (['login', 'register', 'forgot', 'reset'].includes(page)) {
      showAuthPage(page);
    }
  });
});

/* ============================================ */
/* AUTH FORMS */
/* ============================================ */
$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateForm(e.target)) return;
  
  const btn = e.target.querySelector('button[type="submit"]');
  setLoading(btn, true);

  const email = $('#login-email').value.trim();
  const password = $('#login-password').value;

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(btn, false);
    if (error) {
      if (error.message && error.message.toLowerCase().includes('email not confirmed')) {
        confirmDialog(
          'Email Belum Dikonfirmasi',
          'Akun ini belum dikonfirmasi. Cek inbox/folder spam Anda, atau klik OK untuk kirim ulang email konfirmasi.',
          async () => {
            try {
              const { error: resendError } = await supabase.auth.resend({
                type: 'signup',
                email
              });
              if (resendError) {
                toast('error', 'Gagal Mengirim Ulang', resendError.message);
                return;
              }
              toast('success', 'Email Terkirim', 'Silakan cek inbox Anda untuk link konfirmasi.');
            } catch (err) {
              toast('error', 'Error', 'Terjadi kesalahan. Silakan coba lagi.');
            }
          }
        );
        return;
      }

      toast('error', 'Login Gagal', error.message);
      return;
    }

    toast('success', 'Login Berhasil', 'Selamat datang kembali!');
    // initDashboard() akan otomatis dijalankan oleh listener onAuthStateChange (event SIGNED_IN)
    // begitu sesi terbentuk — tidak perlu dipanggil lagi di sini (dulu menyebabkan dashboard
    // dimuat dua kali berturut-turut / tampak "loading lagi" setelah berhasil login).
    // Fallback jaga-jaga saja bila event auth telat terpicu; aman karena initDashboard()
    // sudah dilindungi guard state.dashboardInitializing (tidak akan jalan dobel).
    setTimeout(() => { if (!state.dashboardReady) initDashboard(); }, 1500);
  } catch (err) {
    setLoading(btn, false);
    toast('error', 'Error', 'Terjadi kesalahan. Silakan coba lagi.');
  }
});

$('#form-register').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateForm(e.target)) return;
  
  const btn = e.target.querySelector('button[type="submit"]');
  setLoading(btn, true);

  const full_name = $('#register-name').value.trim();
  const phone = $('#register-phone').value.trim();
  const email = $('#register-email').value.trim();
  const password = $('#register-password').value;

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name, phone } }
    });

    setLoading(btn, false);
    if (error) {
      toast('error', 'Registrasi Gagal', error.message);
      return;
    }

    toast('success', 'Registrasi Berhasil', 'Cek email Anda (termasuk folder spam) dan klik link konfirmasi sebelum login.');
    showAuthPage('login');
  } catch (err) {
    setLoading(btn, false);
    toast('error', 'Error', 'Terjadi kesalahan. Silakan coba lagi.');
  }
});

$('#form-forgot').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateForm(e.target)) return;
  
  const btn = e.target.querySelector('button[type="submit"]');
  setLoading(btn, true);

  const email = $('#forgot-email').value.trim();
  
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname
    });

    setLoading(btn, false);
    if (error) {
      toast('error', 'Gagal', error.message);
      return;
    }
    toast('success', 'Email Terkirim', 'Cek inbox Anda untuk link reset password');
  } catch (err) {
    setLoading(btn, false);
    toast('error', 'Error', 'Terjadi kesalahan.');
  }
});

$('#form-reset').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateForm(e.target)) return;

  const btn = e.target.querySelector('button[type="submit"]');
  const password = $('#reset-password').value;
  const passwordConfirm = $('#reset-password-confirm').value;

  if (password !== passwordConfirm) {
    toast('error', 'Password Tidak Cocok', 'Password baru dan konfirmasi harus sama.');
    return;
  }

  setLoading(btn, true);

  try {
    const { error } = await supabase.auth.updateUser({ password });

    setLoading(btn, false);
    if (error) {
      toast('error', 'Gagal Menyimpan Password', error.message);
      return;
    }

    toast('success', 'Password Berhasil Diubah', 'Silakan masuk dengan password baru Anda.');
    await supabase.auth.signOut();
    showAuthPage('login');
  } catch (err) {
    setLoading(btn, false);
    toast('error', 'Error', 'Terjadi kesalahan. Silakan coba lagi.');
  }
});

$$('.toggle-password').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = $(`#${btn.dataset.target}`);
    input.type = input.type === 'password' ? 'text' : 'password';
  });
});

/* ============================================ */
/* DASHBOARD ROUTING */
/* ============================================ */
function navigateTo(page) {
  state.currentPage = page;
  $$('.view').forEach(v => v.classList.remove('active'));
  const view = $(`#view-${page}`);
  if (view) view.classList.add('active');

  $$('.nav-item').forEach(n => n.classList.remove('active'));
  $$('.nav-item[data-page="' + page + '"]').forEach(n => n.classList.add('active'));

  $$('.bottom-item').forEach(n => n.classList.remove('active'));
  $$('.bottom-item[data-page="' + page + '"]').forEach(n => n.classList.add('active'));

  const topbarChatBtn = $('#topbar-chat-btn');
  if (topbarChatBtn) topbarChatBtn.classList.toggle('active', page === 'chat' || page === 'admin-chat');

  // Load data per page
  const loaders = {
    'beranda': loadBeranda,
    'profil': loadProfil,
    'dokumen': loadDocumentsChecklist,
    'progress': loadProgress,
    'jadwal': loadSchedules,
    'notifikasi': loadNotifications,
    'chat': loadChat,
    'pengumuman': loadAnnouncements,
    'lowongan': loadLowongan,
    'admin-dashboard': loadAdminDashboard,
    'admin-peserta': loadAdminPeserta,
    'admin-verifikasi': loadAdminVerifikasi,
    'admin-pengumuman': loadAdminPengumuman,
    'admin-negara': loadAdminNegara,
    'admin-posisi': loadAdminPosisi,
    'admin-jadwal-keberangkatan': loadAdminJadwalKeberangkatan,
    'admin-penempatan': loadAdminPenempatan,
    'admin-chat': loadAdminChatPage
  };
  
  if (loaders[page]) loaders[page]();

  $('#sidebar').classList.remove('open');
}

$$('.nav-item[data-page]').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(item.dataset.page);
  });
});

$$('.bottom-item[data-page]').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(item.dataset.page);
  });
});

$('#topbar-chat-btn').addEventListener('click', () => {
  navigateTo(state.isAdmin ? 'admin-chat' : 'chat');
});

$$('.quick-card[data-page]').forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.page));
});

// Kartu statistik Dashboard Admin: klik untuk lompat ke halaman terkait,
// dan otomatis set filter status/tahapan kalau kartunya punya
// data-filter-status atau data-filter-step (mis. "Disetujui" -> Kelola
// Peserta dengan filter tahapan "Penempatan").
$$('.admin-stat-card[data-page]').forEach(item => {
  item.addEventListener('click', () => {
    const page = item.dataset.page;
    const filterStatus = item.dataset.filterStatus;
    const filterStep = item.dataset.filterStep;

    if (filterStatus !== undefined && page === 'admin-peserta') {
      state.adminTable.filterStatus = filterStatus;
      const filterSelect = $('#admin-filter-status');
      if (filterSelect) filterSelect.value = filterStatus;
      applyAdminFilters();
    }

    if (filterStep !== undefined && page === 'admin-peserta') {
      state.adminTable.filterStep = filterStep;
      const stepSelect = $('#admin-filter-step');
      if (stepSelect) stepSelect.value = filterStep;
      applyAdminFilters();
    }

    navigateTo(page);
  });
});

$('#btn-logout').addEventListener('click', (e) => {
  e.preventDefault();
  confirmDialog('Logout', 'Yakin ingin keluar dari akun?', async () => {
    await supabase.auth.signOut();
    location.reload();
  });
});

// Tombol logout khusus tampilan HP (pojok kanan atas). Pakai logic yang
// sama persis dengan logout di sidebar, supaya setelah logout langsung
// kembali ke halaman login (location.reload() menampilkan layar auth).
$('#mobile-logout-btn')?.addEventListener('click', (e) => {
  e.preventDefault();
  confirmDialog('Logout', 'Yakin ingin keluar dari akun?', async () => {
    await supabase.auth.signOut();
    location.reload();
  });
});

/* ============================================ */
/* DASHBOARD INIT */
/* ============================================ */
async function initDashboard() {
  if (state.dashboardInitializing) return;
  state.dashboardInitializing = true;
  // Tandai apakah ini init PERTAMA (login awal) atau re-init yang dipicu ulang
  // oleh Supabase (mis. SIGNED_IN yang re-fire saat sesi/token di-refresh setelah
  // app sempat di-background-kan, contoh: buka kamera untuk upload dokumen).
  // Re-init TIDAK boleh memaksa pindah halaman, supaya user yang sedang di
  // halaman lain (mis. Upload Dokumen) tidak tiba-tiba dilempar ke Beranda.
  const isFirstInit = !state.dashboardReady;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    state.user = user;

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    state.profile = profile;
    state.isAdmin = profile?.role === 'admin';

    const name = profile?.full_name || user.email?.split('@')[0] || 'Peserta';
    const initial = name.charAt(0).toUpperCase();
    const avatarUrl = profile?.avatar_url || '';

    $('#welcome-name').textContent = name;
    $('#sidebar-name').textContent = name;
    $('#sidebar-email').textContent = user.email;
    $('#profile-name-text').textContent = name;
    $('#profile-email-text').textContent = user.email;
    $('#sidebar-role').textContent = state.isAdmin ? 'Admin' : 'Peserta';

    if (avatarUrl) {
      $('#sidebar-avatar').src = avatarUrl;
      $('#profile-avatar-img').src = avatarUrl;
    } else {
      ['#sidebar-avatar', '#profile-avatar-img'].forEach(sel => {
        const img = $(sel);
        if (img) {
          img.src = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><rect width='100' height='100' fill='%23234c73'/><g transform='translate(31,31) scale(1.6)' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'/><circle cx='12' cy='7' r='4'/></g></svg>`;
        }
      });
    }

    if (state.isAdmin) {
      hide($('#user-nav'));
      show($('#admin-nav'));
      if (isFirstInit) navigateTo('admin-dashboard');
    } else {
      show($('#user-nav'));
      hide($('#admin-nav'));
      if (isFirstInit) navigateTo('beranda');
    }

    hide($('#auth-wrapper'));
    show($('#dashboard-wrapper'));
    
    await requestNotificationPermission();
    subscribeRealtime();
  } catch (err) {
    console.error('Init error:', err);
    toast('error', 'Error', 'Gagal memuat dashboard');
  } finally {
    state.dashboardInitializing = false;
    state.dashboardReady = true;
  }
}

/* ============================================ */
/* BERANDA */
/* ============================================ */
async function loadBeranda() {
  const userId = state.user.id;

  try {
    const [docsRes, progressRes, schedulesRes, placementRes] = await Promise.all([
      supabase.from('documents').select('id, status').eq('user_id', userId),
      supabase.from('participant_status').select('current_step').eq('user_id', userId).maybeSingle(),
      supabase.from('schedules').select('id').eq('user_id', userId).eq('status', 'scheduled'),
      supabase.from('placements').select('departure_date').eq('user_id', userId).maybeSingle()
    ]);

    const docs = docsRes.data || [];
    const completedDocs = docs.filter(d => d.status === 'approved').length;
    $('#stat-docs').textContent = `${completedDocs}/${DOC_TYPES.length}`;

    const currentStep = progressRes.data?.current_step || 1;
    const finalStep = TIMELINE_STEPS[TIMELINE_STEPS.length - 1].step;
    const percent = Math.round(((currentStep - 1) / (TIMELINE_STEPS.length - 1)) * 100);

    const progressLabel = $('#stat-progress-label');
    const departureDate = placementRes.data?.departure_date || null;

    if (currentStep >= finalStep && departureDate) {
      // Admin sudah menekan tombol "Proses" di halaman Penempatan -> tampilkan
      // hitung mundur menuju tanggal keberangkatan, bukan lagi persentase.
      const days = daysUntilDate(departureDate);
      if (progressLabel) progressLabel.textContent = 'Keberangkatan';
      $('#stat-progress').textContent = days > 0 ? `H-${days}` : (days === 0 ? 'Hari H' : 'Berangkat');
    } else if (currentStep >= finalStep) {
      // Semua tahapan selesai tapi belum diproses admin (belum ada tanggal keberangkatan)
      if (progressLabel) progressLabel.textContent = 'Progress';
      $('#stat-progress').textContent = 'SELESAI';
    } else {
      if (progressLabel) progressLabel.textContent = 'Progress';
      $('#stat-progress').textContent = percent + '%';
    }

    $('#stat-schedules').textContent = schedulesRes.data?.length || 0;

    const { data: announcements } = await supabase
      .from('announcements')
      .select('*')
      .eq('is_published', true)
      .order('created_at', { ascending: false })
      .limit(3);

    const container = $('#home-announcements');
    if (!announcements || announcements.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l18-5v12L3 14v-3z"/></svg>
          <h4>Belum ada pengumuman</h4>
          <p>Pengumuman terbaru akan muncul di sini</p>
        </div>
      `;
    } else {
      container.innerHTML = announcements.map(a => `
        <div class="card-item priority-${a.priority}">
          <div class="card-item-header">
            <div class="card-item-title">${escapeHtml(a.title)}</div>
            <span class="card-item-meta">${formatDate(a.created_at)}</span>
          </div>
          <div class="card-item-body">${escapeHtml(a.content || '')}</div>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Load beranda error:', err);
  }
}

/* ============================================ */
/* PROFIL */
/* ============================================ */
async function loadProfil() {
  const p = state.profile || {};
  
  // Load draft if exists
  const draft = await loadFormDraft('profile');
  const data = draft || p;
  
  $('#profile-fullname').value = data.full_name || '';
  $('#profile-phone').value = data.phone || '';
  $('#profile-address').value = data.address || '';
  $('#profile-birth').value = data.birth_date || '';
  $('#profile-gender').value = data.gender || '';
  $('#profile-education').value = data.education || '';
  $('#profile-job').value = data.job_interest || '';
  $('#profile-marital').value = data.marital_status || '';
  $('#profile-religion').value = data.religion || '';
  
  if (draft) {
    toast('info', 'Draft Ditemukan', 'Data terakhir yang belum disimpan telah dimuat');
  }
}

// Auto-save on profile form
$('#form-profile').addEventListener('input', (e) => {
  const data = {
    full_name: $('#profile-fullname').value,
    phone: $('#profile-phone').value,
    address: $('#profile-address').value,
    birth_date: $('#profile-birth').value,
    gender: $('#profile-gender').value,
    education: $('#profile-education').value,
    job_interest: $('#profile-job').value,
    marital_status: $('#profile-marital').value,
    religion: $('#profile-religion').value
  };
  autoSaveForm('profile', data);
});

$('#form-profile').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateForm(e.target)) return;
  
  const btn = e.target.querySelector('button[type="submit"]');
  setLoading(btn, true);

  const updates = {
    id: state.user.id,
    full_name: $('#profile-fullname').value.trim(),
    phone: $('#profile-phone').value.trim(),
    address: $('#profile-address').value.trim(),
    birth_date: $('#profile-birth').value || null,
    gender: $('#profile-gender').value || null,
    education: $('#profile-education').value || null,
    job_interest: $('#profile-job').value.trim(),
    marital_status: $('#profile-marital').value || null,
    religion: $('#profile-religion').value || null,
    updated_at: new Date().toISOString()
  };

  try {
    const { error } = await supabase.from('profiles').upsert(updates);
    setLoading(btn, false);

    if (error) {
      console.error('Save profile error:', error);
      toast('error', 'Gagal Menyimpan', error.message);
      return;
    }

    // Bersihkan draft — dibungkus try terpisah supaya kalau baris ini gagal
    // (mis. tabel form_drafts / RLS bermasalah), profil yang SUDAH tersimpan
    // di atas tidak ikut dianggap gagal dan tetap menampilkan toast sukses.
    try {
      await supabase.from('form_drafts').delete().eq('user_id', state.user.id).eq('form_key', 'profile');
    } catch (draftErr) {
      console.error('Clear draft error:', draftErr);
    }

    state.profile = { ...state.profile, ...updates };
    $('#welcome-name').textContent = updates.full_name;
    $('#sidebar-name').textContent = updates.full_name;
    $('#profile-name-text').textContent = updates.full_name;
    toast('success', 'Profil Diperbarui');
  } catch (err) {
    setLoading(btn, false);
    console.error('Save profile error:', err);
    toast('error', 'Error', 'Terjadi kesalahan');
  }
});

$('#avatar-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    toast('error', 'File terlalu besar', 'Maks 2MB');
    return;
  }

  const ext = file.name.split('.').pop();
  const path = `${state.user.id}/avatar-${Date.now()}.${ext}`;

  try {
    const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });

    if (upErr) {
      toast('error', 'Upload Gagal', upErr.message);
      return;
    }

    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
    const avatarUrl = urlData.publicUrl;

    const { error: dbErr } = await supabase.from('profiles').update({ avatar_url: avatarUrl }).eq('id', state.user.id);

    if (dbErr) {
      toast('error', 'Gagal', dbErr.message);
      return;
    }

    state.profile.avatar_url = avatarUrl;
    ['#sidebar-avatar', '#profile-avatar-img'].forEach(sel => {
      const img = $(sel);
      if (img) img.src = avatarUrl;
    });
    toast('success', 'Avatar Diperbarui');
  } catch (err) {
    toast('error', 'Error', 'Gagal mengupload avatar');
  }
});

/* ============================================ */
/* LOWONGAN KERJA */
/* ============================================ */
async function loadLowongan() {
  try {
    const { data: countries } = await supabase.from('countries').select('*').eq('is_active', true).order('name');
    
    const countrySelect = $('#lowongan-country-filter');
    countrySelect.innerHTML = '<option value="">Semua Negara</option>';
    (countries || []).forEach(c => {
      countrySelect.innerHTML += `<option value="${c.id}">${c.flag_emoji || ''} ${escapeHtml(c.name)}</option>`;
    });

    await fetchLowongan();
  } catch (err) {
    console.error('Load lowongan error:', err);
  }
}

async function fetchLowongan() {
  let query = supabase
    .from('job_positions')
    .select('*, countries(name, flag_emoji, code)')
    .eq('is_active', true);

  const countryFilter = $('#lowongan-country-filter').value;
  if (countryFilter) query = query.eq('country_id', countryFilter);

  const search = $('#lowongan-search').value.trim().toLowerCase();
  
  const { data, error } = await query.order('created_at', { ascending: false });

  const container = $('#lowongan-list');
  
  if (error || !data || data.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1/-1;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
        <h4>Tidak ada lowongan</h4>
        <p>Lowongan kerja akan muncul di sini</p>
      </div>
    `;
    return;
  }

  let filtered = data;
  if (search) {
    filtered = data.filter(j => j.title.toLowerCase().includes(search) || j.category?.toLowerCase().includes(search));
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1/-1;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <h4>Tidak ditemukan</h4>
        <p>Coba kata kunci lain</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(j => {
    const quotaPercent = j.quota > 0 ? Math.round((j.filled / j.quota) * 100) : 0;
    const salaryRange = j.salary_min && j.salary_max 
      ? `${formatCurrency(j.salary_min, j.currency)} - ${formatCurrency(j.salary_max, j.currency)}`
      : 'Negosiasi';
    
    return `
      <div class="job-card">
        <div class="job-card-header">
          <div class="job-card-flag">${j.countries?.flag_emoji || '🌍'}</div>
          <div class="job-card-country">${escapeHtml(j.countries?.name || 'N/A')}</div>
          <div class="job-card-title">${escapeHtml(j.title)}</div>
          ${j.category ? `<span class="job-card-category">${escapeHtml(j.category)}</span>` : ''}
        </div>
        <div class="job-card-body">
          <div class="job-card-info">
            <div class="job-card-info-row">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <span>Estimasi: <strong>${j.estimated_departure || '-'}</strong></span>
            </div>
          </div>
          <div class="job-card-salary">
            <div class="job-card-salary-label">Kisaran Gaji per Bulan</div>
            <div class="job-card-salary-value">${salaryRange}</div>
          </div>
          ${j.requirements && j.requirements.length > 0 ? `
            <div class="job-card-requirements">
              <h4>Persyaratan:</h4>
              <ul>
                ${j.requirements.slice(0, 5).map(r => `<li>${escapeHtml(r)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          <div class="job-card-quota">
            <span>Kuota:</span>
            <div class="job-card-quota-bar">
              <div class="job-card-quota-fill" style="width: ${quotaPercent}%"></div>
            </div>
            <span><strong>${j.filled || 0}/${j.quota || 0}</strong></span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

$('#lowongan-search').addEventListener('input', fetchLowongan);
$('#lowongan-country-filter').addEventListener('change', fetchLowongan);

/* ============================================ */
/* DOKUMEN CHECKLIST */
/* ============================================ */
async function loadDocumentsChecklist() {
  try {
    const { data: docs } = await supabase
      .from('documents')
      .select('*')
      .eq('user_id', state.user.id);

    const docsMap = {};
    (docs || []).forEach(d => { docsMap[d.doc_type] = d; });

    const completedCount = (docs || []).filter(d => d.status === 'approved').length;
    const percent = Math.round((completedCount / DOC_TYPES.length) * 100);
    
    $('#doc-progress-text').textContent = `${completedCount}/${DOC_TYPES.length} Lengkap`;
    $('#doc-progress-bar').style.width = percent + '%';

    const container = $('#docs-checklist');
    container.innerHTML = DOC_TYPES.map(docType => {
      const doc = docsMap[docType];
      const status = doc?.status || 'empty';
      const statusLabel = {
        empty: 'Belum Upload',
        pending: 'Menunggu Review',
        approved: 'Disetujui',
        rejected: 'Ditolak'
      }[status];

      return `
        <div class="doc-item status-${status}">
          <div class="doc-item-header">
            <div class="doc-item-title">${docType}</div>
            <div class="doc-item-status ${status}">
              ${status === 'approved' ? '✓' : status === 'rejected' ? '✗' : status === 'pending' ? '⏳' : '○'}
              ${statusLabel}
            </div>
          </div>
          ${doc ? `
            <div class="doc-item-preview">
              <button class="btn-view" onclick="previewDocument('${doc.file_url}', '${docType}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                Lihat
              </button>
              ${status === 'rejected' ? `
                <button class="btn-reupload" onclick="openUploadModal('${docType}')">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  Upload Ulang
                </button>
              ` : ''}
            </div>
            ${status === 'rejected' && doc.rejection_reason ? `
              <div class="doc-item-reason">
                <strong>Alasan Penolakan:</strong>
                ${escapeHtml(doc.rejection_reason)}
              </div>
            ` : ''}
          ` : `
            <div class="doc-item-preview">
              <button class="btn-upload" onclick="openUploadModal('${docType}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Upload
              </button>
            </div>
          `}
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Load docs error:', err);
  }
}

window.previewDocument = function(url, title) {
  const modal = $('#preview-modal');
  const body = $('#preview-body');

  // Kalau dipanggil dari dalam modal Detail Peserta yang sedang terbuka
  // (klik dokumen di grid "Dokumen"), tandai supaya tombol close nanti
  // kembali ke Detail Peserta, bukan menutup modal sepenuhnya.
  state.adminDetail.previewReturnsToDetail =
    !!state.adminDetail.activeUserId && body.querySelector('.detail-peserta') !== null;

  $('#preview-title').textContent = title;
  
  const isImage = /\.(jpg|jpeg|png|gif)$/i.test(url);
  const isPdf = /\.pdf$/i.test(url);
  
  if (isImage) {
    body.innerHTML = `<img src="${url}" alt="${escapeHtml(title)}" />`;
  } else if (isPdf) {
    body.innerHTML = `<iframe src="${url}"></iframe>`;
  } else {
    body.innerHTML = `<div class="empty-state"><p>Preview tidak tersedia</p><a href="${url}" target="_blank" class="link">Download File</a></div>`;
  }
  
  show(modal);
};

function closePreviewModal() {
  // Jika modal preview dokumen ini dibuka dari dalam Detail Peserta,
  // kembali ke Detail Peserta alih-alih menutup modal sepenuhnya.
  if (state.adminDetail.previewReturnsToDetail && state.adminDetail.activeUserId) {
    state.adminDetail.previewReturnsToDetail = false;
    viewParticipantDetail(state.adminDetail.activeUserId);
    return;
  }
  state.adminDetail.previewReturnsToDetail = false;
  hide($('#preview-modal'));
  state.adminDetail.activeUserId = null;
  closeAdminChatChannel();
}

function closeAdminChatChannel() {
  if (state.adminChat.channel) {
    supabase.removeChannel(state.adminChat.channel);
    state.adminChat.channel = null;
  }
  state.adminChat.userId = null;
}

$('#preview-close').addEventListener('click', closePreviewModal);
$$('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
      if (e.target.closest('#preview-modal')) {
        closePreviewModal();
      } else {
        hide($('#preview-modal'));
        state.adminDetail.previewReturnsToDetail = false;
        state.adminDetail.activeUserId = null;
      }
      if (activeConfirmCleanup) activeConfirmCleanup();
      else hide($('#confirm-modal'));
    }
  });
});

window.openUploadModal = function(docType) {
  const modal = $('#preview-modal');
  const body = $('#preview-body');
  $('#preview-title').textContent = `Upload ${docType}`;
  
  body.innerHTML = `
    <div class="upload-modal-content">
      <div class="upload-zone" id="modal-upload-zone" style="margin-bottom: 16px;">
        <div id="modal-upload-placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <h3>Drag & Drop atau Klik</h3>
          <p>Maks. 5MB (PDF, JPG, PNG)</p>
        </div>
        <div id="modal-preview" class="upload-preview hidden">
          <img id="modal-preview-img" class="hidden" alt="Preview" />
          <div class="preview-info">
            <svg id="modal-preview-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span id="modal-preview-name">file.pdf</span>
          </div>
        </div>
        <input type="file" id="modal-file-input" accept=".pdf,.jpg,.jpeg,.png" class="hidden" />
      </div>
      <div class="ocr-status hidden" id="modal-ocr-checking">
        <span class="spinner"></span> Memeriksa isi dokumen...
      </div>
      <div class="ocr-warning hidden" id="modal-ocr-warning">
        <strong>⚠️ Dokumen tidak terdeteksi sebagai <span id="modal-ocr-doctype"></span></strong>
        <p>Pastikan file yang diupload sudah benar. Anda tetap bisa lanjut jika yakin file ini sudah sesuai.</p>
        <label class="ocr-override-label">
          <input type="checkbox" id="modal-ocr-override" />
          Saya yakin file ini sudah benar, tetap upload
        </label>
      </div>
      <div class="upload-progress hidden" id="modal-upload-progress">
        <div class="upload-progress-bar">
          <div class="upload-progress-fill" id="modal-progress-fill" style="width: 0%"></div>
        </div>
        <div class="upload-progress-text" id="modal-progress-text">0%</div>
      </div>
      <button class="btn btn-primary btn-block" id="modal-upload-btn">
        <span class="btn-text">Upload Dokumen</span>
        <span class="btn-loader hidden"></span>
      </button>
    </div>
  `;
  
  show(modal);

  // Mulai siapkan worker OCR di background begitu modal dibuka (kalau dokumen ini
  // memang dicek OCR), supaya saat user selesai pilih file, worker sudah/lagi siap
  // -> tidak menunggu proses inisialisasi dari nol setelah file dipilih.
  if (DOC_OCR_KEYWORDS[docType] && typeof Tesseract !== 'undefined') {
    getTesseractWorker().catch(() => {});
  }
  
  const zone = $('#modal-upload-zone');
  const input = $('#modal-file-input');
  let selectedFile = null;
  
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleModalFileSelect(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', (e) => {
    if (e.target.files[0]) handleModalFileSelect(e.target.files[0]);
  });
  
  let ocrPassed = true; // default true (docs without keyword rules, or PDFs, skip check)

  function handleModalFileSelect(file) {
    if (file.size > 5 * 1024 * 1024) {
      toast('error', 'File terlalu besar', 'Maks 5MB');
      return;
    }
    selectedFile = file;
    ocrPassed = true;
    $('#modal-preview-name').textContent = file.name;
    hide($('#modal-ocr-warning'));
    $('#modal-ocr-override').checked = false;

    const imgEl = $('#modal-preview-img');
    const iconEl = $('#modal-preview-icon');

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        imgEl.src = e.target.result;
        show(imgEl);
        hide(iconEl);
      };
      reader.readAsDataURL(file);
    } else {
      imgEl.removeAttribute('src');
      hide(imgEl);
      show(iconEl);
    }

    hide($('#modal-upload-placeholder'));
    show($('#modal-preview'));

    runOcrCheck(file);
  }

  async function runOcrCheck(file) {
    const keywordGroups = DOC_OCR_KEYWORDS[docType];
    // Skip: bukan tipe dokumen bertulisan (foto) atau bukan gambar (PDF) atau lib belum termuat
    if (!keywordGroups || !file.type.startsWith('image/') || typeof Tesseract === 'undefined') return;

    const btn = $('#modal-upload-btn');
    const checkingEl = $('#modal-ocr-checking');
    setLoading(btn, false);
    btn.disabled = true;
    show(checkingEl);

    try {
      const ocrImage = await downscaleImageForOcr(file);
      const worker = await getTesseractWorker();
      const { data } = await worker.recognize(ocrImage);
      const text = (data.text || '').toUpperCase();

      const matched = keywordGroups.every(group => group.some(kw => text.includes(kw)));

      if (!matched) {
        ocrPassed = false;
        $('#modal-ocr-doctype').textContent = docType;
        show($('#modal-ocr-warning'));
      } else {
        ocrPassed = true;
      }
    } catch (err) {
      // Gagal OCR (mis. offline/CDN blocked/worker error) -> jangan blokir user,
      // lewati pengecekan. Reset worker supaya percobaan upload berikutnya bikin
      // worker baru (siapa tahu error-nya karena worker sebelumnya rusak).
      console.warn('OCR check failed, skipping validation:', err);
      tesseractWorkerPromise = null;
      ocrPassed = true;
    } finally {
      hide(checkingEl);
      btn.disabled = false;
    }
  }

  $('#modal-ocr-override').addEventListener('change', (e) => {
    ocrPassed = e.target.checked;
  });

  $('#modal-upload-btn').addEventListener('click', async () => {
    if (!selectedFile) {
      toast('warning', 'Pilih file dulu');
      return;
    }
    if (!ocrPassed) {
      toast('warning', 'Dokumen belum sesuai', 'Centang konfirmasi jika yakin file sudah benar');
      return;
    }
    
    const btn = $('#modal-upload-btn');
    setLoading(btn, true);
    show($('#modal-upload-progress'));
    
    // Kecilkan dulu file gambar sebelum dikirim -> ini yang paling menentukan
    // cepat/lambatnya upload di jaringan mobile, bukan proses pengecekan OCR.
    const fileToUpload = await compressImageForUpload(selectedFile);
    
    const ext = fileToUpload.name.split('.').pop();
    const path = `${state.user.id}/${docType}-${Date.now()}.${ext}`;
    
    let progress = 0;
    const progressInterval = setInterval(() => {
      progress += 10;
      if (progress <= 90) {
        $('#modal-progress-fill').style.width = progress + '%';
        $('#modal-progress-text').textContent = progress + '%';
      }
    }, 100);
    
    try {
      // Upload file & cek dokumen lama dijalankan BARENGAN (bukan berurutan),
      // karena dua-duanya tidak saling bergantung -> hemat satu round-trip jaringan.
      const [{ error: upErr }, { data: existing }] = await Promise.all([
        supabase.storage.from('documents').upload(path, fileToUpload),
        supabase
          .from('documents')
          .select('id')
          .eq('user_id', state.user.id)
          .eq('doc_type', docType)
          .single()
      ]);
      clearInterval(progressInterval);
      
      if (upErr) {
        setLoading(btn, false);
        hide($('#modal-upload-progress'));
        toast('error', 'Upload Gagal', upErr.message);
        return;
      }
      
      $('#modal-progress-fill').style.width = '100%';
      $('#modal-progress-text').textContent = '100%';
      
      const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path);
      
      let dbErr;
      if (existing) {
        const { error } = await supabase
          .from('documents')
          .update({
            file_url: urlData.publicUrl,
            file_name: fileToUpload.name,
            status: 'pending',
            rejection_reason: null,
            reviewed_at: new Date().toISOString()
          })
          .eq('id', existing.id);
        dbErr = error;
      } else {
        const { error } = await supabase.from('documents').insert({
          user_id: state.user.id,
          doc_type: docType,
          file_url: urlData.publicUrl,
          file_name: fileToUpload.name,
          status: 'pending'
        });
        dbErr = error;
      }
      
      setLoading(btn, false);
      hide($('#modal-upload-progress'));
      
      if (dbErr) {
        toast('error', 'Gagal menyimpan', dbErr.message);
        return;
      }
      
      toast('success', 'Dokumen Terupload', 'Menunggu review admin');
      hide(modal);
      loadDocumentsChecklist();
    } catch (err) {
      clearInterval(progressInterval);
      setLoading(btn, false);
      hide($('#modal-upload-progress'));
      toast('error', 'Error', 'Terjadi kesalahan saat upload');
    }
  });
};

/* ============================================ */
/* PROGRESS */
/* ============================================ */
async function loadProgress() {
  try {
    const [{ data: statusData }, { data: placementData }] = await Promise.all([
      supabase.from('participant_status').select('*').eq('user_id', state.user.id).maybeSingle(),
      supabase.from('placements').select('departure_date').eq('user_id', state.user.id).maybeSingle()
    ]);

    const currentStep = statusData?.current_step || 1;
    const finalStep = TIMELINE_STEPS[TIMELINE_STEPS.length - 1].step;
    const percent = Math.round(((currentStep - 1) / (TIMELINE_STEPS.length - 1)) * 100);
    const departureDate = placementData?.departure_date || null;

    $('#progress-fill').style.width = percent + '%';

    if (currentStep >= finalStep && departureDate) {
      const days = daysUntilDate(departureDate);
      $('#progress-percent').textContent = days > 0 ? `H-${days}` : (days === 0 ? 'Hari H' : 'Berangkat');
      $('#progress-status').textContent = days > 0
        ? `Keberangkatan dalam ${days} hari (${formatDate(departureDate)}) 🎉`
        : days === 0
        ? `Hari ini jadwal keberangkatan Anda (${formatDate(departureDate)}) 🎉`
        : `Sudah melewati tanggal keberangkatan (${formatDate(departureDate)})`;
    } else if (currentStep >= finalStep) {
      $('#progress-percent').textContent = 'SELESAI';
      $('#progress-status').textContent = 'Semua tahapan selesai — menunggu jadwal keberangkatan dari admin 🎉';
    } else {
      $('#progress-percent').textContent = percent + '%';
      const currentStepInfo = TIMELINE_STEPS.find(s => s.step === currentStep);
      $('#progress-status').textContent = currentStepInfo
        ? `Sedang: ${currentStepInfo.title}`
        : 'Memuat data...';
    }

    const container = $('#progress-timeline');
    container.innerHTML = TIMELINE_STEPS.map((step, idx) => {
      const isFinalStepDone = step.step === finalStep && currentStep >= finalStep && !!departureDate;
      const isCompleted = step.step < currentStep || isFinalStepDone;
      const isCurrent = step.step === currentStep && !isFinalStepDone;
      const statusClass = isCompleted ? 'completed' : isCurrent ? 'current' : 'upcoming';
      const statusLabel = isCompleted ? 'Selesai' : isCurrent ? 'Sedang Diproses' : 'Menunggu';

      const icon = isCompleted
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
        : isCurrent
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
        : `<span>${step.step}</span>`;

      return `
        <div class="timeline-item ${statusClass}" style="animation-delay:${idx * 60}ms">
          <div class="timeline-icon">${icon}</div>
          <div class="timeline-body">
            <div class="timeline-title-row">
              <div class="timeline-title">${step.title}</div>
              <span class="timeline-badge ${statusClass}">${statusLabel}</span>
            </div>
            <div class="timeline-desc">${step.desc}</div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Load progress error:', err);
  }
}

/* ============================================ */
/* JADWAL */
/* ============================================ */
async function loadSchedules() {
  try {
    let query = supabase
      .from('schedules')
      .select('*')
      .eq('user_id', state.user.id)
      .order('schedule_date', { ascending: true });

    if (state.scheduleFilter !== 'all') {
      query = query.eq('schedule_type', state.scheduleFilter);
    }

    const { data, error } = await query;

    const container = $('#schedules-list');
    if (error || !data || data.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <h4>Tidak ada jadwal</h4>
          <p>Jadwal akan muncul di sini setelah admin mengatur</p>
        </div>
      `;
      return;
    }

    container.innerHTML = data.map(s => `
      <div class="schedule-card type-${s.schedule_type}">
        <div class="schedule-card-header">
          <div class="schedule-card-title">${escapeHtml(s.title)}</div>
          <div class="schedule-card-type">${s.schedule_type}</div>
        </div>
        <div class="schedule-card-details">
          <div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            ${formatDate(s.schedule_date)} ${s.schedule_time ? '• ' + formatTime(s.schedule_date + ' ' + s.schedule_time) : ''}
          </div>
          ${s.location ? `
            <div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              ${escapeHtml(s.location)}
            </div>
          ` : ''}
          ${s.description ? `
            <div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>
              ${escapeHtml(s.description)}
            </div>
          ` : ''}
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Load schedules error:', err);
  }
}

$$('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.scheduleFilter = btn.dataset.filter;
    loadSchedules();
  });
});

/* ============================================ */
/* NOTIFIKASI */
/* ============================================ */
async function loadNotifications() {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', state.user.id)
      .order('created_at', { ascending: false });

    const container = $('#notif-list');
    if (error || !data || data.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/></svg>
          <h4>Tidak ada notifikasi</h4>
          <p>Notifikasi akan muncul di sini</p>
        </div>
      `;
      return;
    }

    container.innerHTML = data.map(n => `
      <div class="card-item ${!n.is_read ? 'priority-high' : ''}" style="opacity: ${n.is_read ? '0.7' : '1'}">
        <div class="card-item-header">
          <div class="card-item-title">${escapeHtml(n.title)}</div>
          <span class="status-badge status-${n.type === 'success' ? 'approved' : n.type === 'error' ? 'rejected' : 'in_progress'}">${n.type}</span>
        </div>
        <div class="card-item-body">${escapeHtml(n.message || '')}</div>
        <div class="card-item-meta">${formatDate(n.created_at)} ${formatTime(n.created_at)}</div>
      </div>
    `).join('');

    updateNotifBadge();
  } catch (err) {
    console.error('Load notifications error:', err);
  }
}

async function updateNotifBadge() {
  try {
    const { count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', state.user.id)
      .eq('is_read', false);

    const badge = $('#notif-badge');
    if (badge) {
      badge.textContent = count || 0;
      badge.style.display = count > 0 ? 'flex' : 'none';
    }
  } catch (err) {
    console.error('Update badge error:', err);
  }
}

$('#btn-mark-all-read').addEventListener('click', async () => {
  try {
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', state.user.id)
      .eq('is_read', false);
    toast('success', 'Semua ditandai dibaca');
    loadNotifications();
  } catch (err) {
    toast('error', 'Error', 'Gagal menandai dibaca');
  }
});

/* ============================================ */
/* CHAT DENGAN ATTACHMENT */
/* ============================================ */
async function loadChat() {
  try {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('user_id', state.user.id)
      .order('created_at', { ascending: true });

    const container = $('#chat-messages');
    if (error || !data || data.length === 0) {
      container.innerHTML = `
        <div class="chat-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <p>Belum ada pesan. Mulai percakapan!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = data.map(renderChatBubble).join('');
    container.scrollTop = container.scrollHeight;

    await supabase
      .from('chat_messages')
      .update({ is_read: true })
      .eq('user_id', state.user.id)
      .eq('sender_role', 'admin')
      .eq('is_read', false);
  } catch (err) {
    console.error('Load chat error:', err);
  }
}

// FIX: tabel `chat_messages` di Supabase ternyata tidak punya kolom
// `attachment_name` MAUPUN `attachment_type`/`attachment_url` (keduanya
// memicu error "Could not find the '...' column of 'chat_messages' in the
// schema cache" saat insert). Daripada terus menambah/mengurangi kolom yang
// belum tentu ada di skema, info lampiran sekarang "ditumpangkan" di dalam
// teks `message` itu sendiri lewat penanda [[ATT:type|url]] di baris
// terakhir, lalu diuraikan lagi saat render. Dengan begitu fitur lampiran
// tetap jalan tanpa butuh kolom tambahan apa pun di database.
const CHAT_ATTACHMENT_MARKER = /\n?\[\[ATT:(image|pdf)\|([^\]]+)\]\]$/;

function embedAttachmentMarker(message, type, url) {
  const base = message || '';
  return `${base}\n[[ATT:${type}|${url}]]`;
}

function parseChatMessage(m) {
  // Kompatibel mundur: kalau suatu saat kolom attachment_url/attachment_type
  // memang ada & terisi di baris tertentu, tetap dipakai duluan.
  if (m.attachment_url) {
    return { text: m.message || '', attachmentUrl: m.attachment_url, attachmentType: m.attachment_type || 'pdf' };
  }
  const raw = m.message || '';
  const match = raw.match(CHAT_ATTACHMENT_MARKER);
  if (!match) return { text: raw, attachmentUrl: null, attachmentType: null };
  return { text: raw.replace(CHAT_ATTACHMENT_MARKER, ''), attachmentUrl: match[2], attachmentType: match[1] };
}

// FIX: kolom `attachment_name` tidak ada di tabel `chat_messages` (skema
// Supabase belum punya kolom ini), jadi nama file diturunkan dari URL saja
// supaya tampilan lampiran tetap punya label yang masuk akal tanpa perlu
// menyimpan kolom tambahan yang bisa memicu error "Could not find the
// 'attachment_name' column of 'chat_messages' in the schema cache".
function getAttachmentDisplayName(attachmentUrl) {
  if (!attachmentUrl) return 'File';
  try {
    const clean = attachmentUrl.split('?')[0];
    const rawName = decodeURIComponent(clean.substring(clean.lastIndexOf('/') + 1));
    // Nama file diupload dengan pola "chat-<timestamp>.<ext>"; buang prefix itu
    // supaya yang tampil ke user cuma "Lampiran.<ext>" yang lebih rapi.
    const m2 = rawName.match(/^chat-\d+\.(.+)$/i);
    return m2 ? `Lampiran.${m2[1]}` : (rawName || 'File');
  } catch (e) {
    return 'File';
  }
}

function renderChatBubble(m) {
  const isUser = m.sender_role === 'user';
  const { text, attachmentUrl, attachmentType } = parseChatMessage(m);
  let attachmentHtml = '';
  
  if (attachmentUrl) {
    if (attachmentType === 'image') {
      attachmentHtml = `<div class="attachment" onclick="previewDocument('${attachmentUrl}', 'Lampiran')"><img src="${attachmentUrl}" alt="attachment" /></div>`;
    } else {
      attachmentHtml = `
        <a href="${attachmentUrl}" target="_blank" class="attachment">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span>${escapeHtml(getAttachmentDisplayName(attachmentUrl))}</span>
        </a>
      `;
    }
  }
  
  return `
    <div class="chat-bubble ${isUser ? 'user' : 'admin'}">
      ${text ? escapeHtml(text) : ''}
      ${attachmentHtml}
      <span class="chat-time">${formatTime(m.created_at)}</span>
    </div>
  `;
}

// Chat attachment handling
$('#chat-attach-btn').addEventListener('click', () => {
  $('#chat-file-input').click();
});

$('#chat-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  if (file.size > 5 * 1024 * 1024) {
    toast('error', 'File terlalu besar', 'Maks 5MB');
    return;
  }
  
  state.chatAttachment = file;
  $('#chat-attachment-name').textContent = file.name;
  show($('#chat-attachment-preview'));
});

$('#chat-attachment-remove').addEventListener('click', () => {
  state.chatAttachment = null;
  $('#chat-file-input').value = '';
  hide($('#chat-attachment-preview'));
});

$('#form-chat').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#chat-message');
  const message = input.value.trim();
  
  if (!message && !state.chatAttachment) return;

  input.value = '';
  const container = $('#chat-messages');
  const empty = container.querySelector('.chat-empty');
  if (empty) empty.remove();

  // Optimistic UI
  const tempBubble = document.createElement('div');
  tempBubble.className = 'chat-bubble user';
  tempBubble.innerHTML = `${escapeHtml(message)}<span class="chat-time">mengirim...</span>`;
  container.appendChild(tempBubble);
  container.scrollTop = container.scrollHeight;

  try {
    let attachmentUrl = null;
    let attachmentType = null;
    
    if (state.chatAttachment) {
      const ext = state.chatAttachment.name.split('.').pop();
      const path = `${state.user.id}/chat-${Date.now()}.${ext}`;
      
      const isImage = ['jpg', 'jpeg', 'png', 'gif'].includes(ext.toLowerCase());
      
      const { error: upErr } = await supabase.storage.from('documents').upload(path, state.chatAttachment);
      
      if (upErr) {
        throw upErr;
      }
      
      const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path);
      attachmentUrl = urlData.publicUrl;
      attachmentType = isImage ? 'image' : 'pdf';
    }

    const { error } = await supabase.from('chat_messages').insert({
      user_id: state.user.id,
      sender_id: state.user.id,
      sender_role: 'user',
      message: attachmentUrl
        ? embedAttachmentMarker(message, attachmentType, attachmentUrl)
        : (message || '[Lampiran]')
    });

    if (error) throw error;

    tempBubble.querySelector('.chat-time').textContent = formatTime(new Date());
    
    // Reset attachment
    state.chatAttachment = null;
    $('#chat-file-input').value = '';
    hide($('#chat-attachment-preview'));
  } catch (err) {
    tempBubble.remove();
    toast('error', 'Gagal mengirim', err.message || 'Terjadi kesalahan');
    input.value = message;
  }
});

/* ============================================ */
/* PENGUMUMAN */
/* ============================================ */
async function loadAnnouncements() {
  try {
    const { data, error } = await supabase
      .from('announcements')
      .select('*')
      .eq('is_published', true)
      .order('created_at', { ascending: false });

    const container = $('#announcements-list');
    if (error || !data || data.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l18-5v12L3 14v-3z"/></svg>
          <h4>Belum ada pengumuman</h4>
          <p>Pengumuman resmi akan muncul di sini</p>
        </div>
      `;
      return;
    }

    container.innerHTML = data.map(a => `
      <div class="card-item priority-${a.priority}">
        <div class="card-item-header">
          <div class="card-item-title">${escapeHtml(a.title)}</div>
          <span class="status-badge status-${a.priority === 'urgent' ? 'rejected' : a.priority === 'high' ? 'pending' : 'in_progress'}">${a.priority}</span>
        </div>
        <div class="card-item-body">${escapeHtml(a.content || '')}</div>
        <div class="card-item-meta">${formatDate(a.created_at)}</div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Load announcements error:', err);
  }
}

/* ============================================ */
/* ADMIN DASHBOARD */
/* ============================================ */
async function loadAdminDashboard() {
  try {
    const [profilesRes, statusesRes] = await Promise.all([
      supabase.from('profiles').select('id, documents!user_id(status)').eq('role', 'user'),
      supabase.from('participant_status').select('user_id, current_step')
    ]);

    if (profilesRes.error) console.error('Dashboard profiles error:', profilesRes.error);
    if (statusesRes.error) console.error('Dashboard statuses error:', statusesRes.error);

    const profiles = profilesRes.data || [];
    const statusMap = {};
    (statusesRes.data || []).forEach(s => { statusMap[s.user_id] = s.current_step; });

    // Tahap akhir timeline (saat ini "Penempatan") dihitung dinamis dari
    // TIMELINE_STEPS supaya tetap konsisten kalau daftar tahapan berubah lagi.
    const finalStep = TIMELINE_STEPS[TIMELINE_STEPS.length - 1].step;

    let countPendaftaran = 0; // masih di tahap Pendaftaran (step 1 / belum ada participant_status)
    let countReview = 0;      // Verifikasi s.d. sebelum tahap akhir (step 2 s.d. finalStep - 1)
    let countPenempatan = 0;  // sudah mencapai tahap akhir (Penempatan)
    let countDitolak = 0;     // punya minimal 1 dokumen yang ditolak

    profiles.forEach(p => {
      const step = statusMap[p.id] || 1;
      const docs = p.documents || [];
      const hasRejected = docs.some(d => d.status === 'rejected');

      if (hasRejected) countDitolak++;

      if (step <= 1) countPendaftaran++;
      else if (step < finalStep) countReview++;
      else countPenempatan++;
    });

    $('#admin-stat-total').textContent = profiles.length;
    $('#admin-stat-pendaftaran').textContent = countPendaftaran;
    $('#admin-stat-review').textContent = countReview;
    $('#admin-stat-approved').textContent = countPenempatan;
    $('#admin-stat-rejected').textContent = countDitolak;

    updateUnverifiedBadge();
  } catch (err) {
    console.error('Load admin dashboard error:', err);
  }
}

/* ============================================ */
/* ADMIN KELOLA PESERTA */
/* ============================================ */
async function loadAdminPeserta() {
  try {
    const { data: profiles, error: profilesErr } = await supabase
      .from('profiles')
      .select('*, documents!user_id(status, doc_type)')
      .eq('role', 'user')
      .eq('email_verified', true);

    if (profilesErr) {
      console.error('Profiles query error:', profilesErr);
      toast('error', 'Gagal Memuat Peserta', profilesErr.message);
    }

    const { data: statuses, error: statusesErr } = await supabase
      .from('participant_status')
      .select('user_id, current_step');

    if (statusesErr) {
      console.error('Participant status query error:', statusesErr);
    }

    const statusMap = {};
    (statuses || []).forEach(s => { statusMap[s.user_id] = s.current_step; });

    // Jumlah pesan chat dari peserta yang belum dibaca admin, dipakai untuk
    // menampilkan titik notifikasi kecil di tombol Chat pada tabel.
    const { data: unreadChats, error: unreadChatsErr } = await supabase
      .from('chat_messages')
      .select('user_id')
      .eq('sender_role', 'user')
      .eq('is_read', false);

    if (unreadChatsErr) {
      console.error('Load unread chat error:', unreadChatsErr);
    }

    const unreadChatMap = {};
    (unreadChats || []).forEach(m => { unreadChatMap[m.user_id] = (unreadChatMap[m.user_id] || 0) + 1; });

    // Peserta yang sudah mencapai tahap akhir timeline (saat ini "Penempatan")
    // dipindah ke tab Penempatan, jadi tidak lagi ditampilkan di sini supaya
    // tabel Kelola Peserta fokus ke peserta yang masih berproses. Perpindahan
    // ini baru terjadi saat admin menekan tombol "Lanjut ke Penempatan" di
    // kolom Status (bukan lagi otomatis saat mencapai "Medical").
    const finalStep = TIMELINE_STEPS[TIMELINE_STEPS.length - 1].step;

    state.adminTable.data = (profiles || [])
      .filter(p => (statusMap[p.id] || 1) < finalStep)
      .map(p => {
      const docs = p.documents || [];
      const hasRejected = docs.some(d => d.status === 'rejected');
      const allApproved = docs.length > 0 && docs.every(d => d.status === 'approved');
      const approvedCount = docs.filter(d => d.status === 'approved').length;
      const uploadedCount = docs.length;

      let status = 'pending';
      if (hasRejected) status = 'rejected';
      else if (allApproved) status = 'approved';

      // Kelengkapan data profil: field-field yang ditampilkan di "Detail Peserta"
      // harus terisi semua. Kosong/null/string kosong dianggap belum diisi.
      // Dicatat labelnya satu-satu (bukan cuma true/false) supaya admin bisa lihat
      // persis field mana yang kosong lewat tooltip, tidak perlu nebak-nebak.
      const profileFieldChecks = [
        ['Telepon', p.phone],
        ['Tgl Lahir', p.birth_date],
        ['Jenis Kelamin', p.gender],
        ['Pendidikan', p.education],
        ['Status Nikah', p.marital_status],
        ['Agama', p.religion],
        ['Pekerjaan Diminati', p.job_interest],
        ['Alamat', p.address]
      ];
      const missingProfileFields = profileFieldChecks
        .filter(([, v]) => v === null || v === undefined || String(v).trim() === '')
        .map(([label]) => label);

      // Kelengkapan dokumen: semua jenis dokumen wajib sudah DIUPLOAD (belum tentu
      // sudah di-approve) -> dicatat jenis dokumen mana saja yang belum ada sama sekali.
      const uploadedDocTypes = docs.map(d => d.doc_type);
      const missingDocTypes = DOC_TYPES.filter(t => !uploadedDocTypes.includes(t));

      return {
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        phone: p.phone,
        current_step: statusMap[p.id] || 1,
        status,
        approvedDocs: approvedCount,
        uploadedDocs: uploadedCount,
        totalDocs: DOC_TYPES.length,
        missingProfileFields,
        missingDocTypes,
        isDataComplete: missingProfileFields.length === 0 && missingDocTypes.length === 0,
        unreadChat: unreadChatMap[p.id] || 0
      };
    });

    // Self-heal: kalau dokumen sudah disetujui semua tapi tahapan masih tersangkut
    // di step 1 (kasus lama karena participant_status belum pernah dibuat/ter-update),
    // betulkan otomatis di sini karena tombol Approve sudah tidak muncul lagi untuk
    // peserta yang statusnya sudah "approved".
    const stuck = state.adminTable.data.filter(p => p.status === 'approved' && p.current_step < 2);
    if (stuck.length > 0) {
      for (const p of stuck) {
        const { error: healErr } = await supabase
          .from('participant_status')
          .upsert({
            user_id: p.id,
            current_step: 2,
            step_verifikasi: true,
            updated_by: state.user.id,
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id' });

        if (healErr) {
          console.error('Gagal sinkronkan tahapan untuk', p.full_name, healErr);
        } else {
          p.current_step = 2;
        }
      }
    }

    applyAdminFilters();
  } catch (err) {
    console.error('Load admin peserta error:', err);
  }
}

function applyAdminFilters() {
  let filtered = [...state.adminTable.data];

  if (state.adminTable.search) {
    const search = state.adminTable.search.toLowerCase();
    filtered = filtered.filter(p => 
      p.full_name.toLowerCase().includes(search) ||
      p.email.toLowerCase().includes(search)
    );
  }

  if (state.adminTable.filterStatus) {
    filtered = filtered.filter(p => p.status === state.adminTable.filterStatus);
  }

  if (state.adminTable.filterStep) {
    filtered = filtered.filter(p => p.current_step === parseInt(state.adminTable.filterStep));
  }

  filtered.sort((a, b) => {
    const aVal = a[state.adminTable.sortField];
    const bVal = b[state.adminTable.sortField];
    const modifier = state.adminTable.sortDirection === 'asc' ? 1 : -1;
    
    if (typeof aVal === 'string') return aVal.localeCompare(bVal) * modifier;
    return (aVal - bVal) * modifier;
  });

  state.adminTable.filtered = filtered;
  renderAdminTable();
}

// Badge kolom Status di tabel Kelola Peserta. Tahapan sekarang murni linear dan
// readonly (lihat kolom Tahapan) — satu-satunya cara pindah tahap adalah lewat
// tombol di kolom Status ini, sesuai urutan: Pendaftaran -> Verifikasi -> Interview
// -> Administrasi -> Medical -> Penempatan.
// - uploadedDocs < totalDocs ATAU biodata belum lengkap (!isDataComplete): tampil
//   progress "X/N" (N = jumlah dokumen wajib, X = jumlah dokumen yang SUDAH DIUPLOAD,
//   bukan yang sudah di-approve) -> naik tiap kali peserta upload dokumen baru.
// - Semua dokumen sudah diupload (X/N penuh) DAN biodata sudah lengkap, tapi belum
//   semua dokumen di-approve admin: tampil badge KUNING "REVIEW" (data sudah siap
//   diperiksa oleh admin lewat modal Detail Peserta).
// - Dokumen sudah lengkap semua DAN sudah disetujui semua tapi current_step belum
//   sampai Interview (step 3): tampil tombol MERAH "APPROVE" -> panggil
//   finalizeApproveParticipant (Verifikasi -> Interview).
// - current_step Interview/Administrasi/Medical (3, 4, 5): tampil tombol "Lanjut ke ..."
//   -> panggil advanceParticipantStage untuk memajukan SATU tahap saja (tidak bisa loncat).
// - current_step sudah Penempatan (6): baris ini seharusnya sudah tersaring keluar dari
//   tabel Kelola Peserta (lihat finalStep filter di loadAdminPeserta), badge ini jaga-jaga saja.
const NEXT_STAGE_BUTTON = {
  3: { next: 4, label: 'Lanjut Administrasi' },
  4: { next: 5, label: 'Lanjut Medical' },
  5: { next: 6, label: 'Lanjut Penempatan' }
};

function renderPesertaStatusBadge(p) {
  const { approvedDocs, uploadedDocs, totalDocs, isDataComplete, current_step, id, full_name } = p;
  const safeName = escapeHtml(full_name).replace(/'/g, "\\'");

  if (uploadedDocs < totalDocs || !isDataComplete) {
    return `<span class="status-badge status-progress">${uploadedDocs}/${totalDocs}</span>`;
  }

  if (approvedDocs < totalDocs) {
    return `<span class="status-badge status-pending">REVIEW</span>`;
  }

  if (current_step < 3) {
    return `<button class="status-badge status-approve-btn" onclick="finalizeApproveParticipant('${id}', '${safeName}')">APPROVE</button>`;
  }

  const advance = NEXT_STAGE_BUTTON[current_step];
  if (advance) {
    return `<button class="status-badge status-advance-btn" onclick="advanceParticipantStage('${id}', ${current_step}, ${advance.next}, '${safeName}')">${advance.label}</button>`;
  }

  return `<span class="status-badge status-approved">Selesai</span>`;
}

function renderAdminTable() {
  const { filtered, page, perPage } = state.adminTable;
  const start = (page - 1) * perPage;
  const end = start + perPage;
  const pageData = filtered.slice(start, end);

  const tbody = $('#admin-table-body');
  
  if (pageData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-loading">Tidak ada data</td></tr>';
  } else {
    tbody.innerHTML = pageData.map((p, i) => `
      <tr>
        <td>${start + i + 1}</td>
        <td>${escapeHtml(p.full_name)}</td>
        <td>
          <span class="status-tahap status-tahap-${p.current_step}">${TIMELINE_STEPS.find(s => s.step === p.current_step)?.title || '-'}</span>
        </td>
        <td>${renderPesertaStatusBadge(p)}</td>
        <td>
          <div class="table-actions-cell">
            <div class="table-actions-group">
              <button class="btn-action ${p.isDataComplete ? '' : 'btn-action-incomplete'}" onclick="viewParticipantDetail('${p.id}')" ${p.isDataComplete ? '' : `title="Belum lengkap: ${escapeHtml([...p.missingProfileFields, ...p.missingDocTypes.map(t => 'Dok. ' + t)].join(', '))}"`}>Detail</button>
              <button class="btn-action btn-chat-action btn-icon-only ${p.unreadChat > 0 ? 'has-unread' : ''}" data-user-id="${p.id}" onclick="goToAdminChat('${p.id}', '${escapeHtml(p.full_name).replace(/'/g, "\\'")}', '${escapeHtml(p.email).replace(/'/g, "\\'")}')" title="Chat dengan Peserta" aria-label="Chat dengan Peserta">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              </button>
              <button class="btn-reject" onclick="rejectParticipant('${p.id}', '${escapeHtml(p.full_name).replace(/'/g, "\\'")}')" title="Tolak Peserta">Tolak</button>
            </div>
            <button class="btn-action btn-make-admin-action btn-icon-only" onclick="makeAdmin('${p.id}', '${escapeHtml(p.full_name).replace(/'/g, "\\'")}')" title="Jadikan Admin" aria-label="Jadikan Admin">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 3.5v5.5c0 5-3.4 8.7-8 11-4.6-2.3-8-6-8-11V5.5L12 2z"/><path d="m9 12 2 2 4-4"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  renderPagination();
}

// Majukan peserta SATU tahap (dipanggil dari tombol "Lanjut ke ..." di kolom
// Status pada tabel Kelola Peserta — lihat NEXT_STAGE_BUTTON di
// renderPesertaStatusBadge). Tahapan tidak lagi bisa diubah manual/loncat
// lewat dropdown; urutannya selalu linear: Interview -> Administrasi -> Medical
// -> Penempatan.
window.advanceParticipantStage = async function(userId, fromStep, toStep, fullName) {
  const fromTitle = TIMELINE_STEPS.find(s => s.step === fromStep)?.title || '-';
  const toTitle = TIMELINE_STEPS.find(s => s.step === toStep)?.title || '-';

  confirmDialog(
    'Lanjutkan Tahapan',
    `Pindahkan ${fullName} dari tahap "${fromTitle}" ke "${toTitle}"?`,
    async () => {
      try {
        const { error } = await supabase
          .from('participant_status')
          .upsert({
            user_id: userId,
            current_step: toStep,
            updated_by: state.user.id,
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id' });

        if (error) {
          toast('error', 'Gagal Update Tahapan', error.message);
          return;
        }

        await supabase.from('notifications').insert({
          user_id: userId,
          title: 'Tahapan Diperbarui',
          message: `Tahapan Anda saat ini: ${toTitle}`,
          type: 'success'
        });

        // update state lokal supaya konsisten sebelum reload penuh
        const participant = state.adminTable.data.find(p => p.id === userId);
        if (participant) participant.current_step = toStep;

        toast('success', 'Tahapan Diperbarui', toTitle);
        loadAdminPeserta();
      } catch (err) {
        console.error('Update tahapan gagal:', err);
        toast('error', 'Gagal Update Tahapan', 'Terjadi kesalahan, coba lagi.');
      }
    }
  );
};

/* ============================================ */
/* ADMIN CHAT DENGAN PESERTA */
/* Dibuka lewat tombol chat di sebelah tombol Detail pada tabel Kelola
   Peserta. Memakai tabel `chat_messages` yang sama dengan chat peserta
   (sender_role 'user' vs 'admin'), hanya saja di sini di-scope ke
   user_id peserta yang dipilih, bukan admin yang sedang login. */
window.openAdminChat = async function(userId, fullName) {
  const modal = $('#preview-modal');
  const body = $('#preview-body');

  state.adminChat.userId = userId;

  $('#preview-title').textContent = `Chat - ${fullName}`;
  body.innerHTML = `
    <div class="chat-container glass">
      <div class="chat-messages" id="admin-chat-messages">
        <div class="chat-empty"><p>Memuat pesan...</p></div>
      </div>
      <form class="chat-input" id="form-admin-chat" novalidate>
        <input type="text" id="admin-chat-message" placeholder="Ketik pesan ke peserta..." autocomplete="off" required />
        <button type="submit" class="btn btn-primary" aria-label="Kirim">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </form>
    </div>
  `;
  show(modal);

  $('#form-admin-chat').addEventListener('submit', (e) => {
    e.preventDefault();
    sendAdminChatMessage(userId);
  });

  await loadAdminChatMessages(userId);

  // Dengarkan pesan baru dari peserta ini secara realtime selama modal terbuka.
  if (state.adminChat.channel) {
    supabase.removeChannel(state.adminChat.channel);
    state.adminChat.channel = null;
  }
  state.adminChat.channel = supabase
    .channel('admin-chat-' + userId)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `user_id=eq.${userId}` },
      (payload) => {
        if (payload.new.sender_role !== 'admin' && state.adminChat.userId === userId) {
          loadAdminChatMessages(userId);
        }
      }
    )
    .subscribe();
};

async function sendAdminChatMessage(userId) {
  const input = $('#admin-chat-message');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  const container = $('#admin-chat-messages');
  const empty = container.querySelector('.chat-empty');
  if (empty) empty.remove();

  const tempBubble = document.createElement('div');
  tempBubble.className = 'chat-bubble user';
  tempBubble.innerHTML = `${escapeHtml(message)}<span class="chat-time">mengirim...</span>`;
  container.appendChild(tempBubble);
  container.scrollTop = container.scrollHeight;

  try {
    const { error } = await supabase.from('chat_messages').insert({
      user_id: userId,
      sender_id: state.user.id,
      sender_role: 'admin',
      message
    });

    if (error) throw error;

    tempBubble.querySelector('.chat-time').textContent = formatTime(new Date());

    await supabase.from('notifications').insert({
      user_id: userId,
      title: 'Pesan Baru dari Admin',
      message: message.length > 80 ? message.slice(0, 80) + '...' : message,
      type: 'info'
    });
  } catch (err) {
    tempBubble.remove();
    toast('error', 'Gagal Mengirim', err.message || 'Terjadi kesalahan');
    input.value = message;
  }
}

async function loadAdminChatMessages(userId) {
  try {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    const container = $('#admin-chat-messages');
    if (!container) return; // modal sudah ditutup / peserta lain sudah dibuka

    if (error) {
      console.error('Load admin chat error:', error);
    }

    if (!data || data.length === 0) {
      container.innerHTML = `
        <div class="chat-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <p>Belum ada pesan. Mulai percakapan dengan peserta ini!</p>
        </div>
      `;
    } else {
      container.innerHTML = data.map(renderAdminChatBubble).join('');
      container.scrollTop = container.scrollHeight;
    }

    await supabase
      .from('chat_messages')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('sender_role', 'user')
      .eq('is_read', false);

    // Hilangkan titik notifikasi di tombol chat pada tabel setelah dibaca.
    const participant = state.adminTable.data.find(p => p.id === userId);
    if (participant) participant.unreadChat = 0;
    const chatBtn = document.querySelector(`.btn-chat-action[data-user-id="${userId}"]`);
    if (chatBtn) chatBtn.classList.remove('has-unread');
  } catch (err) {
    console.error('Load admin chat error:', err);
  }
}

function renderAdminChatBubble(m) {
  const isMine = m.sender_role === 'admin';
  const { text, attachmentUrl, attachmentType } = parseChatMessage(m);
  let attachmentHtml = '';

  if (attachmentUrl) {
    if (attachmentType === 'image') {
      attachmentHtml = `<div class="attachment" onclick="previewDocument('${attachmentUrl}', 'Lampiran')"><img src="${attachmentUrl}" alt="attachment" /></div>`;
    } else {
      attachmentHtml = `
        <a href="${attachmentUrl}" target="_blank" class="attachment">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span>${escapeHtml(getAttachmentDisplayName(attachmentUrl))}</span>
        </a>
      `;
    }
  }

  return `
    <div class="chat-bubble ${isMine ? 'user' : ''}">
      ${text ? escapeHtml(text) : ''}
      ${attachmentHtml}
      <span class="chat-time">${formatTime(m.created_at)}</span>
    </div>
  `;
}

/* ============================================ */
/* ADMIN CHAT TAB (halaman navbar "Chat", ala WhatsApp) */
/* Berbeda dari openAdminChat() (modal cepat di tabel Kelola Peserta),
   tab ini menampilkan daftar SEMUA percakapan yang pernah ada, diurutkan
   dari yang paling baru di atas, plus tombol "Chat Baru" untuk memilih
   peserta yang belum pernah diajak chat. Riwayat percakapan yang sudah
   ada tidak perlu dicari ulang - tinggal klik dari daftar. */
/* ============================================ */

function formatChatListTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const isSameDay = date.toDateString() === now.toDateString();
  if (isSameDay) return formatTime(dateStr);

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Kemarin';

  return date.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function chatListPreviewText(messageRow) {
  const { text, attachmentType } = parseChatMessage(messageRow);
  if (text && text.trim()) return text.trim();
  if (attachmentType === 'image') return '📷 Foto';
  if (attachmentType === 'pdf') return '📄 Dokumen';
  return messageRow.message || '';
}

async function loadAdminChatPage() {
  const listEl = $('#admin-chat-list');
  try {
    const [messagesRes, profilesRes] = await Promise.all([
      supabase.from('chat_messages').select('user_id, sender_role, message, is_read, created_at').order('created_at', { ascending: true }),
      supabase.from('profiles').select('id, full_name, email').eq('role', 'user')
    ]);

    if (messagesRes.error) console.error('Load chat messages error:', messagesRes.error);
    if (profilesRes.error) console.error('Load profiles error:', profilesRes.error);

    const profileMap = {};
    (profilesRes.data || []).forEach(p => { profileMap[p.id] = p; });

    const convoMap = {};
    (messagesRes.data || []).forEach(m => {
      const profile = profileMap[m.user_id];
      if (!convoMap[m.user_id]) {
        convoMap[m.user_id] = {
          userId: m.user_id,
          fullName: profile ? profile.full_name : 'Peserta',
          email: profile ? profile.email : '',
          lastMessage: '',
          lastAt: null,
          unreadCount: 0
        };
      }
      const convo = convoMap[m.user_id];
      convo.lastMessage = chatListPreviewText(m);
      convo.lastAt = m.created_at;
      if (m.sender_role === 'user' && !m.is_read) convo.unreadCount++;
    });

    // Pertahankan percakapan baru yang barusan dipilih lewat "Chat Baru" tapi belum
    // ada pesannya sama sekali, supaya tetap tampil di daftar (di paling atas)
    // selagi admin mengetik pesan pertama.
    (state.adminChatTab.conversations || []).forEach(c => {
      if (!convoMap[c.userId] && c.lastAt === null) {
        convoMap[c.userId] = c;
      }
    });

    const conversations = Object.values(convoMap).sort((a, b) => {
      if (a.lastAt === null && b.lastAt === null) return 0;
      if (a.lastAt === null) return -1;
      if (b.lastAt === null) return 1;
      return new Date(b.lastAt) - new Date(a.lastAt);
    });

    state.adminChatTab.conversations = conversations;
    renderAdminChatList();
    updateAdminChatNavBadge();

    // Kalau ada percakapan yang sedang aktif dibuka, muat ulang pesannya juga
    // (misalnya setelah kembali dari halaman lain).
    if (state.adminChatTab.activeUserId) {
      await loadAdminChatTabMessages(state.adminChatTab.activeUserId);
    }
  } catch (err) {
    console.error('Load admin chat page error:', err);
    if (listEl) listEl.innerHTML = '<div class="admin-chat-list-empty">Gagal memuat percakapan.</div>';
  }
}

function renderAdminChatList() {
  const listEl = $('#admin-chat-list');
  if (!listEl) return;

  const search = state.adminChatTab.search.toLowerCase();
  let items = state.adminChatTab.conversations;
  if (search) {
    items = items.filter(c =>
      (c.fullName || '').toLowerCase().includes(search) ||
      (c.email || '').toLowerCase().includes(search)
    );
  }

  if (items.length === 0) {
    listEl.innerHTML = `<div class="admin-chat-list-empty">${search ? 'Tidak ada percakapan yang cocok.' : 'Belum ada percakapan. Klik "Chat Baru" untuk mulai.'}</div>`;
    return;
  }

  listEl.innerHTML = items.map(c => {
    const initial = (c.fullName || '?').trim().charAt(0).toUpperCase();
    const isActive = state.adminChatTab.activeUserId === c.userId;
    const hasUnread = c.unreadCount > 0;
    return `
      <div class="admin-chat-list-item ${isActive ? 'active' : ''} ${hasUnread ? 'has-unread' : ''}" data-user-id="${c.userId}" onclick="selectAdminChatConversation('${c.userId}')">
        <div class="admin-chat-avatar">${escapeHtml(initial)}</div>
        <div class="admin-chat-list-item-body">
          <div class="admin-chat-list-item-top">
            <span class="admin-chat-list-item-name">${escapeHtml(c.fullName || 'Peserta')}</span>
            <span class="admin-chat-list-item-time">${c.lastAt ? formatChatListTime(c.lastAt) : ''}</span>
          </div>
          <div class="admin-chat-list-item-preview">${c.lastMessage ? escapeHtml(c.lastMessage) : 'Belum ada pesan'}</div>
        </div>
        ${hasUnread ? `<span class="admin-chat-unread-dot">${c.unreadCount}</span>` : ''}
      </div>
    `;
  }).join('');
}

function updateAdminChatNavBadge() {
  const badge = $('#admin-chat-nav-badge');
  const topbarBadge = $('#topbar-chat-badge');
  const total = (state.adminChatTab.conversations || []).reduce((sum, c) => sum + (c.unreadCount || 0), 0);
  const text = total > 99 ? '99+' : String(total);
  [badge, topbarBadge].forEach(el => {
    if (!el) return;
    if (total > 0) {
      el.textContent = text;
      show(el);
    } else {
      hide(el);
    }
  });
}

$('#admin-chat-search').addEventListener('input', (e) => {
  state.adminChatTab.search = e.target.value;
  renderAdminChatList();
});

window.selectAdminChatConversation = async function (userId) {
  const convo = state.adminChatTab.conversations.find(c => c.userId === userId);
  if (!convo) return;

  state.adminChatTab.activeUserId = userId;
  state.adminChatTab.activeName = convo.fullName;
  state.adminChatTab.activeEmail = convo.email;

  $('#admin-chat-header-name').textContent = convo.fullName || 'Peserta';
  $('#admin-chat-header-email').textContent = convo.email || '';
  $('#admin-chat-header-avatar').textContent = (convo.fullName || '?').trim().charAt(0).toUpperCase();

  hide($('#admin-chat-panel-empty'));
  show($('#admin-chat-panel-active'));
  $('.admin-chat-wrap').classList.add('has-active');

  renderAdminChatList();
  await loadAdminChatTabMessages(userId);
};

$('#admin-chat-back-btn').addEventListener('click', () => {
  state.adminChatTab.activeUserId = null;
  $('.admin-chat-wrap').classList.remove('has-active');
  show($('#admin-chat-panel-empty'));
  hide($('#admin-chat-panel-active'));
  renderAdminChatList();
});

async function loadAdminChatTabMessages(userId) {
  const container = $('#admin-chat-tab-messages');
  try {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (!container || state.adminChatTab.activeUserId !== userId) return;

    if (error) console.error('Load admin chat tab error:', error);

    if (!data || data.length === 0) {
      container.innerHTML = `
        <div class="chat-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <p>Belum ada pesan. Mulai percakapan dengan peserta ini!</p>
        </div>
      `;
    } else {
      container.innerHTML = data.map(renderAdminChatBubble).join('');
      container.scrollTop = container.scrollHeight;
    }

    await supabase
      .from('chat_messages')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('sender_role', 'user')
      .eq('is_read', false);

    const convo = state.adminChatTab.conversations.find(c => c.userId === userId);
    if (convo) convo.unreadCount = 0;
    renderAdminChatList();
    updateAdminChatNavBadge();

    // Sinkronkan juga titik notifikasi di tombol chat pada tabel Kelola Peserta.
    const participant = state.adminTable.data.find(p => p.id === userId);
    if (participant) participant.unreadChat = 0;
    const chatBtn = document.querySelector(`.btn-chat-action[data-user-id="${userId}"]`);
    if (chatBtn) chatBtn.classList.remove('has-unread');
  } catch (err) {
    console.error('Load admin chat tab error:', err);
  }
}

// Dipanggil dari channel realtime GLOBAL (lihat subscribeRealtime) setiap ada
// pesan baru dari peserta manapun - jalan terus selama admin login, tidak
// cuma saat tab Chat sedang dibuka. Ini yang memunculkan toast + suara +
// notifikasi browser walau admin sedang di halaman lain (mis. Kelola Peserta).
async function handleIncomingChatMessageForAdmin(msg) {
  if (msg.sender_role !== 'user') return;

  let convo = state.adminChatTab.conversations.find(c => c.userId === msg.user_id);
  if (!convo) {
    const { data: profile } = await supabase.from('profiles').select('full_name, email').eq('id', msg.user_id).single();
    convo = {
      userId: msg.user_id,
      fullName: profile ? profile.full_name : 'Peserta',
      email: profile ? profile.email : '',
      lastMessage: '',
      lastAt: null,
      unreadCount: 0
    };
    state.adminChatTab.conversations.push(convo);
  }

  convo.lastMessage = chatListPreviewText(msg);
  convo.lastAt = msg.created_at;

  const isViewingThisConvo = state.currentPage === 'admin-chat' && state.adminChatTab.activeUserId === msg.user_id;

  if (isViewingThisConvo) {
    // Admin sedang lihat percakapan ini langsung -> cukup update panel & tandai
    // terbaca, tidak perlu toast/suara karena pesannya sudah kelihatan.
    loadAdminChatTabMessages(msg.user_id);
  } else {
    convo.unreadCount = (convo.unreadCount || 0) + 1;

    toast('info', 'Pesan Baru dari Peserta', `${convo.fullName}: ${convo.lastMessage}`);
    playNotificationSound();
    showBrowserNotification('Pesan Baru dari Peserta', `${convo.fullName}: ${convo.lastMessage}`);

    // Sinkronkan titik unread di tombol chat pada tabel Kelola Peserta (kalau lagi ter-render).
    const participant = state.adminTable.data.find(p => p.id === msg.user_id);
    if (participant) participant.unreadChat = (participant.unreadChat || 0) + 1;
    const chatBtn = document.querySelector(`.btn-chat-action[data-user-id="${msg.user_id}"]`);
    if (chatBtn) chatBtn.classList.add('has-unread');
  }

  // Pindahkan percakapan ini ke posisi paling atas & refresh badge total.
  state.adminChatTab.conversations = [
    convo,
    ...state.adminChatTab.conversations.filter(c => c.userId !== msg.user_id)
  ];
  if (state.currentPage === 'admin-chat') renderAdminChatList();
  updateAdminChatNavBadge();
}

// Lampiran untuk chat tab (sama persis polanya dengan chat peserta)
$('#admin-chat-tab-attach-btn').addEventListener('click', () => {
  $('#admin-chat-tab-file-input').click();
});

$('#admin-chat-tab-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    toast('error', 'File terlalu besar', 'Maks 5MB');
    return;
  }

  state.adminChatTab.attachment = file;
  $('#admin-chat-tab-attachment-name').textContent = file.name;
  show($('#admin-chat-tab-attachment-preview'));
});

$('#admin-chat-tab-attachment-remove').addEventListener('click', () => {
  state.adminChatTab.attachment = null;
  $('#admin-chat-tab-file-input').value = '';
  hide($('#admin-chat-tab-attachment-preview'));
});

$('#form-admin-chat-tab').addEventListener('submit', async (e) => {
  e.preventDefault();
  const userId = state.adminChatTab.activeUserId;
  if (!userId) return;

  const input = $('#admin-chat-tab-message');
  const message = input.value.trim();
  if (!message && !state.adminChatTab.attachment) return;

  input.value = '';
  const container = $('#admin-chat-tab-messages');
  const empty = container.querySelector('.chat-empty');
  if (empty) empty.remove();

  const tempBubble = document.createElement('div');
  tempBubble.className = 'chat-bubble user';
  tempBubble.innerHTML = `${escapeHtml(message)}<span class="chat-time">mengirim...</span>`;
  container.appendChild(tempBubble);
  container.scrollTop = container.scrollHeight;

  try {
    let attachmentUrl = null;
    let attachmentType = null;

    if (state.adminChatTab.attachment) {
      const file = state.adminChatTab.attachment;
      const ext = file.name.split('.').pop();
      const path = `${userId}/chat-${Date.now()}.${ext}`;
      const isImage = ['jpg', 'jpeg', 'png', 'gif'].includes(ext.toLowerCase());

      const { error: upErr } = await supabase.storage.from('documents').upload(path, file);
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path);
      attachmentUrl = urlData.publicUrl;
      attachmentType = isImage ? 'image' : 'pdf';
    }

    const { error } = await supabase.from('chat_messages').insert({
      user_id: userId,
      sender_id: state.user.id,
      sender_role: 'admin',
      message: attachmentUrl
        ? embedAttachmentMarker(message, attachmentType, attachmentUrl)
        : (message || '[Lampiran]')
    });

    if (error) throw error;

    tempBubble.querySelector('.chat-time').textContent = formatTime(new Date());

    await supabase.from('notifications').insert({
      user_id: userId,
      title: 'Pesan Baru dari Admin',
      message: message.length > 80 ? message.slice(0, 80) + '...' : (message || 'Mengirim lampiran'),
      type: 'info'
    });

    state.adminChatTab.attachment = null;
    $('#admin-chat-tab-file-input').value = '';
    hide($('#admin-chat-tab-attachment-preview'));
  } catch (err) {
    tempBubble.remove();
    toast('error', 'Gagal Mengirim', err.message || 'Terjadi kesalahan');
    input.value = message;
  }
});

/* --- Picker "Chat Baru": pilih peserta yang akan diajak mulai percakapan --- */

$('#btn-new-chat').addEventListener('click', openAdminChatPicker);
$('#admin-chat-picker-close').addEventListener('click', closeAdminChatPicker);
$('#admin-chat-picker-overlay').addEventListener('click', closeAdminChatPicker);

function closeAdminChatPicker() {
  hide($('#admin-chat-picker'));
}

async function openAdminChatPicker() {
  show($('#admin-chat-picker'));
  $('#admin-chat-picker-search').value = '';
  const listEl = $('#admin-chat-picker-list');
  listEl.innerHTML = '<div class="skeleton-card"></div>';

  try {
    if (!state.adminChatTab.allParticipants) {
      const { data, error } = await supabase.from('profiles').select('id, full_name, email').eq('role', 'user').order('full_name');
      if (error) throw error;
      state.adminChatTab.allParticipants = data || [];
    }
    renderAdminChatPickerList('');
  } catch (err) {
    console.error('Load participants for picker error:', err);
    listEl.innerHTML = '<div class="admin-chat-picker-empty">Gagal memuat daftar peserta.</div>';
  }
}

function renderAdminChatPickerList(search) {
  const listEl = $('#admin-chat-picker-list');
  const term = search.toLowerCase();
  let items = state.adminChatTab.allParticipants || [];

  if (term) {
    items = items.filter(p =>
      (p.full_name || '').toLowerCase().includes(term) ||
      (p.email || '').toLowerCase().includes(term)
    );
  }

  if (items.length === 0) {
    listEl.innerHTML = '<div class="admin-chat-picker-empty">Tidak ada peserta yang cocok.</div>';
    return;
  }

  listEl.innerHTML = items.map(p => {
    const initial = (p.full_name || '?').trim().charAt(0).toUpperCase();
    return `
      <div class="admin-chat-picker-item" onclick="startAdminChatFromPicker('${p.id}')">
        <div class="admin-chat-avatar">${escapeHtml(initial)}</div>
        <div>
          <div class="admin-chat-picker-item-name">${escapeHtml(p.full_name || 'Peserta')}</div>
          <div class="admin-chat-picker-item-email">${escapeHtml(p.email || '')}</div>
        </div>
      </div>
    `;
  }).join('');
}

$('#admin-chat-picker-search').addEventListener('input', (e) => {
  renderAdminChatPickerList(e.target.value);
});

window.startAdminChatFromPicker = function (userId) {
  const profile = (state.adminChatTab.allParticipants || []).find(p => p.id === userId);
  if (!profile) return;

  closeAdminChatPicker();

  let convo = state.adminChatTab.conversations.find(c => c.userId === userId);
  if (!convo) {
    convo = {
      userId,
      fullName: profile.full_name,
      email: profile.email,
      lastMessage: '',
      lastAt: null,
      unreadCount: 0
    };
    state.adminChatTab.conversations = [convo, ...state.adminChatTab.conversations];
  }

  selectAdminChatConversation(userId);
};

// Tombol chat di baris tabel Kelola Peserta sekarang langsung membuka tab
// Chat ini (bukan modal terpisah lagi), supaya semua percakapan terpusat
// di satu tempat dan riwayatnya konsisten dengan daftar di tab Chat.
window.goToAdminChat = function (userId, fullName, email) {
  navigateTo('admin-chat');

  let convo = state.adminChatTab.conversations.find(c => c.userId === userId);
  if (!convo) {
    convo = {
      userId,
      fullName: fullName || 'Peserta',
      email: email || '',
      lastMessage: '',
      lastAt: null,
      unreadCount: 0
    };
    state.adminChatTab.conversations = [convo, ...state.adminChatTab.conversations];
  }

  // loadAdminChatPage() dari navigateTo() berjalan async; beri sedikit jeda
  // supaya daftar percakapan (termasuk convo di atas) sudah dirender dulu
  // sebelum kita memilihnya.
  setTimeout(() => selectAdminChatConversation(userId), 250);
};

function renderPagination() {
  const { filtered, page, perPage } = state.adminTable;
  const totalPages = Math.ceil(filtered.length / perPage);
  const start = (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, filtered.length);

  const container = $('#admin-pagination');
  if (totalPages === 0) {
    // Sebelumnya innerHTML dikosongkan total saat tidak ada data, sehingga
    // bar pagination "menyusut" (hanya sisa padding) dan tingginya beda
    // dibanding saat ada data. Sekarang tetap render info "0 dari 0" tanpa
    // tombol halaman, supaya tinggi bar selalu konsisten.
    container.innerHTML = `
      <div class="pagination-info">Menampilkan 0 dari 0 peserta</div>
      <div class="pagination-controls">
        <button disabled>← Prev</button>
        <button disabled>Next →</button>
      </div>
    `;
    return;
  }
  
  container.innerHTML = `
    <div class="pagination-info">Menampilkan ${start}-${end} dari ${filtered.length} peserta</div>
    <div class="pagination-controls">
      <button ${page === 1 ? 'disabled' : ''} onclick="changePage(${page - 1})">← Prev</button>
      ${Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
        let pageNum;
        if (totalPages <= 5) pageNum = i + 1;
        else if (page <= 3) pageNum = i + 1;
        else if (page >= totalPages - 2) pageNum = totalPages - 4 + i;
        else pageNum = page - 2 + i;
        return `<button class="${pageNum === page ? 'active' : ''}" onclick="changePage(${pageNum})">${pageNum}</button>`;
      }).join('')}
      <button ${page === totalPages ? 'disabled' : ''} onclick="changePage(${page + 1})">Next →</button>
    </div>
  `;
}

window.changePage = function(page) {
  state.adminTable.page = page;
  renderAdminTable();
};

$('#admin-search').addEventListener('input', (e) => {
  state.adminTable.search = e.target.value;
  state.adminTable.page = 1;
  applyAdminFilters();
});

$('#admin-filter-status').addEventListener('change', (e) => {
  state.adminTable.filterStatus = e.target.value;
  state.adminTable.page = 1;
  applyAdminFilters();
});

$('#admin-filter-step').addEventListener('change', (e) => {
  state.adminTable.filterStep = e.target.value;
  state.adminTable.page = 1;
  applyAdminFilters();
});

$$('.modern-table th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const field = th.dataset.sort;
    if (state.adminTable.sortField === field) {
      state.adminTable.sortDirection = state.adminTable.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      state.adminTable.sortField = field;
      state.adminTable.sortDirection = 'asc';
    }
    
    $$('.modern-table th').forEach(t => t.classList.remove('sort-asc', 'sort-desc'));
    th.classList.add(state.adminTable.sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
    
    applyAdminFilters();
  });
});

/* ============================================ */
/* ADMIN VERIFIKASI EMAIL */
/* ============================================ */
async function updateUnverifiedBadge() {
  try {
    const { count, error } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'user')
      .eq('email_verified', false);

    if (error) {
      console.error('Gagal hitung peserta belum verifikasi:', error);
      return;
    }

    const badge = $('#badge-unverified');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch (err) {
    console.error('updateUnverifiedBadge error:', err);
  }
}

async function loadAdminVerifikasi() {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'user')
      .eq('email_verified', false)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Load admin verifikasi error:', error);
      toast('error', 'Gagal Memuat Data', error.message);
    }

    state.adminVerifikasi.data = data || [];
    renderAdminVerifikasi();
    updateUnverifiedBadge();
  } catch (err) {
    console.error('Load admin verifikasi error:', err);
  }
}

function renderAdminVerifikasi() {
  let filtered = [...state.adminVerifikasi.data];

  if (state.adminVerifikasi.search) {
    const search = state.adminVerifikasi.search.toLowerCase();
    filtered = filtered.filter(p =>
      (p.full_name || '').toLowerCase().includes(search) ||
      (p.email || '').toLowerCase().includes(search)
    );
  }

  const tbody = $('#admin-verifikasi-body');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-loading">Tidak ada peserta yang belum verifikasi email</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((p, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(p.full_name || '-')}</td>
      <td>${escapeHtml(p.email || '-')}</td>
      <td>${escapeHtml(p.phone || '-')}</td>
      <td>${formatDate(p.created_at)}</td>
      <td>
        <div class="table-actions-cell">
          <button class="btn-action" onclick="resendVerificationEmail('${escapeHtml(p.email).replace(/'/g, "\\'")}')">Kirim Ulang Verifikasi</button>
          <button class="btn-delete" onclick="deleteUnverifiedParticipant('${p.id}', '${escapeHtml(p.full_name || '-').replace(/'/g, "\\'")}')">Hapus</button>
        </div>
      </td>
    </tr>
  `).join('');
}

window.resendVerificationEmail = async function(email) {
  try {
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    if (error) {
      toast('error', 'Gagal Mengirim', error.message);
      return;
    }
    toast('success', 'Email Terkirim', `Email verifikasi dikirim ulang ke ${email}`);
  } catch (err) {
    console.error('resendVerificationEmail error:', err);
    toast('error', 'Error', 'Gagal mengirim ulang email verifikasi');
  }
};

// Hapus peserta yang belum verifikasi email dari daftar (tabel Confirmasi Email).
// Hanya menghapus baris profil di tabel `profiles` — akun auth.users terkait
// TIDAK ikut terhapus di sini karena penghapusan auth user butuh service_role
// key (admin API), yang tidak boleh dipakai di client. Kalau perlu benar-benar
// menghapus akun auth-nya juga, tambahkan Edge Function terpisah yang dipanggil
// dari sini.
window.deleteUnverifiedParticipant = function(userId, fullName) {
  confirmDialog('Hapus Peserta', `Yakin ingin menghapus data pendaftaran "${fullName}"? Peserta harus mendaftar ulang jika ingin bergabung kembali.`, async () => {
    try {
      const { data, error } = await supabase.from('profiles').delete().eq('id', userId).select();
      if (error) throw error;

      if (!data || data.length === 0) {
        // Query "sukses" (tidak ada error) tapi 0 baris yang benar-benar terhapus.
        // Ini hampir selalu berarti diblokir RLS policy DELETE pada tabel profiles.
        toast('error', 'Gagal Menghapus', 'Data tidak terhapus (kemungkinan diblokir RLS policy tabel profiles).');
        console.error('deleteUnverifiedParticipant: 0 baris terhapus, cek RLS policy DELETE pada tabel profiles untuk role admin.');
        return;
      }

      toast('success', 'Peserta Dihapus');
      loadAdminVerifikasi();
    } catch (err) {
      console.error('deleteUnverifiedParticipant error:', err);
      toast('error', 'Error', 'Gagal menghapus. Periksa RLS policy tabel profiles.');
    }
  });
};

$('#admin-verifikasi-search')?.addEventListener('input', (e) => {
  state.adminVerifikasi.search = e.target.value;
  renderAdminVerifikasi();
});

$('#btn-export-excel').addEventListener('click', () => {
  if (typeof XLSX === 'undefined') {
    toast('error', 'Library tidak tersedia');
    return;
  }
  
  const data = state.adminTable.filtered.map(p => ({
    'Nama': p.full_name,
    'Email': p.email,
    'Telepon': p.phone,
    'Tahapan': TIMELINE_STEPS.find(s => s.step === p.current_step)?.title || '-',
    'Status': statusLabel(p.status)
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Peserta');
  XLSX.writeFile(wb, 'peserta-pt-juara.xlsx');
  toast('success', 'Export Berhasil', 'File Excel telah diunduh');
});

$('#btn-export-pdf').addEventListener('click', () => {
  if (typeof window.jspdf === 'undefined') {
    toast('error', 'Library tidak tersedia');
    return;
  }
  
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(18);
  doc.text('Data Peserta - PT. Juara', 14, 22);
  doc.setFontSize(11);
  doc.text(`Tanggal: ${formatDate(new Date())}`, 14, 30);

  const tableData = state.adminTable.filtered.map(p => [
    p.full_name,
    p.email,
    p.phone || '-',
    TIMELINE_STEPS.find(s => s.step === p.current_step)?.title || '-',
    statusLabel(p.status)
  ]);

  doc.autoTable({
    head: [['Nama', 'Email', 'Telepon', 'Tahapan', 'Status']],
    body: tableData,
    startY: 40,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [37, 99, 235] }
  });

  doc.save('peserta-pt-juara.pdf');
  toast('success', 'Export Berhasil', 'File PDF telah diunduh');
});

window.viewParticipantDetail = async function(userId) {
  try {
    state.adminDetail.activeUserId = userId;
    state.adminDetail.previewReturnsToDetail = false;
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
    const { data: docs } = await supabase.from('documents').select('*').eq('user_id', userId);
    const { data: status } = await supabase.from('participant_status').select('*').eq('user_id', userId).maybeSingle();

    const modal = $('#preview-modal');
    const body = $('#preview-body');
    $('#preview-title').textContent = 'Detail Peserta';

    // docs.length === 0 dicek eksplisit di depan karena Array.every() pada array
    // kosong selalu bernilai true di JavaScript — tanpa ini, peserta yang belum
    // upload dokumen sama sekali keliru dianggap "Disetujui".
    const docsStatus = docs.length === 0
      ? 'pending'
      : docs.some(d => d.status === 'rejected')
        ? 'rejected'
        : docs.every(d => d.status === 'approved')
          ? 'approved'
          : 'pending';

    const initial = (profile.full_name || '?').charAt(0).toUpperCase();
    const fields = [
      { icon: 'phone', tone: 'blue', label: 'Telepon', value: escapeHtml(profile.phone || '-') },
      { icon: 'calendar', tone: 'blue', label: 'Tgl Lahir', value: profile.birth_date ? formatDate(profile.birth_date) : '-' },
      { icon: 'user', tone: 'blue', label: 'Jenis Kelamin', value: escapeHtml(profile.gender || '-') },
      { icon: 'book', tone: 'blue', label: 'Pendidikan', value: escapeHtml(profile.education || '-') },
      { icon: 'heart', tone: 'blue', label: 'Status Nikah', value: escapeHtml(profile.marital_status || '-') },
      { icon: 'star', tone: 'blue', label: 'Agama', value: escapeHtml(profile.religion || '-') },
      { icon: 'briefcase', tone: 'blue', label: 'Pekerjaan Diminati', value: escapeHtml(profile.job_interest || '-') },
      { icon: 'flag', tone: 'blue', label: 'Tahapan', value: TIMELINE_STEPS.find(s => s.step === status?.current_step)?.title || '-' }
    ];

    const fieldIcons = {
      mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/>',
      phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
      calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
      user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
      book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
      heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
      star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
      briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
      'map-pin': '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
      flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>'
    };
    const docIcons = {
      approved: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
      pending: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
      rejected: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'
    };
    const svgIcon = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

    body.innerHTML = `
      <div class="detail-peserta">
        <div class="detail-hero">
          <div class="detail-hero-avatar">${escapeHtml(initial)}</div>
          <div class="detail-hero-info">
            <h3>${escapeHtml(profile.full_name)}</h3>
            <p>${escapeHtml(profile.email)}</p>
          </div>
          <span class="status-badge status-${docsStatus} detail-hero-status">${statusLabel(docsStatus)}</span>
        </div>

        <div class="detail-grid">
          ${fields.map(f => `
            <div class="detail-field">
              <div class="detail-field-icon tone-${f.tone}">${svgIcon(fieldIcons[f.icon])}</div>
              <div>
                <strong>${f.label}</strong>
                <span>${f.value}</span>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="detail-field detail-field-full">
          <div class="detail-field-icon tone-blue">${svgIcon(fieldIcons['map-pin'])}</div>
          <div>
            <strong>Alamat</strong>
            <span>${escapeHtml(profile.address || '-')}</span>
          </div>
        </div>

        <h4 class="detail-docs-title">Dokumen</h4>
        <div class="detail-docs-grid">
          ${docs.map(d => `
            <div class="detail-doc-item status-${d.status}">
              <div class="detail-doc-main" onclick="previewDocument('${d.file_url}', '${escapeHtml(d.doc_type).replace(/'/g, "\\'")}')" title="Klik untuk lihat dokumen">
                <div class="detail-doc-icon status-${d.status}">${svgIcon(docIcons[d.status] || docIcons.pending)}</div>
                <span class="detail-doc-name">${d.doc_type}</span>
                <span class="status-badge status-${d.status}">${statusLabel(d.status)}</span>
              </div>
              ${d.status === 'pending' ? `
                <div class="table-actions-cell">
                  <button class="btn-approve" onclick="event.stopPropagation(); approveDocument('${d.id}', '${d.user_id}')">OK</button>
                  <button class="btn-reject" onclick="event.stopPropagation(); rejectDocument('${d.id}', '${d.user_id}')">Reject</button>
                </div>
              ` : ''}
              ${d.status === 'rejected' && d.rejection_reason ? `
                <div class="doc-item-reason"><strong>Alasan:</strong> ${escapeHtml(d.rejection_reason)}</div>
              ` : ''}
            </div>
          `).join('') || '<p style="color: var(--gray-500);">Belum ada dokumen</p>'}
        </div>
      </div>
    `;

    show(modal);
  } catch (err) {
    toast('error', 'Error', 'Gagal memuat detail');
  }
};

// Dipanggil dari tombol APPROVE merah di tabel Kelola Peserta, muncul setelah
// seluruh dokumen disetujui satu-satu (lihat approveDocument). Memindahkan
// peserta dari tahap Verifikasi langsung ke Interview.
window.finalizeApproveParticipant = async function(userId, fullName) {
  confirmDialog('Approve Peserta', `Lanjutkan ${fullName} ke tahap Interview?`, async () => {
    try {
      const { error: stepErr } = await supabase
        .from('participant_status')
        .upsert({
          user_id: userId,
          current_step: 3,
          step_verifikasi: true,
          updated_by: state.user.id,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

      if (stepErr) {
        console.error('Update tahapan gagal:', stepErr);
        toast('error', 'Gagal Update Tahapan', stepErr.message);
        return;
      }

      await supabase.from('notifications').insert({
        user_id: userId,
        title: 'Selamat, Anda Lolos Verifikasi',
        message: 'Seluruh dokumen Anda telah disetujui. Silakan lanjut ke tahap interview.',
        type: 'success'
      });

      toast('success', 'Peserta Diapprove', 'Tahapan berpindah ke Interview');
      loadAdminPeserta();
    } catch (err) {
      console.error('finalizeApproveParticipant error:', err);
      toast('error', 'Error', err.message || 'Gagal mengapprove');
    }
  });
};

window.approveParticipant = async function(userId) {
  confirmDialog('Approve Peserta', 'Approve seluruh dokumen peserta ini?', async () => {
    try {
      const { error: docErr } = await supabase
        .from('documents')
        .update({ status: 'approved', reviewed_by: state.user.id, reviewed_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('status', 'pending');

      if (docErr) {
        console.error('Update dokumen gagal:', docErr);
        toast('error', 'Gagal Approve Dokumen', docErr.message);
        return;
      }

      const { error: stepErr } = await supabase
        .from('participant_status')
        .upsert({
          user_id: userId,
          current_step: 2,
          step_verifikasi: true,
          updated_by: state.user.id,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

      if (stepErr) {
        console.error('Update tahapan gagal:', stepErr);
        toast('error', 'Gagal Update Tahapan', stepErr.message);
        return;
      }

      await supabase.from('notifications').insert({
        user_id: userId,
        title: 'Dokumen Disetujui',
        message: 'Seluruh dokumen Anda telah disetujui. Silakan lanjut ke tahap verifikasi.',
        type: 'success'
      });

      toast('success', 'Peserta Diapprove');
      loadAdminPeserta();
    } catch (err) {
      console.error('approveParticipant error:', err);
      toast('error', 'Error', err.message || 'Gagal mengapprove');
    }
  });
};

window.rejectParticipant = async function(userId, fullName) {
  confirmDialog('Tolak Peserta', `Tolak seluruh dokumen ${fullName || 'peserta ini'}?`, async () => {
    const reason = prompt('Alasan penolakan:');
    if (!reason) return;

    try {
      await supabase
        .from('documents')
        .update({ status: 'rejected', rejection_reason: reason, reviewed_by: state.user.id, reviewed_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('status', 'pending');

      await supabase.from('notifications').insert({
        user_id: userId,
        title: 'Dokumen Ditolak',
        message: `Dokumen Anda ditolak. Alasan: ${reason}`,
        type: 'error'
      });

      toast('success', 'Peserta Ditolak');
      loadAdminPeserta();
    } catch (err) {
      toast('error', 'Error', 'Gagal menolak');
    }
  });
};

window.makeAdmin = async function(userId, fullName) {
  confirmDialog(
    'Jadikan Admin',
    `Yakin ingin menjadikan "${fullName}" sebagai admin? User ini akan mendapat akses penuh ke panel admin.`,
    async () => {
      try {
        const { error } = await supabase
          .from('profiles')
          .update({ role: 'admin' })
          .eq('id', userId);

        if (error) throw error;

        toast('success', 'Berhasil', `${fullName} sekarang menjadi admin`);
        loadAdminPeserta();
      } catch (err) {
        console.error('Make admin error:', err);
        toast('error', 'Error', 'Gagal mengubah role. Periksa RLS policy tabel profiles.');
      }
    }
  );
};

/* ============================================ */
/* ADMIN REVIEW DOKUMEN (sekarang jadi bagian dari modal Detail Peserta
   di Kelola Peserta -> lihat viewParticipantDetail) */
/* ============================================ */
window.approveDocument = async function(docId, userId) {
  confirmDialog('Approve Dokumen', 'Setujui dokumen ini?', async () => {
    try {
      await supabase.from('documents').update({ 
        status: 'approved',
        reviewed_by: state.user.id,
        reviewed_at: new Date().toISOString()
      }).eq('id', docId);

      // Kalau ini dokumen pertama yang di-OK (tahapan peserta masih di Pendaftaran/
      // belum pernah dibuat), otomatis majukan ke Verifikasi. Pemanggilan berikutnya
      // aman diulang karena hanya bergerak maju kalau current_step masih 1.
      const { data: statusRow } = await supabase
        .from('participant_status')
        .select('current_step')
        .eq('user_id', userId)
        .maybeSingle();

      if (!statusRow || statusRow.current_step === 1) {
        await supabase
          .from('participant_status')
          .upsert({
            user_id: userId,
            current_step: 2,
            step_verifikasi: true,
            updated_by: state.user.id,
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id' });
      }

      await supabase.from('notifications').insert({
        user_id: userId,
        title: 'Dokumen Disetujui',
        message: 'Dokumen Anda telah disetujui oleh admin.',
        type: 'success'
      });

      toast('success', 'Dokumen Disetujui');
      // Refresh modal Detail Peserta yang sedang terbuka + tabel Kelola Peserta
      // (badge status & tombol Detail merah/tidak ikut berubah sesuai data terbaru).
      if (state.adminDetail.activeUserId) viewParticipantDetail(state.adminDetail.activeUserId);
      loadAdminPeserta();
    } catch (err) {
      toast('error', 'Error', 'Gagal mengapprove');
    }
  });
};

window.rejectDocument = async function(docId, userId) {
  const reason = prompt('Alasan penolakan:');
  if (!reason) return;

  try {
    await supabase.from('documents').update({ 
      status: 'rejected',
      rejection_reason: reason,
      reviewed_by: state.user.id,
      reviewed_at: new Date().toISOString()
    }).eq('id', docId);

    await supabase.from('notifications').insert({
      user_id: userId,
      title: 'Dokumen Ditolak',
      message: `Dokumen Anda ditolak. Alasan: ${reason}`,
      type: 'error'
    });

    toast('success', 'Dokumen Ditolak');
    if (state.adminDetail.activeUserId) viewParticipantDetail(state.adminDetail.activeUserId);
    loadAdminPeserta();
  } catch (err) {
    toast('error', 'Error', 'Gagal menolak');
  }
};

/* ============================================ */
/* ADMIN PENGGUMAN CRUD */
/* ============================================ */
async function loadAdminPengumuman() {
  try {
    const { data, error } = await supabase
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false });

    const container = $('#admin-announcements-list');
    if (error || !data || data.length === 0) {
      container.innerHTML = '<div class="empty-state"><h4>Belum ada pengumuman</h4></div>';
      return;
    }

    container.innerHTML = data.map(a => `
      <div class="card-item priority-${a.priority}">
        <div class="card-item-header">
          <div>
            <div class="card-item-title">${escapeHtml(a.title)}</div>
            <div class="card-item-meta">${formatDate(a.created_at)} • ${a.priority}</div>
          </div>
          <div class="table-actions-cell">
            <button class="btn-edit" onclick="editAnnouncement('${a.id}')">Edit</button>
            <button class="btn-delete" onclick="deleteAnnouncement('${a.id}')">Hapus</button>
          </div>
        </div>
        <div class="card-item-body">${escapeHtml(a.content || '')}</div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Load admin pengumuman error:', err);
  }
}

$('#btn-add-announcement').addEventListener('click', () => openAnnouncementModal());

window.editAnnouncement = async function(id) {
  try {
    const { data } = await supabase.from('announcements').select('*').eq('id', id).single();
    if (data) openAnnouncementModal(data);
  } catch (err) {
    toast('error', 'Error', 'Gagal memuat data');
  }
};

function openAnnouncementModal(existing = null) {
  const modal = $('#preview-modal');
  const body = $('#preview-body');
  $('#preview-title').textContent = existing ? 'Edit Pengumuman' : 'Tambah Pengumuman';

  body.innerHTML = `
    <form id="form-announcement" style="display: flex; flex-direction: column; gap: 14px;" novalidate>
      <div class="input-group">
        <label>Judul</label>
        <input type="text" id="announcement-title" value="${escapeHtml(existing?.title || '')}" required />
        <span class="field-error"></span>
      </div>
      <div class="input-group">
        <label>Prioritas</label>
        <select id="announcement-priority">
          <option value="low" ${existing?.priority === 'low' ? 'selected' : ''}>Low</option>
          <option value="normal" ${existing?.priority === 'normal' || !existing ? 'selected' : ''}>Normal</option>
          <option value="high" ${existing?.priority === 'high' ? 'selected' : ''}>High</option>
          <option value="urgent" ${existing?.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
        </select>
      </div>
      <div class="input-group">
        <label>Konten</label>
        <textarea id="announcement-content" rows="5" required>${escapeHtml(existing?.content || '')}</textarea>
        <span class="field-error"></span>
      </div>
      <label class="checkbox-label">
        <input type="checkbox" id="announcement-published" ${existing?.is_published !== false ? 'checked' : ''} />
        <span>Publikasikan sekarang</span>
      </label>
      <button type="submit" class="btn btn-primary">
        <span class="btn-text">${existing ? 'Update' : 'Simpan'}</span>
        <span class="btn-loader hidden"></span>
      </button>
    </form>
  `;

  show(modal);

  $('#form-announcement').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm(e.target)) return;
    
    const btn = e.target.querySelector('button[type="submit"]');
    setLoading(btn, true);

    const payload = {
      title: $('#announcement-title').value.trim(),
      content: $('#announcement-content').value.trim(),
      priority: $('#announcement-priority').value,
      is_published: $('#announcement-published').checked,
      updated_at: new Date().toISOString()
    };

    try {
      let error;
      if (existing) {
        const res = await supabase.from('announcements').update(payload).eq('id', existing.id);
        error = res.error;
      } else {
        payload.created_by = state.user.id;
        const res = await supabase.from('announcements').insert(payload);
        error = res.error;
      }

      setLoading(btn, false);

      if (error) {
        toast('error', 'Gagal', error.message);
        return;
      }

      toast('success', existing ? 'Pengumuman Diperbarui' : 'Pengumuman Ditambahkan');
      hide(modal);
      loadAdminPengumuman();
    } catch (err) {
      setLoading(btn, false);
      toast('error', 'Error', 'Terjadi kesalahan');
    }
  });
}

window.deleteAnnouncement = function(id) {
  confirmDialog('Hapus Pengumuman', 'Yakin ingin menghapus pengumuman ini?', async () => {
    try {
      const { error } = await supabase.from('announcements').delete().eq('id', id);
      if (error) throw error;
      toast('success', 'Pengumuman Dihapus');
      loadAdminPengumuman();
    } catch (err) {
      toast('error', 'Error', 'Gagal menghapus');
    }
  });
};

/* ============================================ */
/* ADMIN NEGARA TUJUAN */
/* ============================================ */
async function loadAdminNegara() {
  try {
    const { data, error } = await supabase
      .from('countries')
      .select('*')
      .order('name');

    const tbody = $('#admin-countries-body');
    if (error || !data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="table-loading">Belum ada data</td></tr>';
      return;
    }

    tbody.innerHTML = data.map(c => `
      <tr>
        <td style="font-size: 24px;">${c.flag_emoji || '🌍'}</td>
        <td><strong>${escapeHtml(c.name)}</strong></td>
        <td>${escapeHtml(c.code || '-')}</td>
        <td>${escapeHtml(c.currency || '-')}</td>
        <td>
          <div class="table-actions-cell">
            <button class="btn-edit" onclick="editCountry('${c.id}')">Edit</button>
            <button class="btn-delete" onclick="deleteCountry('${c.id}')">Hapus</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Load admin negara error:', err);
  }
}

$('#btn-add-country').addEventListener('click', () => openCountryModal());

window.editCountry = async function(id) {
  try {
    const { data } = await supabase.from('countries').select('*').eq('id', id).single();
    if (data) openCountryModal(data);
  } catch (err) {
    toast('error', 'Error', 'Gagal memuat data');
  }
};

// =========================================================
// Auto-deteksi emoji bendera berdasarkan nama negara (Indonesia/Inggris)
// =========================================================
const COUNTRY_ISO_MAP = {
  'indonesia': 'ID', 'malaysia': 'MY', 'singapura': 'SG', 'singapore': 'SG',
  'brunei': 'BN', 'thailand': 'TH', 'filipina': 'PH', 'philippines': 'PH',
  'vietnam': 'VN', 'kamboja': 'KH', 'cambodia': 'KH', 'laos': 'LA',
  'myanmar': 'MM', 'timor leste': 'TL',
  'taiwan': 'TW', 'hong kong': 'HK', 'tiongkok': 'CN', 'china': 'CN',
  'jepang': 'JP', 'japan': 'JP', 'korea selatan': 'KR', 'korea utara': 'KP',
  'mongolia': 'MN',
  'india': 'IN', 'pakistan': 'PK', 'bangladesh': 'BD', 'sri lanka': 'LK',
  'nepal': 'NP', 'bhutan': 'BT', 'maladewa': 'MV', 'maldives': 'MV',
  'arab saudi': 'SA', 'saudi arabia': 'SA', 'uni emirat arab': 'AE',
  'uea': 'AE', 'united arab emirates': 'AE', 'qatar': 'QA', 'kuwait': 'KW',
  'bahrain': 'BH', 'oman': 'OM', 'yordania': 'JO', 'jordan': 'JO',
  'lebanon': 'LB', 'suriah': 'SY', 'syria': 'SY', 'irak': 'IQ', 'iraq': 'IQ',
  'iran': 'IR', 'israel': 'IL', 'palestina': 'PS', 'palestine': 'PS',
  'turki': 'TR', 'turkey': 'TR', 'yaman': 'YE', 'yemen': 'YE',
  'mesir': 'EG', 'egypt': 'EG', 'maroko': 'MA', 'morocco': 'MA',
  'aljazair': 'DZ', 'algeria': 'DZ', 'tunisia': 'TN', 'libya': 'LY',
  'sudan': 'SD', 'ethiopia': 'ET', 'kenya': 'KE', 'nigeria': 'NG',
  'afrika selatan': 'ZA', 'south africa': 'ZA', 'ghana': 'GH',
  'tanzania': 'TZ', 'uganda': 'UG',
  'rusia': 'RU', 'russia': 'RU', 'ukraina': 'UA', 'ukraine': 'UA',
  'belarus': 'BY', 'polandia': 'PL', 'poland': 'PL',
  'republik ceko': 'CZ', 'czech republic': 'CZ', 'slowakia': 'SK',
  'slovakia': 'SK', 'hungaria': 'HU', 'hungary': 'HU', 'rumania': 'RO',
  'romania': 'RO', 'bulgaria': 'BG', 'yunani': 'GR', 'greece': 'GR',
  'serbia': 'RS', 'kroasia': 'HR', 'croatia': 'HR',
  'jerman': 'DE', 'germany': 'DE', 'prancis': 'FR', 'france': 'FR',
  'inggris': 'GB', 'united kingdom': 'GB', 'uk': 'GB', 'italia': 'IT',
  'italy': 'IT', 'spanyol': 'ES', 'spain': 'ES', 'portugal': 'PT',
  'belanda': 'NL', 'netherlands': 'NL', 'belgia': 'BE', 'belgium': 'BE',
  'swiss': 'CH', 'switzerland': 'CH', 'austria': 'AT', 'swedia': 'SE',
  'sweden': 'SE', 'norwegia': 'NO', 'norway': 'NO', 'denmark': 'DK',
  'finlandia': 'FI', 'finland': 'FI', 'irlandia': 'IE', 'ireland': 'IE',
  'islandia': 'IS', 'iceland': 'IS', 'luksemburg': 'LU', 'luxembourg': 'LU',
  'malta': 'MT', 'siprus': 'CY', 'cyprus': 'CY',
  'amerika serikat': 'US', 'united states': 'US', 'usa': 'US',
  'kanada': 'CA', 'canada': 'CA', 'meksiko': 'MX', 'mexico': 'MX',
  'brazil': 'BR', 'brasil': 'BR', 'argentina': 'AR', 'chile': 'CL',
  'peru': 'PE', 'kolombia': 'CO', 'colombia': 'CO', 'venezuela': 'VE',
  'ekuador': 'EC', 'ecuador': 'EC', 'bolivia': 'BO', 'paraguay': 'PY',
  'uruguay': 'UY',
  'australia': 'AU', 'selandia baru': 'NZ', 'new zealand': 'NZ',
  'fiji': 'FJ', 'papua nugini': 'PG', 'papua new guinea': 'PG',
  'afghanistan': 'AF', 'kazakhstan': 'KZ', 'uzbekistan': 'UZ',
  'turkmenistan': 'TM', 'kirgistan': 'KG', 'kyrgyzstan': 'KG',
  'tajikistan': 'TJ', 'azerbaijan': 'AZ', 'armenia': 'AM', 'georgia': 'GE'
};

function isoToFlagEmoji(iso2) {
  if (!iso2 || iso2.length !== 2) return '';
  return String.fromCodePoint(...iso2.toUpperCase().split('').map(c => 127397 + c.charCodeAt(0)));
}

function guessCountryFlag(name) {
  const key = (name || '').trim().toLowerCase();
  if (!key) return '';
  if (COUNTRY_ISO_MAP[key]) return isoToFlagEmoji(COUNTRY_ISO_MAP[key]);
  // Coba cocokkan sebagian (mis. "Korea Selatan (Baru)" tetap kedeteksi)
  for (const k in COUNTRY_ISO_MAP) {
    if (key.includes(k)) return isoToFlagEmoji(COUNTRY_ISO_MAP[k]);
  }
  return '';
}

const CURRENCY_ISO_MAP = {
  ID: 'IDR', MY: 'MYR', SG: 'SGD', BN: 'BND', TH: 'THB', PH: 'PHP',
  VN: 'VND', KH: 'KHR', LA: 'LAK', MM: 'MMK', TL: 'USD',
  TW: 'TWD', HK: 'HKD', CN: 'CNY', JP: 'JPY', KR: 'KRW', KP: 'KPW', MN: 'MNT',
  IN: 'INR', PK: 'PKR', BD: 'BDT', LK: 'LKR', NP: 'NPR', BT: 'BTN', MV: 'MVR',
  SA: 'SAR', AE: 'AED', QA: 'QAR', KW: 'KWD', BH: 'BHD', OM: 'OMR',
  JO: 'JOD', LB: 'LBP', SY: 'SYP', IQ: 'IQD', IR: 'IRR', IL: 'ILS',
  PS: 'ILS', TR: 'TRY', YE: 'YER',
  EG: 'EGP', MA: 'MAD', DZ: 'DZD', TN: 'TND', LY: 'LYD', SD: 'SDG',
  ET: 'ETB', KE: 'KES', NG: 'NGN', ZA: 'ZAR', GH: 'GHS', TZ: 'TZS', UG: 'UGX',
  RU: 'RUB', UA: 'UAH', BY: 'BYN', PL: 'PLN', CZ: 'CZK', SK: 'EUR',
  HU: 'HUF', RO: 'RON', BG: 'BGN', GR: 'EUR', RS: 'RSD', HR: 'EUR',
  DE: 'EUR', FR: 'EUR', GB: 'GBP', IT: 'EUR', ES: 'EUR', PT: 'EUR',
  NL: 'EUR', BE: 'EUR', CH: 'CHF', AT: 'EUR', SE: 'SEK', NO: 'NOK',
  DK: 'DKK', FI: 'EUR', IE: 'EUR', IS: 'ISK', LU: 'EUR', MT: 'EUR', CY: 'EUR',
  US: 'USD', CA: 'CAD', MX: 'MXN', BR: 'BRL', AR: 'ARS', CL: 'CLP',
  PE: 'PEN', CO: 'COP', VE: 'VES', EC: 'USD', BO: 'BOB', PY: 'PYG', UY: 'UYU',
  AU: 'AUD', NZ: 'NZD', FJ: 'FJD', PG: 'PGK',
  AF: 'AFN', KZ: 'KZT', UZ: 'UZS', TM: 'TMT', KG: 'KGS', TJ: 'TJS',
  AZ: 'AZN', AM: 'AMD', GE: 'GEL'
};

function guessCountryCurrency(name) {
  const key = (name || '').trim().toLowerCase();
  if (!key) return '';
  let iso = COUNTRY_ISO_MAP[key];
  if (!iso) {
    for (const k in COUNTRY_ISO_MAP) {
      if (key.includes(k)) { iso = COUNTRY_ISO_MAP[k]; break; }
    }
  }
  return iso ? (CURRENCY_ISO_MAP[iso] || '') : '';
}

function openCountryModal(existing = null) {
  const modal = $('#preview-modal');
  const body = $('#preview-body');
  $('#preview-title').textContent = existing ? 'Edit Negara' : 'Tambah Negara';

  body.innerHTML = `
    <form id="form-country" style="display: flex; flex-direction: column; gap: 14px;" novalidate>
      <div class="input-group">
        <label>Nama Negara</label>
        <div style="display:flex; align-items:center; gap:10px;">
          <span id="country-flag-preview" style="font-size:26px; line-height:1;">${existing?.flag_emoji || guessCountryFlag(existing?.name) || '🌍'}</span>
          <input type="text" id="country-name" value="${escapeHtml(existing?.name || '')}" required style="flex:1;" />
        </div>
        <span class="field-error"></span>
      </div>
      <div class="input-group">
        <label>Kode</label>
        <input type="text" id="country-code" value="${escapeHtml(existing?.code || '')}" maxlength="3" required />
        <span class="field-error"></span>
      </div>
      <button type="submit" class="btn btn-primary">
        <span class="btn-text">${existing ? 'Update' : 'Simpan'}</span>
        <span class="btn-loader hidden"></span>
      </button>
    </form>
  `;

  show(modal);

  $('#country-name').addEventListener('input', (e) => {
    $('#country-flag-preview').textContent = guessCountryFlag(e.target.value) || '🌍';
  });

  $('#form-country').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm(e.target)) return;
    
    const btn = e.target.querySelector('button[type="submit"]');
    setLoading(btn, true);

    const nameVal = $('#country-name').value.trim();
    const payload = {
      name: nameVal,
      code: $('#country-code').value.trim().toUpperCase(),
      flag_emoji: existing?.flag_emoji || guessCountryFlag(nameVal) || '🌍',
      region: existing?.region || '',
      currency: existing?.currency || guessCountryCurrency(nameVal) || '',
      language: existing?.language || '',
      is_active: existing?.is_active !== false,
      updated_at: new Date().toISOString()
    };

    try {
      let error;
      if (existing) {
        const res = await supabase.from('countries').update(payload).eq('id', existing.id);
        error = res.error;
      } else {
        payload.created_by = state.user.id;
        const res = await supabase.from('countries').insert(payload);
        error = res.error;
      }

      setLoading(btn, false);

      if (error) {
        toast('error', 'Gagal', error.message);
        return;
      }

      toast('success', existing ? 'Negara Diperbarui' : 'Negara Ditambahkan');
      hide(modal);
      loadAdminNegara();
    } catch (err) {
      setLoading(btn, false);
      toast('error', 'Error', 'Terjadi kesalahan');
    }
  });
}

window.deleteCountry = function(id) {
  confirmDialog('Hapus Negara', 'Yakin ingin menghapus negara ini?', async () => {
    try {
      const { error } = await supabase.from('countries').delete().eq('id', id);
      if (error) throw error;
      toast('success', 'Negara Dihapus');
      loadAdminNegara();
    } catch (err) {
      toast('error', 'Error', 'Gagal menghapus');
    }
  });
};

/* ============================================ */
/* ADMIN POSISI KERJA */
/* ============================================ */
async function loadAdminPosisi() {
  try {
    const { data, error } = await supabase
      .from('job_positions')
      .select('*, countries(name, flag_emoji)')
      .order('created_at', { ascending: false });

    const tbody = $('#admin-positions-body');
    if (error || !data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="table-loading">Belum ada data</td></tr>';
      return;
    }

    tbody.innerHTML = data.map(p => `
      <tr>
        <td><strong>${escapeHtml(p.title)}</strong></td>
        <td>${p.countries?.flag_emoji || ''} ${escapeHtml(p.countries?.name || '-')}</td>
        <td>${escapeHtml(p.category || '-')}</td>
        <td>
          <div class="table-actions-cell">
            <button class="btn-edit" onclick="editPosition('${p.id}')">Edit</button>
            <button class="btn-delete" onclick="deletePosition('${p.id}')">Hapus</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Load admin posisi error:', err);
  }
}

$('#btn-add-position').addEventListener('click', () => openPositionModal());

window.editPosition = async function(id) {
  try {
    const { data } = await supabase.from('job_positions').select('*').eq('id', id).single();
    if (data) openPositionModal(data);
  } catch (err) {
    toast('error', 'Error', 'Gagal memuat data');
  }
};

async function openPositionModal(existing = null) {
  const modal = $('#preview-modal');
  const body = $('#preview-body');
  $('#preview-title').textContent = existing ? 'Edit Posisi' : 'Tambah Posisi';

  // Load countries
  let countriesHtml = '<option value="">Pilih negara...</option>';
  try {
    const { data: countries, error: countriesErr } = await supabase.from('countries').select('*').eq('is_active', true).order('name');
    if (countriesErr) {
      console.error('Load countries error:', countriesErr);
      toast('error', 'Gagal Memuat Negara', countriesErr.message);
    } else if (!countries || countries.length === 0) {
      console.warn('Tabel countries kosong atau tidak ada negara aktif.');
    }
    (countries || []).forEach(c => {
      countriesHtml += `<option value="${c.id}" ${existing?.country_id === c.id ? 'selected' : ''}>${c.flag_emoji || ''} ${escapeHtml(c.name)}</option>`;
    });
  } catch (err) {
    console.error('Load countries error:', err);
    toast('error', 'Gagal Memuat Negara', err.message || 'Terjadi kesalahan');
  }

  body.innerHTML = `
    <form id="form-position" style="display: flex; flex-direction: column; gap: 14px;" novalidate>
      <div class="input-group">
        <label>Negara</label>
        <select id="position-country" required>${countriesHtml}</select>
        <span class="field-error"></span>
      </div>
      <div class="input-group">
        <label>Tempat</label>
        <input type="text" id="position-place" value="${escapeHtml(existing?.category || '')}" required />
        <span class="field-error"></span>
      </div>
      <div class="input-group">
        <label>Bagian</label>
        <input type="text" id="position-title" value="${escapeHtml(existing?.title || '')}" required />
        <span class="field-error"></span>
      </div>
      <button type="submit" class="btn btn-primary">
        <span class="btn-text">${existing ? 'Update' : 'Simpan'}</span>
        <span class="btn-loader hidden"></span>
      </button>
    </form>
  `;

  show(modal);

  $('#form-position').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm(e.target)) return;
    
    const btn = e.target.querySelector('button[type="submit"]');
    setLoading(btn, true);

    const payload = {
      country_id: $('#position-country').value,
      title: $('#position-title').value.trim(),
      category: $('#position-place').value.trim(),
      description: existing?.description || '',
      requirements: existing?.requirements || [],
      salary_min: existing?.salary_min || null,
      salary_max: existing?.salary_max || null,
      currency: existing?.currency || 'USD',
      quota: existing?.quota || null,
      estimated_departure: existing?.estimated_departure || '',
      is_active: existing?.is_active !== false,
      updated_at: new Date().toISOString()
    };

    try {
      let error;
      if (existing) {
        const res = await supabase.from('job_positions').update(payload).eq('id', existing.id);
        error = res.error;
      } else {
        payload.created_by = state.user.id;
        const res = await supabase.from('job_positions').insert(payload);
        error = res.error;
      }

      setLoading(btn, false);

      if (error) {
        toast('error', 'Gagal', error.message);
        return;
      }

      toast('success', existing ? 'Posisi Diperbarui' : 'Posisi Ditambahkan');
      hide(modal);
      loadAdminPosisi();
    } catch (err) {
      setLoading(btn, false);
      toast('error', 'Error', 'Terjadi kesalahan');
    }
  });
}

window.deletePosition = function(id) {
  confirmDialog('Hapus Posisi', 'Yakin ingin menghapus posisi ini?', async () => {
    try {
      const { error } = await supabase.from('job_positions').delete().eq('id', id);
      if (error) throw error;
      toast('success', 'Posisi Dihapus');
      loadAdminPosisi();
    } catch (err) {
      toast('error', 'Error', 'Gagal menghapus');
    }
  });
};

/* ============================================ */
/* ADMIN JADWAL KEBERANGKATAN */
/* Master data tanggal pemberangkatan (batch keberangkatan) yang dipakai
   sebagai pilihan dropdown "Tanggal Pemberangkatan" di halaman Penempatan.
   Tabel terpisah `departure_schedules`, dikelola lewat menu sidebar
   "Master Data > Jadwal Keberangkatan". */
async function loadAdminJadwalKeberangkatan() {
  try {
    const { data, error } = await supabase
      .from('departure_schedules')
      .select('*')
      .order('schedule_date');

    const tbody = $('#admin-schedules-body');
    if (error || !data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="table-loading">Belum ada data</td></tr>';
      return;
    }

    tbody.innerHTML = data.map(s => `
      <tr>
        <td><strong>${formatDate(s.schedule_date)}</strong></td>
        <td>${escapeHtml(s.note || '-')}</td>
        <td>${s.quota || '-'}</td>
        <td><span class="status-badge status-${s.is_active ? 'approved' : 'rejected'}">${s.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
        <td>
          <div class="table-actions-cell">
            <button class="btn-edit" onclick="editSchedule('${s.id}')">Edit</button>
            <button class="btn-delete" onclick="deleteSchedule('${s.id}')">Hapus</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Load admin jadwal keberangkatan error:', err);
  }
}

$('#btn-add-departure-schedule').addEventListener('click', () => openScheduleModal());

window.editSchedule = async function(id) {
  try {
    const { data } = await supabase.from('departure_schedules').select('*').eq('id', id).single();
    if (data) openScheduleModal(data);
  } catch (err) {
    toast('error', 'Error', 'Gagal memuat data');
  }
};

function openScheduleModal(existing = null) {
  const modal = $('#preview-modal');
  const body = $('#preview-body');
  $('#preview-title').textContent = existing ? 'Edit Jadwal Keberangkatan' : 'Tambah Jadwal Keberangkatan';

  body.innerHTML = `
    <form id="form-schedule" style="display: flex; flex-direction: column; gap: 14px;" novalidate>
      <div class="input-group">
        <label>Tanggal Keberangkatan</label>
        <input type="date" id="schedule-date" value="${existing?.schedule_date || ''}" required />
        <span class="field-error"></span>
      </div>
      <div class="input-group">
        <label>Catatan</label>
        <input type="text" id="schedule-note" value="${escapeHtml(existing?.note || '')}" placeholder="Mis. Batch 1 - Taiwan" />
      </div>
      <div class="input-group">
        <label>Kuota</label>
        <input type="number" id="schedule-quota" value="${existing?.quota || ''}" />
      </div>
      <label class="checkbox-label">
        <input type="checkbox" id="schedule-active" ${existing?.is_active !== false ? 'checked' : ''} />
        <span>Aktif</span>
      </label>
      <button type="submit" class="btn btn-primary">
        <span class="btn-text">${existing ? 'Update' : 'Simpan'}</span>
        <span class="btn-loader hidden"></span>
      </button>
    </form>
  `;

  show(modal);

  $('#form-schedule').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm(e.target)) return;

    const btn = e.target.querySelector('button[type="submit"]');
    setLoading(btn, true);

    const payload = {
      schedule_date: $('#schedule-date').value,
      note: $('#schedule-note').value.trim(),
      quota: parseInt($('#schedule-quota').value) || null,
      is_active: $('#schedule-active').checked,
      updated_at: new Date().toISOString()
    };

    try {
      let error;
      if (existing) {
        const res = await supabase.from('departure_schedules').update(payload).eq('id', existing.id);
        error = res.error;
      } else {
        payload.created_by = state.user.id;
        const res = await supabase.from('departure_schedules').insert(payload);
        error = res.error;
      }

      setLoading(btn, false);

      if (error) {
        toast('error', 'Gagal', error.message);
        return;
      }

      toast('success', existing ? 'Jadwal Diperbarui' : 'Jadwal Ditambahkan');
      hide(modal);
      loadAdminJadwalKeberangkatan();
    } catch (err) {
      setLoading(btn, false);
      toast('error', 'Error', 'Terjadi kesalahan');
    }
  });
}

window.deleteSchedule = function(id) {
  confirmDialog('Hapus Jadwal', 'Yakin ingin menghapus jadwal keberangkatan ini?', async () => {
    try {
      const { error } = await supabase.from('departure_schedules').delete().eq('id', id);
      if (error) throw error;
      toast('success', 'Jadwal Dihapus');
      loadAdminJadwalKeberangkatan();
    } catch (err) {
      toast('error', 'Error', 'Gagal menghapus');
    }
  });
};

/* ============================================ */
/* ADMIN PENEMPATAN */
/* Menampilkan peserta yang sudah mencapai tahap akhir timeline (saat ini
   "Penempatan", dipindahkan manual oleh admin lewat tombol "Lanjut ke
   Penempatan" di kolom Status pada Kelola Peserta) beserta detail penempatan (tanggal pemberangkatan, tujuan
   negara, penempatan) yang bisa diisi/diedit admin. Detail tersimpan di
   tabel terpisah `placements` (satu baris per peserta, keyed by user_id)
   supaya tidak mencampur data operasional ke tabel profiles/participant_status. */
async function loadAdminPenempatan() {
  try {
    const finalStep = TIMELINE_STEPS[TIMELINE_STEPS.length - 1].step;

    const { data: statuses, error: statusErr } = await supabase
      .from('participant_status')
      .select('user_id, current_step')
      .gte('current_step', finalStep);

    if (statusErr) {
      console.error('Load penempatan status error:', statusErr);
    }

    const userIds = (statuses || []).map(s => s.user_id);
    const tbody = $('#admin-penempatan-body');

    if (userIds.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-loading">Belum ada peserta yang mencapai tahap akhir</td></tr>';
      return;
    }

    const { data: profiles, error: profilesErr } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds);

    if (profilesErr) {
      console.error('Load penempatan profiles error:', profilesErr);
    }

    const { data: placements, error: placementsErr } = await supabase
      .from('placements')
      .select('*')
      .in('user_id', userIds);

    if (placementsErr) {
      console.error('Load penempatan data error:', placementsErr);
    }

    const placementMap = {};
    (placements || []).forEach(p => { placementMap[p.user_id] = p; });

    const rows = (profiles || [])
      .slice()
      .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-loading">Belum ada peserta yang mencapai tahap akhir</td></tr>';
      return;
    }

    // Master data untuk dropdown per-kolom (sumbernya sama dengan halaman
    // Master Data: Jadwal Keberangkatan, Negara Tujuan, Posisi Kerja).
    let schedules = [];
    let countries = [];
    let positions = [];
    try {
      const [schedRes, countryRes, posRes] = await Promise.all([
        supabase.from('departure_schedules').select('schedule_date, note').eq('is_active', true).order('schedule_date'),
        supabase.from('countries').select('name').eq('is_active', true).order('name'),
        supabase.from('job_positions').select('title, category, countries(name)').eq('is_active', true).order('title')
      ]);
      if (schedRes.error) console.error('Load departure_schedules error:', schedRes.error);
      if (countryRes.error) console.error('Load countries error:', countryRes.error);
      if (posRes.error) console.error('Load job_positions error:', posRes.error);
      schedules = schedRes.data || [];
      countries = countryRes.data || [];
      positions = posRes.data || [];
      if (!schedules.length) console.warn('departure_schedules: 0 baris aktif (cek is_active / RLS)');
      if (!countries.length) console.warn('countries: 0 baris aktif (cek is_active / RLS)');
      if (!positions.length) console.warn('job_positions: 0 baris aktif (cek is_active / RLS)');
    } catch (err) {
      console.error('Load master data for penempatan error:', err);
    }

    function buildDateOptions(selected) {
      let opts = '<option value="">Pilih tanggal...</option>';
      opts += schedules.map(s => {
        const label = formatDate(s.schedule_date) + (s.note ? ` — ${s.note}` : '');
        return `<option value="${s.schedule_date}" ${selected === s.schedule_date ? 'selected' : ''}>${escapeHtml(label)}</option>`;
      }).join('');
      if (selected && !schedules.some(s => s.schedule_date === selected)) {
        opts += `<option value="${selected}" selected>${escapeHtml(formatDate(selected))} (tidak aktif)</option>`;
      }
      return opts;
    }

    function buildCountryOptions(selected) {
      let opts = '<option value="">Pilih negara...</option>';
      opts += countries.map(c =>
        `<option value="${escapeHtml(c.name)}" ${selected === c.name ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
      ).join('');
      if (selected && !countries.some(c => c.name === selected)) {
        opts += `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)} (tidak aktif)</option>`;
      }
      return opts;
    }

    function buildPlacementOptions(countryName, selected) {
      const filtered = countryName ? positions.filter(p => p.countries?.name === countryName) : positions;
      let opts = '<option value="">Pilih posisi/penempatan...</option>';
      opts += filtered.map(p =>
        `<option value="${escapeHtml(p.category)}" ${selected === p.category ? 'selected' : ''}>${escapeHtml(p.category)}</option>`
      ).join('');
      if (selected && !filtered.some(p => p.category === selected)) {
        opts += `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)} (tidak aktif)</option>`;
      }
      return opts;
    }

    tbody.innerHTML = rows.map((p, i) => {
      const pl = placementMap[p.id];
      const isProcessed = !!(pl?.departure_date && pl?.destination_country && pl?.placement);
      return `
        <tr>
          <td>${i + 1}</td>
          <td>
            <strong>${escapeHtml(p.full_name)}</strong><br>
            <span class="status-badge ${isProcessed ? 'status-completed' : 'status-pending'}" style="margin-top:4px;">
              ${isProcessed ? 'Sudah Diproses' : 'Belum Diproses'}
            </span>
          </td>
          <td>
            <select class="penempatan-field" data-user="${p.id}" data-field="departure_date">
              ${buildDateOptions(pl?.departure_date || '')}
            </select>
          </td>
          <td>
            <select class="penempatan-field penempatan-country" data-user="${p.id}" data-field="destination_country">
              ${buildCountryOptions(pl?.destination_country || '')}
            </select>
          </td>
          <td>
            <select class="penempatan-field penempatan-placement" data-user="${p.id}" data-field="placement">
              ${buildPlacementOptions(pl?.destination_country || '', pl?.placement || '')}
            </select>
          </td>
          <td>
            <div class="table-actions-cell">
              <button class="btn-action" onclick="viewParticipantDetail('${p.id}')">Detail</button>
              <button class="btn-edit" id="proses-btn-${p.id}" onclick="prosesPenempatan('${p.id}')">Proses</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Saat negara diganti, filter ulang pilihan posisi/penempatan pada baris itu saja
    // (hanya mengubah opsi di layar; belum tersimpan sampai tombol Proses ditekan)
    tbody.querySelectorAll('.penempatan-country').forEach((sel) => {
      sel.addEventListener('change', (e) => {
        const userId = e.target.dataset.user;
        const placementSel = tbody.querySelector(`.penempatan-placement[data-user="${userId}"]`);
        if (placementSel) {
          placementSel.innerHTML = buildPlacementOptions(e.target.value, '');
          placementSel.value = '';
        }
      });
    });
  } catch (err) {
    console.error('Load admin penempatan error:', err);
  }
}

// Tombol "Proses" di tabel Penempatan: menyimpan (upsert) tanggal pemberangkatan,
// tujuan negara, dan penempatan sekaligus untuk satu peserta. Setelah tersimpan,
// halaman Beranda peserta otomatis berubah dari "100%"/"SELESAI" menjadi hitung
// mundur (countdown) hari menuju tanggal keberangkatan, karena countdown itu
// dihitung langsung dari kolom departure_date pada tabel `placements`.
window.prosesPenempatan = async function(userId) {
  const btn = $(`#proses-btn-${userId}`);
  const dateSel = document.querySelector(`.penempatan-field[data-field="departure_date"][data-user="${userId}"]`);
  const countrySel = document.querySelector(`.penempatan-country[data-user="${userId}"]`);
  const placementSel = document.querySelector(`.penempatan-placement[data-user="${userId}"]`);

  const departure_date = dateSel?.value || '';
  const destination_country = countrySel?.value || '';
  const placement = placementSel?.value || '';

  if (!departure_date || !destination_country || !placement) {
    toast('error', 'Belum Lengkap', 'Pilih Tanggal Pemberangkatan, Tujuan Negara, dan Penempatan terlebih dahulu');
    return;
  }

  const originalText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }

  try {
    const payload = {
      user_id: userId,
      departure_date,
      destination_country,
      placement,
      updated_by: state.user.id,
      updated_at: new Date().toISOString()
    };
    const { error } = await supabase.from('placements').upsert(payload, { onConflict: 'user_id' });

    if (error) {
      toast('error', 'Gagal Memproses', error.message);
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
      return;
    }

    toast('success', 'Penempatan Diproses', 'Countdown keberangkatan otomatis tampil di akun peserta');
    loadAdminPenempatan();
  } catch (err) {
    console.error('Proses penempatan error:', err);
    toast('error', 'Gagal Memproses');
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
};

/* ============================================ */
/* REALTIME REFRESH HELPERS (ADMIN) */
/* ============================================ */
// Dipanggil setiap kali ada perubahan dari sisi peserta (pendaftaran baru,
// upload dokumen, dsb). Cukup refresh halaman admin yang SEDANG dibuka +
// badge global, tidak perlu reload semua halaman sekaligus.
function refreshAdminViewsAfterParticipantChange() {
  updateUnverifiedBadge();

  if (state.currentPage === 'admin-dashboard') loadAdminDashboard();
  if (state.currentPage === 'admin-peserta') loadAdminPeserta();
  if (state.currentPage === 'admin-verifikasi') loadAdminVerifikasi();

  // Kalau admin sedang membuka modal "Detail Peserta" untuk peserta tertentu,
  // muat ulang modal itu juga supaya dokumen/data terbaru langsung terlihat
  // tanpa perlu menutup lalu membuka modalnya lagi.
  if (state.adminDetail.activeUserId) {
    window.viewParticipantDetail(state.adminDetail.activeUserId);
  }
}
const debouncedRefreshAdminViews = debounce(refreshAdminViewsAfterParticipantChange, 500);

/* ============================================ */
/* REALTIME SUBSCRIPTIONS */
/* ============================================ */
function subscribeRealtime() {
  try {
    // Cleanup existing channels
    state.realtimeChannels.forEach(c => supabase.removeChannel(c));
    state.realtimeChannels = [];

    // Chat realtime
    const chatChannel = supabase
      .channel('chat-' + state.user.id)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `user_id=eq.${state.user.id}`
      }, (payload) => {
        if (state.currentPage === 'chat') {
          const container = $('#chat-messages');
          const empty = container.querySelector('.chat-empty');
          if (empty) empty.remove();

          if (payload.new.sender_role === 'admin') {
            container.insertAdjacentHTML('beforeend', renderChatBubble(payload.new));
            container.scrollTop = container.scrollHeight;
          }
        } else {
          toast('info', 'Pesan baru', 'Anda menerima pesan dari admin');
          playNotificationSound();
          showBrowserNotification('Pesan Baru', 'Anda menerima pesan dari admin');
        }
      })
      .subscribe();

    state.realtimeChannels.push(chatChannel);

    // Chat realtime KHUSUS ADMIN: channel di atas (chat-<user.id>) tidak pernah
    // cocok untuk admin karena filternya `user_id=eq.<id akun admin>`, padahal
    // chat_messages.user_id selalu berisi ID PESERTA, bukan ID admin. Akibatnya
    // sebelum ini admin tidak pernah dapat notifikasi chat masuk sama sekali
    // (kecuali sedang membuka tab Chat itu sendiri). Channel terpisah ini
    // mendengarkan pesan dari peserta MANAPUN, aktif selama admin login, di
    // halaman manapun - bukan cuma saat tab Chat sedang dibuka.
    if (state.isAdmin) {
      const adminChatGlobalChannel = supabase
        .channel('admin-chat-global-' + state.user.id)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: 'sender_role=eq.user'
        }, (payload) => {
          handleIncomingChatMessageForAdmin(payload.new);
        })
        .subscribe();

      state.realtimeChannels.push(adminChatGlobalChannel);

      // Pendaftar baru / perubahan profil peserta (mis. verifikasi email,
      // edit data diri) -> Kelola Peserta, Verifikasi, dan Dashboard admin
      // harus ikut ter-update otomatis tanpa perlu refresh manual.
      const adminProfilesChannel = supabase
        .channel('admin-profiles-' + state.user.id)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'profiles'
        }, (payload) => {
          const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
          if (!row || row.role !== 'user') return;

          if (payload.eventType === 'INSERT') {
            toast('info', 'Pendaftar Baru', `${row.full_name || row.email || 'Peserta baru'} baru saja mendaftar`);
            playNotificationSound();
            showBrowserNotification('Pendaftar Baru', `${row.full_name || row.email || 'Peserta baru'} baru saja mendaftar`);
          }

          debouncedRefreshAdminViews();
        })
        .subscribe();

      state.realtimeChannels.push(adminProfilesChannel);

      // Upload dokumen baru dari peserta (checklist dokumen) -> tabel
      // Kelola Peserta (progress dokumen), Verifikasi, dan Dashboard admin.
      const adminDocumentsChannel = supabase
        .channel('admin-documents-' + state.user.id)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'documents'
        }, (payload) => {
          if (payload.eventType === 'INSERT') {
            toast('info', 'Dokumen Baru Diunggah', 'Ada peserta yang baru saja mengunggah dokumen');
            playNotificationSound();
            showBrowserNotification('Dokumen Baru Diunggah', 'Ada peserta yang baru saja mengunggah dokumen');
          }

          debouncedRefreshAdminViews();
        })
        .subscribe();

      state.realtimeChannels.push(adminDocumentsChannel);

      // Perubahan tahapan peserta (participant_status) -> ikut memperbarui
      // Kelola Peserta & Dashboard bila sedang dibuka (mis. tahapan berubah
      // dari sesi/perangkat admin lain, atau proses self-heal dari sesi lain).
      const adminStatusChannel = supabase
        .channel('admin-status-' + state.user.id)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'participant_status'
        }, () => {
          debouncedRefreshAdminViews();
        })
        .subscribe();

      state.realtimeChannels.push(adminStatusChannel);
    }

    // Notifications realtime
    const notifChannel = supabase
      .channel('notif-' + state.user.id)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${state.user.id}`
      }, (payload) => {
        toast('info', payload.new.title, payload.new.message || '');
        updateNotifBadge();
        showBrowserNotification(payload.new.title, payload.new.message || '');
        if (state.currentPage === 'notifikasi') loadNotifications();
        if (state.currentPage === 'beranda') loadBeranda();
        // Notifikasi terkait perubahan tahapan (mis. "Dokumen Disetujui",
        // "Tahapan Diperbarui") juga harus langsung memperbarui halaman
        // Progress kalau sedang dibuka, tanpa perlu refresh manual.
        if (state.currentPage === 'progress') loadProgress();
      })
      .subscribe();

    state.realtimeChannels.push(notifChannel);

    // Participant status realtime (for user)
    if (!state.isAdmin) {
      const statusChannel = supabase
        .channel('status-' + state.user.id)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'participant_status',
          filter: `user_id=eq.${state.user.id}`
        }, (payload) => {
          const stepTitle = TIMELINE_STEPS.find(s => s.step === payload.new.current_step)?.title;
          toast('success', 'Progress Diperbarui', `Tahapan: ${stepTitle}`);
          showBrowserNotification('Progress Diperbarui', `Tahapan Anda: ${stepTitle}`);
          if (state.currentPage === 'progress') loadProgress();
          if (state.currentPage === 'beranda') loadBeranda();
        })
        .subscribe();

      state.realtimeChannels.push(statusChannel);
    }

    // Schedules realtime
    const scheduleChannel = supabase
      .channel('schedules-' + state.user.id)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'schedules',
        filter: `user_id=eq.${state.user.id}`
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          toast('info', 'Jadwal Baru', `Anda memiliki jadwal ${payload.new.schedule_type}`);
          showBrowserNotification('Jadwal Baru', `Jadwal ${payload.new.schedule_type}`);
        }
        if (state.currentPage === 'jadwal') loadSchedules();
      })
      .subscribe();

    state.realtimeChannels.push(scheduleChannel);

    // Announcements realtime
    const announcementChannel = supabase
      .channel('announcements-global')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'announcements'
      }, (payload) => {
        // Beritahu peserta (bukan admin) begitu ada pengumuman BARU yang
        // langsung dipublikasikan, sama seperti notifikasi realtime lain
        // (chat/jadwal/status) -> toast + notifikasi browser, tidak cuma
        // diam-diam refresh list kalau lagi dibuka.
        if (!state.isAdmin && payload.eventType === 'INSERT' && payload.new?.is_published) {
          toast('info', 'Pengumuman Baru', payload.new.title || '');
          showBrowserNotification('Pengumuman Baru', payload.new.title || '');
        }

        if (state.currentPage === 'pengumuman') loadAnnouncements();
        if (state.currentPage === 'beranda') loadBeranda();
        if (state.currentPage === 'admin-pengumuman') loadAdminPengumuman();
      })
      .subscribe();

    state.realtimeChannels.push(announcementChannel);
  } catch (err) {
    console.error('Realtime subscription error:', err);
  }
}

function showBrowserNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body: body,
        icon: './icon.svg',
        badge: './icon.svg'
      });
    } catch (err) {
      console.error('Browser notification error:', err);
    }
  }
}

// Beep notifikasi 2 nada (mirip "ting" WhatsApp) memakai Web Audio API,
// jadi tidak perlu file .mp3/.wav terpisah. Dipakai untuk pesan chat masuk,
// baik di sisi admin maupun peserta, selama aplikasi/tab sedang terbuka.
let sharedNotifAudioCtx = null;
function playNotificationSound() {
  try {
    if (!sharedNotifAudioCtx) {
      sharedNotifAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = sharedNotifAudioCtx;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.12;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.25);
    });
  } catch (err) {
    console.error('Play notification sound error:', err);
  }
}

/* ============================================ */
/* AUTH STATE LISTENER */
/* ============================================ */
supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    hideSplash();
    hide($('#dashboard-wrapper'));
    show($('#auth-wrapper'));
    showAuthPage('reset');
    return;
  }
  if (event === 'SIGNED_IN' && session) {
    if ($('#page-reset').classList.contains('active')) return;
    hideSplash();
    initDashboard();
  } else if (event === 'SIGNED_OUT') {
    state.realtimeChannels.forEach(c => supabase.removeChannel(c));
    state.realtimeChannels = [];
    show($('#auth-wrapper'));
    hide($('#dashboard-wrapper'));
  }
});

/* ============================================ */
/* INIT */
/* ============================================ */
(async () => {
  try {
    const isRecoveryLink = window.location.hash.includes('type=recovery');
    const { data: { session } } = await supabase.auth.getSession();
    hideSplash();

    if (isRecoveryLink) {
      hide($('#dashboard-wrapper'));
      show($('#auth-wrapper'));
      showAuthPage('reset');
    } else if (session) {
      initDashboard();
    } else {
      show($('#auth-wrapper'));
      hide($('#dashboard-wrapper'));
    }
  } catch (err) {
    hideSplash();
    console.error('Init error:', err);
    show($('#auth-wrapper'));
  }
})();

// Fallback hide splash after 5 seconds
setTimeout(hideSplash, 5000);
})();
