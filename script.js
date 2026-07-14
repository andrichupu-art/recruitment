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
  adminDocs: { data: [], search: '', filterStatus: '', grouped: {}, activeUserId: null },
  adminVerifikasi: { data: [], search: '' },
  scheduleFilter: 'all',
  theme: localStorage.getItem('theme') || 'light',
  autoSaveTimers: {},
  dashboardInitializing: false,
  dashboardReady: false
};

const DOC_TYPES = [
  'KTP', 'KK', 'Akta', 'Ijazah', 'Paspor', 
  'SKCK', 'Surat Izin Orang Tua', 'Buku Nikah', 
  'Sertifikat', 'Foto Full Body', 'Foto Close Up'
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
  'Surat Izin Orang Tua': [['SURAT IZIN', 'IZIN ORANG TUA']],
  'Buku Nikah': [['NIKAH']],
  'Sertifikat': [['SERTIFIKAT', 'CERTIFICATE']]
};

const TIMELINE_STEPS = [
  { step: 1, title: 'Pendaftaran', desc: 'Registrasi akun dan lengkapi data diri' },
  { step: 2, title: 'Verifikasi', desc: 'Verifikasi dokumen dan data peserta' },
  { step: 3, title: 'Interview', desc: 'Wawancara dengan pihak agensi' },
  { step: 4, title: 'Administrasi', desc: 'Pengurusan dokumen administrasi' },
  { step: 5, title: 'Medical', desc: 'Pemeriksaan kesehatan' },
  { step: 6, title: 'Pelatihan', desc: 'Pelatihan kerja dan bahasa' },
  { step: 7, title: 'Paspor', desc: 'Pembuatan paspor' },
  { step: 8, title: 'Visa', desc: 'Pengurusan visa kerja' },
  { step: 9, title: 'Booking Tiket', desc: 'Pemesanan tiket pesawat' },
  { step: 10, title: 'Siap Berangkat', desc: 'Persiapan akhir sebelum berangkat' },
  { step: 11, title: 'Berangkat', desc: 'Keberangkatan ke negara tujuan' }
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

function confirmDialog(title, message, onConfirm, onCancel) {
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  show($('#confirm-modal'));
  
  const okBtn = $('#confirm-ok');
  const cancelBtn = $('#confirm-cancel');
  
  const cleanup = () => {
    hide($('#confirm-modal'));
    okBtn.removeEventListener('click', handleOk);
    cancelBtn.removeEventListener('click', handleCancel);
  };
  
  const handleOk = () => { cleanup(); onConfirm(); };
  const handleCancel = () => { cleanup(); if (typeof onCancel === 'function') onCancel(); };
  
  okBtn.addEventListener('click', handleOk);
  cancelBtn.addEventListener('click', handleCancel);
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

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
      toast('success', 'Aplikasi Terinstall', 'GlobalWork berhasil ditambahkan ke perangkat Anda.');
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
    'admin-dokumen': loadAdminDokumen,
    'admin-jadwal': loadAdminJadwal,
    'admin-pengumuman': loadAdminPengumuman,
    'admin-negara': loadAdminNegara,
    'admin-posisi': loadAdminPosisi
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

$$('.quick-card[data-page]').forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.page));
});

// Kartu statistik Dashboard Admin: klik untuk lompat ke halaman terkait,
// dan otomatis set filter status kalau kartunya punya data-filter-status
// (mis. "Menunggu Review" -> Review Dokumen dengan filter "pending").
$$('.admin-stat-card[data-page]').forEach(item => {
  item.addEventListener('click', () => {
    const page = item.dataset.page;
    const filterStatus = item.dataset.filterStatus;

    if (filterStatus !== undefined && page === 'admin-dokumen') {
      state.adminDocs.filterStatus = filterStatus;
      const filterSelect = $('#admin-doc-filter');
      if (filterSelect) filterSelect.value = filterStatus;
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

/* ============================================ */
/* DASHBOARD INIT */
/* ============================================ */
async function initDashboard() {
  if (state.dashboardInitializing) return;
  state.dashboardInitializing = true;
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
          img.src = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><rect width='100' height='100' fill='%232563eb'/><g transform='translate(31,31) scale(1.6)' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'/><circle cx='12' cy='7' r='4'/></g></svg>`;
        }
      });
    }

    if (state.isAdmin) {
      hide($('#user-nav'));
      show($('#admin-nav'));
      navigateTo('admin-dashboard');
    } else {
      show($('#user-nav'));
      hide($('#admin-nav'));
      navigateTo('beranda');
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
    const [docsRes, progressRes, schedulesRes] = await Promise.all([
      supabase.from('documents').select('id, status').eq('user_id', userId),
      supabase.from('participant_status').select('current_step').eq('user_id', userId).single(),
      supabase.from('schedules').select('id').eq('user_id', userId).eq('status', 'scheduled')
    ]);

    const docs = docsRes.data || [];
    const completedDocs = docs.filter(d => d.status === 'approved').length;
    $('#stat-docs').textContent = `${completedDocs}/11`;
    
    const currentStep = progressRes.data?.current_step || 1;
    const percent = Math.round(((currentStep - 1) / 10) * 100);
    $('#stat-progress').textContent = percent + '%';
    
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
      toast('error', 'Gagal Menyimpan', error.message);
      return;
    }

    // Clear draft
    await supabase.from('form_drafts').delete().eq('user_id', state.user.id).eq('form_key', 'profile');

    state.profile = { ...state.profile, ...updates };
    $('#welcome-name').textContent = updates.full_name;
    $('#sidebar-name').textContent = updates.full_name;
    $('#profile-name-text').textContent = updates.full_name;
    toast('success', 'Profil Diperbarui');
  } catch (err) {
    setLoading(btn, false);
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
    const percent = Math.round((completedCount / 11) * 100);
    
    $('#doc-progress-text').textContent = `${completedCount}/11 Lengkap`;
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

$('#preview-close').addEventListener('click', () => { hide($('#preview-modal')); state.adminDocs.activeUserId = null; });
$('.modal-overlay').addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    hide($('#preview-modal'));
    hide($('#confirm-modal'));
    state.adminDocs.activeUserId = null;
  }
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
      const { data } = await Tesseract.recognize(file, 'eng');
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
      // Gagal OCR (mis. offline/CDN blocked) -> jangan blokir user, lewati pengecekan
      console.warn('OCR check failed, skipping validation:', err);
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
    
    const ext = selectedFile.name.split('.').pop();
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
      const { error: upErr } = await supabase.storage.from('documents').upload(path, selectedFile);
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
      
      const { data: existing } = await supabase
        .from('documents')
        .select('id')
        .eq('user_id', state.user.id)
        .eq('doc_type', docType)
        .single();
      
      let dbErr;
      if (existing) {
        const { error } = await supabase
          .from('documents')
          .update({
            file_url: urlData.publicUrl,
            file_name: selectedFile.name,
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
          file_name: selectedFile.name,
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
    const { data: statusData } = await supabase
      .from('participant_status')
      .select('*')
      .eq('user_id', state.user.id)
      .single();

    const currentStep = statusData?.current_step || 1;
    const percent = Math.round(((currentStep - 1) / 10) * 100);
    
    $('#progress-fill').style.width = percent + '%';
    $('#progress-percent').textContent = percent + '%';
    
    const currentStepInfo = TIMELINE_STEPS.find(s => s.step === currentStep);
    $('#progress-status').textContent = currentStepInfo 
      ? `Sedang: ${currentStepInfo.title}`
      : (percent === 100 ? 'Semua tahapan selesai 🎉' : 'Memuat data...');

    const container = $('#progress-timeline');
    container.innerHTML = TIMELINE_STEPS.map(step => {
      const isCompleted = step.step < currentStep;
      const isCurrent = step.step === currentStep;
      const statusClass = isCompleted ? 'completed' : isCurrent ? 'in_progress' : '';
      
      return `
        <div class="timeline-item ${statusClass}">
          <div class="timeline-title">${step.step}. ${step.title}</div>
          <div class="timeline-desc">${step.desc}</div>
          <div class="timeline-date">
            ${isCompleted ? '✓ Selesai' : isCurrent ? '⏳ Sedang Diproses' : '○ Belum'}
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

function renderChatBubble(m) {
  const isUser = m.sender_role === 'user';
  let attachmentHtml = '';
  
  if (m.attachment_url) {
    if (m.attachment_type === 'image') {
      attachmentHtml = `<div class="attachment" onclick="previewDocument('${m.attachment_url}', 'Lampiran')"><img src="${m.attachment_url}" alt="attachment" /></div>`;
    } else {
      attachmentHtml = `
        <a href="${m.attachment_url}" target="_blank" class="attachment">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span>${escapeHtml(m.attachment_name || 'File')}</span>
        </a>
      `;
    }
  }
  
  return `
    <div class="chat-bubble ${isUser ? 'user' : 'admin'}">
      ${m.message ? escapeHtml(m.message) : ''}
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
    let attachmentName = null;
    
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
      attachmentName = state.chatAttachment.name;
    }

    const { error } = await supabase.from('chat_messages').insert({
      user_id: state.user.id,
      sender_id: state.user.id,
      sender_role: 'user',
      message: message || '[Lampiran]',
      attachment_url: attachmentUrl,
      attachment_type: attachmentType,
      attachment_name: attachmentName
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
    const [totalRes, pendingRes, approvedRes, rejectedRes] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'user'),
      supabase.from('documents').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('documents').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
      supabase.from('documents').select('id', { count: 'exact', head: true }).eq('status', 'rejected')
    ]);

    $('#admin-stat-total').textContent = totalRes.count || 0;
    $('#admin-stat-pending').textContent = pendingRes.count || 0;
    $('#admin-stat-approved').textContent = approvedRes.count || 0;
    $('#admin-stat-rejected').textContent = rejectedRes.count || 0;

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
      .select('*, documents!user_id(status)')
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

    state.adminTable.data = (profiles || []).map(p => {
      const docs = p.documents || [];
      const hasRejected = docs.some(d => d.status === 'rejected');
      const allApproved = docs.length > 0 && docs.every(d => d.status === 'approved');
      
      let status = 'pending';
      if (hasRejected) status = 'rejected';
      else if (allApproved) status = 'approved';
      
      return {
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        phone: p.phone,
        current_step: statusMap[p.id] || 1,
        status
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

function renderAdminTable() {
  const { filtered, page, perPage } = state.adminTable;
  const start = (page - 1) * perPage;
  const end = start + perPage;
  const pageData = filtered.slice(start, end);

  const tbody = $('#admin-table-body');
  
  if (pageData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-loading">Tidak ada data</td></tr>';
  } else {
    tbody.innerHTML = pageData.map((p, i) => `
      <tr>
        <td>${start + i + 1}</td>
        <td>${escapeHtml(p.full_name)}</td>
        <td>${escapeHtml(p.phone || '-')}</td>
        <td>
          <select class="tahapan-inline-select" data-cs-skip="1" data-user-id="${p.id}" data-current-step="${p.current_step}" ${p.status !== 'approved' ? 'disabled title="Approve dokumen dulu sebelum mengubah tahapan"' : ''}>
            ${TIMELINE_STEPS.map(s => `<option value="${s.step}" ${s.step === p.current_step ? 'selected' : ''}>${s.title}</option>`).join('')}
          </select>
        </td>
        <td><span class="status-badge status-${p.status}">${statusLabel(p.status)}</span></td>
        <td>
          <div class="table-actions-cell">
            <div class="table-actions-group">
              <button class="btn-action" onclick="viewParticipantDetail('${p.id}')">Detail</button>
              ${p.status === 'pending' ? `
                <button class="btn-action" onclick="approveParticipant('${p.id}')">Approve</button>
                <button class="btn-action" onclick="rejectParticipant('${p.id}')">Reject</button>
              ` : ''}
            </div>
            <button class="btn-action btn-make-admin-action" onclick="makeAdmin('${p.id}', '${escapeHtml(p.full_name).replace(/'/g, "\\'")}')">Jadikan Admin</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  renderPagination();
}

// Ganti tahapan peserta lewat dropdown inline di tabel Kelola Peserta.
// Delegasi event supaya tetap berfungsi walau tbody di-render ulang.
$('#admin-table-body').addEventListener('change', (e) => {
  const select = e.target.closest('.tahapan-inline-select');
  if (!select) return;

  const userId = select.dataset.userId;
  const oldStep = parseInt(select.dataset.currentStep);
  const newStep = parseInt(select.value);
  if (newStep === oldStep) return;

  const participant = state.adminTable.data.find(p => p.id === userId);
  const fullName = participant?.full_name || 'peserta ini';
  const oldTitle = TIMELINE_STEPS.find(s => s.step === oldStep)?.title || '-';
  const newTitle = TIMELINE_STEPS.find(s => s.step === newStep)?.title || '-';

  confirmDialog(
    'Ubah Tahapan',
    `Pindahkan ${fullName} dari tahap "${oldTitle}" ke "${newTitle}"?`,
    () => updateParticipantStage(userId, newStep, select),
    () => { select.value = oldStep; }
  );
});

window.updateParticipantStage = async function(userId, newStep, selectEl) {
  try {
    const { error } = await supabase
      .from('participant_status')
      .upsert({
        user_id: userId,
        current_step: newStep,
        updated_by: state.user.id,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

    if (error) {
      toast('error', 'Gagal Update Tahapan', error.message);
      if (selectEl) selectEl.value = selectEl.dataset.currentStep;
      return;
    }

    const stepTitle = TIMELINE_STEPS.find(s => s.step === newStep)?.title || '-';

    await supabase.from('notifications').insert({
      user_id: userId,
      title: 'Tahapan Diperbarui',
      message: `Tahapan Anda saat ini: ${stepTitle}`,
      type: 'success'
    });

    // update state lokal supaya konsisten sebelum reload penuh
    const participant = state.adminTable.data.find(p => p.id === userId);
    if (participant) participant.current_step = newStep;
    if (selectEl) selectEl.dataset.currentStep = newStep;

    toast('success', 'Tahapan Diperbarui', `${stepTitle}`);
    loadAdminPeserta();
  } catch (err) {
    console.error('Update tahapan gagal:', err);
    toast('error', 'Gagal Update Tahapan', 'Terjadi kesalahan, coba lagi.');
    if (selectEl) selectEl.value = selectEl.dataset.currentStep;
  }
};

function renderPagination() {
  const { filtered, page, perPage } = state.adminTable;
  const totalPages = Math.ceil(filtered.length / perPage);
  const start = (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, filtered.length);

  const container = $('#admin-pagination');
  if (totalPages === 0) {
    container.innerHTML = '';
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
  XLSX.writeFile(wb, 'peserta-globalwork.xlsx');
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
  doc.text('Data Peserta - GlobalWork', 14, 22);
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

  doc.save('peserta-globalwork.pdf');
  toast('success', 'Export Berhasil', 'File PDF telah diunduh');
});

window.viewParticipantDetail = async function(userId) {
  try {
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
    const { data: docs } = await supabase.from('documents').select('*').eq('user_id', userId);
    const { data: status } = await supabase.from('participant_status').select('*').eq('user_id', userId).single();

    const modal = $('#preview-modal');
    const body = $('#preview-body');
    $('#preview-title').textContent = 'Detail Peserta';

    const docsStatus = docs.some(d => d.status === 'rejected') ? 'rejected' : docs.every(d => d.status === 'approved') ? 'approved' : 'pending';

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
              <div class="detail-doc-icon status-${d.status}">${svgIcon(docIcons[d.status] || docIcons.pending)}</div>
              <span class="detail-doc-name">${d.doc_type}</span>
              <span class="status-badge status-${d.status}">${statusLabel(d.status)}</span>
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

window.rejectParticipant = async function(userId) {
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
/* ADMIN REVIEW DOKUMEN */
/* ============================================ */
async function loadAdminDokumen() {
  try {
    const { data, error } = await supabase
      .from('documents')
      .select('*, profiles!user_id(full_name, email)')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Load admin dokumen error:', error);
      toast('error', 'Gagal Memuat Dokumen', error.message);
    }

    // Kelompokkan dokumen berdasarkan peserta (user_id)
    const grouped = {};
    (data || []).forEach(d => {
      if (!grouped[d.user_id]) {
        grouped[d.user_id] = {
          user_id: d.user_id,
          full_name: d.profiles?.full_name || 'Peserta',
          email: d.profiles?.email || '',
          docs: []
        };
      }
      grouped[d.user_id].docs.push(d);
    });
    state.adminDocs.grouped = grouped;

    let participants = Object.values(grouped);

    if (state.adminDocs.search) {
      const search = state.adminDocs.search.toLowerCase();
      participants = participants.filter(p =>
        p.full_name.toLowerCase().includes(search) ||
        p.email.toLowerCase().includes(search)
      );
    }

    if (state.adminDocs.filterStatus) {
      participants = participants.filter(p => p.docs.some(d => d.status === state.adminDocs.filterStatus));
    }

    participants.sort((a, b) => a.full_name.localeCompare(b.full_name));

    const container = $('#admin-docs-list');
    if (participants.length === 0) {
      container.innerHTML = '<div class="empty-state"><h4>Tidak ada dokumen</h4></div>';
      return;
    }

    container.innerHTML = participants.map(p => {
      const total = p.docs.length;
      const pendingCount = p.docs.filter(d => d.status === 'pending').length;
      const rejectedCount = p.docs.filter(d => d.status === 'rejected').length;
      const overall = rejectedCount > 0 ? 'rejected' : pendingCount > 0 ? 'pending' : 'approved';
      const summary = pendingCount > 0
        ? `${pendingCount} dari ${total} menunggu`
        : rejectedCount > 0
          ? `${rejectedCount} dari ${total} ditolak`
          : `${total} dokumen disetujui`;

      return `
      <div class="doc-participant-card" onclick="viewParticipantDocuments('${p.user_id}')">
        <div class="doc-participant-info">
          <div class="doc-participant-name">${escapeHtml(p.full_name)}</div>
          <div class="card-item-meta">${escapeHtml(p.email)} • ${summary}</div>
        </div>
        <span class="status-badge status-${overall}">${statusLabel(overall)}</span>
        <svg class="doc-participant-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    `;
    }).join('');

    // Kalau modal dokumen peserta sedang terbuka, refresh isinya juga
    if (state.adminDocs.activeUserId && grouped[state.adminDocs.activeUserId]) {
      renderParticipantDocumentsModal(grouped[state.adminDocs.activeUserId]);
    }
  } catch (err) {
    console.error('Load admin dokumen error:', err);
  }
}

window.viewParticipantDocuments = function(userId) {
  const participant = state.adminDocs.grouped[userId];
  if (!participant) return;
  state.adminDocs.activeUserId = userId;
  renderParticipantDocumentsModal(participant);
  show($('#preview-modal'));
};

function renderParticipantDocumentsModal(participant) {
  const body = $('#preview-body');
  $('#preview-title').textContent = participant.full_name;

  body.innerHTML = `
    <div style="padding: 4px; text-align: left;">
      <p class="card-item-meta" style="margin-bottom: 14px;">${escapeHtml(participant.email)}</p>
      <div class="doc-review-grid docs-checklist">
        ${participant.docs.map(d => {
          const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(d.file_url || '');
          return `
          <div class="doc-item status-${d.status}">
            <div class="doc-item-header">
              <div class="doc-item-title">${d.doc_type}</div>
              <div class="doc-item-status ${d.status}">${statusLabel(d.status)}</div>
            </div>
            <div class="doc-item-preview">
              <div class="doc-thumb" onclick="previewDocument('${d.file_url}', '${d.doc_type}')" title="Lihat dokumen">
                ${isImg
                  ? `<img src="${d.file_url}" alt="${escapeHtml(d.doc_type)}" loading="lazy" />`
                  : `<div class="doc-thumb-file"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>`
                }
                <span class="doc-thumb-zoom"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></span>
              </div>
            </div>
            ${d.status === 'pending' ? `
              <div class="table-actions-cell">
                <button class="btn-approve" onclick="approveDocument('${d.id}', '${d.user_id}')">Approve</button>
                <button class="btn-reject" onclick="rejectDocument('${d.id}', '${d.user_id}')">Reject</button>
              </div>
            ` : ''}
            ${d.status === 'rejected' && d.rejection_reason ? `
              <div class="doc-item-reason" style="margin-top: 8px;"><strong>Alasan:</strong> ${escapeHtml(d.rejection_reason)}</div>
            ` : ''}
            <div class="card-item-meta" style="margin-top: 6px;">${formatDate(d.created_at)}</div>
          </div>
        `;
        }).join('')}
      </div>
    </div>
  `;
}

$('#admin-doc-search').addEventListener('input', (e) => {
  state.adminDocs.search = e.target.value;
  loadAdminDokumen();
});

$('#admin-doc-filter').addEventListener('change', (e) => {
  state.adminDocs.filterStatus = e.target.value;
  loadAdminDokumen();
});

window.approveDocument = async function(docId, userId) {
  confirmDialog('Approve Dokumen', 'Setujui dokumen ini?', async () => {
    try {
      await supabase.from('documents').update({ 
        status: 'approved',
        reviewed_by: state.user.id,
        reviewed_at: new Date().toISOString()
      }).eq('id', docId);

      await supabase.from('notifications').insert({
        user_id: userId,
        title: 'Dokumen Disetujui',
        message: 'Dokumen Anda telah disetujui oleh admin.',
        type: 'success'
      });

      toast('success', 'Dokumen Disetujui');
      loadAdminDokumen();
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
    loadAdminDokumen();
  } catch (err) {
    toast('error', 'Error', 'Gagal menolak');
  }
};

/* ============================================ */
/* ADMIN KELOLA JADWAL */
/* ============================================ */
async function loadAdminJadwal() {
  try {
    const { data, error } = await supabase
      .from('schedules')
      .select('*, profiles(full_name)')
      .order('schedule_date', { ascending: true });

    const container = $('#admin-schedules-list');
    if (error || !data || data.length === 0) {
      container.innerHTML = '<div class="empty-state"><h4>Belum ada jadwal</h4></div>';
      return;
    }

    container.innerHTML = data.map(s => `
      <div class="schedule-card type-${s.schedule_type}">
        <div class="schedule-card-header">
          <div>
            <div class="schedule-card-title">${escapeHtml(s.title)}</div>
            <div class="card-item-meta">${escapeHtml(s.profiles?.full_name || 'Peserta')}</div>
          </div>
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
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Load admin jadwal error:', err);
  }
}

$('#btn-add-schedule').addEventListener('click', async () => {
  const modal = $('#preview-modal');
  const body = $('#preview-body');
  $('#preview-title').textContent = 'Tambah Jadwal';

  body.innerHTML = `
    <form id="form-add-schedule" style="display: flex; flex-direction: column; gap: 14px;" novalidate>
      <div class="input-group">
        <label>Peserta</label>
        <select id="schedule-user" required><option value="">Pilih peserta...</option></select>
        <span class="field-error"></span>
      </div>
      <div class="input-group">
        <label>Jenis Jadwal</label>
        <select id="schedule-type" required>
          <option value="Interview">Interview</option>
          <option value="Medical">Medical</option>
          <option value="Pelatihan">Pelatihan</option>
          <option value="Pemberangkatan">Pemberangkatan</option>
        </select>
      </div>
      <div class="input-group">
        <label>Judul</label>
        <input type="text" id="schedule-title" required />
        <span class="field-error"></span>
      </div>
      <div class="input-group">
        <label>Tanggal</label>
        <input type="date" id="schedule-date" required />
        <span class="field-error"></span>
      </div>
      <div class="input-group">
        <label>Waktu</label>
        <input type="time" id="schedule-time" />
      </div>
      <div class="input-group">
        <label>Lokasi</label>
        <input type="text" id="schedule-location" />
      </div>
      <div class="input-group">
        <label>Deskripsi</label>
        <textarea id="schedule-desc" rows="2"></textarea>
      </div>
      <button type="submit" class="btn btn-primary">
        <span class="btn-text">Simpan Jadwal</span>
        <span class="btn-loader hidden"></span>
      </button>
    </form>
  `;

  show(modal);

  try {
    const { data } = await supabase.from('profiles').select('id, full_name').eq('role', 'user');
    const select = $('#schedule-user');
    (data || []).forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.full_name;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error('Load users error:', err);
  }

  $('#form-add-schedule').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm(e.target)) return;
    
    const btn = e.target.querySelector('button[type="submit"]');
    setLoading(btn, true);

    try {
      const { error } = await supabase.from('schedules').insert({
        user_id: $('#schedule-user').value,
        schedule_type: $('#schedule-type').value,
        title: $('#schedule-title').value,
        schedule_date: $('#schedule-date').value,
        schedule_time: $('#schedule-time').value || null,
        location: $('#schedule-location').value || null,
        description: $('#schedule-desc').value || null,
        created_by: state.user.id
      });

      setLoading(btn, false);

      if (error) {
        toast('error', 'Gagal', error.message);
        return;
      }

      await supabase.from('notifications').insert({
        user_id: $('#schedule-user').value,
        title: `Jadwal ${$('#schedule-type').value}`,
        message: `Anda memiliki jadwal ${$('#schedule-type').value} pada ${formatDate($('#schedule-date').value)}`,
        type: 'info'
      });

      toast('success', 'Jadwal Ditambahkan');
      hide(modal);
      loadAdminJadwal();
    } catch (err) {
      setLoading(btn, false);
      toast('error', 'Error', 'Terjadi kesalahan');
    }
  });
});

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
      tbody.innerHTML = '<tr><td colspan="7" class="table-loading">Belum ada data</td></tr>';
      return;
    }

    tbody.innerHTML = data.map(c => `
      <tr>
        <td style="font-size: 24px;">${c.flag_emoji || '🌍'}</td>
        <td><strong>${escapeHtml(c.name)}</strong></td>
        <td>${escapeHtml(c.code || '-')}</td>
        <td>${escapeHtml(c.region || '-')}</td>
        <td>${escapeHtml(c.currency || '-')}</td>
        <td><span class="status-badge status-${c.is_active ? 'approved' : 'rejected'}">${c.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
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

function openCountryModal(existing = null) {
  const modal = $('#preview-modal');
  const body = $('#preview-body');
  $('#preview-title').textContent = existing ? 'Edit Negara' : 'Tambah Negara';

  body.innerHTML = `
    <form id="form-country" style="display: flex; flex-direction: column; gap: 14px;" novalidate>
      <div class="input-group">
        <label>Nama Negara</label>
        <input type="text" id="country-name" value="${escapeHtml(existing?.name || '')}" required />
        <span class="field-error"></span>
      </div>
      <div class="form-grid" style="grid-template-columns: 1fr 1fr;">
        <div class="input-group">
          <label>Kode</label>
          <input type="text" id="country-code" value="${escapeHtml(existing?.code || '')}" maxlength="3" />
        </div>
        <div class="input-group">
          <label>Emoji Bendera</label>
          <input type="text" id="country-flag" value="${escapeHtml(existing?.flag_emoji || '')}" placeholder="🇯🇵" />
        </div>
        <div class="input-group">
          <label>Region</label>
          <input type="text" id="country-region" value="${escapeHtml(existing?.region || '')}" />
        </div>
        <div class="input-group">
          <label>Mata Uang</label>
          <input type="text" id="country-currency" value="${escapeHtml(existing?.currency || '')}" placeholder="USD" />
        </div>
      </div>
      <div class="input-group">
        <label>Bahasa</label>
        <input type="text" id="country-language" value="${escapeHtml(existing?.language || '')}" />
      </div>
      <label class="checkbox-label">
        <input type="checkbox" id="country-active" ${existing?.is_active !== false ? 'checked' : ''} />
        <span>Aktif</span>
      </label>
      <button type="submit" class="btn btn-primary">
        <span class="btn-text">${existing ? 'Update' : 'Simpan'}</span>
        <span class="btn-loader hidden"></span>
      </button>
    </form>
  `;

  show(modal);

  $('#form-country').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm(e.target)) return;
    
    const btn = e.target.querySelector('button[type="submit"]');
    setLoading(btn, true);

    const payload = {
      name: $('#country-name').value.trim(),
      code: $('#country-code').value.trim().toUpperCase(),
      flag_emoji: $('#country-flag').value.trim(),
      region: $('#country-region').value.trim(),
      currency: $('#country-currency').value.trim().toUpperCase(),
      language: $('#country-language').value.trim(),
      is_active: $('#country-active').checked,
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
      tbody.innerHTML = '<tr><td colspan="7" class="table-loading">Belum ada data</td></tr>';
      return;
    }

    tbody.innerHTML = data.map(p => `
      <tr>
        <td><strong>${escapeHtml(p.title)}</strong></td>
        <td>${p.countries?.flag_emoji || ''} ${escapeHtml(p.countries?.name || '-')}</td>
        <td>${escapeHtml(p.category || '-')}</td>
        <td>${p.salary_min && p.salary_max ? `${formatCurrency(p.salary_min, p.currency)} - ${formatCurrency(p.salary_max, p.currency)}` : '-'}</td>
        <td>${p.filled || 0}/${p.quota || 0}</td>
        <td>${p.estimated_departure || '-'}</td>
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
    const { data: countries } = await supabase.from('countries').select('*').eq('is_active', true).order('name');
    (countries || []).forEach(c => {
      countriesHtml += `<option value="${c.id}" ${existing?.country_id === c.id ? 'selected' : ''}>${c.flag_emoji || ''} ${escapeHtml(c.name)}</option>`;
    });
  } catch (err) {
    console.error('Load countries error:', err);
  }

  body.innerHTML = `
    <form id="form-position" style="display: flex; flex-direction: column; gap: 14px;" novalidate>
      <div class="input-group">
        <label>Negara</label>
        <select id="position-country" required>${countriesHtml}</select>
        <span class="field-error"></span>
      </div>
      <div class="form-grid" style="grid-template-columns: 1fr 1fr;">
        <div class="input-group">
          <label>Judul Posisi</label>
          <input type="text" id="position-title" value="${escapeHtml(existing?.title || '')}" required />
          <span class="field-error"></span>
        </div>
        <div class="input-group">
          <label>Kategori</label>
          <input type="text" id="position-category" value="${escapeHtml(existing?.category || '')}" />
        </div>
      </div>
      <div class="input-group">
        <label>Deskripsi</label>
        <textarea id="position-desc" rows="2">${escapeHtml(existing?.description || '')}</textarea>
      </div>
      <div class="input-group">
        <label>Persyaratan (pisahkan dengan koma)</label>
        <textarea id="position-requirements" rows="3" placeholder="SMA/SMK, Usia 18-30, Sehat">${(existing?.requirements || []).join(', ')}</textarea>
      </div>
      <div class="form-grid" style="grid-template-columns: 1fr 1fr 1fr;">
        <div class="input-group">
          <label>Gaji Min</label>
          <input type="number" id="position-salary-min" value="${existing?.salary_min || ''}" />
        </div>
        <div class="input-group">
          <label>Gaji Max</label>
          <input type="number" id="position-salary-max" value="${existing?.salary_max || ''}" />
        </div>
        <div class="input-group">
          <label>Currency</label>
          <input type="text" id="position-currency" value="${escapeHtml(existing?.currency || 'USD')}" />
        </div>
      </div>
      <div class="form-grid" style="grid-template-columns: 1fr 1fr 1fr;">
        <div class="input-group">
          <label>Kuota</label>
          <input type="number" id="position-quota" value="${existing?.quota || ''}" />
        </div>
        <div class="input-group">
          <label>Estimasi Berangkat</label>
          <input type="text" id="position-estimate" value="${escapeHtml(existing?.estimated_departure || '')}" placeholder="6 months" />
        </div>
        <div class="input-group" style="display: flex; align-items: flex-end;">
          <label class="checkbox-label">
            <input type="checkbox" id="position-active" ${existing?.is_active !== false ? 'checked' : ''} />
            <span>Aktif</span>
          </label>
        </div>
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

    const requirements = $('#position-requirements').value.split(',').map(r => r.trim()).filter(r => r);

    const payload = {
      country_id: $('#position-country').value,
      title: $('#position-title').value.trim(),
      category: $('#position-category').value.trim(),
      description: $('#position-desc').value.trim(),
      requirements: requirements,
      salary_min: parseFloat($('#position-salary-min').value) || null,
      salary_max: parseFloat($('#position-salary-max').value) || null,
      currency: $('#position-currency').value.trim().toUpperCase(),
      quota: parseInt($('#position-quota').value) || null,
      estimated_departure: $('#position-estimate').value.trim(),
      is_active: $('#position-active').checked,
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
          showBrowserNotification('Pesan Baru', 'Anda menerima pesan dari admin');
        }
      })
      .subscribe();

    state.realtimeChannels.push(chatChannel);

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
      }, () => {
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
