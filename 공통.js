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
  if (Number(단지.다이소도보분) > 선택한시간) return false;   // 다이소 조건
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
