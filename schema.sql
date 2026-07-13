-- ============================================
-- TABEL COUNTRIES (Negara Tujuan)
-- ============================================
CREATE TABLE countries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  flag_emoji TEXT,
  region TEXT,
  currency TEXT,
  language TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABEL JOB_POSITIONS (Posisi Kerja)
-- ============================================
CREATE TABLE job_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id UUID REFERENCES countries(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT,
  description TEXT,
  requirements TEXT[],
  estimated_departure INTERVAL,
  salary_min NUMERIC,
  salary_max NUMERIC,
  currency TEXT DEFAULT 'USD',
  quota INT,
  filled INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_job_positions_country ON job_positions(country_id);
CREATE INDEX idx_job_positions_active ON job_positions(is_active);

-- ============================================
-- UPDATE TABEL CHAT_MESSAGES (Support Attachments)
-- ============================================
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_type TEXT CHECK (attachment_type IN ('image', 'pdf', 'file'));
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_name TEXT;

-- ============================================
-- UPDATE TABEL ANNOUNCEMENTS (untuk CRUD)
-- ============================================
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT TRUE;

-- ============================================
-- TABEL FORM_DRAFTS (Auto Save)
-- ============================================
CREATE TABLE form_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  form_key TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, form_key)
);

CREATE INDEX idx_form_drafts_user ON form_drafts(user_id);

-- ============================================
-- ENABLE RLS & POLICIES
-- ============================================
ALTER TABLE countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_drafts ENABLE ROW LEVEL SECURITY;

-- Countries policies
CREATE POLICY "Anyone can view active countries" ON countries
  FOR SELECT USING (is_active = TRUE OR EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ));

CREATE POLICY "Admins can manage countries" ON countries
  FOR ALL USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ));

-- Job positions policies
CREATE POLICY "Anyone can view active jobs" ON job_positions
  FOR SELECT USING (is_active = TRUE OR EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ));

CREATE POLICY "Admins can manage jobs" ON job_positions
  FOR ALL USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ));

-- Form drafts policies
CREATE POLICY "Users can manage own drafts" ON form_drafts
  FOR ALL USING (auth.uid() = user_id);

-- Update announcements policies
DROP POLICY IF EXISTS "Anyone can view announcements" ON announcements;
CREATE POLICY "Anyone can view published announcements" ON announcements
  FOR SELECT USING (is_published = TRUE OR EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ));

CREATE POLICY "Admins can manage announcements" ON announcements
  FOR ALL USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ));

-- Update chat policies for attachments
DROP POLICY IF EXISTS "Users can send chat" ON chat_messages;
CREATE POLICY "Users can send chat" ON chat_messages
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================
-- ENABLE REALTIME
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE announcements;
ALTER PUBLICATION supabase_realtime ADD TABLE countries;
ALTER PUBLICATION supabase_realtime ADD TABLE job_positions;

-- ============================================
-- SAMPLE DATA
-- ============================================
INSERT INTO countries (name, code, flag_emoji, region, currency, language) VALUES
  ('Jepang', 'JP', '🇯🇵', 'Asia Timur', 'JPY', 'Jepang'),
  ('Korea Selatan', 'KR', '🇰🇷', 'Asia Timur', 'KRW', 'Korea'),
  ('Taiwan', 'TW', '🇹🇼', 'Asia Timur', 'TWD', 'Mandarin'),
  ('Hong Kong', 'HK', '🇭🇰', 'Asia Timur', 'HKD', 'Kanton'),
  ('Singapura', 'SG', '🇸🇬', 'Asia Tenggara', 'SGD', 'Inggris'),
  ('Malaysia', 'MY', '🇲🇾', 'Asia Tenggara', 'MYR', 'Melayu'),
  ('Arab Saudi', 'SA', '🇸🇦', 'Timur Tengah', 'SAR', 'Arab'),
  ('Uni Emirat Arab', 'AE', '🇦🇪', 'Timur Tengah', 'AED', 'Arab'),
  ('Jerman', 'DE', '🇩🇪', 'Eropa', 'EUR', 'Jerman'),
  ('Australia', 'AU', '🇦🇺', 'Oseania', 'AUD', 'Inggris');

INSERT INTO job_positions (country_id, title, category, requirements, estimated_departure, salary_min, salary_max, currency, quota) VALUES
  ((SELECT id FROM countries WHERE code='JP'), 'Operator Pabrik', 'Manufaktur', 
   ARRAY['SMA/SMK', 'Usia 18-30', 'Sehat jasmani rohani'], '6 months', 120000, 180000, 'JPY', 50),
  ((SELECT id FROM countries WHERE code='JP'), 'Perawat Lansia', 'Kesehatan',
   ARRAY['D3 Keperawatan', 'Sertifikat JLPT N4', 'Pengalaman 1 tahun'], '9 months', 150000, 220000, 'JPY', 30),
  ((SELECT id FROM countries WHERE code='KR'), 'Worker Pabrik', 'Manufaktur',
   ARRAY['SMA/SMK', 'Usia 18-35', 'EPS-TOPIK Pass'], '5 months', 1800000, 2500000, 'KRW', 40),
  ((SELECT id FROM countries WHERE code='TW'), 'Teknisi Elektronik', 'Teknologi',
   ARRAY['SMK Teknik', 'Bahasa Mandarin dasar'], '7 months', 25000, 35000, 'TWD', 25),
  ((SELECT id FROM countries WHERE code='SA'), 'Pekerja Rumah Tangga', 'Household',
   ARRAY['Perempuan', 'Usia 23-40', 'SMA'], '4 months', 1500, 2500, 'SAR', 100);