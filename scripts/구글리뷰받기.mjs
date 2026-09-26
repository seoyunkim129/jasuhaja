/*
 * 구글 지도 리뷰 받아오기 (확인용)
 *
 * 네이버 검색 API는 카페 본문 대신 평균 142자짜리 잘린 요약문만 줍니다.
 * 구글 Places API는 리뷰 본문 전체와 별점을 주지만, 시설당 최대 5개까지입니다.
 * 실제로 뭐가 오는지 눈으로 보려고 만든 스크립트입니다.
 *
 * 중요 - 저장하면 안 됩니다
 * 구글 정책상 Place ID만 보관할 수 있고 리뷰 본문은 저장·캐시가 금지입니다.
 * 그래서 결과를 프로젝트 폴더가 아니라 --출력 으로 받은 경로에만 씁니다.
 * 기본값도 레포 바깥이고, 레포 안에 쓰려고 하면 막습니다.
 *
 * 실행: node scripts/구글리뷰받기.mjs --출력 <파일경로>
 */
import fs from 'node:fs';
import path from 'node:path';

const 뿌리 = process.cwd();

// .env.local에서 키를 읽습니다 (다른 스크립트와 같은 방식)
const 로컬환경 = path.join(뿌리, '.env.local');
if (fs.existsSync(로컬환경)) {
  for (const 줄 of fs.readFileSync(로컬환경, 'utf8').split(/\r?\n/)) {
    const m = 줄.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const 키 = process.env.GOOGLE_MAPS_KEY;
if (!키) {
  console.error('GOOGLE_MAPS_KEY가 없습니다. .env.local에 넣어 주세요.');
  process.exit(1);
}

const 출력인덱스 = process.argv.indexOf('--출력');
if (출력인덱스 === -1 || !process.argv[출력인덱스 + 1]) {
  console.error('사용법: node scripts/구글리뷰받기.mjs --출력 <파일경로>');
  process.exit(1);
}
const 출력경로 = path.resolve(process.argv[출력인덱스 + 1]);

// 구글 정책상 리뷰 본문은 보관할 수 없으므로 레포 안에 쓰는 것을 막습니다
if (!path.relative(뿌리, 출력경로).startsWith('..')) {
  console.error('구글 리뷰는 저장이 금지되어 프로젝트 폴더 안에 쓸 수 없습니다.');
  console.error('레포 바깥 경로를 지정해 주세요.');
  process.exit(1);
}

// 구글 지도에 실제로 등록된 이름으로 찾습니다.
// 신석스포렉스(리뷰 1개)와 소의체육문화센터(미등록)는 제외했습니다.
const 찾을곳 = [
  { 수영장ID: 'MP002', 이름: '아현스포렉스',        검색어: '아현스포렉스 서울 마포구' },
  { 수영장ID: 'MP006', 이름: '월드컵스파랜드24',    검색어: '월드컵스파랜드24 서울 마포구' },
  { 수영장ID: 'MP004', 이름: '창천교육문화관',      검색어: '창천교육문화회관 수영장 서울 마포구' },
  { 수영장ID: 'MP001', 이름: '마포아트센터 수영장', 검색어: '마포아트센터 서울 마포구' },
];

const 받을항목 = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.rating',
  'places.userRatingCount',
  'places.reviews',
].join(',');

async function 찾기(검색어) {
  const 응답 = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': 키,
      'X-Goog-FieldMask': 받을항목,
    },
    body: JSON.stringify({ textQuery: 검색어, languageCode: 'ko', regionCode: 'KR' }),
  });
  const 본문 = await 응답.text();
  if (!응답.ok) {
    // 오류 본문에 키가 섞여 나올 수 있어 앞부분만 보여줍니다
    throw new Error(`HTTP ${응답.status} · ${본문.slice(0, 200)}`);
  }
  return JSON.parse(본문);
}

const 결과 = [];
let 호출수 = 0;

for (const 곳 of 찾을곳) {
  try {
    const 응답 = await 찾기(곳.검색어);
    호출수++;
    const 장소 = 응답.places?.[0];
    if (!장소) {
      결과.push({ ...곳, 상태: '구글에서 못 찾음' });
      console.log(`${곳.이름}: 못 찾음`);
      continue;
    }
    const 리뷰 = (장소.reviews || []).map(r => ({
      별점: r.rating,
      작성시점: r.relativePublishTimeDescription,
      본문: r.originalText?.text || r.text?.text || '',
      글자수: (r.originalText?.text || r.text?.text || '').length,
      링크: r.googleMapsUri || '',
    }));
    결과.push({
      ...곳,
      상태: '성공',
      구글이름: 장소.displayName?.text,
      주소: 장소.formattedAddress,
      placeId: 장소.id,
      전체평점: 장소.rating,
      전체리뷰수: 장소.userRatingCount,
      받은리뷰수: 리뷰.length,
      리뷰,
    });
    console.log(`${곳.이름}: 평점 ${장소.rating} · 전체 ${장소.userRatingCount}개 중 ${리뷰.length}개 받음`);
  } catch (오류) {
    결과.push({ ...곳, 상태: '실패', 이유: 오류.message });
    console.log(`${곳.이름}: 실패 - ${오류.message}`);
  }
}

fs.mkdirSync(path.dirname(출력경로), { recursive: true });
fs.writeFileSync(출력경로, JSON.stringify({
  받은시각: new Date().toISOString(),
  주의: '구글 정책상 이 파일은 보관용이 아닙니다. 확인 후 지우세요.',
  호출수,
  결과,
}, null, 2));

console.log(`\nAPI 호출 ${호출수}회. 결과를 ${출력경로} 에 저장했습니다.`);
