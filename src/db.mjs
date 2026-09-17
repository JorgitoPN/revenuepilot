import pg from "pg";
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || "";
export const dbEnabled = Boolean(DATABASE_URL);

export const pool = dbEnabled ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 8,
}) : null;

export async function initDb() {
  if (!pool) return;
  await pool.query(`
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

    ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS fingerprint TEXT;
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
      price_cents INT NOT NULL,
      default_language TEXT NOT NULL DEFAULT 'es',
      languages JSONB NOT NULL DEFAULT '["es","en"]'::jsonb,
      spec JSONB NOT NULL,
      distribution JSONB,
      status TEXT NOT NULL DEFAULT 'draft',
      stripe_payment_link TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at DESC);

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
  `);
}

export async function dbPing() {
  if (!pool) return { ok:false, error:"DATABASE_URL no configurado" };
  try {
    const { rows } = await pool.query(`SELECT current_database() AS database, current_setting('server_version') AS version`);
    return { ok:true, database:rows[0]?.database, version:rows[0]?.version };
  } catch (e) {
    return { ok:false, error:e.message };
  }
}

export async function listOpportunities(limit=100) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT * FROM opportunities ORDER BY created_at DESC, score DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function getOpportunity(id) {
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT * FROM opportunities WHERE id=$1`, [id]);
  return rows[0] || null;
}

export async function insertOpportunities(scanId, opportunities, sources) {
  if (!pool) throw new Error("Database not configured");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = [];
    for (const o of opportunities) {
      const { rows } = await client.query(`
        INSERT INTO opportunities (
          scan_id,fingerprint,title,niche,market,problem,
          demand_score,competition_score,buyer_intent_score,price_power_score,pain_score,distribution_score,
          score,decision,price_min_eur,price_max_eur,primary_channel,rationale,evidence,sources,research_mode
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb,'web_search'
        )
        ON CONFLICT (fingerprint) WHERE fingerprint IS NOT NULL DO UPDATE SET
          created_at=now(), scan_id=EXCLUDED.scan_id, title=EXCLUDED.title, niche=EXCLUDED.niche, market=EXCLUDED.market, problem=EXCLUDED.problem,
          demand_score=EXCLUDED.demand_score, competition_score=EXCLUDED.competition_score, buyer_intent_score=EXCLUDED.buyer_intent_score,
          price_power_score=EXCLUDED.price_power_score, pain_score=EXCLUDED.pain_score, distribution_score=EXCLUDED.distribution_score,
          score=EXCLUDED.score, decision=EXCLUDED.decision, price_min_eur=EXCLUDED.price_min_eur, price_max_eur=EXCLUDED.price_max_eur,
          primary_channel=EXCLUDED.primary_channel, rationale=EXCLUDED.rationale, evidence=EXCLUDED.evidence, sources=EXCLUDED.sources
        RETURNING *
      `, [
        scanId,o.fingerprint,o.title,o.niche,o.market,o.problem,
        o.demand,o.competition,o.buyer_intent,o.price_power,o.pain,o.distribution,
        o.score,o.decision,o.price_min_eur,o.price_max_eur,o.primary_channel,o.rationale,
        JSON.stringify(o.evidence || []),JSON.stringify(sources || [])
      ]);
      inserted.push(rows[0]);
    }
    await client.query("COMMIT");
    return inserted;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function listProducts() {
  if (!pool) return [];
  const { rows } = await pool.query(`
    SELECT id, opportunity_id, created_at, updated_at, slug, name, tagline, target_user, archetype,
           price_cents, default_language, languages, status, stripe_payment_link,
           distribution IS NOT NULL AS has_distribution
    FROM products ORDER BY created_at DESC
  `);
  return rows;
}

export async function getProductById(id) {
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT * FROM products WHERE id=$1`, [id]);
  return rows[0] || null;
}

export async function getProductBySlug(slug) {
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT * FROM products WHERE slug=$1`, [slug]);
  return rows[0] || null;
}

export async function getProductByOpportunityId(opportunityId) {
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT * FROM products WHERE opportunity_id=$1 ORDER BY created_at DESC LIMIT 1`, [opportunityId]);
  return rows[0] || null;
}

export async function updateProductStatus(productId, status) {
  if (!pool) throw new Error("Database not configured");
  const allowed=["draft","ready","published","killed"];
  if(!allowed.includes(status)) throw new Error("Invalid product status");
  const { rows } = await pool.query(`UPDATE products SET status=$2, updated_at=now() WHERE id=$1 RETURNING *`, [productId,status]);
  return rows[0] || null;
}

export async function insertProduct(product) {
  if (!pool) throw new Error("Database not configured");
  const { rows } = await pool.query(`
    INSERT INTO products (
      opportunity_id,slug,name,tagline,target_user,archetype,price_cents,default_language,languages,spec,status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,'draft')
    RETURNING *
  `, [
    product.opportunity_id,product.slug,product.name,product.tagline,product.target_user,product.archetype,
    product.price_cents,product.default_language,JSON.stringify(product.languages),JSON.stringify(product.spec)
  ]);
  return rows[0];
}

export async function updateDistribution(productId, distribution) {
  const { rows } = await pool.query(`
    UPDATE products SET distribution=$2::jsonb, status=CASE WHEN status='draft' THEN 'ready' ELSE status END, updated_at=now() WHERE id=$1 RETURNING *
  `, [productId, JSON.stringify(distribution)]);
  return rows[0] || null;
}

export async function updateStripeLink(productId, link) {
  const { rows } = await pool.query(`
    UPDATE products SET stripe_payment_link=$2, updated_at=now() WHERE id=$1 RETURNING *
  `, [productId, link]);
  return rows[0] || null;
}

export async function insertOrder(order) {
  if (!pool) return null;
  const { rows } = await pool.query(`
    INSERT INTO orders(stripe_session_id,product_id,customer_email,amount_total,currency,payment_status)
    VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT (stripe_session_id) DO UPDATE SET
      customer_email=EXCLUDED.customer_email,
      amount_total=EXCLUDED.amount_total,
      currency=EXCLUDED.currency,
      payment_status=EXCLUDED.payment_status
    RETURNING *
  `, [order.stripe_session_id,order.product_id,order.customer_email,order.amount_total,order.currency,order.payment_status]);
  return rows[0];
}

export async function listOrders() {
  if (!pool) return [];
  const { rows } = await pool.query(`
    SELECT o.*, p.name AS product_name
    FROM orders o LEFT JOIN products p ON p.id=o.product_id
    ORDER BY o.created_at DESC LIMIT 500
  `);
  return rows;
}
