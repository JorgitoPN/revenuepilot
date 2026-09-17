import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderStandaloneProduct, renderShopLanding } from '../src/product-renderer.mjs';

const status=(key,es,en,pt,fr)=>({key,label_es:es,label_en:en,label_pt:pt,label_fr:fr});
const field=(key,es,en,pt,fr,type='text',required=false)=>({key,label_es:es,label_en:en,label_pt:pt,label_fr:fr,type,required});
const metric=(key,es,en,pt,fr,formula)=>({key,label_es:es,label_en:en,label_pt:pt,label_fr:fr,formula});
const copy={
  es:{name:'Producto Demo',tagline:'Herramienta profesional',cta:'Comprar',new_record:'Nuevo registro',records:'Registros',export:'Exportar CSV'},
  en:{name:'Demo Product',tagline:'Professional tool',cta:'Buy',new_record:'New record',records:'Records',export:'Export CSV'},
  pt:{name:'Produto Demo',tagline:'Ferramenta profissional',cta:'Comprar',new_record:'Novo registo',records:'Registos',export:'Exportar CSV'},
  fr:{name:'Produit Démo',tagline:'Outil professionnel',cta:'Acheter',new_record:'Nouvel enregistrement',records:'Enregistrements',export:'Exporter CSV'}
};
const statuses=[status('new','Nuevo','New','Novo','Nouveau'),status('in_progress','En curso','In progress','Em curso','En cours'),status('completed','Completado','Completed','Concluído','Terminé')];

const cases={
  job_costing:{
    fields:[field('client','Cliente','Client','Cliente','Client','text',true),field('job','Trabajo','Job','Trabalho','Travail','text',true),field('quote','Presupuesto','Quote','Orçamento','Devis','number',true),field('materials','Materiales','Materials','Materiais','Matériaux','number'),field('labor_hours','Horas','Hours','Horas','Heures','number'),field('hourly_cost','Coste/hora','Hourly cost','Custo/hora','Coût/heure','number'),field('subcontractors','Subcontratas','Subcontractors','Subcontratados','Sous-traitants','number'),field('status','Estado','Status','Estado','Statut','select',true)],
    metrics:[metric('cost','Coste','Cost','Custo','Coût','JOB_COST'),metric('profit','Beneficio','Profit','Lucro','Bénéfice','JOB_PROFIT'),metric('margin','Margen','Margin','Margem','Marge','JOB_MARGIN')]
  },
  crm_pipeline:{
    fields:[field('client','Cliente','Client','Cliente','Client','text',true),field('deal','Operación','Deal','Negócio','Affaire','text',true),field('amount','Valor','Value','Valor','Valeur','number',true),field('due_date','Cierre','Closing','Fecho','Clôture','date'),field('status','Etapa','Stage','Etapa','Étape','select',true)],
    metrics:[metric('total','Operaciones','Deals','Negócios','Affaires','COUNT'),metric('value','Valor','Value','Valor','Valeur','SUM:amount')]
  },
  booking_manager:{
    fields:[field('client','Cliente','Client','Cliente','Client','text',true),field('service','Servicio','Service','Serviço','Service','text',true),field('amount','Importe','Amount','Valor','Montant','number'),field('date','Fecha','Date','Data','Date','date',true),field('time','Hora','Time','Hora','Heure','time',true),field('status','Estado','Status','Estado','Statut','select',true)],
    metrics:[metric('bookings','Citas','Bookings','Marcações','Rendez-vous','COUNT'),metric('revenue','Ingresos','Revenue','Receitas','Revenus','SUM:amount')]
  },
  project_tracker:{
    fields:[field('project','Proyecto','Project','Projeto','Projet','text',true),field('client','Cliente','Client','Cliente','Client','text'),field('amount','Valor','Value','Valor','Valeur','number'),field('due_date','Entrega','Due date','Prazo','Échéance','date'),field('status','Estado','Status','Estado','Statut','select',true)],
    metrics:[metric('projects','Proyectos','Projects','Projetos','Projets','COUNT'),metric('value','Valor','Value','Valor','Valeur','SUM:amount')]
  }
};

for(const [archetype,c] of Object.entries(cases)){
  const product={id:`test-${archetype}`,slug:`test-${archetype}`,name:`Test ${archetype}`,tagline:'Test runtime',price_cents:3900,default_language:'es',languages:['es','en','pt','fr'],spec:{archetype,features:['Feature one','Feature two'],statuses,fields:c.fields,metrics:c.metrics,copy}};
  const html=renderStandaloneProduct(product);
  if(!html.includes(product.name)||!html.includes('localStorage')) throw new Error(`${archetype}: missing expected HTML`);
  const match=html.match(/<script>([\s\S]*?)<\/script>/);
  if(!match) throw new Error(`${archetype}: embedded script not found`);
  const file=path.join(os.tmpdir(),`rp-${archetype}.js`);
  fs.writeFileSync(file,match[1]);
  const check=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(check.status!==0) throw new Error(`${archetype}: JS syntax failed\n${check.stderr}`);
  const landing=renderShopLanding(product);
  if(!landing.includes(`/buy/${product.slug}`)) throw new Error(`${archetype}: shop link missing`);
  if(!landing.includes('id="lang"') || !landing.includes('rp_shop_lang')) throw new Error(`${archetype}: multilingual shop missing`);
  const lmatch=landing.match(/<script>([\s\S]*?)<\/script>/);
  if(!lmatch) throw new Error(`${archetype}: shop script missing`);
  const lfile=path.join(os.tmpdir(),`rp-shop-${archetype}.js`);
  fs.writeFileSync(lfile,lmatch[1]);
  const lcheck=spawnSync(process.execPath,['--check',lfile],{encoding:'utf8'});
  if(lcheck.status!==0) throw new Error(`${archetype}: shop JS syntax failed\n${lcheck.stderr}`);
  console.log(`OK ${archetype}`);
}
console.log('Renderer QA passed.');
