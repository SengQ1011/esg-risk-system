"""
離線預處理腳本 — demo 前執行一次

讀取 data/cache/{company}_indicators.json + {company}_news.json
→ 呼叫 core/scoring.py 計算 E/S/G 分數
→ 寫入 SQLite

執行方式（在專案根目錄）：
  python scripts/preprocess_cache.py
"""

import sys
import json
import os
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.path.append(str(Path(__file__).parent.parent))

from database.models import SessionLocal, Base, engine
from database.crud import get_or_create_company, save_esg_score
from core.scoring import calculate_esg_score

CACHE_DIR = Path(__file__).parent.parent / "data" / "cache"

COMPANIES = [
    {"name": "台達電", "ticker": "2308", "industry": "電子製造業"},
    {"name": "中鋼",   "ticker": "2002", "industry": "鋼鐵業"},
    {"name": "南山人壽","ticker": "5874", "industry": "保險業"},
]


def load_cache(company_name: str) -> tuple[dict, dict]:
    ind_path = CACHE_DIR / f"{company_name}_indicators.json"
    news_path = CACHE_DIR / f"{company_name}_news.json"

    if not ind_path.exists():
        raise FileNotFoundError(f"找不到快取檔案：{ind_path}")
    if not news_path.exists():
        raise FileNotFoundError(f"找不到快取檔案：{news_path}")

    indicators = json.loads(ind_path.read_text(encoding="utf-8"))
    news = json.loads(news_path.read_text(encoding="utf-8"))
    return indicators, news


def process_company(db, company_info: dict) -> None:
    name = company_info["name"]
    print(f"\n處理：{name} ({company_info['ticker']})")

    indicators_data, news_data = load_cache(name)

    indicators = indicators_data.get("indicators", {})
    news_event_score = news_data.get("news_event_score", 0.0)
    greenwash_flag = news_data.get("greenwash_flag", False)
    report_year = indicators_data.get("report_year")

    result = calculate_esg_score(
        indicators=indicators,
        news_event_score=news_event_score,
        greenwash_flag=greenwash_flag,
    )

    greenwash_reasons = news_data.get("greenwash_reasons", [])
    events = news_data.get("events", [])
    red_flags = [e for e in events if e.get("severity") in ("high", "critical")]

    reasoning_parts = []
    if greenwash_flag and greenwash_reasons:
        reasoning_parts.append("【漂綠警示】" + "；".join(greenwash_reasons))
    if red_flags:
        flag_titles = [e["title"] for e in red_flags]
        reasoning_parts.append("【重大事件】" + "；".join(flag_titles))
    reasoning = "\n".join(reasoning_parts) if reasoning_parts else "無重大警示事件。"

    company = get_or_create_company(
        db,
        name=name,
        industry=company_info["industry"],
        ticker=company_info["ticker"],
    )

    score_record = save_esg_score(
        db=db,
        company_id=company.ID,
        e_score=result["e_score"],
        s_score=result["s_score"],
        g_score=result["g_score"],
        total_score=result["total_score"],
        grade=result["grade"],
        news_event_score=news_event_score,
        greenwash_flag=greenwash_flag,
        reasoning=reasoning,
        breakdown=result["breakdown"],
        report_year=report_year,
    )

    print(f"  E: {result['e_score']:.1f}  S: {result['s_score']:.1f}  G: {result['g_score']:.1f}")
    print(f"  總分: {result['total_score']:.1f}  等級: {result['grade']}")
    print(f"  扣分: {result['penalties']['total_penalty']:.2f}（新聞 {result['penalties']['news_penalty']:.2f} + 漂綠 {result['penalties']['greenwash_penalty']:.2f}）")
    print(f"  已寫入 DB，ScoreID = {score_record.ScoreID}")


def main():
    print("=== ESG 快取預處理腳本 ===")
    print(f"資料目錄：{CACHE_DIR}")

    print("重建資料庫 schema...")
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    print("Schema 重建完成。")

    db = SessionLocal()
    try:
        for company in COMPANIES:
            try:
                process_company(db, company)
            except FileNotFoundError as e:
                print(f"  [跳過] {e}")
            except Exception as e:
                print(f"  [錯誤] {company['name']}：{e}")
                raise
    finally:
        db.close()

    print("\n=== 預處理完成 ===")


if __name__ == "__main__":
    main()
