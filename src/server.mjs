import "dotenv/config";
import express from "express";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import Stripe from "stripe";
import {
  dbEnabled, dbPing, initDb, listOpportunities, getOpportunity, insertOpportunities,
  listProducts, getProductById, getProductBySlug, getProductByOpportunityId, insertProduct, updateDistribution, updateProductStatus,
  insertOrder, listOrders
} from "./db.mjs";
import { aiEnabled, researchMarket, generateProductSpec, generateDistribution, validateProductSpec } from "./ai.mjs";
import { renderStandaloneProduct, renderShopLanding } from "./product-renderer.mjs";
import { runAutopilot } from "./autopilot-core.mjs";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_SECRET = process.env.ADMIN_SESSION_SECRET || "";
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || "";
const isProd = process.env.NODE_ENV === "production";
const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY, { apiVersion:"2026-07-29.dahlia" }) : null;

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Demasiados intentos de acceso. Inténtalo más tarde." }
});

if (isProd && (!ADMIN_PASSWORD || ADMIN_SECRET.length < 32 || DOWNLOAD_SECRET.length < 32)) {
  throw new Error("ADMIN_PASSWORD, ADMIN_SESSION_SECRET and DOWNLOAD_SECRET (32+ chars) are required in production.");
}

await initDb();

function signAdmin(){
  const body=Buffer.from(JSON.stringify({exp:Date.now()+12*3600_000})).toString("base64url");
  const sig=crypto.createHmac("sha256",ADMIN_SECRET||"dev-secret").update(body).digest("base64url");
  return `${body}.${sig}`;
}
function adminOk(token){
  try{
    const [body,sig]=String(token||"").split(".");
    const expected=crypto.createHmac("sha256",ADMIN_SECRET||"dev-secret").update(body).digest("base64url");
    if(!sig || sig.length!==expected.length || !crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) return false;
    return JSON.parse(Buffer.from(body,"base64url").toString("utf8")).exp > Date.now();
  }catch{return false}
}
function adminOnly(req,res,next){
  if(!adminOk(req.cookies.rp_admin)) return res.status(401).json({error:"No autorizado"});
  next();
}

function signDownload(payload){
  const body=Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig=crypto.createHmac("sha256",DOWNLOAD_SECRET||"dev-download-secret").update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verifyDownload(token){
  const [body,sig]=String(token||"").split(".");
  if(!body||!sig) throw new Error("Token inválido");
  const expected=crypto.createHmac("sha256",DOWNLOAD_SECRET||"dev-download-secret").update(body).digest("base64url");
  if(sig.length!==expected.length || !crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) throw new Error("Firma inválida");
  const payload=JSON.parse(Buffer.from(body,"base64url").toString("utf8"));
  if(Date.now()>payload.exp) throw new Error("Enlace caducado");
  return payload;
}

function safeSlug(input){
  return String(input||"product").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60) || `product-${Date.now()}`;
}

app.post("/webhook/stripe", express.raw({type:"application/json"}), async (req,res)=>{
  try{
    if(!stripe || !STRIPE_WEBHOOK_SECRET) return res.status(400).send("Stripe webhook no configurado");
    const event=stripe.webhooks.constructEvent(req.body,req.headers["stripe-signature"],STRIPE_WEBHOOK_SECRET);
    if(event.type==="checkout.session.completed"){
      const s=event.data.object;
      if(s.payment_status==="paid"){
        await insertOrder({stripe_session_id:s.id,product_id:s.metadata?.product_id||null,customer_email:s.customer_details?.email||s.customer_email||null,amount_total:s.amount_total||0,currency:s.currency||"eur",payment_status:s.payment_status});
      }
    }
    res.json({received:true});
  }catch(e){res.status(400).send(`Webhook error: ${e.message}`)}
});

app.use(helmet({contentSecurityPolicy:false}));
app.use(compression());
app.use(cookieParser());
app.use(express.json({limit:"1mb"}));
app.use(rateLimit({windowMs:60_000,limit:180,standardHeaders:"draft-8",legacyHeaders:false}));
app.use(express.static("public"));

app.get("/health",(req,res)=>res.json({ok:true,db:dbEnabled,ai:aiEnabled,stripe:Boolean(stripe)}));
app.get("/api/preflight",adminOnly,async(req,res)=>{
  const database=await dbPing();
  const checks=[
    {key:"database",label:"PostgreSQL",ok:database.ok,detail:database.ok?`${database.database} · PostgreSQL ${database.version}`:database.error},
    {key:"openai",label:"OpenAI API",ok:aiEnabled,detail:aiEnabled?`Modelo ${process.env.OPENAI_MODEL||"gpt-5.6"}`:"OPENAI_API_KEY no configurado"},
    {key:"stripe",label:"Stripe",ok:Boolean(stripe),detail:stripe?(STRIPE_KEY.startsWith("sk_live_")?"LIVE":"TEST"):"STRIPE_SECRET_KEY no configurado"},
    {key:"webhook",label:"Stripe webhook",ok:Boolean(STRIPE_WEBHOOK_SECRET),detail:STRIPE_WEBHOOK_SECRET?"Secreto configurado":"STRIPE_WEBHOOK_SECRET no configurado"},
    {key:"base_url",label:"URL pública",ok:!isProd||BASE_URL.startsWith("https://"),detail:BASE_URL},
    {key:"admin",label:"Seguridad admin",ok:Boolean(ADMIN_PASSWORD)&&ADMIN_SECRET.length>=32,detail:ADMIN_PASSWORD&&ADMIN_SECRET.length>=32?"OK":"Configura ADMIN_PASSWORD y ADMIN_SESSION_SECRET"},
    {key:"downloads",label:"Descargas firmadas",ok:DOWNLOAD_SECRET.length>=32,detail:DOWNLOAD_SECRET.length>=32?"OK":"DOWNLOAD_SECRET debe tener 32+ caracteres"}
  ];
  res.json({ready:checks.every(c=>c.ok),checks});
});
app.get("/api/status",(req,res)=>res.json({db:dbEnabled,ai:aiEnabled,stripe:Boolean(stripe),stripe_mode:STRIPE_KEY.includes("_live_")?"live":STRIPE_KEY?"test":"off",authenticated:adminOk(req.cookies.rp_admin)}));
app.post("/api/login",loginLimiter,(req,res)=>{
  if(!ADMIN_PASSWORD) return res.status(503).json({error:"ADMIN_PASSWORD no configurado"});
  const a=Buffer.from(String(req.body?.password||"")),b=Buffer.from(ADMIN_PASSWORD);
  if(a.length!==b.length || !crypto.timingSafeEqual(a,b)) return res.status(401).json({error:"Contraseña incorrecta"});
  res.cookie("rp_admin",signAdmin(),{httpOnly:true,sameSite:"strict",secure:isProd,maxAge:12*3600_000});
  res.json({ok:true});
});
app.post("/api/logout",(req,res)=>{res.clearCookie("rp_admin");res.json({ok:true})});
app.get("/api/opportunities",adminOnly,async(req,res)=>{try{res.json(await listOpportunities())}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/radar/scan",adminOnly,async(req,res)=>{
  try{
    if(!dbEnabled) return res.status(503).json({error:"DATABASE_URL no configurado"});
    if(!aiEnabled) return res.status(503).json({error:"OPENAI_API_KEY no configurado"});
    const market=String(req.body?.market||process.env.DEFAULT_MARKET||"US").slice(0,30);
    const themes=Array.isArray(req.body?.themes)?req.body.themes.slice(0,8).map(x=>String(x).slice(0,80)):[];
    const research=await researchMarket({market,themes,count:8});
    const inserted=await insertOpportunities(research.scan_id,research.opportunities,research.sources);
    res.json({scan_id:research.scan_id,model:research.model,sources:research.sources,opportunities:inserted});
  }catch(e){console.error(e);res.status(500).json({error:e.message})}
});
app.post("/api/autopilot/run",adminOnly,async(req,res)=>{
  try{
    if(!dbEnabled) return res.status(503).json({error:"DATABASE_URL no configurado"});
    if(!aiEnabled) return res.status(503).json({error:"OPENAI_API_KEY no configurado"});
    const themes=Array.isArray(req.body?.themes)?req.body.themes.slice(0,8).map(x=>String(x).slice(0,80)):[];
    const languages=Array.isArray(req.body?.languages)?req.body.languages.filter(x=>["es","en","pt","fr"].includes(x)).slice(0,4):["es","en"];
    const result=await runAutopilot({getProductBySlug,market:String(req.body?.market||process.env.DEFAULT_MARKET||"US").slice(0,30),themes,autoGenerate:Boolean(req.body?.auto_generate),autoPublish:false,minScore:Number(req.body?.min_score||80),languages});
    res.json(result);
  }catch(e){console.error(e);res.status(500).json({error:e.message})}
});
app.get("/api/products",adminOnly,async(req,res)=>{try{res.json(await listProducts())}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/products/generate",adminOnly,async(req,res)=>{
  try{
    if(!dbEnabled) return res.status(503).json({error:"DATABASE_URL no configurado"});
    if(!aiEnabled) return res.status(503).json({error:"OPENAI_API_KEY no configurado"});
    const opportunity=await getOpportunity(req.body?.opportunity_id);
    if(!opportunity) return res.status(404).json({error:"Oportunidad no encontrada"});
    const languages=Array.isArray(req.body?.languages)?req.body.languages.filter(x=>["es","en","pt","fr"].includes(x)).slice(0,4):["es","en"];
    let spec=null,validation=null;
    for(let attempt=1;attempt<=2;attempt++){
      spec=await generateProductSpec(opportunity,{languages:languages.length?languages:["es","en"],targetPriceEur:req.body?.target_price_eur||null});
      validation=validateProductSpec(spec); if(validation.ok) break;
    }
    if(!validation?.ok) return res.status(422).json({error:"La especificación generada no superó QA",details:validation?.errors||[]});
    let slug=safeSlug(spec.slug||spec.name); if(await getProductBySlug(slug)) slug=`${slug}-${crypto.randomBytes(3).toString("hex")}`;
    const product=await insertProduct({opportunity_id:opportunity.id,slug,name:spec.name,tagline:spec.tagline,target_user:spec.target_user,archetype:spec.archetype,price_cents:Number(spec.price_eur)*100,default_language:spec.default_language,languages:spec.languages,spec});
    res.json(product);
  }catch(e){console.error(e);res.status(500).json({error:e.message})}
});
app.post("/api/products/:id/distribution",adminOnly,async(req,res)=>{
  try{
    if(!aiEnabled) return res.status(503).json({error:"OPENAI_API_KEY no configurado"});
    const product=await getProductById(req.params.id); if(!product) return res.status(404).json({error:"Producto no encontrado"});
    const opportunity=product.opportunity_id?await getOpportunity(product.opportunity_id):null;
    const updated=await updateDistribution(product.id,await generateDistribution(product,opportunity)); res.json(updated);
  }catch(e){console.error(e);res.status(500).json({error:e.message})}
});
app.post("/api/products/:id/publish",adminOnly,async(req,res)=>{
  try{
    const p=await getProductById(req.params.id); if(!p) return res.status(404).json({error:"Producto no encontrado"});
    const qa=validateProductSpec(p.spec||{}); if(!qa.ok) return res.status(422).json({error:"El producto no supera QA",details:qa.errors});
    if(!p.distribution) return res.status(409).json({error:"Genera primero el pack de distribución"});
    if(!stripe) return res.status(409).json({error:"Configura Stripe antes de publicar un producto vendible"});
    res.json(await updateProductStatus(p.id,"published"));
  }catch(e){console.error(e);res.status(500).json({error:e.message})}
});
async function makeCheckout(p,cancelUrl){
  const suffix=crypto.randomBytes(6).toString("hex").slice(0,8);
  return stripe.checkout.sessions.create({mode:"payment",line_items:[{price_data:{currency:"eur",unit_amount:p.price_cents,product_data:{name:p.name,description:p.tagline}},quantity:1}],success_url:`${BASE_URL}/delivery.html?session_id={CHECKOUT_SESSION_ID}`,cancel_url:cancelUrl,customer_creation:"if_required",metadata:{product_id:p.id,product_slug:p.slug},integration_identifier:`revenuepilot_${suffix}`});
}
app.post("/api/products/:id/checkout",adminOnly,async(req,res)=>{try{if(!stripe)return res.status(503).json({error:"STRIPE_SECRET_KEY no configurado"});const p=await getProductById(req.params.id);if(!p)return res.status(404).json({error:"Producto no encontrado"});res.json({url:(await makeCheckout(p,`${BASE_URL}/`)).url})}catch(e){res.status(500).json({error:e.message})}});
app.get("/shop/:slug",async(req,res)=>{try{const p=await getProductBySlug(req.params.slug);if(!p||p.status!=="published")return res.status(404).send("Producto no disponible");res.type("html").send(renderShopLanding(p))}catch{res.status(500).send("Error al cargar la oferta")}});
app.get("/buy/:slug",async(req,res)=>{try{if(!stripe)return res.status(503).send("Stripe no está configurado");const p=await getProductBySlug(req.params.slug);if(!p||p.status!=="published")return res.status(404).send("Producto no disponible");const s=await makeCheckout(p,`${BASE_URL}/shop/${encodeURIComponent(p.slug)}`);res.redirect(303,s.url)}catch{res.status(500).send("No se pudo iniciar el checkout")}});
app.post("/api/delivery/confirm",async(req,res)=>{
  try{
    if(!stripe) return res.status(503).json({error:"Stripe no configurado"});
    const id=String(req.body?.session_id||""); if(!id.startsWith("cs_")) return res.status(400).json({error:"Sesión inválida"});
    const session=await stripe.checkout.sessions.retrieve(id); if(session.payment_status!=="paid") return res.status(402).json({error:"El pago aún no figura como pagado"});
    const p=session.metadata?.product_id?await getProductById(session.metadata.product_id):null; if(!p) return res.status(404).json({error:"Producto no encontrado"});
    await insertOrder({stripe_session_id:session.id,product_id:p.id,customer_email:session.customer_details?.email||session.customer_email||null,amount_total:session.amount_total||p.price_cents,currency:session.currency||"eur",payment_status:session.payment_status});
    const token=signDownload({product_id:p.id,session_id:session.id,exp:Date.now()+72*3600_000}); res.json({product_name:p.name,download_url:`/download/${encodeURIComponent(token)}`});
  }catch(e){res.status(400).json({error:"No se pudo verificar el pago"})}
});
app.get("/download/:token",async(req,res)=>{
  try{
    const payload=verifyDownload(req.params.token),p=await getProductById(payload.product_id); if(!p) return res.status(404).send("Producto no encontrado");
    if(stripe){const s=await stripe.checkout.sessions.retrieve(payload.session_id);if(s.payment_status!=="paid"||s.metadata?.product_id!==p.id)return res.status(403).send("Compra no verificada")}
    res.setHeader("Content-Disposition",`attachment; filename="${p.slug}.html"`); res.type("html").send(renderStandaloneProduct(p));
  }catch(e){res.status(403).send(e.message)}
});
app.get("/api/orders",adminOnly,async(req,res)=>{try{res.json(await listOrders())}catch(e){res.status(500).json({error:e.message})}});
app.get("/p/:slug",adminOnly,async(req,res)=>{try{const p=await getProductBySlug(req.params.slug);if(!p)return res.status(404).send("Producto no encontrado");res.type("html").send(renderStandaloneProduct(p))}catch{res.status(500).send("Error al cargar producto")}});
app.get("/api/products/:id/export",adminOnly,async(req,res)=>{try{const p=await getProductById(req.params.id);if(!p)return res.status(404).json({error:"Producto no encontrado"});res.setHeader("Content-Disposition",`attachment; filename="${p.slug}.html"`);res.type("html").send(renderStandaloneProduct(p))}catch(e){res.status(500).json({error:e.message})}});

app.listen(PORT,()=>console.log(`RevenuePilot running on ${BASE_URL}`));
