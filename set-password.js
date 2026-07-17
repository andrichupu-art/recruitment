/* ============================================================
   SET PASSWORD BARU — khusus peserta yang baru pertama kali daftar
   lewat Google OAuth. Halaman ini SENGAJA dibuat terpisah dari
   index.html (aplikasi terpisah), jadi script ini mandiri: tidak
   memakai/bergantung pada script.js sama sekali.

   Alur:
   1. Peserta klik "Daftar dengan Google" di index.html -> OAuth
      Google sukses -> index.html mendeteksi (lewat needsPasswordSetup()
      di script.js) bahwa akun ini provider Google & belum pernah
      set password -> redirect ke sini.
   2. Di sini peserta bikin password baru -> disimpan lewat
      supabase.auth.updateUser({ password, data: { password_set: true } }).
      Penanda password_set:true DISIMPAN DI user_metadata (bagian dari
      Supabase Auth, bukan tabel profiles terpisah) — supaya index.html
      tahu di kunjungan berikutnya bahwa peserta ini sudah tidak perlu
      diarahkan ke sini lagi.
   3. Setelah sukses, redirect balik ke index.html -> otomatis masuk
      dashboard seperti alur normal.
   ============================================================ */
(function () {
  'use strict';

  /* ============================================ */
  /* KONFIGURASI SUPABASE (sama persis dengan script.js) */
  /* ============================================ */
  const SUPABASE_URL = 'https://sicqlydgtteqzujvuaks.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpY3FseWRndHRlcXp1anZ1YWtzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NDE1MTcsImV4cCI6MjA5OTUxNzUxN30.CE1VbaKvb66fCrAYymTqQOEPiKG36-de5XoXGTUSOw8';

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  /* ============================================ */
  /* HELPER KECIL (versi mandiri, tidak pinjam dari script.js) */
  /* ============================================ */
  const $ = (sel) => document.querySelector(sel);

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function toast(type, title, message = '') {
    const container = $('#toast-container');
    const icons = {
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
    };
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `
      <div class="toast-icon">${icons[type] || icons.success}</div>
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

  function setLoading(btn, loading) {
    if (!btn) return;
    const text = btn.querySelector('.btn-text');
    const loader = btn.querySelector('.btn-loader');
    if (loading) {
      btn.disabled = true;
      if (text) text.style.opacity = '0.5';
      if (loader) loader.classList.remove('hidden');
    } else {
      btn.disabled = false;
      if (text) text.style.opacity = '1';
      if (loader) loader.classList.add('hidden');
    }
  }

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

  // Sama persis definisinya dengan needsPasswordSetup() di script.js —
  // dijaga identik supaya kedua halaman selalu sepakat soal kapan
  // peserta dianggap "belum set password".
  function needsPasswordSetup(session) {
    const user = session?.user;
    if (!user) return false;
    const provider = user.app_metadata?.provider;
    const passwordAlreadySet = user.user_metadata?.password_set === true;
    return provider === 'google' && !passwordAlreadySet;
  }

  /* ============================================ */
  /* TOGGLE LIHAT PASSWORD */
  /* ============================================ */
  document.querySelectorAll('.toggle-password').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });

  const spPassword = $('#sp-password');
  if (spPassword) {
    spPassword.addEventListener('input', (e) => checkPasswordStrength(e.target.value));
  }

  /* ============================================ */
  /* SUBMIT FORM */
  /* ============================================ */
  $('#form-set-password').addEventListener('submit', async (e) => {
    e.preventDefault();

    const password = $('#sp-password').value;
    const passwordConfirm = $('#sp-password-confirm').value;
    const errPassword = $('#sp-password-error');
    const errConfirm = $('#sp-password-confirm-error');
    errPassword.textContent = '';
    errConfirm.textContent = '';

    if (password.length < 6) {
      errPassword.textContent = 'Password minimal 6 karakter.';
      return;
    }
    if (password !== passwordConfirm) {
      errConfirm.textContent = 'Konfirmasi password tidak cocok.';
      return;
    }

    const btn = e.target.querySelector('button[type="submit"]');
    setLoading(btn, true);

    try {
      const { error } = await supabase.auth.updateUser({
        password,
        data: { password_set: true }
      });

      if (error) {
        setLoading(btn, false);
        toast('error', 'Gagal Menyimpan Password', error.message);
        return;
      }

      toast('success', 'Password Berhasil Dibuat', 'Anda akan diarahkan ke aplikasi...');
      setTimeout(() => {
        window.location.replace('index.html');
      }, 1200);
    } catch (err) {
      setLoading(btn, false);
      toast('error', 'Error', 'Terjadi kesalahan. Silakan coba lagi.');
    }
  });

  /* ============================================ */
  /* GUARD: pastikan halaman ini hanya bisa diakses oleh peserta
     yang memang sedang login & memang belum set password. Kalau
     tidak, lempar balik ke index.html supaya tidak ada orang yang
     buka set-password.html secara langsung/sembarangan. */
  /* ============================================ */
  (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        // Belum login sama sekali -> tidak berhak ada di sini.
        window.location.replace('index.html');
        return;
      }
      if (!needsPasswordSetup(session)) {
        // Sudah pernah set password (atau login via email/password) ->
        // tidak perlu lagi ke halaman ini, langsung ke dashboard.
        window.location.replace('index.html');
        return;
      }
    } catch (err) {
      console.error('Guard set-password.html error:', err);
      window.location.replace('index.html');
    }
  })();
})();
