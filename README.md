# RevenuePilot

Sistema full-stack para investigar oportunidades de mercado, generar herramientas digitales verticales, preparar su distribución y venderlas con Stripe.

## Flujo

`Web Search → Evidencia → Scoring → QA → Product Factory → Runtime → Distribution → Publish → Stripe → Delivery`

RevenuePilot no carga scores o ventas ficticias. Si OpenAI, PostgreSQL o Stripe no están configurados, el panel lo muestra como **NO CONFIGURADO**.

## Componentes

- `src/ai.mjs` — investigación web, Structured Outputs, scoring y distribución.
- `src/db.mjs` — PostgreSQL, deduplicación, productos y pedidos.
- `src/product-renderer.mjs` — runtimes de producto y páginas de venta.
- `src/autopilot-core.mjs` — ciclo automático con guardas.
- `src/server.mjs` — API, auth, Stripe, publicación y descargas.
- `public/` — panel administrador.
- `scripts/validate-renderer.mjs` — QA automático de los 4 runtimes.
- `scripts/validate-static.mjs` — comprueba frontend, scripts embebidos y marcadores prohibidos.
- `migrations/001_init.sql` — esquema portable para Supabase/PostgreSQL.

## Desarrollo

```bash
cp .env.example .env
npm install
npm test
npm start
```

Abrir `http://localhost:3000`.

## Producción

Lee [`PRODUCTION_CHECKLIST.md`](./PRODUCTION_CHECKLIST.md).

### Base de datos

RevenuePilot usa PostgreSQL estándar. Para producción puede usar Supabase mediante su connection string/pooler como `DATABASE_URL`; no requiere SDK de Supabase ni cambios de código. Usa un proyecto independiente de BarLive.

### Render

- Runtime: Node
- Node: 22.x
- Build: `npm install --no-audit --no-fund`
- Start: `npm start`
- Health: `/health`
- Región recomendada: Frankfurt

## Seguridad de compra

La página pública nunca decide el precio. `/buy/:slug` obtiene el precio desde PostgreSQL y crea Stripe Checkout en servidor. Después del pago, `/api/delivery/confirm` consulta Stripe, registra el pedido y entrega un token HMAC temporal. `/download/:token` vuelve a verificar la compra antes de generar el HTML completo.

## Autopilot

`npm run autopilot` realiza investigación, deduplica y puntúa. Por defecto **no genera ni publica automáticamente**. La publicación automática queda deshabilitada incluso cuando se ejecuta desde el panel.
