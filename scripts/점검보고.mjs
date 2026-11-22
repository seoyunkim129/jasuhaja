// 변경감지 결과(_변경목록.json)와 수정안(data/수정안/<모델>.md)을 묶어 PR·이슈 본문을 만든다.
// GitHub Actions 안에서는 다음 단계가 쓸 값(바뀐 곳, 접속 실패 수)을 $GITHUB_OUTPUT에 적는다.
//
// 실행: node scripts/점검보고.mjs [스냅샷폴더] [모델]   (모델을 빼면 수정안 없이 바뀐 줄만 적는다)
// 결과: data/점검보고.md
import fs from 'node:fs';
import path from 'node:path';

const 폴더 = process.argv[2] || 'data/스냅샷';
const 모델 = process.argv[3]; // 모델 이름을 주면 그 모델의 수정안을 본문에 붙인다
const { 확인시각, 결과 } = JSON.parse(fs.readFileSync(path.join(폴더, '_변경목록.json'), 'utf8'));

const 바뀜 = 결과.filter(r => r.상태 === '바뀜');
const 처음 = 결과.filter(r => r.상태 === '처음');
const 실패 = 결과.filter(r => r.상태 === '접속실패');
const 날짜 = new Date(확인시각).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

const 줄 = [`## 주간 점검 ${날짜}`, '', `공식 페이지 ${결과.length}곳 중 **바뀜 ${바뀜.length}** · 처음 ${처음.length} · 접속 실패 ${실패.length} · 같음 ${결과.length - 바뀜.length - 처음.length - 실패.length}`, ''];

for (const r of 바뀜) {
  줄.push(`### ${r.수영장ID} ${r.이름}`, '', `- 페이지: ${r.주소}`, `- 볼 것: ${r.볼것}`);
  if (r.새로생긴줄.length) { 줄.push('', '새로 생긴 줄'); r.새로생긴줄.slice(0, 15).forEach(l => 줄.push(`- \`+\` ${l.slice(0, 160)}`)); if (r.새로생긴줄.length > 15) 줄.push(`- … 외 ${r.새로생긴줄.length - 15}줄`); }
  if (r.사라진줄.length) { 줄.push('', '사라진 줄'); r.사라진줄.slice(0, 15).forEach(l => 줄.push(`- \`-\` ${l.slice(0, 160)}`)); if (r.사라진줄.length > 15) 줄.push(`- … 외 ${r.사라진줄.length - 15}줄`); }
  if (r.새이미지.length) { 줄.push('', '새 이미지(공지일 수 있음)'); r.새이미지.slice(0, 5).forEach(s => 줄.push(`- ${s}`)); }
  줄.push('');
}
if (실패.length) { 줄.push('### 접속 실패 — 직접 확인 필요', ''); 실패.forEach(r => 줄.push(`- ${r.수영장ID} ${r.이름}: ${r.이유} (${r.주소})`)); 줄.push(''); }

const 수정안 = `data/수정안/${모델}.md`;
if (바뀜.length && 모델 && fs.existsSync(수정안)) 줄.push('---', '', fs.readFileSync(수정안, 'utf8'));
else if (바뀜.length) 줄.push('---', '', 'AI 요약은 없다(AI 키가 설정되지 않았거나 추출에 실패함). 위 페이지를 직접 열어 `자유수영시간.csv`와 비교한다.', '');

줄.push('---', '', '**승인 전에 할 일**: 바뀐 페이지를 직접 열어 수정안과 대조한다. 자동으로 넣는 것은 새 회차와 확인일뿐이고, 빠진 회차·요금·휴관은 사람이 고친다. 이 PR을 합쳐야 사이트에 반영된다.');

fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/점검보고.md', 줄.join('\n') + '\n');

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${바뀜.map(r => r.수영장ID).join(',')}\nfailed=${실패.length}\ndate=${날짜}\n`);
}
console.log(`바뀜 ${바뀜.length}${바뀜.length ? ` (${바뀜.map(r => r.수영장ID).join(', ')})` : ''} · 처음 ${처음.length} · 접속 실패 ${실패.length}`);
