// supabase/functions/delete-account/index.ts
//
// Menghapus akun auth.users milik USER YANG SEDANG LOGIN sendiri (self-service
// account deletion). Ini WAJIB dijalankan lewat Edge Function (bukan langsung
// dari script.js di client) karena supabase.auth.admin.deleteUser() hanya bisa
// dipanggil pakai SERVICE_ROLE key — kalau service_role key ditaruh di client
// (index.html/script.js), siapa pun bisa buka DevTools dan pakai key itu untuk
// menghapus akun ATAU data siapa saja. Jadi key-nya harus tetap di server
// (Edge Function ini), dan yang boleh dihapus HANYA akun milik token JWT yang
// mengirim request (diverifikasi di bawah) — bukan userId sembarangan yang
// dikirim dari client.
//
// CARA DEPLOY:
//   1. Install Supabase CLI kalau belum ada:
//        npm install -g supabase
//   2. Login & hubungkan ke project:
//        supabase login
//        supabase link --project-ref sicqlydgtteqzujvuaks
//   3. Deploy function ini:
//        supabase functions deploy delete-account
//      (SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY otomatis tersedia sebagai
//      env var bawaan di setiap Edge Function, tidak perlu di-set manual.)
//   4. Selesai — script.js sudah otomatis memanggil endpoint ini lewat:
//        POST {SUPABASE_URL}/functions/v1/delete-account
//      dengan header Authorization: Bearer <access_token milik user>.
//
// CATATAN: Kalau tabel-tabel lain (documents, participant_status, dst) sudah
// diberi foreign key `ON DELETE CASCADE` ke auth.users, menghapus baris di
// sini otomatis akan ikut membersihkan sisa data. Tapi script.js di client
// SUDAH menghapus semua baris & file storage lebih dulu sebelum memanggil
// function ini, jadi tetap aman walau belum ada cascade.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace('Bearer ', '').trim();

    if (!jwt) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Client biasa (pakai JWT si pengirim request) — dipakai HANYA untuk
    // memverifikasi siapa yang sedang request, BUKAN untuk operasi admin.
    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser(jwt);
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Client admin (service_role) — HANYA dipakai di sini, di server, untuk
    // benar-benar menghapus akun. userId diambil dari token yang sudah
    // diverifikasi di atas, BUKAN dari body request, supaya user A tidak
    // bisa memicu penghapusan akun user B.
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(user.id);

    if (deleteErr) {
      console.error('delete-account: gagal hapus user', user.id, deleteErr);
      return new Response(JSON.stringify({ error: deleteErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('delete-account: unexpected error', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
