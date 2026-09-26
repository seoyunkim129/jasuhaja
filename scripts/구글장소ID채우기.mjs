/*
 * 수영장.csv에 구글 Place ID 채우기
 *
 * 구글 정책상 리뷰 본문·평점은 저장할 수 없지만,
 * Place ID는 "무기한 저장 가능"으로 명시된 유일한 예외입니다.
 * (Places API 정책: place ID is exempt from the caching restrictions)
 *
 * ID를 미리 저장해두면 매번 이름으로 검색할 필요가 없어
 * API 호출이 절반으로 줄고, 엉뚱한 장소를 집을 위험도 없어집니다.
 *
 * 구글은 12개월보다 오래된 Place ID는 갱신을 권장합니다.
 * 그래서 확인일을 함께 적어둡니다.
 *
 * 실행: node scripts/구글장소ID채우기.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const 뿌리 = process.cwd();

const 로컬환경 = path.join(뿌리, '.env.local');
if (fs.existsSync(로컬환경)) {
  for (const 줄 of fs.readFileSync(로컬환경, 'utf8').split(/\r?\n/)) {
    const m = 줄.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const 키 = process.env.GOOGLE_MAPS_KEY;
if (!키) { console.error('GOOGLE_MAPS_KEY가 없습니다.'); process.exit(1); }

// 구글 지도에 등록된 이름이 우리 CSV와 다른 곳이 있어 따로 적어둡니다.
const 검색어덮기 = {
  MP004: '창천교육문화회관 수영장 서울 마포구',
  MP006: '월드컵스파랜드24 서울 마포구',
};

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
const csv칸쓰기 = v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

const 줄들 = fs.readFileSync(path.join(뿌리, '수영장.csv'), 'utf8').trim().split(/\r?\n/);
const 머리 = csv줄나누기(줄들.shift());
const 수영장들 = 줄들.map(줄 => {
  const 칸 = csv줄나누기(줄);
  return Object.fromEntries(머리.map((h, i) => [h, 칸[i] ?? '']));
});

for (const 이름 of ['구글PlaceID', '구글확인일']) {
  if (!머리.includes(이름)) 머리.push(이름);
}

const 오늘 = new Date().toISOString().slice(0, 10);
let 호출수 = 0;

for (const 곳 of 수영장들) {
  if (곳.구글PlaceID) { console.log(`${곳.이름}: 이미 있음`); continue; }

  const 검색어 = 검색어덮기[곳.수영장ID] || `${곳.이름} ${곳.주소}`;
  const 응답 = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': 키,
      // Place ID와 이름만 받습니다. 리뷰를 안 받으면 더 싼 등급으로 계산됩니다.
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress',
    },
    body: JSON.stringify({ textQuery: 검색어, languageCode: 'ko', regionCode: 'KR', maxResultCount: 1 }),
  });
  호출수++;

  if (!응답.ok) {
    console.log(`${곳.이름}: 실패 HTTP ${응답.status}`);
    곳.구글PlaceID = ''; 곳.구글확인일 = '';
    continue;
  }
  const 결과 = await 응답.json();
  const 장소 = 결과.places?.[0];
  if (!장소) {
    console.log(`${곳.이름}: 구글에서 못 찾음`);
    곳.구글PlaceID = ''; 곳.구글확인일 = '';
    continue;
  }
  곳.구글PlaceID = 장소.id;
  곳.구글확인일 = 오늘;
  console.log(`${곳.이름}: ${장소.displayName?.text} (${장소.formattedAddress})`);
}

const 새내용 = [머리.map(csv칸쓰기).join(',')]
  .concat(수영장들.map(곳 => 머리.map(h => csv칸쓰기(곳[h] ?? '')).join(',')))
  .join('\n') + '\n';
fs.writeFileSync(path.join(뿌리, '수영장.csv'), 새내용);

console.log(`\nAPI 호출 ${호출수}회. 수영장.csv에 Place ID를 저장했습니다.`);
