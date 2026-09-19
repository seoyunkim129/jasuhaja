/* ============================================================
   물때 - 목록 화면(index.html)과 지도 화면(map.html)이 같이 쓰는 코드

   전에는 이 코드가 두 파일에 똑같이 복사돼 있었습니다.
   나중에 조건을 하나 바꿀 때 한쪽만 고치고 다른 쪽을 깜빡하면,
   목록과 지도가 서로 다른 기준으로 단지를 보여주는 버그가 생깁니다.
   그래서 이 파일 하나로 합쳐서 두 화면이 같이 불러쓰게 했습니다.
   ============================================================ */

let 선택한시간 = 5;

function 조건통과(단지){
  const 검색어 = document.getElementById('검색어').value.trim();
  const 유형   = document.getElementById('유형').value;
  const 자치구 = document.getElementById('자치구').value;

  if (Number(단지.수영장도보분) > 선택한시간) return false;   // 수영장 조건
  // 다이소 조건은 뺐습니다. 이제 수영장 하나만 봅니다.
  // (다이소가 보고 싶으면 지도 화면에서 시설로 직접 추가하면 됩니다)
  if (유형   !== '전체' && 단지.유형   !== 유형)   return false;
  if (자치구 !== '전체' && 단지.자치구 !== 자치구) return false;
  if (검색어 && !단지.단지명.includes(검색어))    return false;
  return true;
}

function 시간바꾸기(누른버튼, 분){
  document.querySelectorAll('.min-btn').forEach(b => b.classList.remove('on'));
  누른버튼.classList.add('on');
  선택한시간 = 분;
  다시그리기();   // 다시그리기()는 화면마다 다르게 생겨서 각 파일에 그대로 둡니다
}

// "24억5000" → 245000, "19억" → 190000 (만원 단위 숫자로 바꿉니다)
// 정렬할 때 씁니다. index.html과 map.html이 같이 쓸 수 있어 여기 둡니다.
function 가격숫자(문자열){
  const m = String(문자열).match(/^(\d+)억(\d*)$/);
  if (!m) return NaN;
  return Number(m[1]) * 10000 + Number(m[2] || 0);
}
