"""
M2 新聞事件評分：Google News RSS → Gemini 分類 → ERS 計算

執行：
    python scripts/fetch_news_m2.py --company 台達電
    python scripts/fetch_news_m2.py              # 全部公司
    python scripts/fetch_news_m2.py --force      # 強制重新爬取，不用快取

ERS 計算方式（仿 TESG 事件風險分數）：
    ERS = Σ [ intensity × exp(-λ × days_since_event) ]
    intensity：positive=-0.1, low=0.1, medium=0.4, high=0.7, critical=1.0
    λ = 0.005（時間衰減係數）
    最終 ERS 上限 clamp 到 [0, 1]
"""

import sys
import json
import math
import time
import argparse
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote

sys.stdout.reconfigure(encoding="utf-8")
sys.path.append(str(Path(__file__).parent.parent))

import requests
from dotenv import load_dotenv

load_dotenv()

# ── 路徑常數 ──────────────────────────────────────────────────────────────────
CACHE_DIR = Path(__file__).parent.parent / "data" / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# ── Demo 公司清單 ─────────────────────────────────────────────────────────────
COMPANIES = [
    {"company": "台達電",   "ticker": "2308", "industry": "電子製造業"},
    {"company": "中鋼",     "ticker": "2002", "industry": "鋼鐵業"},
    {"company": "南山人壽", "ticker": "5874", "industry": "保險業"},
]

# ── ERS 參數 ──────────────────────────────────────────────────────────────────
LAMBDA = 0.005
INTENSITY_MAP = {
    "critical": 1.0,
    "high":     0.7,
    "medium":   0.4,
    "low":      0.1,
    "positive": -0.1,
}


def _get_client():
    """延遲初始化 Gemini client（避免 import 時需要 API key）。"""
    from google import genai
    return genai.Client()


# ── Google News RSS 爬取 ──────────────────────────────────────────────────────

def _fetch_rss(query: str, max_items: int = 30) -> list[dict]:
    """爬取 Google News RSS，回傳近 12 個月的文章清單。"""
    encoded_q = quote(query)
    url = (
        f"https://news.google.com/rss/search"
        f"?q={encoded_q}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"
    )

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        )
    }

    try:
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"  [RSS] 請求失敗：{e}")
        return []

    cutoff = datetime.now() - timedelta(days=365)
    articles: list[dict] = []

    try:
        root = ET.fromstring(resp.content)
        channel = root.find("channel")
        if channel is None:
            return []

        for item in channel.findall("item"):
            title_el   = item.find("title")
            link_el    = item.find("link")
            pub_date_el = item.find("pubDate")

            title    = title_el.text.strip() if title_el is not None and title_el.text else ""
            link     = link_el.text.strip() if link_el is not None and link_el.text else ""
            pub_date = pub_date_el.text.strip() if pub_date_el is not None and pub_date_el.text else ""

            # 解析日期
            parsed_date = _parse_rss_date(pub_date)
            if parsed_date and parsed_date < cutoff:
                continue

            articles.append({
                "title":    title,
                "link":     link,
                "date":     parsed_date.strftime("%Y-%m-%d") if parsed_date else datetime.now().strftime("%Y-%m-%d"),
            })

            if len(articles) >= max_items:
                break

    except ET.ParseError as e:
        print(f"  [RSS] XML 解析失敗：{e}")
        return []

    return articles


def _parse_rss_date(date_str: str) -> datetime | None:
    """解析 RSS pubDate 格式（RFC 2822）。"""
    formats = [
        "%a, %d %b %Y %H:%M:%S %z",
        "%a, %d %b %Y %H:%M:%S %Z",
        "%d %b %Y %H:%M:%S %z",
    ]
    for fmt in formats:
        try:
            return datetime.strptime(date_str, fmt).replace(tzinfo=None)
        except (ValueError, TypeError):
            pass
    # 嘗試只解析日期部分
    m = re.search(r"\d{1,2} \w{3} \d{4}", date_str)
    if m:
        try:
            return datetime.strptime(m.group(), "%d %b %Y")
        except ValueError:
            pass
    return None


# ── Gemini 分類 ────────────────────────────────────────────────────────────────

_NEWS_CLASSIFIER_SYSTEM = """你是一位 ESG 風險分析師，負責判斷新聞是否與企業 ESG 表現相關，並進行分類。

對每則新聞判斷：
1. is_esg_related：是否與該公司的 ESG 表現直接相關（true/false）
   - 相關：環境污染、裁罰、違規、勞工糾紛、治理問題、ESG 獎項、碳排、再生能源、社會責任
   - 不相關：一般財報、產品發布、市場行情、一般新聞
2. severity：事件嚴重度（critical / high / medium / low / positive）
   - critical：重大裁罰、刑事訴訟、重大傷亡事故
   - high：勞基法違規、環保違規、董監事糾紛
   - medium：輕微裁罰、ESG 評等下調
   - low：一般負面報導
   - positive：獲獎、升評、正面永續新聞
3. category：分類（裁罰|違規|污染|工安|漂綠|ESG獎項|勞工|治理|其他）

回傳嚴格 JSON（不含說明）：
{
  "classifications": [
    {
      "title": "新聞標題（原文）",
      "is_esg_related": true,
      "severity": "high",
      "category": "勞工"
    }
  ]
}
"""


def _classify_articles(company_name: str, articles: list[dict]) -> list[dict]:
    """用 Gemini 批次分類新聞，回傳含 severity / category 的完整事件清單。"""
    if not articles:
        return []

    from google.genai import types

    articles_text = json.dumps(
        [{"title": a["title"], "date": a["date"]} for a in articles],
        ensure_ascii=False,
        indent=2,
    )

    prompt = (
        f"公司名稱：{company_name}\n\n"
        f"以下是近 12 個月的新聞標題清單，請逐一判斷是否與 ESG 相關並分類：\n\n"
        f"{articles_text}"
    )

    try:
        client = _get_client()
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=_NEWS_CLASSIFIER_SYSTEM,
                response_mime_type="application/json",
                temperature=0.1,
            ),
        )
        classifications = json.loads(response.text).get("classifications", [])
    except Exception as e:
        print(f"  [Gemini] 分類失敗：{e}")
        classifications = []

    # 將分類結果合併回原始文章
    title_to_cls: dict[str, dict] = {c["title"]: c for c in classifications}
    events: list[dict] = []

    for article in articles:
        cls = title_to_cls.get(article["title"], {})
        if not cls.get("is_esg_related", False):
            continue

        events.append({
            "title":    article["title"],
            "date":     article["date"],
            "source":   "Google News RSS",
            "severity": cls.get("severity", "low"),
            "category": cls.get("category", "其他"),
            "summary":  "",
        })

    return events


# ── ERS 計算 ──────────────────────────────────────────────────────────────────

def calc_ers(events: list[dict]) -> float:
    """計算 ERS（Event Risk Score）。"""
    now = datetime.now()
    ers = 0.0

    for event in events:
        try:
            event_dt = datetime.fromisoformat(event["date"])
        except (ValueError, TypeError):
            event_dt = now

        days = max(0, (now - event_dt).days)
        intensity = INTENSITY_MAP.get(event.get("severity", "low"), 0.3)
        ers += intensity * math.exp(-LAMBDA * days)

    # positive 事件可以使 ERS 為負數，clamp 到 [0, 1]
    return round(min(max(ers, 0.0), 1.0), 4)


# ── 主流程 ────────────────────────────────────────────────────────────────────

def fetch_news_for_company(
    company_name: str,
    ticker: str,
    force: bool = False,
) -> dict:
    """爬取單一公司的新聞，更新 data/cache/{company}_news.json。"""
    cache_path = CACHE_DIR / f"{company_name}_news.json"

    # 讀取現有快取（不 force 時保留舊資料）
    existing: dict = {}
    if cache_path.exists() and not force:
        try:
            existing = json.loads(cache_path.read_text(encoding="utf-8"))
            # 快取未過期（7 天內）直接回傳
            last_updated = existing.get("last_updated")
            if last_updated:
                last_dt = datetime.fromisoformat(last_updated)
                if (datetime.now() - last_dt).days < 7:
                    print(f"  [快取] {company_name} 快取未過期（{last_updated[:10]}），跳過爬取。--force 可強制重跑。")
                    return existing
        except Exception:
            pass

    print(f"  [M2] 開始爬取 {company_name} 新聞...")

    # 多查詢詞組合，確保覆蓋 ESG 相關新聞
    queries = [
        f"{company_name} ESG 永續",
        f"{company_name} 違規 裁罰 勞工",
        f"{company_name} 碳排 環境 污染",
    ]

    all_articles: list[dict] = []
    seen_titles: set[str] = set()

    for query in queries:
        articles = _fetch_rss(query, max_items=20)
        for a in articles:
            if a["title"] not in seen_titles:
                seen_titles.add(a["title"])
                all_articles.append(a)
        time.sleep(1.5)   # 避免 rate limit

    print(f"  [M2] 共取得 {len(all_articles)} 篇不重複文章，開始 Gemini 分類...")

    events = _classify_articles(company_name, all_articles)
    print(f"  [M2] ESG 相關事件：{len(events)} 篇")

    ers = calc_ers(events)
    print(f"  [M2] ERS 分數：{ers}")

    # 保留現有的漂綠資料（M3 設定，不覆蓋）
    greenwash_flag    = existing.get("greenwash_flag", False)
    greenwash_reasons = existing.get("greenwash_reasons", [])
    greenwash_claims  = existing.get("greenwash_claims", [])

    result = {
        "company_name":     company_name,
        "ticker":           ticker,
        "events":           events,
        "news_event_score": ers,
        "greenwash_flag":   greenwash_flag,
        "greenwash_reasons": greenwash_reasons,
        "greenwash_claims":  greenwash_claims,
        "last_updated":     datetime.now().isoformat(),
    }

    cache_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  [M2] 已存檔：{cache_path.name}")
    return result


def main():
    parser = argparse.ArgumentParser(
        description="M2 新聞事件評分（Google News RSS → Gemini 分類 → ERS）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
範例：
  python scripts/fetch_news_m2.py                  # 全部公司（快取優先）
  python scripts/fetch_news_m2.py --company 南山人壽
  python scripts/fetch_news_m2.py --force          # 強制重新爬取
        """,
    )
    parser.add_argument("--company", type=str, help="只處理指定公司")
    parser.add_argument("--force", action="store_true", help="強制重新爬取，忽略快取")
    args = parser.parse_args()

    companies = COMPANIES
    if args.company:
        companies = [c for c in COMPANIES if c["company"] == args.company]
        if not companies:
            print(f"[錯誤] 找不到公司：{args.company}，可用：{[c['company'] for c in COMPANIES]}")
            return

    print("=" * 60)
    print("M2 新聞事件評分腳本")
    print(f"模式：{'強制重爬' if args.force else '快取優先'}")
    print("=" * 60)

    for info in companies:
        print(f"\n── {info['company']} ({info['ticker']}) ──")
        try:
            result = fetch_news_for_company(
                info["company"],
                info["ticker"],
                force=args.force,
            )
            print(
                f"  完成｜{len(result.get('events', []))} 件 ESG 事件"
                f"｜ERS = {result.get('news_event_score', 0)}"
            )
        except Exception as e:
            print(f"  [錯誤] {info['company']}：{e}")
        time.sleep(2)

    print("\n完成！下一步：python scripts/preprocess_cache.py")


if __name__ == "__main__":
    main()
