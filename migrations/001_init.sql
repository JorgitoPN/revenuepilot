CREATE TABLE IF NOT EXISTS opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scan_id UUID,
  fingerprint TEXT,
  title TEXT NOT NULL,
  niche TEXT NOT NULL,
  market TEXT NOT NULL,
  problem TEXT NOT NULL,
  demand_score INT NOT NULL CHECK (demand_score BETWEEN 0 AND 100),
  competition_score INT NOT NULL CHECK (competition_score BETWEEN 0 AND 100),
  buyer_intent_score INT NOT NULL CHECK (buyer_intent_score BETWEEN 0 AND 100),
  price_power_score INT NOT NULL CHECK (price_power_score BETWEEN 0 AND 100),
  pain_score INT NOT NULL CHECK (pain_score BETWEEN 0 AND 100),
  distribution_score INT NOT NULL CHECK (distribution_score BETWEEN 0 AND 100),
  score INT NOT NULL CHECK (score BETWEEN 0 AND 100),
  decision TEXT NOT NULL,
  price_min_eur INT NOT NULL,
  price_max_eur INT NOT NULL,
  primary_channel TEXT NOT NULL,
  rationale TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  research_mode TEXT NOT NULL DEFAULT 'web_search',
  status TEXT NOT NULL DEFAULT 'new'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunities_fingerprint ON opportunities(fingerprint) WHERE fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opportunities_created_at ON opportunities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_score ON opportunities(score DESC);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  tagline TEXT NOT NULL,
  target_user TEXT NOT NULL,
  archetype TEXT NOT NULL,
  price_cents INT NOT NULL CHECK (price_cents >= 0),
  default_language TEXT NOT NULL DEFAULT 'es',
  languages JSONB NOT NULL DEFAULT '["es","en"]'::jsonb,
  spec JSONB NOT NULL,
  distribution JSONB,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','published','killed')),
  stripe_payment_link TEXT
);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_opportunity ON products(opportunity_id);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stripe_session_id TEXT UNIQUE NOT NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  customer_email TEXT,
  amount_total INT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'eur',
  payment_status TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_product ON orders(product_id);
