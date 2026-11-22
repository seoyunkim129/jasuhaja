// 3단계 AI 추출 결과(data/추출/<모델>/<수영장ID>.json)를 지금 자유수영시간.csv와 비교해 사람이 읽을 수정안을 만든다.
// "월~금"과 "월·수·금 + 화·목"처럼 표기만 다른 것은 요일 하나하나로 풀어서(월 08:00, 화 08:00 …) 같은 것으로 본다.
//
// 실행 예:
//   node scripts/수정안만들기.mjs --모델 claude --대상 MP003      수정안만 보여준다(CSV는 그대로)
//   node scripts/수정안만들기.mjs --모델 claude --적용             새 회차 추가 + 확인된 줄의 확인일 갱신
// 결과: data/수정안/<모델>.md (사람용), data/수정안/<모델>.json (기계용)
//
// --적용은 "추가"와 "확인일 갱신"만 한다. 빠진 회차 삭제·요금 변경·휴관은 사람이 원본을 보고 직접 고친다.
import fs from 'node:fs';
import path from 'node:path';

const 인자 = process.argv.slice(2);
const 값 = 이름 => { const i = 인자.indexOf(이름); return i >= 0 ? 인자[i + 1] : undefined; };
const 종류 = 값('--모델') || 'claude';
const 적용 = 인자.includes('--적용');
const 시간표파일 = '자유수영시간.csv';

const 요일순서 = ['월', '화', '수', '목', '금', '토', '일', '공휴일'];

// "월~금", "일·공휴일", "평일·토", "월·수·금" → ['월','화',…]
function 요일풀기(표기) {
  const 결과 = new Set();
  for (const 조각 of String(표기).replace(/요일/g, '').split(/[·,\/\s]+/).filter(Boolean)) {
    if (조각 === '평일') ['월', '화', '수', '목', '금'].forEach(d => 결과.add(d));
    else if (조각.includes('~')) {
      const [a, b] = 조각.split('~');
      const i = 요일순서.indexOf(a), j = 요일순서.indexOf(b);
      if (i < 0 || j < 0) throw Error(`모르는 요일 범위: ${표기}`);
      요일순서.slice(i, j + 1).forEach(d => 결과.add(d));
    } else if (요일순서.includes(조각)) 결과.add(조각);
    else throw Error(`모르는 요일: ${표기}`);
  }
  return 요일순서.filter(d => 결과.has(d));
}

// 요일 묶음을 CSV 표기로 되돌린다: [월..금] → "월~금", [일, 공휴일] → "일·공휴일"
function 요일묶기(요일들) {
  const 평일 = ['월', '화', '수', '목', '금'];
  if (평일.every(d => 요일들.includes(d))) return ['월~금', ...요일들.filter(d => !평일.includes(d))].join('·');
  return 요일들.join('·');
}

function CSV줄나누기(줄) {
  const 칸 = []; let 값 = '', 따옴표 = false;
  for (let i = 0; i < 줄.length; i++) {
    const c = 줄[i];
    if (c === '"') { if (따옴표 && 줄[i + 1] === '"') { 값 += '"'; i++; } else 따옴표 = !따옴표; }
    else if (c === ',' && !따옴표) { 칸.push(값); 값 = ''; }
    else 값 += c;
  }
  칸.push(값);
  return 칸;
}
const CSV칸 = v => /[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');

const 원문 = fs.readFileSync(시간표파일, 'utf8');
const 줄끝 = 원문.includes('\r\n') ? '\r\n' : '\n';
const 줄들 = 원문.replace(/\r?\n$/, '').split(/\r?\n/);
const 머리 = CSV줄나누기(줄들[0]);
const 행들 = 줄들.slice(1).map((줄, i) => ({ 번호: i + 1, 칸: Object.fromEntries(CSV줄나누기(줄).map((v, k) => [머리[k], v])) }));

const 폴더 = path.join('data/추출', 종류);
let 파일들 = fs.readdirSync(폴더).filter(f => /^[A-Z]{2}\d{3}\.json$/.test(f));
if (값('--대상')) { const 고른것 = 값('--대상').split(','); 파일들 = 파일들.filter(f => 고른것.includes(f.slice(0, 5))); }

const 오늘 = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const 보고 = [];

for (const 파일 of 파일들) {
  const 추출 = JSON.parse(fs.readFileSync(path.join(폴더, 파일), 'utf8'));
  const id = 추출.수영장ID;
  const 지금행 = 행들.filter(r => r.칸.수영장ID === id && r.칸.대상 === '성인');

  // 둘 다 "요일|시작|끝" 칸으로 푼다
  const AI칸 = new Map();
  for (const r of 추출.회차) for (const d of 요일풀기(r.요일구분)) AI칸.set(`${d}|${r.시작시간}|${r.종료시간}`, r);
  const CSV칸들 = new Map();
  for (const r of 지금행) for (const d of 요일풀기(r.칸.요일구분)) CSV칸들.set(`${d}|${r.칸.시작시간}|${r.칸.종료시간}`, r);

  // 새로 생긴 칸은 같은 시간끼리 다시 묶어 사람이 읽기 쉽게 만든다
  const 묶음 = new Map();
  for (const [k, r] of AI칸) {
    if (CSV칸들.has(k)) continue;
    const [d, 시작, 끝] = k.split('|');
    const 키 = `${시작}|${끝}`;
    if (!묶음.has(키)) 묶음.set(키, { 요일들: [], 시작, 끝, 회원: r.회원가격원, 비회원: r.비회원가격원, 근거: r.근거 });
    묶음.get(키).요일들.push(d);
  }
  const 추가 = [...묶음.values()].map(x => ({ ...x, 요일구분: 요일묶기(x.요일들) }));

  const 빠짐 = [];
  for (const [k, r] of CSV칸들) if (!AI칸.has(k)) { const [d] = k.split('|'); 빠짐.push({ 줄: r.번호 + 1, 요일: d, 시작: r.칸.시작시간, 끝: r.칸.종료시간 }); }

  // 요금: AI가 값을 읽었을 때만 비교한다. AI가 비워 뒀다면 페이지에 요금이 없다는 뜻이라 메모만 남긴다.
  const 요금 = [];
  for (const [k, r] of AI칸) {
    const 지금 = CSV칸들.get(k);
    if (!지금) continue;
    for (const [AI키, CSV키] of [['회원가격원', '회원가격원'], ['비회원가격원', '비회원가격원']]) {
      const a = r[AI키], c = 지금.칸[CSV키] === '' ? null : Number(지금.칸[CSV키]);
      if (a !== null && a !== c) 요금.push({ 칸: k, 항목: CSV키, 지금: c, AI: a, 근거: r.근거 });
    }
  }
  const 요금없음 = 추출.회차.length > 0 && 추출.회차.every(r => r.회원가격원 === null && r.비회원가격원 === null) && 지금행.some(r => r.칸.비회원가격원 || r.칸.회원가격원);

  // CSV 한 줄의 모든 칸을 AI도 읽었으면 "다시 확인됨"
  const 확인된줄 = 지금행.filter(r => 요일풀기(r.칸.요일구분).every(d => AI칸.has(`${d}|${r.칸.시작시간}|${r.칸.종료시간}`)));

  보고.push({ id, 이름: 추출.이름, 주소: 추출.주소, 모델: 추출.모델, 읽은시각: 추출.읽은시각, 운영상태: 추출.운영상태, 확신도: 추출.확신도, 공지: 추출.공지, 메모: 추출.메모, 추가, 빠짐, 요금, 요금없음, 확인된줄: 확인된줄.map(r => r.번호 + 1), 형식문제: 추출.형식문제 });

  if (적용) {
    // 확인일은 오늘이 아니라 AI가 실제로 페이지를 읽은 날이다
    const 읽은날 = new Date(추출.읽은시각).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
    for (const r of 확인된줄) r.칸.확인일 = 읽은날;
    for (const x of 추가) {
      const 새행 = Object.fromEntries(머리.map(k => [k, '']));
      Object.assign(새행, {
        수영장ID: id, 요일구분: x.요일구분, 시작시간: x.시작, 종료시간: x.끝, 대상: '성인',
        회원가격원: x.회원 ?? '', 비회원가격원: x.비회원 ?? '', 정보상태: '공식확인', 출처: 추출.주소,
        비고: `자동 추출(${추출.모델}, ${읽은날}) 근거: ${x.근거}`, 확인일: 읽은날,
      });
      // 같은 수영장의 마지막 줄 뒤에 넣는다
      const 끝번호 = Math.max(...행들.filter(r => r.칸.수영장ID === id).map(r => r.번호));
      행들.splice(행들.findIndex(r => r.번호 === 끝번호) + 1, 0, { 번호: -1, 칸: 새행 });
    }
  }
}

// 사람이 읽을 수정안
const md = [`# 시간표 수정안 (${종류}, ${오늘})`, '', '> 자동 추출 결과와 지금 `자유수영시간.csv`를 요일 하나하나로 풀어 비교했다. 추가만 자동 적용할 수 있고, 빠짐·요금·휴관은 원본을 보고 사람이 정한다.', ''];
for (const r of 보고) {
  md.push(`## ${r.id} ${r.이름}`, '', `- 출처: ${r.주소}`, `- 모델: ${r.모델} · 읽은 시각 ${r.읽은시각} · 운영상태 **${r.운영상태}** · 확신도 ${r.확신도}${r.형식문제?.length ? ` · 형식문제 ${r.형식문제.length}` : ''}`, '');
  const 없음 = !r.추가.length && !r.빠짐.length && !r.요금.length;
  if (없음) md.push('**바뀐 회차 없음.** 지금 CSV와 같다.', '');
  if (r.추가.length) { md.push('**새로 생긴 회차 (CSV에 없음)**', ''); r.추가.forEach(x => md.push(`- ➕ ${x.요일구분} ${x.시작}~${x.끝} — 근거: ${x.근거}`)); md.push(''); }
  if (r.빠짐.length) { md.push('**페이지에서 못 찾은 회차 (CSV에는 있음) — 사람이 확인**', ''); r.빠짐.forEach(x => md.push(`- ❓ ${x.요일} ${x.시작}~${x.끝} (CSV ${x.줄}번째 줄)`)); md.push(''); }
  if (r.요금.length) { md.push('**요금이 다름 — 사람이 확인**', ''); r.요금.forEach(x => md.push(`- 💰 ${x.칸.replaceAll('|', ' ')} ${x.항목}: CSV ${x.지금 ?? '없음'} → 페이지 ${x.AI} (근거: ${x.근거})`)); md.push(''); }
  if (r.요금없음) md.push('- 참고: 공식 페이지에 자유수영 요금이 없다. CSV의 요금은 다른 출처 값이므로 그대로 두되 공식으로 올리지 않는다.', '');
  if (r.공지?.length) { md.push('**공지**', ''); r.공지.forEach(x => md.push(`- 📢 ${x.내용}${x.기간 ? ` (${x.기간})` : ''}`)); md.push(''); }
  if (r.메모) md.push(`**AI 메모:** ${r.메모}`, '');
  md.push(`다시 확인된 CSV 줄: ${r.확인된줄.length ? r.확인된줄.join(', ') + '번째' : '없음'}`, '');
}

fs.mkdirSync('data/수정안', { recursive: true });
fs.writeFileSync(`data/수정안/${종류}.md`, md.join('\n'));
fs.writeFileSync(`data/수정안/${종류}.json`, JSON.stringify({ 만든날: 오늘, 모델: 종류, 보고 }, null, 2) + '\n');

if (적용) {
  const 새줄들 = [줄들[0], ...행들.map(r => 머리.map(k => CSV칸(r.칸[k])).join(','))];
  fs.writeFileSync(시간표파일, 새줄들.join(줄끝) + (원문.endsWith('\n') ? 줄끝 : ''));
}

for (const r of 보고) console.log(`${r.id} 추가 ${r.추가.length} · 못 찾음 ${r.빠짐.length} · 요금 다름 ${r.요금.length} · 다시 확인 ${r.확인된줄.length}줄`);
console.log(`수정안: data/수정안/${종류}.md${적용 ? ` · CSV에 적용함(${시간표파일})` : ' · CSV는 그대로'}`);
