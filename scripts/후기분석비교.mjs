import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const localEnvPath = path.join(root, '.env.local');
if (fs.existsSync(localEnvPath)) {
  for (const line of fs.readFileSync(localEnvPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
const rubric = JSON.parse(fs.readFileSync(path.join(root, 'analysis', 'review-rubric.json'), 'utf8'));
const baseUrl = process.env.REVIEW_API_BASE || 'https://mulddae-cyan.vercel.app';
const poolLimit = Number(process.env.POOL_LIMIT || 1);
const sampleLimit = Number(process.env.ANALYSIS_LIMIT || 8);
const hfToken = process.env.HF_TOKEN || '';
const hfModel = process.env.HF_MODEL || 'MoritzLaurer/ModernBERT-large-zeroshot-v2.0';

function parseCsvLine(line) {
  const out = []; let value = ''; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && quoted && line[i + 1] === '"') { value += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { out.push(value); value = ''; }
    else value += ch;
  }
  out.push(value); return out;
}

function readPools() {
  const lines = fs.readFileSync(path.join(root, '수영장.csv'), 'utf8').trim().split(/\r?\n/);
  const headers = parseCsvLine(lines.shift());
  return lines.map(line => Object.fromEntries(headers.map((h, i) => [h, parseCsvLine(line)[i] || '']))).slice(0, poolLimit);
}

function stripHtml(text = '') { return text.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'); }
function coreName(name) { return name.replace(/\s|수영장/g, ''); }
function relevant(items, name) { const core = coreName(name); return items.filter(x => coreName(stripHtml(x.title)).includes(core)); }

async function search(query) {
  const response = await fetch(`${baseUrl}/api/cafe-search?q=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error(`후기 검색 실패: ${response.status}`);
  return (await response.json()).items || [];
}

function keywordResult(items, criterion) {
  const evidence = [];
  for (const item of items) {
    const text = stripHtml(`${item.title}. ${item.description}`);
    const positive = criterion.positive.some(word => text.includes(word));
    const negative = criterion.negative.some(word => text.includes(word));
    if (positive || negative) evidence.push({ link: item.link, sentiment: positive && !negative ? 1 : negative && !positive ? -1 : 0, text });
  }
  const score = evidence.length ? evidence.reduce((sum, x) => sum + x.sentiment, 0) / evidence.length : null;
  return { evidenceCount: evidence.length, score, evidence: evidence.slice(0, 3) };
}

async function transformerResult(items) {
  if (!hfToken) return { status: 'skipped', reason: 'HF_TOKEN 없음' };
  const labels = Object.values(rubric.criteria).flatMap(c => [`${c.label} 긍정`, `${c.label} 부정`, `${c.label} 중립`]);
  const rows = [];
  for (const item of items.slice(0, sampleLimit)) {
    const response = await fetch(`https://router.huggingface.co/hf-inference/models/${hfModel}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${hfToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: stripHtml(`${item.title}. ${item.description}`), parameters: { candidate_labels: labels, multi_label: true, hypothesis_template: '이 후기의 내용은 {}이다.' } })
    });
    if (!response.ok) throw new Error(`Transformer 호출 실패: ${response.status} ${await response.text()}`);
    const result = await response.json();
    rows.push({ link: item.link, labels: result.labels?.slice(0, 4), scores: result.scores?.slice(0, 4) });
  }
  return { status: 'complete', model: hfModel, sampleCount: rows.length, rows };
}

function markdown(results) {
  const lines = ['# 후기 분석 방식 비교', '', `실행 시각: ${new Date().toISOString()}`, '', '| 수영장 | 방식 | 표본 | 결과 |', '| --- | --- | ---: | --- |'];
  for (const result of results) {
    const keywordEvidence = Object.values(result.keyword).reduce((sum, x) => sum + x.evidenceCount, 0);
    lines.push(`| ${result.pool} | 키워드 | ${result.reviewCount} | 평가 근거 ${keywordEvidence}건 |`);
    lines.push(`| ${result.pool} | Transformer | ${result.transformer.sampleCount || 0} | ${result.transformer.status}${result.transformer.reason ? ` · ${result.transformer.reason}` : ''} |`);
  }
  lines.push('', '## 비교 기준', '', '- 추출률: 전체 후기 중 평가 근거를 찾은 비율', '- 일치율: 사람이 만든 최소 평가표와 같은 판정을 한 비율', '- 설명 가능성: 판정 근거 문장을 사용자에게 보여줄 수 있는지', '- 비용·속도: 한 시설을 분석하는 호출 수와 실행 시간', '', '> Sonnet/Opus 평가는 사람이 검토할 최소 정답표를 만드는 보조 수단으로 사용하고, 서비스의 실시간 판정 모델로 직접 간주하지 않는다.');
  return lines.join('\n');
}

const results = [];
for (const pool of readPools()) {
  const queries = [`${pool.이름} 자유수영 후기`, `${pool.이름} 자수 후기`, `${pool.이름} 수영장 후기`];
  const all = (await Promise.all(queries.map(search))).flat();
  const deduped = [...new Map(relevant(all, pool.이름).map(item => [item.link, item])).values()];
  const keyword = Object.fromEntries(Object.entries(rubric.criteria).map(([key, criterion]) => [key, keywordResult(deduped, criterion)]));
  let transformer;
  try { transformer = await transformerResult(deduped); } catch (error) { transformer = { status: 'failed', reason: error.message }; }
  results.push({ pool: pool.이름, reviewCount: deduped.length, keyword, transformer });
}

const outputDir = path.join(root, 'analysis', 'results');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'latest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
fs.writeFileSync(path.join(root, 'docs', '후기분석-비교.md'), markdown(results));
console.log(`후기 분석 비교 완료: ${results.length}개 시설`);
