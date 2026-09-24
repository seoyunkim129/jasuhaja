/*
 * 후기 표본 스냅샷 만들기
 *
 * 왜 필요한가:
 * 네이버 검색 결과는 날마다 달라집니다. 그런데 "키워드 방식과 트랜스포머 방식 중
 * 뭐가 나은가"를 비교하려면 두 방식이 반드시 '같은 후기'를 봐야 합니다.
 * 그래서 어느 한 시점의 후기를 파일에 박아두고, 이후 모든 비교는 이 파일만 씁니다.
 *
 * 실행: npm run sample:reviews
 * 결과: analysis/gold/후기표본.json
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

// .env.local에서 환경변수를 읽습니다 (후기분석비교.mjs와 같은 방식)
const 로컬환경 = path.join(root, '.env.local');
if (fs.existsSync(로컬환경)) {
  for (const 줄 of fs.readFileSync(로컬환경, 'utf8').split(/\r?\n/)) {
    const m = 줄.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const 기준주소 = process.env.REVIEW_API_BASE || 'https://mulddae-cyan.vercel.app';

function csv줄나누기(줄) {
  const 결과 = []; let 값 = ''; let 따옴표안 = false;
  for (let i = 0; i < 줄.length; i++) {
    const ch = 줄[i];
    if (ch === '"' && 따옴표안 && 줄[i + 1] === '"') { 값 += '"'; i++; }
    else if (ch === '"') 따옴표안 = !따옴표안;
    else if (ch === ',' && !따옴표안) { 결과.push(값); 값 = ''; }
    else 값 += ch;
  }
  결과.push(값); return 결과;
}

function 수영장읽기() {
  const 줄들 = fs.readFileSync(path.join(root, '수영장.csv'), 'utf8').trim().split(/\r?\n/);
  const 머리 = csv줄나누기(줄들.shift());
  return 줄들.map(줄 => {
    const 칸 = csv줄나누기(줄);
    return Object.fromEntries(머리.map((h, i) => [h, 칸[i] || '']));
  });
}

const 태그제거 = t => String(t || '').replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const 핵심이름 = n => n.replace(/\s|수영장/g, '');

async function 검색(검색어) {
  const 응답 = await fetch(`${기준주소}/api/cafe-search?q=${encodeURIComponent(검색어)}`);
  if (!응답.ok) throw new Error(`검색 실패(${응답.status}): ${검색어}`);
  return (await 응답.json()).items || [];
}

const 표본 = [];
let 일련번호 = 0;

for (const 수영장 of 수영장읽기()) {
  const 검색어들 = [
    `${수영장.이름} 자유수영 후기`,
    `${수영장.이름} 자수 후기`,
    `${수영장.이름} 수영장 후기`
  ];
  const 전체 = (await Promise.all(검색어들.map(검색))).flat();

  // 후기분석비교.mjs와 똑같은 기준으로 거릅니다 (제목에 시설명이 들어간 글만)
  const 관련 = 전체.filter(x => 핵심이름(태그제거(x.title)).includes(핵심이름(수영장.이름)));
  const 중복제거 = [...new Map(관련.map(x => [x.link, x])).values()];

  for (const 글 of 중복제거) {
    표본.push({
      id: `R${String(++일련번호).padStart(3, '0')}`,
      수영장ID: 수영장.수영장ID,
      수영장: 수영장.이름,
      제목: 태그제거(글.title),
      요약: 태그제거(글.description),
      링크: 글.link,
      카페: 글.cafeName || ''
    });
  }
  console.log(`${수영장.이름}: 원본 ${전체.length} → 이름일치 ${관련.length} → 중복제거 ${중복제거.length}`);
}

const 저장폴더 = path.join(root, 'analysis', 'gold');
fs.mkdirSync(저장폴더, { recursive: true });
fs.writeFileSync(
  path.join(저장폴더, '후기표본.json'),
  JSON.stringify({
    수집시각: new Date().toISOString(),
    출처: '네이버 카페글 검색 API (제목·요약문만, 본문 아님)',
    검색어형식: ['{시설명} 자유수영 후기', '{시설명} 자수 후기', '{시설명} 수영장 후기'],
    표본수: 표본.length,
    표본
  }, null, 2)
);

console.log(`\n표본 ${표본.length}건을 analysis/gold/후기표본.json 에 저장했습니다.`);
