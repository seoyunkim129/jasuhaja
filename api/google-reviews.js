/*
 * 구글 지도 리뷰 중계 함수
 *
 * 왜 서버를 거치나
 * 브라우저에서 구글 API를 직접 부르면 API 키가 공개됩니다.
 * 그래서 브라우저 → 이 함수 → 구글 순서로 요청합니다.
 * 키는 Vercel 환경변수에만 있고 응답에는 절대 포함하지 않습니다.
 *
 * 왜 캐시를 안 하나
 * 구글 정책상 Place ID만 무기한 저장할 수 있고, 리뷰 본문·평점은
 * 저장도 캐시도 금지입니다. 그래서 응답에 no-store를 붙이고
 * 파일이나 DB에도 남기지 않습니다. 대신 Place ID는 수영장.csv에 저장해
 * 매번 이름으로 검색하지 않아도 되게 했습니다.
 *
 * 리뷰는 시설당 최대 5개입니다. 구글이 정한 상한이라 늘릴 수 없습니다.
 *
 * 작성자 표기 의무
 * 구글은 리뷰를 보여줄 때 작성자(아바타·이름·프로필 링크)와
 * 원본 리뷰 링크를 함께 표시하도록 요구합니다.
 * 그래서 authorAttribution과 googleMapsUri를 그대로 내려보냅니다.
 */

const 장소주소 = 'https://places.googleapis.com/v1/places/';

// 필요한 것만 받습니다. 항목을 줄일수록 요금 등급이 낮아집니다.
const 받을항목 = [
  'id',
  'displayName',
  'rating',
  'userRatingCount',
  'googleMapsUri',
  'reviews',
].join(',');

module.exports = async function googleReviews(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET 요청만 가능합니다.' });
  }

  const 장소ID = String(req.query.placeId || '').trim();
  if (!장소ID) {
    return res.status(400).json({ error: 'placeId가 필요합니다.' });
  }
  // Place ID는 영문·숫자·_-만 쓰입니다. 다른 글자가 오면 주소 조작 시도로 봅니다.
  if (!/^[A-Za-z0-9_-]{10,255}$/.test(장소ID)) {
    return res.status(400).json({ error: 'placeId 형식이 올바르지 않습니다.' });
  }

  const 키 = process.env.GOOGLE_MAPS_KEY;
  if (!키) {
    console.error('GOOGLE_MAPS_KEY가 없습니다.');
    return res.status(503).json({ error: '구글 리뷰가 아직 설정되지 않았습니다.' });
  }

  try {
    const 주소 = new URL(장소주소 + encodeURIComponent(장소ID));
    주소.searchParams.set('languageCode', 'ko');
    주소.searchParams.set('regionCode', 'KR');

    const 응답 = await fetch(주소, {
      headers: {
        'X-Goog-Api-Key': 키,
        'X-Goog-FieldMask': 받을항목,
      },
    });

    if (!응답.ok) {
      const 본문 = await 응답.text();
      console.error('구글 Places API 오류:', 응답.status, 본문.slice(0, 300));
      // 할당량을 다 쓴 경우를 따로 알려줍니다. 화면에서 다르게 안내해야 하기 때문입니다.
      if (응답.status === 429) {
        return res.status(429).json({ error: '오늘 구글 리뷰 조회 한도를 다 썼어요.' });
      }
      return res.status(502).json({ error: '구글 리뷰를 불러오지 못했습니다.', status: 응답.status });
    }

    const 장소 = await 응답.json();

    // 필요한 공개 정보만 골라 내보냅니다. API 키는 이 응답에 포함될 수 없습니다.
    const 리뷰들 = (장소.reviews || []).map(r => ({
      별점: r.rating ?? null,
      시점: r.relativePublishTimeDescription || '',
      작성시각: r.publishTime || '',
      // 원문 그대로 보냅니다. 번역본(text)보다 originalText가 실제로 쓴 글입니다.
      본문: r.originalText?.text || r.text?.text || '',
      // 구글 정책: 작성자 표기는 의무입니다
      작성자: r.authorAttribution?.displayName || '',
      작성자사진: r.authorAttribution?.photoUri || '',
      작성자링크: r.authorAttribution?.uri || '',
      원본링크: r.googleMapsUri || '',
    })).filter(r => r.본문);

    // 구글 정책: 리뷰 본문은 캐시·저장이 금지입니다
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      placeId: 장소.id || 장소ID,
      이름: 장소.displayName?.text || '',
      전체평점: 장소.rating ?? null,
      전체리뷰수: 장소.userRatingCount ?? null,
      장소링크: 장소.googleMapsUri || '',
      리뷰수: 리뷰들.length,
      리뷰: 리뷰들,
    });
  } catch (오류) {
    console.error('구글 리뷰 조회 중 네트워크 오류:', 오류);
    return res.status(500).json({ error: '조회 중 네트워크 오류가 발생했습니다.' });
  }
};
