# -*- coding: utf-8 -*-
"""
키워드 방식의 정확도 측정

정답표(사람 판정)와 키워드 규칙의 판정을 나란히 놓고 몇 개를 맞혔는지 셉니다.
"방식 A가 방식 B보다 낫다"고 말하려면 이 숫자가 있어야 합니다.

세는 것
  적중   정답도 '관련있음', 키워드도 '관련있음'
  오탐   정답은 '관련없음'인데 키워드가 '관련있음'이라고 함  (헛다리)
  누락   정답은 '관련있음'인데 키워드가 못 찾음
  방향   둘 다 관련있다고 봤을 때 긍정/부정 방향까지 맞았는지

실행: python scripts/정확도측정.py
결과: analysis/results/정확도-키워드.json
"""
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
뿌리 = Path(__file__).resolve().parent.parent

기준표 = json.loads((뿌리 / "analysis" / "review-rubric.json").read_text(encoding="utf-8"))
표본 = json.loads((뿌리 / "analysis" / "gold" / "후기표본.json").read_text(encoding="utf-8"))
정답표 = json.loads((뿌리 / "analysis" / "gold" / "정답표.json").read_text(encoding="utf-8"))

정답 = {x["id"]: x for x in 정답표["항목"]}
본문 = {x["id"]: f"{x['제목']}. {x['요약']}" for x in 표본["표본"]}


def 키워드판정(글, 기준):
    """후기분석비교.mjs의 keywordResult()와 같은 규칙입니다."""
    긍정 = any(w in 글 for w in 기준["positive"])
    부정 = any(w in 글 for w in 기준["negative"])
    if 긍정 and not 부정:
        return "긍정"
    if 부정 and not 긍정:
        return "부정"
    if 긍정 and 부정:
        return "중립"
    return "관련없음"


결과 = {}
사례 = {"오탐": [], "누락": [], "방향틀림": []}

for 키, 기준 in 기준표["criteria"].items():
    적중 = 오탐 = 누락 = 정답없음 = 방향맞음 = 0
    for rid, 글 in 본문.items():
        참 = 정답[rid]["판정"][키]
        예측 = 키워드판정(글, 기준)
        참관련 = 참 != "관련없음"
        예측관련 = 예측 != "관련없음"

        if 참관련 and 예측관련:
            적중 += 1
            if 참 == 예측:
                방향맞음 += 1
            else:
                사례["방향틀림"].append({
                    "id": rid, "항목": 기준["label"], "정답": 참, "키워드": 예측,
                    "메모": 정답[rid]["메모"]})
        elif not 참관련 and 예측관련:
            오탐 += 1
            사례["오탐"].append({
                "id": rid, "항목": 기준["label"], "키워드": 예측,
                "제목": 정답[rid]["제목"], "메모": 정답[rid]["메모"]})
        elif 참관련 and not 예측관련:
            누락 += 1
            사례["누락"].append({
                "id": rid, "항목": 기준["label"], "정답": 참,
                "제목": 정답[rid]["제목"], "메모": 정답[rid]["메모"]})
        else:
            정답없음 += 1

    찾은수 = 적중 + 오탐
    있어야할수 = 적중 + 누락
    결과[키] = {
        "항목": 기준["label"],
        "정답_관련있음": 있어야할수,
        "키워드_관련있다고함": 찾은수,
        "적중": 적중, "오탐": 오탐, "누락": 누락,
        "정밀도": round(적중 / 찾은수, 3) if 찾은수 else None,
        "재현율": round(적중 / 있어야할수, 3) if 있어야할수 else None,
        "방향까지맞음": 방향맞음,
    }

전체적중 = sum(r["적중"] for r in 결과.values())
전체오탐 = sum(r["오탐"] for r in 결과.values())
전체누락 = sum(r["누락"] for r in 결과.values())
전체방향 = sum(r["방향까지맞음"] for r in 결과.values())
전체정답 = 전체적중 + 전체누락
전체예측 = 전체적중 + 전체오탐

저장 = {
    "측정시각": 표본["수집시각"],
    "방식": "키워드 규칙 (analysis/review-rubric.json)",
    "표본수": len(본문),
    "항목별": 결과,
    "전체": {
        "정답_관련있음": 전체정답,
        "키워드_관련있다고함": 전체예측,
        "적중": 전체적중, "오탐": 전체오탐, "누락": 전체누락,
        "정밀도": round(전체적중 / 전체예측, 3) if 전체예측 else None,
        "재현율": round(전체적중 / 전체정답, 3) if 전체정답 else None,
        "방향까지맞음": 전체방향,
    },
    "사례": 사례,
}

출력폴더 = 뿌리 / "analysis" / "results"
출력폴더.mkdir(parents=True, exist_ok=True)
(출력폴더 / "정확도-키워드.json").write_text(
    json.dumps(저장, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print(f"{'항목':<12}{'정답':>5}{'예측':>5}{'적중':>5}{'오탐':>5}{'누락':>5}{'정밀도':>8}{'재현율':>8}")
for r in 결과.values():
    정 = "-" if r["정밀도"] is None else f"{r['정밀도']:.0%}"
    재 = "-" if r["재현율"] is None else f"{r['재현율']:.0%}"
    print(f"{r['항목']:<12}{r['정답_관련있음']:>5}{r['키워드_관련있다고함']:>5}"
          f"{r['적중']:>5}{r['오탐']:>5}{r['누락']:>5}{정:>8}{재:>8}")
print(f"{'합계':<12}{전체정답:>5}{전체예측:>5}{전체적중:>5}{전체오탐:>5}{전체누락:>5}"
      f"{전체적중/전체예측:>7.0%}{전체적중/전체정답:>8.0%}")
print(f"\n적중한 {전체적중}건 중 긍정·부정 방향까지 맞은 건: {전체방향}건")

print("\n--- 오탐 (헛다리) ---")
for x in 사례["오탐"]:
    print(f"  [{x['id']}] {x['항목']} ← {x['키워드']}  |  {x['제목'][:38]}")
    print(f"        {x['메모']}")
print("\n--- 누락 (놓친 것) ---")
for x in 사례["누락"]:
    print(f"  [{x['id']}] {x['항목']} = {x['정답']}  |  {x['제목'][:38]}")
print("\n--- 방향 틀림 ---")
for x in 사례["방향틀림"]:
    print(f"  [{x['id']}] {x['항목']}  정답 {x['정답']} vs 키워드 {x['키워드']}")
