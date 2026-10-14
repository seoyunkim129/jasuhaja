// AI를 부르는 부분만 모아 둔 파일. 모델을 바꾸려면 여기만 고치면 된다.
// 세 모델 모두 같은 입력(지시문, 페이지 글, 이미지)을 받아 같은 모양의 JSON을 돌려준다.
//
// 키는 .env.local 또는 환경변수에서 읽는다.
//   claude: ANTHROPIC_API_KEY   gemini: GEMINI_API_KEY   qwen: DASHSCOPE_API_KEY
// 모델 이름은 자주 바뀌어서 환경변수로 바꿀 수 있게 했다(CLAUDE_MODEL, GEMINI_MODEL, QWEN_MODEL).
import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';

if (fs.existsSync('.env.local')) {
  for (const 줄 of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = 줄.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

// 100만 토큰당 달러. 비용 비교용 추정치라 실제 청구액과 다를 수 있다.
// claude: Anthropic 공식 가격(2026-10). gemini: 3.8 Flash 출시 할인가로 알려진 값(공식 확인 전).
// qwen: 공식 가격표에서 확인한 뒤 채운다.
export const 모델들 = {
  claude: { 이름: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5', 키: 'ANTHROPIC_API_KEY', 가격: { 입력: 2, 출력: 10 }, 데이터위치: '미국' },
  gemini: { 이름: process.env.GEMINI_MODEL || 'gemini-3.8-flash', 키: 'GEMINI_API_KEY', 가격: { 입력: 0.75, 출력: 3.75 }, 데이터위치: '미국' },
  qwen: { 이름: process.env.QWEN_MODEL || 'qwen-vl-max', 키: 'DASHSCOPE_API_KEY', 가격: null, 데이터위치: '싱가포르(알리바바 국제판)' },
};

// 입력: { 종류, 지시, 글, 이미지들:[{종류, 바이트}], 스키마 }
// 출력: { 결과, 입력토큰, 출력토큰, 걸린초, 모델, 추정비용달러 }
export async function 추출({ 종류, 지시, 글, 이미지들 = [], 스키마 }) {
  const 모델 = 모델들[종류];
  if (!모델) throw Error(`모르는 모델: ${종류} (claude, gemini, qwen 중 하나)`);
  const 키 = process.env[모델.키];
  if (!키) throw Error(`${모델.키}가 없습니다. .env.local에 넣어 주세요.`);

  const 시작 = Date.now();
  const 답 = await { claude: 클로드, gemini: 제미나이, qwen: 큐웬 }[종류]({ 모델: 모델.이름, 키, 지시, 글, 이미지들, 스키마 });
  const 추정비용달러 = 모델.가격 ? (답.입력토큰 * 모델.가격.입력 + 답.출력토큰 * 모델.가격.출력) / 1e6 : null;
  return { ...답, 결과: JSON.parse(JSON꺼내기(답.글)), 걸린초: (Date.now() - 시작) / 1000, 모델: 모델.이름, 추정비용달러 };
}

// 코드 블록(```json … ```)이나 앞뒤 설명이 붙어 와도 JSON 부분만 꺼낸다.
function JSON꺼내기(글) {
  const 블록 = 글.match(/```(?:json)?\s*([\s\S]*?)```/);
  const 본문 = 블록 ? 블록[1] : 글;
  const 시작 = 본문.indexOf('{'), 끝 = 본문.lastIndexOf('}');
  if (시작 < 0 || 끝 < 시작) throw Error(`JSON을 찾지 못했습니다: ${글.slice(0, 200)}`);
  return 본문.slice(시작, 끝 + 1);
}

async function 클로드({ 모델, 키, 지시, 글, 이미지들, 스키마 }) {
  const client = new Anthropic({ apiKey: 키 });
  const 응답 = await client.beta.messages.create({
    model: 모델,
    max_tokens: 16000,
    // 안전 분류기가 요청을 거절하면 Anthropic이 고른 다른 모델로 한 번 더 시도한다.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    // 표에서 값을 옮겨 적는 일이라 깊게 생각할 필요가 적다. 정확도가 부족하면 high로 올려 비교한다.
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: 스키마 } },
    system: 지시,
    messages: [{
      role: 'user',
      content: [
        ...이미지들.map(이미지 => ({ type: 'image', source: { type: 'base64', media_type: 이미지.종류, data: 이미지.바이트.toString('base64') } })),
        { type: 'text', text: 글 },
      ],
    }],
  });
  if (응답.stop_reason === 'refusal') throw Error(`Claude가 거절했습니다: ${응답.stop_details?.category ?? '이유 없음'}`);
  if (응답.stop_reason === 'max_tokens') throw Error('Claude 답이 길이 제한에서 잘렸습니다.');
  const 텍스트 = 응답.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return { 글: 텍스트, 입력토큰: 응답.usage.input_tokens, 출력토큰: 응답.usage.output_tokens };
}

async function 제미나이({ 모델, 키, 지시, 글, 이미지들, 스키마 }) {
  const 응답 = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': 키, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 모델,
      input: [
        { type: 'text', text: `${지시}\n\n${글}` },
        ...이미지들.map(이미지 => ({ type: 'image', data: 이미지.바이트.toString('base64'), mime_type: 이미지.종류 })),
      ],
      response_format: { type: 'text', mime_type: 'application/json', schema: 스키마 },
    }),
    signal: AbortSignal.timeout(180000),
  });
  const 본문 = await 응답.json();
  if (!응답.ok) throw Error(`Gemini ${응답.status}: ${JSON.stringify(본문).slice(0, 300)}`);
  const 텍스트 = (본문.steps || []).filter(s => s.type === 'model_output').flatMap(s => s.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  return { 글: 텍스트, 입력토큰: 본문.usage?.total_input_tokens ?? 0, 출력토큰: (본문.usage?.total_output_tokens ?? 0) + (본문.usage?.total_thought_tokens ?? 0) };
}

async function 큐웬({ 모델, 키, 지시, 글, 이미지들, 스키마 }) {
  // 알리바바 국제판(싱가포르)의 OpenAI 호환 주소. 중국 본토판 키는 여기서 쓰이지 않는다.
  const 응답 = await fetch('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${키}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 모델,
      messages: [
        // 이미지 모델이 JSON 스키마 강제를 지원하는지 확실하지 않아 지시문에 스키마를 넣고, 받은 뒤 검사한다.
        { role: 'system', content: `${지시}\n\n반드시 아래 JSON 스키마에 맞는 JSON 하나만 답하세요.\n${JSON.stringify(스키마)}` },
        { role: 'user', content: [
          ...이미지들.map(이미지 => ({ type: 'image_url', image_url: { url: `data:${이미지.종류};base64,${이미지.바이트.toString('base64')}` } })),
          { type: 'text', text: 글 },
        ] },
      ],
    }),
    signal: AbortSignal.timeout(180000),
  });
  const 본문 = await 응답.json();
  if (!응답.ok) throw Error(`Qwen ${응답.status}: ${JSON.stringify(본문).slice(0, 300)}`);
  return { 글: 본문.choices?.[0]?.message?.content ?? '', 입력토큰: 본문.usage?.prompt_tokens ?? 0, 출력토큰: 본문.usage?.completion_tokens ?? 0 };
}
