# -*- coding: utf-8 -*-
"""
보류된 단지의 수영장·다이소 도보 시간을 채웁니다.

핵심은 '하버사인 1차 필터'입니다.
TMAP 보행자 경로 API는 하루 한도가 낮아서(1,000건 남짓) 아껴 써야 합니다.
그래서 경로를 물어보기 전에, 공짜인 직선거리 계산으로 먼저 걸러냅니다.

  걸어간 거리는 직선거리보다 항상 깁니다.
  그러니 직선거리가 이미 1,200m를 넘으면,
  걸어서는 무조건 15분을 넘습니다 (도보 1분 = 80m 기준).
  물때의 가장 느슨한 조건이 15분이므로, 이런 곳은 물어볼 필요가 없습니다.

사용법
  # 경로 API를 하나도 안 쓰고, 몇 건이 필요한지만 세어봅니다
  python scripts/도보시간채우기.py --확인만

  # 실제로 채웁니다
  python scripts/도보시간채우기.py --입력 docs/남은단지.json --출력 docs/완료.json
"""
import argparse
import json
import math
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")

BASE = "https://apis.openapi.sk.com/tmap"
분당보행거리 = 80        # 부동산 관행: 도보 1분 = 80m
최대허용분 = 15          # 물때의 가장 느슨한 필터
직선한계m = 분당보행거리 * 최대허용분    # 1200m

# map.html의 규칙과 같은 값입니다. 한쪽만 고치면 화면과 데이터가 어긋납니다.
부속 = re.compile(r"주차장|정문|후문|출입구|입구$")
유아전용 = re.compile(r"키즈|어린이|유아|아동|주니어|차일드|kids", re.I)
미개장 = re.compile(r"공사중|오픈예정|개장예정|준비중")
물놀이장 = re.compile(r"물놀이장|워터파크")
법인명 = re.compile(r"주식회사|㈜|\(주\)")


def 수영장아님(이름):
    return bool(유아전용.search(이름) or 미개장.search(이름)
                or 물놀이장.search(이름) or 법인명.search(이름))


def 앱키(경로="tmap-key.js"):
    with open(경로, encoding="utf-8") as f:
        m = re.search(r'TMAP키\s*=\s*"([^"]+)"', f.read())
    if not m or not m.group(1):
        sys.exit(f"{경로} 에 앱키가 없습니다.")
    return m.group(1)


def 직선거리m(위도1, 경도1, 위도2, 경도2):
    """하버사인 공식. 지구를 구로 보고 두 좌표 사이 직선거리를 미터로 돌려줍니다."""
    R = 6_371_000
    라디안 = math.radians
    a = (math.sin(라디안(위도2 - 위도1) / 2) ** 2
         + math.cos(라디안(위도1)) * math.cos(라디안(위도2))
         * math.sin(라디안(경도2 - 경도1) / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(a))


def 주변시설(키, 카테고리, 위도, 경도, 반경km=3):
    주소 = (f"{BASE}/pois/search/around?version=1"
            f"&categories={urllib.parse.quote(카테고리)}"
            f"&centerLat={위도}&centerLon={경도}&radius={반경km}&count=50"
            f"&resCoordType=WGS84GEO&reqCoordType=WGS84GEO&appKey={키}")
    응답 = json.loads(urllib.request.urlopen(주소, timeout=25).read())
    정보 = 응답.get("searchPoiInfo") or {}
    목록 = ((정보.get("pois") or {}).get("poi")) or []
    결과 = []
    for p in 목록:
        if 부속.search(p["name"]):
            continue
        if 카테고리 == "수영장" and 수영장아님(p["name"]):
            continue
        결과.append(p)
    return 결과


def 도보시간분(키, 출발위도, 출발경도, 도착위도, 도착경도):
    본문 = urllib.parse.urlencode({
        "startX": 출발경도, "startY": 출발위도,
        "endX": 도착경도, "endY": 도착위도,
        "startName": "S", "endName": "E",
        "reqCoordType": "WGS84GEO", "resCoordType": "WGS84GEO",
    }).encode()
    요청 = urllib.request.Request(
        f"{BASE}/routes/pedestrian?version=1&appKey={키}", data=본문,
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    응답 = json.loads(urllib.request.urlopen(요청, timeout=25).read())
    초 = 응답["features"][0]["properties"]["totalTime"]
    return max(1, round(초 / 60))


def 가장가까운후보(키, 카테고리, 단지):
    """하버사인 1차 필터. 경로 API를 부를 가치가 있는 후보 1곳만 돌려줍니다."""
    # CSV에서 온 단지는 좌표가 글자로 들어있어서 숫자로 맞춥니다
    위도, 경도 = float(단지["위도"]), float(단지["경도"])
    후보들 = 주변시설(키, 카테고리, 위도, 경도)
    if not 후보들:
        return None, None
    가까운 = min(후보들, key=lambda p: 직선거리m(
        위도, 경도, float(p["frontLat"]), float(p["frontLon"])))
    거리 = 직선거리m(위도, 경도, float(가까운["frontLat"]), float(가까운["frontLon"]))
    return 가까운, 거리


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--입력", default="docs/남은단지.json")
    ap.add_argument("--출력", default="docs/완료.json")
    ap.add_argument("--키파일", default="tmap-key.js")
    ap.add_argument("--확인만", action="store_true",
                    help="경로 API를 쓰지 않고, 몇 건이 필요한지만 셉니다")
    args = ap.parse_args()

    키 = 앱키(args.키파일)
    단지들 = json.load(open(args.입력, encoding="utf-8"))
    print(f"대상 단지 {len(단지들)}개 · 직선 {직선한계m:.0f}m 넘으면 경로를 묻지 않습니다\n")

    필요, 생략, 시설없음, 완료 = 0, 0, 0, []
    for i, 단지 in enumerate(단지들, 1):
        if 단지.get("위도") in (None, ""):
            continue
        for 카테고리, 이름칸, 분칸 in (("수영장", "수영장이름", "수영장도보분"),
                                    ("다이소", None, "다이소도보분")):
            try:
                가까운, 거리 = 가장가까운후보(키, 카테고리, 단지)
            except Exception as e:
                print(f"  ! {단지['단지명']} {카테고리} 검색 실패: {type(e).__name__}")
                continue

            if 가까운 is None:
                단지[분칸] = ""
                시설없음 += 1
                continue

            if 거리 > 직선한계m:
                # 직선으로도 이미 15분 밖입니다. 경로를 물어볼 필요가 없습니다.
                단지[분칸] = ""
                단지.setdefault("생략사유", {})[카테고리] = f"직선 {거리:.0f}m — 15분 초과 확실"
                생략 += 1
                continue

            필요 += 1
            if args.확인만:
                continue
            try:
                단지[분칸] = 도보시간분(키, float(단지["위도"]), float(단지["경도"]),
                                    float(가까운["frontLat"]), float(가까운["frontLon"]))
                if 이름칸:
                    단지[이름칸] = 가까운["name"]
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    print(f"\n한도 초과. {i-1}번째 단지까지 저장하고 멈춥니다.")
                    json.dump(완료, open(args.출력, "w", encoding="utf-8"),
                              ensure_ascii=False, indent=1)
                    return
                단지[분칸] = ""
            time.sleep(0.08)
        완료.append(단지)
        if i % 50 == 0:
            print(f"  {i}/{len(단지들)} 진행")

    print(f"\n경로 API 호출 필요: {필요}건")
    print(f"하버사인으로 생략:   {생략}건  ← 직선거리만으로 15분 초과가 확실한 경우")
    print(f"근처에 시설 없음:    {시설없음}건")
    아꼈다 = 생략 + 시설없음
    전체 = 필요 + 아꼈다
    if 전체:
        print(f"\n필터 없이 다 물어봤다면 {전체}건 → 실제 {필요}건 ({아꼈다*100//전체}% 절약)")
    if not args.확인만:
        json.dump(완료, open(args.출력, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)
        print(f"\n{args.출력} 에 {len(완료)}개 저장")


if __name__ == "__main__":
    main()
