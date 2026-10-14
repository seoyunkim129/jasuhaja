// 변경감지.mjs와 시간표추출.mjs가 같이 쓰는 페이지 읽기 도구.
export const 관련 = /수영|자유|휴관|휴장|재개장|운영|요금|입장|[0-9]{1,2}\s*[:시]\s*[0-9]{0,2}|[0-9,]+\s*원/;
const 봇이름 = 'Mozilla/5.0 (compatible; jasuhaja-checker; +https://github.com/seoyunkim129/jasuhaja)';

export async function 받기(대상) {
  const 응답 = await fetch(대상.주소, { headers: { 'user-agent': 봇이름 }, signal: AbortSignal.timeout(30000) });
  if (!응답.ok) throw Error(`HTTP ${응답.status}`);
  return new TextDecoder(대상.인코딩).decode(await 응답.arrayBuffer());
}

export function 글줄(html) {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|td|th|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export function 이미지(html, 기준) {
  const 주소들 = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]).filter(s => !s.startsWith('data:'));
  return [...new Set(주소들.map(s => { try { return new URL(s, 기준).href; } catch { return s; } }))];
}

// 관련 줄과 앞뒤 몇 줄을 함께 남긴다. 표의 "평일" 같은 머리글이 다른 칸에 떨어져 있어도 같이 가게 하려는 것이다.
export function 관련구간(줄들, 앞뒤 = 3) {
  const 남김 = new Set();
  줄들.forEach((l, i) => { if (관련.test(l)) for (let j = i - 앞뒤; j <= i + 앞뒤; j++) 남김.add(j); });
  const 결과 = [];
  let 이전 = -2;
  for (let i = 0; i < 줄들.length; i++) {
    if (!남김.has(i)) continue;
    if (i !== 이전 + 1 && 결과.length) 결과.push('…');
    결과.push(줄들[i]);
    이전 = i;
  }
  return 결과;
}

// 공지·시간표 이미지만 고른다. 아이콘·로고·버튼은 작아서 크기로 거른다.
// 우선주소(이번에 새로 생긴 이미지)를 먼저 넣고, 나머지는 큰 것부터 채운다.
export async function 이미지고르기(주소들, { 우선주소 = [], 최대 = 5, 최소바이트 = 15000, 최대바이트 = 3_500_000 } = {}) {
  const 받은것 = await Promise.all(주소들.map(async 주소 => {
    try {
      const 응답 = await fetch(주소, { headers: { 'user-agent': 봇이름 }, signal: AbortSignal.timeout(20000) });
      const 종류 = (응답.headers.get('content-type') || '').split(';')[0].trim();
      if (!응답.ok || !/^image\/(jpeg|png|gif|webp)$/.test(종류)) return null;
      const 바이트 = Buffer.from(await 응답.arrayBuffer());
      if (바이트.length < 최소바이트 || 바이트.length > 최대바이트) return null;
      return { 주소, 종류, 바이트 };
    } catch { return null; }
  }));
  return 받은것.filter(Boolean)
    .sort((a, b) => (우선주소.includes(b.주소) - 우선주소.includes(a.주소)) || b.바이트.length - a.바이트.length)
    .slice(0, 최대);
}
