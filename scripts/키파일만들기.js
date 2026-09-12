// Vercel이 배포할 때(빌드할 때) 실행하는 스크립트입니다.
//
// tmap-key.js는 .gitignore에 걸려 있어서 깃허브에 없습니다.
// 그래서 Vercel도 이 파일을 못 받습니다.
// 대신 Vercel 프로젝트 설정의 "환경 변수(Environment Variables)"에
// TMAP_KEY 라는 이름으로 앱키를 넣어두면, 배포할 때마다
// 이 스크립트가 그 값을 읽어서 tmap-key.js를 새로 만들어 줍니다.
//
// 내 컴퓨터에서 이 스크립트를 직접 실행할 필요는 없습니다.
// (내 컴퓨터에는 이미 tmap-key.js가 있으니까요)

const fs = require("fs");

const 키 = process.env.TMAP_KEY || "";

if (!키) {
  console.warn(
    "경고: TMAP_KEY 환경 변수가 없습니다. " +
    "Vercel 프로젝트 설정 > Environment Variables 에서 TMAP_KEY를 추가하세요. " +
    "지도 없이 나머지 화면은 그대로 배포됩니다."
  );
}

const 내용 = `/* Vercel 배포 중 자동으로 만들어진 파일입니다. 직접 고치지 마세요. */
const TMAP키 = "${키}";
`;

fs.writeFileSync("tmap-key.js", 내용);
console.log(키 ? "tmap-key.js 생성 완료" : "tmap-key.js 생성 완료 (빈 키)");
