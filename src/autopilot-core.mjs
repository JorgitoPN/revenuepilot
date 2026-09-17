import { initDb, insertOpportunities, getProductByOpportunityId, insertProduct, updateDistribution, updateProductStatus } from './db.mjs';
import { aiEnabled, researchMarket, generateProductSpec, generateDistribution, validateProductSpec } from './ai.mjs';

function safeSlug(input){
  return String(input||'product').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60) || `product-${Date.now()}`;
}

async function uniqueSlug(base, getBySlug){
  let slug=safeSlug(base), n=2;
  while(await getBySlug(slug)){slug=`${safeSlug(base)}-${n++}`}
  return slug;
}

export async function runAutopilot({getProductBySlug, market, themes, autoGenerate, autoPublish, minScore, languages}={}){
  if(!aiEnabled) throw new Error('OPENAI_API_KEY no configurado');
  await initDb();
  const research=await researchMarket({market:market||process.env.DEFAULT_MARKET||'US',themes:themes||[],count:8});
  const opportunities=await insertOpportunities(research.scan_id,research.opportunities,research.sources);
  const candidates=opportunities.filter(o=>o.decision==='BUILD' && o.score>=(minScore||80)).sort((a,b)=>b.score-a.score);
  let generated=null;
  if(autoGenerate && candidates[0]){
    const opp=candidates[0];
    generated=await getProductByOpportunityId(opp.id);
    if(!generated){
      let spec=null,qa=null;
      for(let attempt=1;attempt<=2;attempt++){
        spec=await generateProductSpec(opp,{languages:languages?.length?languages:['es','en'],targetPriceEur:null});
        qa=validateProductSpec(spec);
        if(qa.ok) break;
      }
      if(!qa?.ok) throw new Error(`Autopilot QA failed: ${(qa?.errors||[]).join('; ')}`);
      const slug=await uniqueSlug(spec.slug||spec.name,getProductBySlug);
      generated=await insertProduct({
        opportunity_id:opp.id,slug,name:spec.name,tagline:spec.tagline,target_user:spec.target_user,
        archetype:spec.archetype,price_cents:Number(spec.price_eur)*100,default_language:spec.default_language,
        languages:spec.languages,spec
      });
      const distribution=await generateDistribution(generated,opp);
      generated=await updateDistribution(generated.id,distribution);
      if(autoPublish) generated=await updateProductStatus(generated.id,'published');
    }
  }
  return {scan_id:research.scan_id,sources:research.sources,opportunities,candidates,generated};
}
