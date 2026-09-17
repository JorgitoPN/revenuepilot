import crypto from "node:crypto";
import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY || "";
export const aiEnabled = Boolean(apiKey);
const model = process.env.OPENAI_MODEL || "gpt-5.6";
const client = aiEnabled ? new OpenAI({ apiKey }) : null;

const clamp = n => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

export function scoreOpportunity(o) {
  const score = Math.round(
    clamp(o.demand) * 0.24 +
    (100 - clamp(o.competition)) * 0.20 +
    clamp(o.buyer_intent) * 0.18 +
    clamp(o.price_power) * 0.14 +
    clamp(o.pain) * 0.14 +
    clamp(o.distribution) * 0.10
  );
  let decision = "KILL";
  if (score >= 78 && clamp(o.competition) <= 68 && clamp(o.pain) >= 72) decision = "BUILD";
  else if (score >= 68) decision = "VALIDATE";
  return { score, decision };
}

function extractWebSources(response) {
  const seen = new Set();
  const out = [];
  for (const item of response.output || []) {
    if (item?.type !== "web_search_call") continue;
    const sources = item?.action?.sources || [];
    for (const s of sources) {
      if (!s?.url || seen.has(s.url)) continue;
      seen.add(s.url);
      out.push({ url: s.url, title: s.title || s.url });
    }
  }
  return out.slice(0, 40);
}

function parseJsonOutput(response) {
  const text = response.output_text?.trim();
  if (!text) throw new Error("AI returned an empty response.");
  try { return JSON.parse(text); }
  catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI response was not valid JSON.");
    return JSON.parse(match[0]);
  }
}

export async function researchMarket({ market="US", themes=[], count=8 }) {
  if (!client) throw new Error("OPENAI_API_KEY is not configured.");
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["opportunities"],
    properties: {
      opportunities: {
        type: "array",
        minItems: 4,
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "title","niche","market","problem","demand","competition","buyer_intent",
            "price_power","pain","distribution","price_min_eur","price_max_eur",
            "primary_channel","rationale","evidence"
          ],
          properties: {
            title:{type:"string"},
            niche:{type:"string"},
            market:{type:"string"},
            problem:{type:"string"},
            demand:{type:"integer",minimum:0,maximum:100},
            competition:{type:"integer",minimum:0,maximum:100},
            buyer_intent:{type:"integer",minimum:0,maximum:100},
            price_power:{type:"integer",minimum:0,maximum:100},
            pain:{type:"integer",minimum:0,maximum:100},
            distribution:{type:"integer",minimum:0,maximum:100},
            price_min_eur:{type:"integer",minimum:1,maximum:1000},
            price_max_eur:{type:"integer",minimum:1,maximum:2000},
            primary_channel:{type:"string"},
            rationale:{type:"string"},
            evidence:{type:"array",minItems:2,maxItems:6,items:{type:"string"}}
          }
        }
      }
    }
  };

  const themeText = themes.length ? `Focus themes: ${themes.join(", ")}.` : "";
  const response = await client.responses.create({
    model,
    tools: [{ type: "web_search" }],
    input: `Research the current online market for small, sellable digital business tools and micro-software.
Target market: ${market}. ${themeText}
Find ${count} opportunities where a narrow professional niche has a concrete recurring problem tied to money, time, missed sales, scheduling, quoting, job costing, clients, operations, compliance admin, or workflow.
Use current web evidence. Prefer opportunities with clear buyer intent and realistic distribution channels such as marketplaces, search, communities, or direct outreach.
Avoid generic planners, generic invoice templates, generic social-media calendars, and commodity prompt packs unless evidence strongly contradicts that.
The numeric 0-100 fields are model estimates derived from the web evidence, not measured market statistics.
Return only the requested structured JSON.`,
    text: {
      format: {
        type: "json_schema",
        name: "market_opportunities",
        strict: true,
        schema
      }
    }
  });

  const data = parseJsonOutput(response);
  const sources = extractWebSources(response);
  const opportunities = data.opportunities.map(o => {
    const scored = scoreOpportunity(o);
    const fingerprint=crypto.createHash("sha256").update(`${o.title}|${o.niche}|${o.market}`.toLowerCase()).digest("hex");
    return { ...o, ...scored, fingerprint };
  }).sort((a,b)=>b.score-a.score);

  return {
    scan_id: crypto.randomUUID(),
    model,
    sources,
    opportunities
  };
}

export async function generateProductSpec(opportunity, { languages=["es","en"], targetPriceEur=null }={}) {
  if (!client) throw new Error("OPENAI_API_KEY is not configured.");

  const schema = {
    type:"object",
    additionalProperties:false,
    required:[
      "name","slug","tagline","target_user","archetype","price_eur","default_language","languages",
      "positioning","features","fields","statuses","metrics","copy"
    ],
    properties:{
      name:{type:"string"},
      slug:{type:"string"},
      tagline:{type:"string"},
      target_user:{type:"string"},
      archetype:{type:"string",enum:["job_costing","crm_pipeline","booking_manager","project_tracker"]},
      price_eur:{type:"integer",minimum:5,maximum:500},
      default_language:{type:"string",enum:["es","en","pt","fr"]},
      languages:{type:"array",minItems:1,maxItems:4,items:{type:"string",enum:["es","en","pt","fr"]}},
      positioning:{type:"string"},
      features:{type:"array",minItems:5,maxItems:12,items:{type:"object",additionalProperties:false,required:["key","label_es","label_en","label_pt","label_fr"],properties:{key:{type:"string"},label_es:{type:"string"},label_en:{type:"string"},label_pt:{type:"string"},label_fr:{type:"string"}}}},
      fields:{
        type:"array",minItems:5,maxItems:14,
        items:{
          type:"object",additionalProperties:false,
          required:["key","label_es","label_en","label_pt","label_fr","type","required"],
          properties:{
            key:{type:"string"},
            label_es:{type:"string"},
            label_en:{type:"string"},
            label_pt:{type:"string"},
            label_fr:{type:"string"},
            type:{type:"string",enum:["text","number","date","time","select","textarea"]},
            required:{type:"boolean"}
          }
        }
      },
      statuses:{type:"array",minItems:3,maxItems:9,items:{type:"object",additionalProperties:false,required:["key","label_es","label_en","label_pt","label_fr"],properties:{key:{type:"string"},label_es:{type:"string"},label_en:{type:"string"},label_pt:{type:"string"},label_fr:{type:"string"}}}},
      metrics:{
        type:"array",minItems:3,maxItems:5,
        items:{
          type:"object",additionalProperties:false,
          required:["key","label_es","label_en","label_pt","label_fr","formula"],
          properties:{
            key:{type:"string"},
            label_es:{type:"string"},
            label_en:{type:"string"},
            label_pt:{type:"string"},
            label_fr:{type:"string"},
            formula:{type:"string"}
          }
        }
      },
      copy:{
        type:"object",additionalProperties:false,
        required:["es","en","pt","fr"],
        properties:{
          es:{type:"object",additionalProperties:false,required:["name","tagline","cta","new_record","records","export"],properties:{name:{type:"string"},tagline:{type:"string"},cta:{type:"string"},new_record:{type:"string"},records:{type:"string"},export:{type:"string"}}},
          en:{type:"object",additionalProperties:false,required:["name","tagline","cta","new_record","records","export"],properties:{name:{type:"string"},tagline:{type:"string"},cta:{type:"string"},new_record:{type:"string"},records:{type:"string"},export:{type:"string"}}},
          pt:{type:"object",additionalProperties:false,required:["name","tagline","cta","new_record","records","export"],properties:{name:{type:"string"},tagline:{type:"string"},cta:{type:"string"},new_record:{type:"string"},records:{type:"string"},export:{type:"string"}}},
          fr:{type:"object",additionalProperties:false,required:["name","tagline","cta","new_record","records","export"],properties:{name:{type:"string"},tagline:{type:"string"},cta:{type:"string"},new_record:{type:"string"},records:{type:"string"},export:{type:"string"}}}
        }
      }
    }
  };

  const response = await client.responses.create({
    model,
    input: `Act as a senior SaaS product architect.
Create a focused, commercially credible browser-based business tool for this validated opportunity:
${JSON.stringify({
  title:opportunity.title,niche:opportunity.niche,market:opportunity.market,
  problem:opportunity.problem,price_min_eur:opportunity.price_min_eur,
  price_max_eur:opportunity.price_max_eur,primary_channel:opportunity.primary_channel,
  rationale:opportunity.rationale,evidence:opportunity.evidence
}, null, 2)}

Required languages: ${languages.join(", ")}.
Requested target price: ${targetPriceEur || "choose within researched range"} EUR.

Do not create a toy. Choose the archetype that best matches the workflow.
Fields must be useful to the professional. Metrics formulas use only these supported expressions:
COUNT, SUM:<field>, AVG:<field>, STATUS_COUNT:<status>, JOB_COST, JOB_PROFIT, JOB_MARGIN.
For job_costing, include numeric keys quote, materials, labor_hours, hourly_cost, subcontractors so calculations work.
For crm_pipeline, include amount and status.
For booking_manager, include amount, date, time, status.
For project_tracker, include amount, due_date, status. Use type "select" only for the status field; use text for other categorical data. Statuses must use stable lowercase ASCII keys (for example lead, quoted, in_progress, completed) with translated labels in all four languages. STATUS_COUNT formulas must reference a status key, not a translated label.
All user-visible feature names must include translations in es, en, pt and fr. Return only structured JSON.`,
    text:{ format:{ type:"json_schema", name:"product_spec", strict:true, schema } }
  });
  return parseJsonOutput(response);
}

export function validateProductSpec(spec) {
  const errors=[];
  const fieldList=spec.fields||[];
  const keys=new Set(fieldList.map(f=>f.key));
  if(keys.size!==fieldList.length)errors.push("Duplicate field keys");
  const requiredByType={
    job_costing:["client","quote","materials","labor_hours","hourly_cost","subcontractors","status"],
    crm_pipeline:["amount","status"],
    booking_manager:["amount","date","time","status"],
    project_tracker:["amount","due_date","status"]
  };
  for(const k of requiredByType[spec.archetype]||[]){if(!keys.has(k))errors.push(`Missing required field: ${k}`)}
  const statusList=spec.statuses||[];
  const statusKeys=new Set(statusList.map(s=>s.key));
  if(statusKeys.size!==statusList.length)errors.push("Duplicate status keys");
  const allowedFormulas=["COUNT","JOB_COST","JOB_PROFIT","JOB_MARGIN"];
  for(const m of spec.metrics||[]){
    const f=String(m.formula||"");
    const ok=allowedFormulas.includes(f)||f.startsWith("SUM:")||f.startsWith("AVG:")||f.startsWith("STATUS_COUNT:");
    if(!ok)errors.push(`Unsupported metric formula: ${f}`);
    if((f.startsWith("SUM:")||f.startsWith("AVG:"))&&!keys.has(f.split(":")[1]))errors.push(`Metric references missing field: ${f}`);
    if(f.startsWith("STATUS_COUNT:")&&!statusKeys.has(f.slice(13)))errors.push(`Metric references missing status: ${f}`);
  }
  if(!Array.isArray(spec.languages)||!spec.languages.length)errors.push("At least one language is required");
  if(Array.isArray(spec.languages)&&!spec.languages.includes(spec.default_language))errors.push("Default language must be enabled");
  for(const lang of spec.languages||[]){if(!spec.copy?.[lang])errors.push(`Missing product copy for language: ${lang}`)}
  return {ok:errors.length===0,errors};
}

export async function generateDistribution(product, opportunity) {
  if (!client) throw new Error("OPENAI_API_KEY is not configured.");
  const schema = {
    type:"object",additionalProperties:false,
    required:["marketplace_title","marketplace_description","tags","outreach","short_videos","seo_angles"],
    properties:{
      marketplace_title:{type:"string"},
      marketplace_description:{type:"string"},
      tags:{type:"array",minItems:8,maxItems:13,items:{type:"string"}},
      outreach:{type:"array",minItems:3,maxItems:5,items:{type:"string"}},
      short_videos:{type:"array",minItems:5,maxItems:10,items:{type:"string"}},
      seo_angles:{type:"array",minItems:5,maxItems:10,items:{type:"string"}}
    }
  };
  const response = await client.responses.create({
    model,
    input:`Create a practical launch/distribution pack for this product.
Product: ${JSON.stringify({name:product.name,tagline:product.tagline,target_user:product.target_user,price_cents:product.price_cents,spec:product.spec})}
Opportunity: ${JSON.stringify({niche:opportunity?.niche,market:opportunity?.market,problem:opportunity?.problem,primary_channel:opportunity?.primary_channel})}
Use clear commercial language, not hype. Marketplace tags should be search-intent phrases. Outreach should be permission-based and concise. Return only structured JSON.`,
    text:{format:{type:"json_schema",name:"distribution_pack",strict:true,schema}}
  });
  return parseJsonOutput(response);
}
