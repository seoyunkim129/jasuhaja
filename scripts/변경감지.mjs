// 감시대상.json의 공식 페이지를 받아 지난번 스냅샷과 비교한다. AI는 쓰지 않는다.
// 페이지 전체가 아니라 수영·시간·요금·휴관과 관련된 줄과 이미지 주소만 비교해서
// 메뉴나 다른 공지가 바뀐 것에는 반응하지 않게 한다. 바뀐 곳은 다음 단계에서 AI가 읽는다.
//
// 실행: node scripts/변경감지.mjs [스냅샷폴더]   (기본 data/스냅샷)
// 결과: 스냅샷폴더/<수영장ID>.json, 스냅샷폴더/_변경목록.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { 관련, 받기, 글줄, 이미지 } from './페이지읽기.mjs';

const 폴더 = process.argv[2] || 'data/스냅샷';
const 설정 = JSON.parse(fs.readFileSync('scripts/감시대상.json', 'utf8'));

const 지문 = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);

fs.mkdirSync(폴더, { recursive: true });
const 지금 = new Date().toISOString();
const 결과 = [];

for (const 대상 of 설정.대상) {
  const 파일 = path.join(폴더, `${대상.수영장ID}.json`);
  const 이전 = fs.existsSync(파일) ? JSON.parse(fs.readFileSync(파일, 'utf8')) : null;
  let 새것;
  try {
    const html = await 받기(대상);
    const 관련줄 = 글줄(html).filter(l => 관련.test(l));
    const 이미지들 = 이미지(html, 대상.주소);
    새것 = { 수영장ID: 대상.수영장ID, 주소: 대상.주소, 확인시각: 지금, 지문: 지문([관련줄, 이미지들]), 관련줄, 이미지들 };
  } catch (e) {
    결과.push({ 수영장ID: 대상.수영장ID, 이름: 대상.이름, 상태: '접속실패', 이유: e.message, 주소: 대상.주소 });
    continue;
  }

  let 상태 = '같음';
  if (!이전) 상태 = '처음';
  else if (이전.지문 !== 새것.지문) 상태 = '바뀜';

  const 항목 = { 수영장ID: 대상.수영장ID, 이름: 대상.이름, 상태, 주소: 대상.주소, 볼것: 대상.볼것 };
  if (상태 === '바뀜') {
    항목.사라진줄 = 이전.관련줄.filter(l => !새것.관련줄.includes(l));
    항목.새로생긴줄 = 새것.관련줄.filter(l => !이전.관련줄.includes(l));
    항목.새이미지 = 새것.이미지들.filter(s => !이전.이미지들.includes(s));
  }
  결과.push(항목);
  // 같을 때는 파일을 건드리지 않는다. 확인시각만 바뀌는 커밋이 매주 생기지 않게 하려는 것이다.
  if (상태 !== '같음') fs.writeFileSync(파일, JSON.stringify(새것, null, 2) + '\n');
}

fs.writeFileSync(path.join(폴더, '_변경목록.json'), JSON.stringify({ 확인시각: 지금, 결과 }, null, 2) + '\n');
for (const r of 결과) {
  const 덧붙임 = r.상태 === '바뀜' ? ` (+${r.새로생긴줄.length}줄 -${r.사라진줄.length}줄, 새 이미지 ${r.새이미지.length})` : r.이유 ? ` (${r.이유})` : '';
  console.log(`${r.상태.padEnd(4)} ${r.수영장ID} ${r.이름}${덧붙임}`);
}
