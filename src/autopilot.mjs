import 'dotenv/config';
import { getProductBySlug } from './db.mjs';
import { runAutopilot } from './autopilot-core.mjs';

const themes=String(process.env.AUTO_THEMES||'').split(',').map(x=>x.trim()).filter(Boolean);
const languages=String(process.env.AUTO_LANGUAGES||'es,en').split(',').map(x=>x.trim()).filter(Boolean);
const result=await runAutopilot({
  getProductBySlug,
  market:process.env.DEFAULT_MARKET||'US',
  themes,
  autoGenerate:String(process.env.AUTO_GENERATE_PRODUCTS||'false').toLowerCase()==='true',
  autoPublish:String(process.env.AUTO_PUBLISH_PRODUCTS||'false').toLowerCase()==='true',
  minScore:Number(process.env.AUTO_MIN_SCORE||80),
  languages
});
console.log(JSON.stringify({scan_id:result.scan_id,opportunities:result.opportunities.length,candidates:result.candidates.length,generated:result.generated?.name||null},null,2));
