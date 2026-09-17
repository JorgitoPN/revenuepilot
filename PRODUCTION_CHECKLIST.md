# RevenuePilot — Checklist de producción

## Estado del proyecto

El código está preparado para funcionar como servicio Node.js full-stack:

- Panel privado en español.
- Radar con OpenAI Responses API + Web Search.
- Persistencia PostgreSQL.
- Deduplicación de oportunidades.
- Scoring calculado en servidor.
- Generador con Structured Outputs y QA semántico.
- Cuatro runtimes de producto: job costing, CRM/pipeline, reservas y project tracker.
- Productos ES / EN / PT / FR.
- Página pública de venta.
- Stripe Checkout creado en servidor.
- Webhook firmado.
- Verificación server-to-server de la sesión pagada.
- Descarga HMAC firmada con caducidad de 72 horas.
- Pack de distribución generado por IA.
- Autopilot con publicación desactivada por defecto.
- CI de GitHub.

## Staging actual

La instancia Render PostgreSQL `revenuepilot-db` creada para pruebas es **free** y su fecha de expiración indicada por Render es **2026-10-17**. No debe considerarse almacenamiento de producción permanente.

Antes del go-live, utilizar una de estas opciones:

1. PostgreSQL persistente de Render (plan de pago), o
2. un proyecto Supabase/Neon separado dedicado exclusivamente a RevenuePilot.

No reutilizar la base de datos de BarLive.

## Variables obligatorias

```env
NODE_ENV=production
PUBLIC_BASE_URL=https://<dominio>
DATABASE_URL=postgresql://...
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6
STRIPE_SECRET_KEY=rk_test_...   # TEST primero; restricted key recomendada
STRIPE_WEBHOOK_SECRET=whsec_...
ADMIN_PASSWORD=...
ADMIN_SESSION_SECRET=<32+ caracteres>
DOWNLOAD_SECRET=<32+ caracteres>
```

Autopilot:

```env
DEFAULT_MARKET=US
AUTO_THEMES=contractors,local services,professional workflows
AUTO_LANGUAGES=es,en
AUTO_MIN_SCORE=80
AUTO_GENERATE_PRODUCTS=false
AUTO_PUBLISH_PRODUCTS=false
```

## Despliegue TEST

1. Crear repositorio GitHub `JorgitoPN/revenuepilot`.
2. Subir este proyecto a `main`.
3. Crear Web Service Node en Render, región Frankfurt.
4. Build command: `npm install --no-audit --no-fund`.
5. Start command: `npm start`.
6. Configurar las variables anteriores con Stripe TEST.
7. Endpoint de health: `/health`.
8. Registrar webhook Stripe TEST:
   - `https://<servicio>/webhook/stripe`
   - evento mínimo: `checkout.session.completed`
   - recomendado también: `checkout.session.async_payment_succeeded` si se habilitan medios asíncronos.
9. Abrir `/` y ejecutar Preflight.
10. El Preflight debe devolver todos los checks en OK antes de validar el E2E.

## E2E obligatorio

1. Login admin.
2. Radar real genera oportunidades con fuentes.
3. Seleccionar una oportunidad BUILD.
4. Generar producto.
5. QA del producto pasa.
6. Abrir Vista Admin y comprobar datos demo, navegación, idioma y CSV.
7. Generar pack de distribución.
8. Publicar el producto.
9. Abrir `/shop/<slug>`.
10. Completar Stripe TEST.
11. Confirmar que `/delivery.html` verifica la sesión.
12. Descargar el producto.
13. Abrir el HTML descargado y confirmar persistencia local.
14. Confirmar pedido en panel de Ventas.

## Paso TEST → LIVE

No se cambia el código. Cambiar únicamente las credenciales y webhook:

- Restricted key TEST → restricted key LIVE.
- webhook TEST → webhook LIVE.
- `PUBLIC_BASE_URL` → dominio definitivo si cambia.

Antes de LIVE, revisar fiscalidad/IVA. Stripe Tax no se activa automáticamente en RevenuePilot.
