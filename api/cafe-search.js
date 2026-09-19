/*
 * 네이버 카페글 검색 중계 함수
 *
 * 브라우저에서 네이버 API를 직접 부르면 Client Secret이 공개됩니다.
 * 그래서 브라우저 → 이 함수 → 네이버 순서로 요청합니다.
 * 비밀키는 Vercel 환경변수에만 있고 응답에는 절대 포함하지 않습니다.
 */

module.exports = async function cafeSearch(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET 요청만 가능합니다.' });
  }

  const 검색어 = String(req.query.q || '').trim();
  if (!검색어) {
    return res.status(400).json({ error: '검색어(q)가 필요합니다.' });
  }
  if (검색어.length > 100) {
    return res.status(400).json({ error: '검색어는 100자 이하여야 합니다.' });
  }

  const 아이디 = process.env.NAVER_CLIENT_ID;
  const 비밀키 = process.env.NAVER_CLIENT_SECRET;
  if (!아이디 || !비밀키) {
    console.error('NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET이 없습니다.');
    return res.status(503).json({ error: '네이버 검색 API가 아직 설정되지 않았습니다.' });
  }

  // NAVER API HUB에서 새로 발급한 키는 예전 openapi.naver.com에서 쓸 수 없습니다.
  // API HUB 전용 주소와 전용 헤더 이름을 사용해야 합니다.
  const 주소 = new URL('https://naverapihub.apigw.ntruss.com/search/v1/cafearticle');
  주소.searchParams.set('query', 검색어);
  주소.searchParams.set('display', '10');
  주소.searchParams.set('start', '1');
  주소.searchParams.set('sort', 'sim');

  try {
    const 응답 = await fetch(주소, {
      headers: {
        'X-NCP-APIGW-API-KEY-ID': 아이디,
        'X-NCP-APIGW-API-KEY': 비밀키
      }
    });

    if (!응답.ok) {
      const 본문 = await 응답.text();
      console.error('네이버 검색 API 오류:', 응답.status, 본문.slice(0, 300));
      return res.status(502).json({
        error: '네이버 검색 결과를 불러오지 못했습니다.',
        status: 응답.status
      });
    }

    const 결과 = await 응답.json();

    // 필요한 공개 정보만 골라 브라우저에 보냅니다.
    // Client ID와 Client Secret은 이 응답에 포함될 수 없습니다.
    const 글들 = (결과.items || []).map(글 => ({
      title: 글.title || '',
      description: 글.description || '',
      link: 글.link || '',
      cafeName: 글.cafename || '',
      cafeUrl: 글.cafeurl || ''
    }));

    // 같은 검색어의 결과는 Vercel에서 1시간 보관해 호출 수를 아낍니다.
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ query: 검색어, total: 결과.total || 0, items: 글들 });
  } catch (오류) {
    console.error('카페글 검색 중 네트워크 오류:', 오류);
    return res.status(500).json({ error: '검색 중 네트워크 오류가 발생했습니다.' });
  }
};
