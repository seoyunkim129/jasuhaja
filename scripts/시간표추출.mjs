// 공식 페이지(글 + 공지 이미지)를 AI에게 읽혀 성인 자유수영 회차와 휴관 공지를 JSON으로 뽑는다.
// CSV는 고치지 않는다. 지금 CSV와 비교해 수정안을 만드는 것은 다음 단계에서 한다.
//
// 실행 예:
//   node scripts/시간표추출.mjs --미리보기                    AI를 부르지 않고 무엇을 보낼지만 보여준다(무료)
//   node scripts/시간표추출.mjs --모델 claude --대상 MP001
//   node scripts/시간표추출.mjs --모델 gemini --변경목록 data/스냅샷/_변경목록.json
// 결과: data/추출/<모델>/<수영장ID>.json
import fs from 'node:fs';
import path from 'node:path';
import { 받기, 글줄, 이미지, 관련구간, 이미지고르기 } from './페이지읽기.mjs';

const 인자 = process.argv.slice(2);
const 값 = 이름 => { const i = 인자.indexOf(이름); return i >= 0 ? 인자[i + 1] : undefined; };
const 종류 = 값('--모델') || 'claude';
const 미리보기 = 인자.includes('--미리보기');
const 설정 = JSON.parse(fs.readFileSync('scripts/감시대상.json', 'utf8'));

const 지시 = `당신은 수영장 공식 페이지에서 "성인 자유수영" 운영 정보를 옮겨 적는 사람입니다.

규칙
- 페이지 글과 이미지에 실제로 적힌 것만 적습니다. 비어 있는 값을 추측해서 채우지 않습니다.
- 성인이 이용할 수 있는 자유수영(자유이용, 일일입장 포함)만 적습니다. 강습, 아쿠아로빅, 어린이·청소년 전용, 유아풀 전용, 단체 대관은 뺍니다.
- 요일구분은 이 표기를 씁니다: 월~금, 토, 일, 공휴일, 일·공휴일, 토·일·공휴일, 월·수·금, 화·목. 다른 조합이면 같은 방식(가운뎃점, 물결)으로 씁니다.
- 시각은 24시간제 HH:MM입니다. "오후 7시"는 19:00입니다.
- 요금은 원 단위 정수입니다. 회원·비회원 구분이 없으면 비회원가격원에 적고 회원가격원은 null입니다. 요금이 안 보이면 둘 다 null입니다.
- 휴관, 임시 운영, 회차 변경, 재개장 같은 공지가 있으면 공지에 적습니다. 공지가 회차 표보다 우선합니다.
- 근거에는 그 값을 읽은 원문 몇 단어, 또는 "이미지 2"처럼 어느 이미지에서 읽었는지 적습니다.
- 페이지에서 자유수영 정보를 찾지 못했으면 회차를 비우고 확신도를 낮음으로 둡니다.`;

const 정수또는없음 = { anyOf: [{ type: 'integer' }, { type: 'null' }] };
const 글또는없음 = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const 스키마 = {
  type: 'object',
  additionalProperties: false,
  required: ['운영상태', '공지', '회차', '확신도', '메모'],
  properties: {
    운영상태: { type: 'string', enum: ['운영', '휴관', '확인불가'] },
    공지: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['내용', '기간', '근거'], properties: { 내용: { type: 'string' }, 기간: 글또는없음, 근거: { type: 'string' } } },
    },
    회차: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['요일구분', '시작시간', '종료시간', '회원가격원', '비회원가격원', '근거'],
        properties: { 요일구분: { type: 'string' }, 시작시간: { type: 'string' }, 종료시간: { type: 'string' }, 회원가격원: 정수또는없음, 비회원가격원: 정수또는없음, 근거: { type: 'string' } },
      },
    },
    확신도: { type: 'string', enum: ['높음', '보통', '낮음'] },
    메모: { type: 'string' },
  },
};

// 모델이 스키마를 어겨도 그대로 쓰지 않게 한 번 더 검사한다(Qwen은 스키마 강제가 없다).
function 검사(결과) {
  const 문제 = [];
  if (!['운영', '휴관', '확인불가'].includes(결과.운영상태)) 문제.push(`운영상태 ${결과.운영상태}`);
  if (!Array.isArray(결과.공지)) 문제.push('공지가 배열이 아님');
  if (!Array.isArray(결과.회차)) 문제.push('회차가 배열이 아님');
  for (const [i, r] of (결과.회차 || []).entries()) {
    if (!r.요일구분) 문제.push(`회차${i + 1} 요일구분 없음`);
    for (const k of ['시작시간', '종료시간']) if (!/^([01]\d|2[0-4]):[0-5]\d$/.test(r[k] ?? '')) 문제.push(`회차${i + 1} ${k} ${r[k]}`);
    for (const k of ['회원가격원', '비회원가격원']) if (r[k] !== null && !Number.isInteger(r[k])) 문제.push(`회차${i + 1} ${k} ${r[k]}`);
  }
  return 문제;
}

async function 한곳(대상, 우선이미지 = []) {
  const html = await 받기(대상);
  const 구간 = 관련구간(글줄(html));
  const 후보 = 이미지(html, 대상.주소).filter(s => !대상.이미지포함 || s.includes(대상.이미지포함));
  const 이미지들 = await 이미지고르기(후보, { 우선주소: 우선이미지 });
  const 글 = [
    `수영장: ${대상.이름} (${대상.수영장ID})`,
    `주소: ${대상.주소}`,
    `이번에 특히 볼 것: ${대상.볼것}${대상.비고 ? ` / ${대상.비고}` : ''}`,
    이미지들.length ? `첨부 이미지 ${이미지들.length}장은 이 페이지에 있던 그림입니다(앞에서부터 이미지 1, 2, …).` : '첨부 이미지 없음.',
    '',
    '--- 페이지 글(수영·시간·요금 관련 줄과 앞뒤 줄) ---',
    구간.join('\n'),
  ].join('\n');
  return { 글, 이미지들 };
}

const { 추출, 모델들 } = 미리보기 ? { 모델들: {} } : await import('./AI모델.mjs');

let 목록 = 설정.대상;
const 우선 = {};
if (값('--변경목록')) {
  const 변경 = JSON.parse(fs.readFileSync(값('--변경목록'), 'utf8')).결과.filter(r => r.상태 === '바뀜' || r.상태 === '처음');
  변경.forEach(r => { 우선[r.수영장ID] = r.새이미지 || []; });
  목록 = 목록.filter(t => t.수영장ID in 우선);
}
if (값('--대상')) { const 고른것 = 값('--대상').split(','); 목록 = 목록.filter(t => 고른것.includes(t.수영장ID)); }

const 폴더 = path.join('data/추출', 종류);
if (!미리보기) fs.mkdirSync(폴더, { recursive: true });
let 합계 = 0;

for (const 대상 of 목록) {
  try {
    const { 글, 이미지들 } = await 한곳(대상, 우선[대상.수영장ID]);
    if (미리보기) {
      console.log(`\n== ${대상.수영장ID} ${대상.이름}: 글 ${글.length}자, 이미지 ${이미지들.length}장`);
      이미지들.forEach((x, i) => console.log(`   이미지 ${i + 1}: ${Math.round(x.바이트.length / 1024)}KB ${x.주소}`));
      continue;
    }
    const 답 = await 추출({ 종류, 지시, 글, 이미지들, 스키마 });
    const 문제 = 검사(답.결과);
    const 저장 = { 수영장ID: 대상.수영장ID, 이름: 대상.이름, 주소: 대상.주소, 모델: 답.모델, 읽은시각: new Date().toISOString(), 이미지: 이미지들.map(x => x.주소), 형식문제: 문제, 입력토큰: 답.입력토큰, 출력토큰: 답.출력토큰, 걸린초: 답.걸린초, 추정비용달러: 답.추정비용달러, ...답.결과 };
    fs.writeFileSync(path.join(폴더, `${대상.수영장ID}.json`), JSON.stringify(저장, null, 2) + '\n');
    합계 += 답.추정비용달러 ?? 0;
    console.log(`${대상.수영장ID} ${답.결과.운영상태} 회차 ${답.결과.회차.length} 공지 ${답.결과.공지.length} 확신도 ${답.결과.확신도} · ${답.걸린초.toFixed(1)}초${답.추정비용달러 != null ? ` · $${답.추정비용달러.toFixed(4)}` : ''}${문제.length ? ` · 형식문제 ${문제.length}` : ''}`);
  } catch (e) {
    console.log(`${대상.수영장ID} 실패: ${e.message}`);
  }
}
if (!미리보기) console.log(`합계 추정비용 $${합계.toFixed(4)} (${모델들[종류]?.이름})`);
