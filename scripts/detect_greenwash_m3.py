"""
M3 漂綠偵測：重用 M1 compact PDF + M1 量化指標 → Gemini 比對矛盾

執行：
    python scripts/detect_greenwash_m3.py --company 台達電
    python scripts/detect_greenwash_m3.py              # 全部公司

偵測邏輯：
    1. 讀取 M1 compact PDF（data/logs/compact_{ticker}.pdf）
    2. 讀取 M1 量化指標（data/cache/{company}_indicators.json）
    3. 用 Gemini 分析：找出報告書中的永續宣稱，並判斷是否與量化數據矛盾
    4. 更新 data/cache/{company}_news.json 的 greenwash_flag 與 greenwash_claims 欄位
"""

import sys
import json
import argparse
import pathlib
import time
from pathlib import Path
from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8")
sys.path.append(str(Path(__file__).parent.parent))

from dotenv import load_dotenv

load_dotenv()


def _get_client():
    """延遲初始化 Gemini client（避免 import 時需要 API key）。"""
    from google import genai
    return genai.Client()

# ── 路徑常數 ──────────────────────────────────────────────────────────────────
CACHE_DIR = Path(__file__).parent.parent / "data" / "cache"
LOG_DIR   = Path(__file__).parent.parent / "data" / "logs"

# ── Demo 公司清單 ─────────────────────────────────────────────────────────────
COMPANIES = [
    {"company": "台達電",   "ticker": "2308"},
    {"company": "中鋼",     "ticker": "2002"},
    {"company": "南山人壽", "ticker": "5874"},
    {"company": "臺積電",   "ticker": "2330"},
]

# ── Prompt ────────────────────────────────────────────────────────────────────

_GREENWASH_SYSTEM = """你是一位專業的 ESG 稽核分析師，專門偵測企業永續報告書中的漂綠（Greenwashing）矛盾。

漂綠定義：企業在永續報告書中作出的正面環保/永續宣稱，但實際量化數據與該宣稱相矛盾或無法支撐。

分析任務：
1. 找出報告書中關於永續目標、環境承諾、ESG 績效的具體宣稱語句
2. 對照用戶提供的量化指標數據，判斷是否存在矛盾
3. 矛盾類型包括：
   - 宣稱大幅減碳，但碳排放量實際上升或遠超同業
   - 宣稱重視員工福祉，但有多件勞工違規或高傷亡率
   - 宣稱資訊透明，但缺乏第三方確信或關鍵指標未揭露
   - 宣稱積極採用再生能源，但再生能源比例極低
   - 宣稱 ESG 領先，但重大裁罰/違規記錄多

注意：
- 只報告有明確數據支持的矛盾，不要猜測或推測
- 如果數據不足以判斷，不要誤判為漂綠
- confidence 反映判斷的確定程度

回傳嚴格 JSON（不含說明）：
{
  "claims": [
    "報告書中的宣稱語句1（完整引用）",
    "報告書中的宣稱語句2"
  ],
  "contradictions": [
    {
      "description": "矛盾說明：宣稱XX，但實際數據顯示YY",
      "claim_quote": "報告書中的原文宣稱（直接引用）",
      "source_page": 45
    }
  ],
  "greenwash_flag": true,
  "confidence": 0.85,
  "summary": "一句話總結漂綠風險等級和主要問題"
}
"""


# ── 核心函式 ──────────────────────────────────────────────────────────────────

def _load_indicators(company_name: str) -> dict:
    """讀取 M1 抽取的量化指標。"""
    ind_path = CACHE_DIR / f"{company_name}_indicators.json"
    if not ind_path.exists():
        raise FileNotFoundError(f"找不到指標快取：{ind_path}，請先執行 M1 腳本")

    data = json.loads(ind_path.read_text(encoding="utf-8"))
    return data.get("indicators", {})


def _load_news_cache(company_name: str) -> dict:
    """讀取現有新聞快取。"""
    news_path = CACHE_DIR / f"{company_name}_news.json"
    if not news_path.exists():
        return {"company_name": company_name, "events": [], "news_event_score": 0.0}
    return json.loads(news_path.read_text(encoding="utf-8"))


def _build_indicator_summary(indicators: dict) -> str:
    """將量化指標整理成可讀文字，供 Gemini 分析用。"""
    lines = ["已知量化指標（M1 抽取結果）："]

    def _fmt(key: str, label: str, unit: str) -> str:
        ind = indicators.get(key, {})
        val = ind.get("value") if isinstance(ind, dict) else ind
        if val is None:
            return f"  - {label}: 未揭露"
        return f"  - {label}: {val} {unit}"

    lines.append(_fmt("ghg_scope1",    "GHG Scope 1",    "公噸CO2e"))
    lines.append(_fmt("ghg_scope2",    "GHG Scope 2",    "公噸CO2e"))
    lines.append(_fmt("ghg_scope3",    "GHG Scope 3",    "公噸CO2e"))
    lines.append(_fmt("carbon_intensity", "碳強度",       "公噸CO2e/百萬元"))
    lines.append(_fmt("renewable_ratio",  "再生能源佔比", "%"))
    lines.append(_fmt("injury_rate",      "失能傷害頻率", "TRIR"))
    lines.append(_fmt("violations",       "重大違規次數", "次"))
    lines.append(_fmt("training_hours",   "員工平均訓練時數", "小時/人/年"))

    # 布林指標
    def _fmt_bool(key: str, label: str) -> str:
        ind = indicators.get(key, {})
        val = ind.get("value") if isinstance(ind, dict) else ind
        if val is None:
            return f"  - {label}: 未揭露"
        return f"  - {label}: {'有' if val else '無'}"

    lines.append(_fmt_bool("assurance",                "第三方確信"))
    lines.append(_fmt_bool("has_sustainability_officer", "永續長/永續委員會"))

    return "\n".join(lines)


def detect_greenwash(
    company_name: str,
    ticker: str,
    force: bool = False,
) -> dict:
    """對單一公司執行 M3 漂綠偵測，更新 news.json。"""
    news_cache = _load_news_cache(company_name)

    # 快取已有 M3 結果且非 force 時跳過
    if not force and "greenwash_analyzed_at" in news_cache:
        try:
            analyzed_at = datetime.fromisoformat(news_cache["greenwash_analyzed_at"])
            if (datetime.now() - analyzed_at).days < 7:
                print(
                    f"  [快取] {company_name} M3 結果未過期"
                    f"（{news_cache['greenwash_analyzed_at'][:10]}），跳過。"
                )
                return news_cache
        except Exception:
            pass

    indicators = _load_indicators(company_name)
    indicator_summary = _build_indicator_summary(indicators)

    # 尋找 compact PDF
    compact_pdf = LOG_DIR / f"compact_{ticker}.pdf"
    if not compact_pdf.exists():
        print(f"  [警告] 找不到 compact PDF：{compact_pdf}，改用純文字分析")
        pdf_available = False
    else:
        pdf_available = True

    print(f"  [M3] 開始漂綠偵測（compact PDF {'可用' if pdf_available else '不可用'}）...")

    prompt = (
        f"公司名稱：{company_name}（股票代號 {ticker}）\n\n"
        f"{indicator_summary}\n\n"
        "請分析這份永續報告書，找出可能的漂綠矛盾。"
        "重點關注：碳排放宣稱 vs 實際數據、再生能源宣稱 vs 實際比例、"
        "治理宣稱 vs 違規記錄、勞工宣稱 vs 傷亡/違規數據。"
    )

    def _call_gemini() -> dict:
        from google.genai import types
        client = _get_client()
        if pdf_available:
            uploaded = None
            try:
                uploaded = client.files.upload(file=pathlib.Path(compact_pdf))
                resp = client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=[uploaded, prompt],
                    config=types.GenerateContentConfig(
                        system_instruction=_GREENWASH_SYSTEM,
                        response_mime_type="application/json",
                        temperature=0.1,
                    ),
                )
            finally:
                if uploaded:
                    try:
                        client.files.delete(name=uploaded.name)
                    except Exception:
                        pass
        else:
            resp = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=_GREENWASH_SYSTEM,
                    response_mime_type="application/json",
                    temperature=0.1,
                ),
            )
        return json.loads(resp.text)

    analysis_failed = False
    result = None
    last_error = None
    for attempt in range(3):
        try:
            result = _call_gemini()
            break
        except Exception as e:
            last_error = e
            is_503 = "503" in str(e) or "UNAVAILABLE" in str(e)
            if is_503 and attempt < 2:
                wait = 30 * (attempt + 1)
                print(f"  [M3] Gemini 503，{wait}s 後重試（第 {attempt + 1}/3 次）...")
                time.sleep(wait)
            else:
                print(f"  [M3] Gemini 呼叫失敗（attempt {attempt + 1}）：{e}")
                analysis_failed = True
                break

    if result is None:
        result = {
            "claims":          [],
            "contradictions":  [],
            "greenwash_flag":  False,
            "confidence":      0.0,
            "summary":         f"分析失敗：{last_error}",
        }

    greenwash_flag = result.get("greenwash_flag", False)
    raw_contradictions = result.get("contradictions", [])
    claims         = result.get("claims", [])
    confidence     = result.get("confidence", 0.0)
    summary        = result.get("summary", "")

    # 統一矛盾格式：舊格式（字串）和新格式（dict with source_page）都支援
    contradictions = []
    for c in raw_contradictions:
        if isinstance(c, str):
            contradictions.append({"description": c, "claim_quote": "", "source_page": None})
        elif isinstance(c, dict):
            contradictions.append({
                "description": c.get("description", ""),
                "claim_quote": c.get("claim_quote", ""),
                "source_page": c.get("source_page"),
            })

    print(f"  [M3] 漂綠旗標：{greenwash_flag}（信心度 {confidence:.0%}）")
    if contradictions:
        for c in contradictions:
            print(f"       矛盾：{c['description'][:80]}...")

    # 更新 news_cache（保留既有新聞事件，只覆蓋 M3 相關欄位）
    update_payload = {
        "greenwash_flag":       greenwash_flag,
        "greenwash_reasons":    [c["description"] for c in contradictions],
        "greenwash_details":    contradictions,
        "greenwash_claims":     claims,
        "greenwash_confidence": confidence,
        "greenwash_summary":    summary,
    }
    # 分析失敗時不寫入 greenwash_analyzed_at，讓下次執行可自動重試
    if not analysis_failed:
        update_payload["greenwash_analyzed_at"] = datetime.now().isoformat()
    news_cache.update(update_payload)

    news_path = CACHE_DIR / f"{company_name}_news.json"
    news_path.write_text(json.dumps(news_cache, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  [M3] 已更新：{news_path.name}")

    return news_cache


# ── 入口 ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="M3 漂綠偵測（compact PDF + M1 指標 → Gemini 分析）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
範例：
  python scripts/detect_greenwash_m3.py
  python scripts/detect_greenwash_m3.py --company 中鋼
  python scripts/detect_greenwash_m3.py --force
        """,
    )
    parser.add_argument("--company", type=str, help="只處理指定公司")
    parser.add_argument("--force", action="store_true", help="強制重新分析，忽略快取")
    args = parser.parse_args()

    companies = COMPANIES
    if args.company:
        companies = [c for c in COMPANIES if c["company"] == args.company]
        if not companies:
            print(f"[錯誤] 找不到公司：{args.company}")
            return

    print("=" * 60)
    print("M3 漂綠偵測腳本")
    print(f"模式：{'強制重新分析' if args.force else '快取優先'}")
    print("=" * 60)

    for info in companies:
        print(f"\n── {info['company']} ({info['ticker']}) ──")
        try:
            detect_greenwash(info["company"], info["ticker"], force=args.force)
        except FileNotFoundError as e:
            print(f"  [跳過] {e}")
        except Exception as e:
            print(f"  [錯誤] {e}")
        time.sleep(2)

    print("\n完成！下一步：python scripts/preprocess_cache.py")


if __name__ == "__main__":
    main()
