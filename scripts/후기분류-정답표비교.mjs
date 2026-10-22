// 후기 분류 정답표 비교 - 같은 정답표(docs/후기-정답표.md)로 세 방식을 잰다.
//   A. 옛 키워드 규칙 (analysis/review-rubric.json, 9/20)
//   B. 지금 사이트 규칙 (index.html의 후기주제 표와 네이버문장뽑기, 9/26)
//   C. LLM 분류 (scripts/AI모델.mjs의 추출을 그대로 불러 씀, Gemini·Claude 각 2회)
//
// 실행: node scripts/후기분류-정답표비교.mjs          A·B만
//       node scripts/후기분류-정답표비교.mjs --llm    A·B·C
// 결과: analysis/results/gold-compare-2026-10-22.json
//
// 측정만 한다. 사이트 코드·규칙·데이터는 건드리지 않는다.
import fs from 'node:fs';

const 결과파일 = 'analysis/results/gold-compare-2026-10-22.json';
const 항목들 = ['crowd', 'facility', 'water', 'value'];
const 항목이름 = { crowd: '혼잡 여유도', facility: '시설 쾌적도', water: '수영 환경', value: '가성비' };
const 판정값 = ['긍정', '중립', '부정', '관련없음'];
const 비용한도달러 = 1;

// ─── 정답표: md를 파싱하고 json과 대조한다 ───────────────────────────
// md의 짧은 이름 → 항목 키
const md이름 = { 혼잡: 'crowd', 시설: 'facility', 수질: 'water', 가성비: 'value' };

function 정답표읽기() {
  const md = fs.readFileSync('docs/후기-정답표.md', 'utf8');
  const 정답 = {};
  // "### R001 · 제목" 마다 다음 "### " 또는 "## " 전까지가 한 칸
  const 덩어리들 = md.split(/\n(?=###? )/).filter(x => /^### R\d{3}/.test(x));
  for (const 덩어리 of 덩어리들) {
    const id = 덩어리.match(/^### (R\d{3})/)[1];
    const 판정 = Object.fromEntries(항목들.map(k => [k, '관련없음']));
    // 검수 수정 인용(> ✏️ ...)에도 **혼잡 중립** 같은 말이 있어서, 판단 근거 앞까지만 본다
    const 판정부분 = 덩어리.split('판단 근거')[0];
    for (const [, 이름, 값] of 판정부분.matchAll(/\*\*(혼잡|시설|수질|가성비) (긍정|중립|부정)\*\*/g)) {
      판정[md이름[이름]] = 값;
    }
    정답[id] = { 판정, 검수수정: /검수 수정/.test(덩어리) };
  }
  // 사용자가 검수한 칸: 판정이 붙은 칸 + 검수에서 관련없음으로 바꾼 칸
  const 검수칸 = [];
  for (const [id, x] of Object.entries(정답)) {
    for (const k of 항목들) if (x.판정[k] !== '관련없음') 검수칸.push(`${id}|${k}`);
  }
  // md 표 "| R026 | 시설 | 긍정 | **관련없음** |" 에서 관련없음으로 바뀐 칸
  for (const [, id, 이름] of md.matchAll(/\| (R\d{3}) \| (혼잡|시설|수질|가성비) \| [^|]+\| \*\*관련없음\*\* \|/g)) {
    검수칸.push(`${id}|${md이름[이름]}`);
  }
  // json과 대조 (하네스가 정답을 제대로 읽었는지)
  const json = JSON.parse(fs.readFileSync('analysis/gold/정답표.json', 'utf8'));
  const 차이 = [];
  for (const x of json.항목) {
    for (const k of 항목들) {
      if (정답[x.id]?.판정[k] !== x.판정[k]) 차이.push(`${x.id} ${k}: md=${정답[x.id]?.판정[k]} json=${x.판정[k]}`);
    }
  }
  const 판정붙은글 = new Set(Object.entries(정답).filter(([, x]) => 항목들.some(k => x.판정[k] !== '관련없음')).map(([id]) => id));
  for (const 칸 of 검수칸) 판정붙은글.add(칸.split('|')[0]);
  return { 정답, 검수칸, 판정붙은글, json대조차이: 차이 };
}

const 표본 = JSON.parse(fs.readFileSync('analysis/gold/후기표본.json', 'utf8')).표본;

// ─── A. 옛 키워드 규칙 (정확도측정.py와 같은 입력: 제목. 요약 원문) ────────
function 방식A() {
  const 기준표 = JSON.parse(fs.readFileSync('analysis/review-rubric.json', 'utf8'));
  const 답 = {};
  for (const x of 표본) {
    const 글 = `${x.제목}. ${x.요약}`;
    답[x.id] = {};
    for (const k of 항목들) {
      const 기준 = 기준표.criteria[k];
      const 긍 = 기준.positive.some(w => 글.includes(w)), 부 = 기준.negative.some(w => 글.includes(w));
      답[x.id][k] = 긍 && !부 ? '긍정' : 부 && !긍 ? '부정' : 긍 && 부 ? '중립' : '관련없음';
    }
  }
  return 답;
}

// ─── B. 지금 사이트 규칙: index.html에서 코드를 그대로 꺼내 돌린다 ───────
// 손으로 옮겨 적으면 사이트와 어긋날 수 있어서, 후기주제 표·주제점수·네이버문장뽑기를 잘라 쓴다.
// 사이트는 주제만 붙이고 좋다·나쁘다는 판정하지 않는다. 가성비 주제도 없다.
// 그래서 B의 값은 '관련있음' 또는 '관련없음'뿐이다.
function 방식B() {
  const html = fs.readFileSync('index.html', 'utf8');
  const 자르기 = (시작, 끝) => {
    const i = html.indexOf(시작), j = html.indexOf(끝, i);
    if (i < 0 || j < 0) throw Error(`index.html에서 ${시작}를 찾지 못했습니다`);
    return html.slice(i, j);
  };
  const 코드 = [
    자르기('const 후기주제=[', '// 소수점을'),
    자르기('function 주제점수(', '// 마포아트센터는'),
    자르기('function 네이버문장뽑기(', 'function 안전링크('),
  ].join('\n');
  // 깨끗한글은 브라우저 textarea로 HTML 엔티티를 푸는 함수라 Node용으로 같은 일을 하게 바꾼다
  const 깨끗한글 = s => String(s || '').replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const { 후기주제, 네이버문장뽑기 } = new Function('깨끗한글', `${코드}\nreturn {후기주제, 네이버문장뽑기};`)(깨끗한글);
  const 답 = {};
  const 근거 = {};
  for (const x of 표본) {
    const 뽑힌것 = 네이버문장뽑기([{ title: x.제목, description: x.요약, link: x.id }]);
    답[x.id] = {};
    for (const k of 항목들) {
      const 걸린것 = 뽑힌것.find(y => y.주제 === k);
      답[x.id][k] = 걸린것 ? '관련있음' : '관련없음';
      if (걸린것) 근거[`${x.id}|${k}`] = { 문장: 걸린것.문장, 점수: 걸린것.점수 };
    }
  }
  return { 답, 근거, 주제: 후기주제.map(t => t.키) };
}

// ─── C. LLM 분류 ───────────────────────────────────────────────────
// 판정 기준은 docs/후기-정답표.md의 '읽는 법'과 '판정 기준(사용자 결정)'을 그대로 옮겼다.
// 정답표의 판단 근거 메모는 넣지 않는다(답을 알려주는 셈이라).
const 지시 = `당신은 수영장 후기 분류기입니다. 네이버 카페 검색 결과의 제목과 요약문을 읽고, 글마다 네 항목을 판정합니다.

항목
- crowd (혼잡 여유도): 자유수영 시간에 사람이 많은지·여유로운지
- facility (시설 쾌적도): 샤워실·탈의실·락커·화장실 등 시설 상태나 시설 전반
- water (수영 환경): 수질·수온 등 물 상태
- value (가성비): 이용 요금이 싸다·비싸다는 평가

판정 값
| 값 | 뜻 |
| 긍정 | 그 항목이 좋다고 말함 |
| 중립 | 그 항목 이야기는 하는데 좋다·나쁘다를 확정할 수 없음 |
| 부정 | 그 항목이 나쁘다고 말함 |
| 관련없음 | 그 항목과 관련 없는 글 |

혼잡 항목의 방향에 주의하세요. 긍정 = 여유롭다, 부정 = 붐빈다입니다. "사람이 많다"가 긍정이 되면 안 됩니다.

판정 기준
- 들은 말을 전하는 글도 그 주제를 이야기하고 있으면 관련 있음으로 봅니다.
- 붐빈다·나쁘다고 분명히 말하면 부정, 들은 말을 묻기만 해서 확정할 수 없으면 중립입니다.
- 네이버 검색 API는 카페 본문을 주지 않습니다. 제목과 짧은 요약문만 보고 판정합니다. 요약문이 문장 중간에서 잘려 평가를 확정할 수 없으면 관련없음으로 둡니다.
- 요금·주소·사양을 나열만 하고 좋다·나쁘다가 없으면, 그 항목은 관련없음(요금) 또는 중립(시설 사양)처럼 글이 실제로 말하는 만큼만 판정합니다.

모든 글(id)에 대해 네 항목을 빠짐없이 답하세요.`;

const 값스키마 = { type: 'string', enum: 판정값 };
const 스키마 = {
  type: 'object',
  properties: {
    판정: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, crowd: 값스키마, facility: 값스키마, water: 값스키마, value: 값스키마 },
        required: ['id', 'crowd', 'facility', 'water', 'value'],
        additionalProperties: false,
      },
    },
  },
  required: ['판정'],
  additionalProperties: false,
};

const 글묶음 = 표본.map(x => `[${x.id}]\n제목: ${x.제목}\n요약: ${x.요약}`).join('\n\n');

// AI모델.mjs의 가격표는 claude가 Sonnet 기준이라, 여기서 쓰는 가벼운 모델 값으로 다시 계산한다(2026-10 공식가).
const 가격 = {
  'claude-haiku-5-5': { 입력: 0.10, 출력: 0.50 },
  'gemini-3.8-flash': { 입력: 0.75, 출력: 3.75 }, // AI모델.mjs와 같은 값, 공식 확인 전
};

async function 방식C() {
  if (!process.env.CLAUDE_MODEL) process.env.CLAUDE_MODEL = 'claude-haiku-5-5';
  const { 추출, 모델들 } = await import('./AI모델.mjs');
  const 실행들 = [];
  let 누적비용 = 0;
  for (const 종류 of ['gemini', 'claude']) {
    for (const 회차 of [1, 2]) {
      const 모델 = 모델들[종류].이름;
      if (누적비용 > 비용한도달러) { 실행들.push({ 종류, 회차, 모델, 상태: `건너뜀 · 누적 비용 $${누적비용.toFixed(3)} > $${비용한도달러}` }); continue; }
      console.log(`C. ${종류} ${모델} ${회차}회차 호출 중...`);
      const 시작 = Date.now();
      try {
        const r = await 추출({ 종류, 지시, 글: 글묶음, 스키마 });
        const p = 가격[모델] || 모델들[종류].가격;
        const 비용 = p ? (r.입력토큰 * p.입력 + r.출력토큰 * p.출력) / 1e6 : null;
        누적비용 += 비용 || 0;
        const 답 = {};
        for (const y of r.결과.판정 || []) 답[y.id] = Object.fromEntries(항목들.map(k => [k, y[k]]));
        const 빠진글 = 표본.map(x => x.id).filter(id => !답[id]);
        실행들.push({ 종류, 회차, 모델, 상태: '성공', 걸린초: r.걸린초, 입력토큰: r.입력토큰, 출력토큰: r.출력토큰, 추정비용달러: 비용, 빠진글, 답 });
        console.log(`   ${r.걸린초.toFixed(1)}초 · 입력 ${r.입력토큰} · 출력 ${r.출력토큰} · $${비용?.toFixed(4)}${빠진글.length ? ` · 빠진 글 ${빠진글.join(',')}` : ''}`);
      } catch (e) {
        // 키 값이 오류문에 섞일 일은 없지만, 혹시 몰라 긴 영숫자 덩어리는 가린다
        const 오류 = String(e.message).replace(/[A-Za-z0-9_-]{30,}/g, '***').slice(0, 300);
        실행들.push({ 종류, 회차, 모델, 상태: `실패: ${오류}`, 걸린초: (Date.now() - 시작) / 1000 });
        console.log(`   실패: ${오류}`);
      }
    }
  }
  return { 실행들, 누적비용 };
}

// ─── 채점 ─────────────────────────────────────────────────────────
// 정답이 관련없음인 칸은 대부분 사람이 검수하지 않은 칸이다(평가 내용 없음 20건 + 판정 붙은 글의 나머지 항목).
// 그래서 숫자를 세 가지로 나눠 센다.
//   재현율·방향: 사람이 검수한 '관련 있음' 15칸 기준 (확정)
//   정밀도: 옛 정확도측정.py와 같은 정의(37건 × 항목 전체, 관련없음 칸도 정답으로 봄). 비교용
//   검수 안 한 20건에서 무언가를 판정한 칸 수: 참고치
function 채점(답, 정답표, 볼항목 = 항목들) {
  const { 정답, 판정붙은글 } = 정답표;
  const 혼동 = Object.fromEntries(판정값.map(a => [a, Object.fromEntries([...판정값, '관련있음'].map(b => [b, 0]))]));
  const 항목별 = {};
  let 오탐목록 = [], 누락목록 = [], 방향틀림 = [];
  for (const k of 볼항목) {
    let 적중 = 0, 오탐 = 0, 누락 = 0, 방향 = 0, 미검수글판정 = 0, 검수글오탐 = 0;
    for (const x of 표본) {
      const 참 = 정답[x.id].판정[k], 예 = 답[x.id]?.[k] ?? '관련없음';
      혼동[참][예] = (혼동[참][예] ?? 0) + 1;
      const 참관련 = 참 !== '관련없음', 예관련 = 예 !== '관련없음';
      if (참관련 && 예관련) { 적중++; if (참 === 예) 방향++; else 방향틀림.push(`${x.id} ${k} 정답 ${참} / 예측 ${예}`); }
      else if (!참관련 && 예관련) {
        오탐++; 오탐목록.push(`${x.id} ${k} ${예}`);
        if (판정붙은글.has(x.id)) 검수글오탐++; else 미검수글판정++;
      } else if (참관련 && !예관련) { 누락++; 누락목록.push(`${x.id} ${k} 정답 ${참}`); }
    }
    항목별[k] = { 항목: 항목이름[k], 정답관련: 적중 + 누락, 예측관련: 적중 + 오탐, 적중, 오탐, 누락, 방향까지맞음: 방향, 검수글_다른항목_오탐: 검수글오탐, 미검수20건_판정수: 미검수글판정 };
  }
  const 합 = f => Object.values(항목별).reduce((s, r) => s + r[f], 0);
  const 적중 = 합('적중'), 오탐 = 합('오탐'), 누락 = 합('누락');
  return {
    볼항목,
    전체: {
      정답관련: 적중 + 누락, 예측관련: 적중 + 오탐, 적중, 오탐, 누락,
      정밀도: 적중 + 오탐 ? +(적중 / (적중 + 오탐)).toFixed(3) : null,
      재현율: 적중 + 누락 ? +(적중 / (적중 + 누락)).toFixed(3) : null,
      방향까지맞음: 합('방향까지맞음'),
      검수글_다른항목_오탐: 합('검수글_다른항목_오탐'),
      미검수20건_판정수: 합('미검수20건_판정수'),
    },
    항목별, 혼동표: 혼동, 오탐목록, 누락목록, 방향틀림,
  };
}

function 두번차이(a, b) {
  const 다른칸 = [];
  for (const x of 표본) for (const k of 항목들) {
    const p = a[x.id]?.[k] ?? '(없음)', q = b[x.id]?.[k] ?? '(없음)';
    if (p !== q) 다른칸.push(`${x.id} ${k}: ${p} → ${q}`);
  }
  return 다른칸;
}

// ─── 실행 ─────────────────────────────────────────────────────────
const 정답표 = 정답표읽기();
const 출력 = {
  측정일: '2026-10-22',
  정답표: {
    파일: 'docs/후기-정답표.md',
    표본수: 표본.length,
    검수칸수: 정답표.검수칸.length,
    검수칸: 정답표.검수칸,
    정답_관련있음칸: 정답표.검수칸.filter(c => { const [id, k] = c.split('|'); return 정답표.정답[id].판정[k] !== '관련없음'; }).length,
    판정붙은글수: 정답표.판정붙은글.size,
    json대조차이: 정답표.json대조차이,
  },
  방식: {},
};

const A = 방식A();
출력.방식.A = { 이름: '옛 키워드 규칙 (analysis/review-rubric.json)', 판정: A, 채점: 채점(A, 정답표) };

const B = 방식B();
출력.방식.B = {
  이름: '현재 사이트 규칙 (index.html 후기주제·네이버문장뽑기)',
  메모: '주제만 붙이고 방향은 판정하지 않음. 가성비 주제 없음.',
  판정: B.답, 근거: B.근거,
  채점_4항목: 채점(B.답, 정답표),
  채점_사이트3항목: 채점(B.답, 정답표, B.주제),
};
// 참고: 보조 말(점수 1 이하)만 걸린 칸을 빼고 핵심 말(점수 2 이상)만 남기면 어떻게 되는지
const B핵심 = Object.fromEntries(Object.entries(B.답).map(([id, v]) => [id, Object.fromEntries(항목들.map(k =>
  [k, (B.근거[`${id}|${k}`]?.점수 ?? 0) >= 1.5 ? '관련있음' : '관련없음']))]));
출력.방식.B.참고_핵심말만_3항목 = 채점(B핵심, 정답표, B.주제);

if (process.argv.includes('--llm')) {
  const C = await 방식C();
  출력.방식.C = { 이름: 'LLM 분류 (scripts/AI모델.mjs 추출)', 누적추정비용달러: +C.누적비용.toFixed(4), 실행들: [] };
  for (const 종류 of ['gemini', 'claude']) {
    const 둘 = C.실행들.filter(r => r.종류 === 종류);
    for (const r of 둘) 출력.방식.C.실행들.push(r.답 ? { ...r, 채점: 채점(r.답, 정답표) } : r);
    const 성공 = 둘.filter(r => r.답);
    if (성공.length === 2) 출력.방식.C[`${종류}_재현성`] = { 다른칸수: 두번차이(성공[0].답, 성공[1].답).length, 다른칸: 두번차이(성공[0].답, 성공[1].답) };
  }
} else if (fs.existsSync(결과파일)) {
  // --llm 없이 다시 돌리면 앞서 받은 LLM 결과를 지우지 않고 다시 채점만 한다
  const 전 = JSON.parse(fs.readFileSync(결과파일, 'utf8')).방식?.C;
  if (전) {
    전.실행들 = 전.실행들.map(r => r.답 ? { ...r, 채점: 채점(r.답, 정답표) } : r);
    출력.방식.C = 전;
  }
}

fs.mkdirSync('analysis/results', { recursive: true });
fs.writeFileSync(결과파일, JSON.stringify(출력, null, 2) + '\n');

// 요약 출력
const 퍼 = v => v == null ? '-' : `${Math.round(v * 100)}%`;
const 줄 = (이름, s) => `| ${이름} | ${s.전체.정답관련} | ${s.전체.예측관련} | ${s.전체.적중} | ${s.전체.오탐} | ${s.전체.누락} | ${퍼(s.전체.정밀도)} | ${퍼(s.전체.재현율)} | ${s.전체.방향까지맞음} | ${s.전체.미검수20건_판정수} |`;
console.log(`\n정답표: 검수 칸 ${출력.정답표.검수칸수} (관련 있음 ${출력.정답표.정답_관련있음칸}) · md↔json 차이 ${정답표.json대조차이.length}건`);
console.log('| 방식 | 정답 | 예측 | 적중 | 오탐 | 누락 | 정밀도 | 재현율 | 방향 | 미검수20건 판정 |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
console.log(줄('A 옛 키워드', 출력.방식.A.채점));
console.log(줄('B 사이트 규칙(4항목)', 출력.방식.B.채점_4항목));
console.log(줄('B 사이트 규칙(3항목)', 출력.방식.B.채점_사이트3항목));
for (const r of 출력.방식.C?.실행들 || []) if (r.채점) console.log(줄(`C ${r.모델} #${r.회차}`, r.채점));
