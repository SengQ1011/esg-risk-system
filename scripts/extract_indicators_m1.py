"""
M1 指標抽取腳本 v2 — 混合模式（GRI AI 路由 + Gemini Files API）

流程：
  Step 1 [Python]       pdfplumber 全文抽取 → 定位 GRI 索引範圍 + 偵測頁碼偏移
  Step 2 [Gemini Text]  AI 解析 GRI 索引表 → 輸出結構化頁碼 JSON（含跨頁範圍）
  Step 3 [Python]       pypdf 切片 → 精簡 PDF（僅相關頁面 ±1 頁 buffer）
  Step 4 [Gemini PDF]   Files API 上傳精簡 PDF → AI 抽取指標值（無 bbox，穩定性高）
  Step 5 [Gemini PDF]   Files API 上傳精簡 PDF → AI 定位已知值的 bbox 座標（輕量任務）

  bbox 獨立於值抽取（Step 4/5 解耦）的原因：
  合併 bbox 使 JSON schema 從 72 欄增至 90 欄，對弱模型造成認知超載，
  導致大量指標被漏抽。Step 5 只需「找這個數字在哪」，任務單純，穩定性高。

防重複 API 呼叫（Log 快取機制）：
  - Step 2 / Step 4 / Step 5 的 Gemini 回應存至 data/logs/{company}_step{n}_cache.json
  - 重跑時若快取存在，自動跳過 API 呼叫
  - --force  強制重跑所有 API 呼叫
  - --step 4 只重跑 Step 4（清除快取）
  - --step 5 只重跑 Step 5（bbox 重定位，不重跑值抽取）
  - --company 台達電  只處理指定公司

執行方式（在專案根目錄）：
  python scripts/extract_indicators_m1.py
  python scripts/extract_indicators_m1.py --force
  python scripts/extract_indicators_m1.py --company 中鋼 --step 4
  python scripts/extract_indicators_m1.py --company 台達電 --step 5
"""

import sys
import json
import time
import re
import logging
import argparse
import pathlib
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.path.append(str(Path(__file__).parent.parent))

import pdfplumber
from pypdf import PdfReader, PdfWriter
from dotenv import load_dotenv
from google import genai
from google.genai import types
import fitz  # PyMuPDF — 用於頁碼轉換

from core.page_map import build_logical_to_physical_map

load_dotenv()

# ── 路徑常數 ─────────────────────────────────────────────────────
PDF_DIR   = Path(__file__).parent.parent / "data" / "pdfs"
CACHE_DIR = Path(__file__).parent.parent / "data" / "cache"
LOG_DIR   = Path(__file__).parent.parent / "data" / "logs"

for _d in [CACHE_DIR, LOG_DIR]:
    _d.mkdir(parents=True, exist_ok=True)

client = genai.Client()

# ── Gemini generate_content with retry（503 transient overload 用）──
def _generate_with_retry(model: str, contents, config, logger: logging.Logger, tag: str):
    """最多重試 3 次（30s / 60s / 120s），專門應對 503 高峰期。"""
    delays = [30, 60, 120]
    for attempt, wait in enumerate(delays, start=1):
        try:
            return client.models.generate_content(model=model, contents=contents, config=config)
        except Exception as e:
            if "503" in str(e) and attempt <= len(delays):
                logger.warning(f"[{tag}] 503 UNAVAILABLE，第 {attempt} 次重試（等待 {wait}s）...")
                time.sleep(wait)
            else:
                raise
    return client.models.generate_content(model=model, contents=contents, config=config)

# ── Demo 公司清單 ─────────────────────────────────────────────────
COMPANIES = [
    {"company": "台達電",  "ticker": "2308", "industry": "電子製造業", "filename": "台達電_2023.pdf",  "year": 2023},
    {"company": "中鋼",    "ticker": "2002", "industry": "鋼鐵業",     "filename": "中鋼_2023.pdf",    "year": 2023},
    {"company": "南山人壽","ticker": "5874", "industry": "保險業",     "filename": "南山人壽_2023.pdf","year": 2023},
    {"company": "臺積電",  "ticker": "2330", "industry": "半導體製造業","filename": "臺積電_2023.pdf",  "year": 2023},
]

# ── GRI 索引定位 patterns ─────────────────────────────────────────
GRI_INDEX_PATTERNS = [
    r"GRI\s*(?:內容|content)\s*(?:索引|index)",
    r"GRI\s*Standards?\s*(?:Index|Content|索引)",
    r"附錄.*GRI",
    r"SASB.*(?:對照|index)",
    r"永續.*(?:指標|索引).*對照",
    r"揭露.*對照表",
    r"指標對照",
    r"GRI\s*\d{3}",   # e.g. "GRI 305" appearing densely
]

# ── 多層 Fallback 設定 ─────────────────────────────────────────────
FALLBACK_THRESHOLD = 5   # Step 2 找到頁碼 < 此值時啟動 fallback

# Tier A：GRI 準則代號 → 各指標（用於從 GRI 索引文字提取章節編號）
INDICATOR_GRI_CODES: dict[str, list[str]] = {
    "ghg_scope1":               ["305-1"],
    "ghg_scope2":               ["305-2"],
    "ghg_scope3":               ["305-3"],
    "carbon_intensity":         ["305-4"],
    "electricity":              ["302-1"],
    "renewable_ratio":          ["302-1", "302-4"],
    "water":                    ["303-3", "303-5"],
    "waste":                    ["306-3"],
    "injury_rate":              ["403-9", "403-5"],
    "turnover":                 ["401-1"],
    "female_ratio":             ["405-1"],
    "female_mgmt_ratio":        ["405-1"],
    "training_hours":           ["404-1"],
    "independent_director_ratio": ["2-9"],
    "female_director_ratio":    ["405-1"],
    "has_sustainability_officer": ["2-12", "2-13"],
    "assurance":                ["2-5"],
    "violations":               ["2-27"],
}

# Tier B：各指標的中文關鍵字（用於全文搜尋）
INDICATOR_KEYWORDS: dict[str, list[str]] = {
    "ghg_scope1":               ["範疇一", "Scope 1", "直接（範疇一）", "直接排放"],
    "ghg_scope2":               ["範疇二", "Scope 2", "能源間接（範疇二）", "能源間接排放"],
    "ghg_scope3":               ["範疇三", "Scope 3", "其它間接（範疇三）", "其他間接排放"],
    "carbon_intensity":         ["碳排放強度", "溫室氣體強度", "排放強度", "碳強度"],
    "electricity":              ["用電量", "電力消耗", "電力使用量", "能源消耗量"],
    "renewable_ratio":          ["再生能源占比", "可再生能源占比", "再生能源使用率", "綠電占比"],
    "water":                    ["取水量", "耗水量", "用水量"],
    "waste":                    ["廢棄物總量", "廢棄物產生量", "廢棄物量"],
    "injury_rate":              ["職災率", "TRIR", "失能傷害頻率", "職業傷害率"],
    "turnover":                 ["離職率", "員工流動率", "員工離職率"],
    "female_ratio":             ["女性員工比例", "女性員工占比", "女性員工"],
    "female_mgmt_ratio":        ["女性主管比例", "女性管理職", "女性經理"],
    "training_hours":           ["平均訓練時數", "每人平均訓練", "人均訓練"],
    "independent_director_ratio": ["獨立董事比例", "獨立董事占比", "獨立董事"],
    "female_director_ratio":    ["女性董事比例", "女性董事", "女董事"],
    "has_sustainability_officer": ["永續長", "ESG長", "永續委員會", "永續推動委員會"],
    "assurance":                ["第三方確信", "保證聲明", "獨立確信", "鑑證聲明"],
    "violations":               ["重大裁罰", "重大違規", "違規裁罰", "主管機關裁罰"],
}

# ═══════════════════════════════════════════════════════════════════
# Logging 設定
# ═══════════════════════════════════════════════════════════════════

def setup_logger(company: str) -> logging.Logger:
    logger = logging.getLogger(f"m1.{company}")
    logger.setLevel(logging.DEBUG)
    logger.handlers.clear()

    log_path = LOG_DIR / f"{company}_extraction.log"
    fh = logging.FileHandler(log_path, encoding="utf-8", mode="w")
    fh.setLevel(logging.DEBUG)

    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(logging.INFO)

    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
    fh.setFormatter(fmt)
    ch.setFormatter(fmt)

    logger.addHandler(fh)
    logger.addHandler(ch)
    logger.info(f"日誌輸出至：{log_path}")
    return logger

# ═══════════════════════════════════════════════════════════════════
# 步驟間快取（防止重複 API 呼叫）
# ═══════════════════════════════════════════════════════════════════

def _cache_path(company: str, step: int) -> Path:
    return LOG_DIR / f"{company}_step{step}_cache.json"

def load_step_cache(company: str, step: int) -> dict | None:
    p = _cache_path(company, step)
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return None

def save_step_cache(company: str, step: int, data: dict) -> None:
    p = _cache_path(company, step)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

def clear_step_cache(company: str, step: int) -> None:
    p = _cache_path(company, step)
    if p.exists():
        p.unlink()

# ═══════════════════════════════════════════════════════════════════
# Step 1: PDF 全文抽取 + GRI 索引定位 + 頁碼偏移偵測
# ═══════════════════════════════════════════════════════════════════

def extract_all_pages(pdf_path: Path, logger: logging.Logger) -> list[dict]:
    """以 pdfplumber 抽取所有頁面文字，回傳 [{"page": 1, "text": "..."}]"""
    pages = []
    with pdfplumber.open(pdf_path) as pdf:
        total = len(pdf.pages)
        logger.info(f"PDF 共 {total} 頁，開始抽取文字...")
        for i, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            pages.append({
                "page": i + 1,       # 1-indexed 物理頁碼
                "text": text,
                "char_count": len(text),
            })
            if (i + 1) % 30 == 0:
                logger.debug(f"  已處理 {i+1}/{total} 頁")

    non_empty = sum(1 for p in pages if p["char_count"] > 100)
    logger.info(f"文字抽取完成｜有效頁（>100 字）：{non_empty}/{total}")
    return pages


def detect_page_offset(pages: list[dict], logger: logging.Logger) -> int:
    """
    偵測頁碼偏移量（封面/目錄頁數）。
    找到第一個頁尾顯示「1」的 PDF 物理頁，偏移 = 該頁的 0-indexed 索引。
    轉換公式：pdf_0idx = printed_page - 1 + offset
    """
    footer_patterns = [
        r"(?:^|\n)\s*1\s*$",           # 頁尾孤立 "1"
        r"第\s*1\s*頁",
        r"P\.\s*1\b",
        r"- 1 -",
        r"\b01\b\s*$",
    ]
    for page in pages[:25]:
        text = page["text"]
        for pat in footer_patterns:
            if re.search(pat, text, re.MULTILINE):
                offset = page["page"] - 1   # 物理頁 N (1-indexed) → offset = N-1
                logger.info(f"頁碼偏移偵測：PDF 物理第 {page['page']} 頁 = 印刷第 1 頁 → offset={offset}")
                return offset

    logger.warning("無法自動偵測頁碼偏移，預設 offset=0（將由 Step 2 Gemini 修正）")
    return 0


def find_gri_index_pages(pages: list[dict], logger: logging.Logger) -> list[dict]:
    """找出 GRI 內容索引所在的頁面（通常在最後 80 頁）"""
    total = len(pages)
    search_from = max(0, total - 80)
    start_idx = None

    for i in range(search_from, total):
        text = pages[i]["text"]
        hits = sum(1 for pat in GRI_INDEX_PATTERNS if re.search(pat, text, re.IGNORECASE))
        if hits >= 1:
            start_idx = i
            preview = text[:120].replace("\n", " ").strip()
            logger.info(f"GRI 索引頁定位：PDF 第 {pages[i]['page']} 頁（預覽：{preview!r}）")
            break

    if start_idx is None:
        logger.warning("找不到 GRI 索引，使用最後 40 頁作為 fallback")
        start_idx = max(0, total - 40)

    end_idx = min(start_idx + 40, total)
    gri_pages = pages[start_idx:end_idx]
    logger.info(f"GRI 索引範圍：PDF 第 {gri_pages[0]['page']}–{gri_pages[-1]['page']} 頁（共 {len(gri_pages)} 頁）")
    return gri_pages

# ═══════════════════════════════════════════════════════════════════
# Step 2: Gemini 解析 GRI 索引 → 結構化頁碼 JSON
# ═══════════════════════════════════════════════════════════════════

_GRI_PARSER_SYSTEM = """你是一位 ESG 文件分析師，正在解析企業永續報告書的「GRI 內容索引」表格。

這份表格通常為多欄位設計，欄位包含：GRI 指標代號、揭露項目、所在頁碼（可能是範圍，如 62-64）。

任務：
1. 找出以下 18 個指標在報告書中的印刷頁碼（若跨頁請展開為完整清單）
2. 估算頁碼偏移量（PDF 物理頁碼 - 印刷頁碼，封面/目錄佔的頁數）

輸出嚴格 JSON（不含任何說明文字）：
{
  "page_offset": 整數（找不到就填 0）,
  "indicators": {
    "ghg_scope1": [45, 46]  或  null,
    "ghg_scope2": [45, 46]  或  null,
    "ghg_scope3": null,
    "carbon_intensity": [47],
    "electricity": [48],
    "renewable_ratio": [49],
    "water": [52],
    "waste": [54],
    "injury_rate": [62, 63, 64],
    "turnover": [63],
    "female_ratio": [65],
    "female_mgmt_ratio": [65],
    "training_hours": [68],
    "independent_director_ratio": [78],
    "female_director_ratio": [78],
    "has_sustainability_officer": [22],
    "assurance": [112],
    "violations": [80]
  }
}

規則：
- 頁碼填印刷頁碼（非 PDF 物理頁碼）；找不到填 null
- 若索引寫「62-64」→ 展開為 [62, 63, 64]
- 若只寫「62」→ 填 [62]
- page_offset 通常等於封面＋目錄頁數（永續報告書一般 3–10 頁）

指標對照表：
  ghg_scope1              → GRI 305-1  範疇一溫室氣體排放
  ghg_scope2              → GRI 305-2  範疇二溫室氣體排放
  ghg_scope3              → GRI 305-3  範疇三溫室氣體排放
  carbon_intensity        → SASB / 碳強度 / 每百萬元碳排
  electricity             → GRI 302-1  用電量 / 能源消耗
  renewable_ratio         → GRI 302    再生能源占比
  water                   → GRI 303-5  用水量
  waste                   → GRI 306    廢棄物總量
  injury_rate             → GRI 403    職災率 / TRIR / 失能傷害頻率
  turnover                → GRI 401    員工流動率 / 離職率
  female_ratio            → GRI 405-1  女性員工比例
  female_mgmt_ratio       → GRI 405-1  女性主管比例（主管/經理層）
  training_hours          → GRI 404-1  員工平均訓練時數
  independent_director_ratio → GRI 2-9  獨立董事比例
  female_director_ratio   → GRI 405-1  女性董事比例
  has_sustainability_officer → 永續長 / ESG 委員會 / 永續推動委員會
  assurance               → GRI 2-5    第三方確信 / 保證聲明
  violations              → GRI 2-27   重大違規 / 裁罰 / 罰鍰次數

特別注意（治理指標常見位置，GRI 索引未明確列出時也請嘗試推估）：
- independent_director_ratio：「董事會組成」「公司治理」章節，通常含獨立董事人數或比例
- female_director_ratio：同上章節，含女性董事人數或比例
- has_sustainability_officer：報告書前段或「治理架構」章節，提及永續長、ESG 長等職稱
- violations：「法規遵循」「GRI 2-27」「重大裁罰」「罰鍰」相關章節
  若明確找不到，填 null；不要猜測。
"""

def call_step2_gri_parser(
    gri_pages: list[dict],
    company: str,
    logger: logging.Logger,
    force_step: int | None,
) -> dict:
    """Step 2：Gemini 解析 GRI 索引，回傳頁碼映射。有快取則跳過 API。"""
    if force_step != 2:
        cached = load_step_cache(company, 2)
        if cached:
            logger.info("[Step 2] ✓ 使用快取，跳過 Gemini API（--force 或 --step 2 可重跑）")
            return cached

    index_text = "\n\n".join(
        f"[PDF 物理第 {p['page']} 頁]\n{p['text']}"
        for p in gri_pages
        if p["char_count"] > 50
    )

    est_tokens = len(index_text) // 3
    logger.info(f"[Step 2] 呼叫 Gemini（預估 input ~{est_tokens:,} tokens）...")
    logger.debug(f"[Step 2] 送出文字前 300 字：\n{index_text[:300]}")

    response = _generate_with_retry(
        model="gemini-2.5-flash",
        contents=f"以下是 GRI 索引頁面文字，請解析：\n\n{index_text}",
        config=types.GenerateContentConfig(
            system_instruction=_GRI_PARSER_SYSTEM,
            response_mime_type="application/json",
            temperature=0.0,
        ),
        logger=logger,
        tag="Step 2",
    )

    result = json.loads(response.text)
    logger.info(
        f"[Step 2] 完成｜page_offset={result.get('page_offset', 0)}｜"
        f"找到頁碼：{sum(1 for v in result.get('indicators', {}).values() if v)}/18 個"
    )
    logger.debug(f"[Step 2] 完整回應：\n{json.dumps(result, ensure_ascii=False, indent=2)}")

    save_step_cache(company, 2, result)
    logger.info(f"[Step 2] 快取已存：{_cache_path(company, 2).name}")
    return result

# ═══════════════════════════════════════════════════════════════════
# Step 2A: 章節編號解析（Tier A Fallback）
# ═══════════════════════════════════════════════════════════════════

def resolve_section_references(
    gri_pages: list[dict],
    all_pages: list[dict],
    indicator_pages: dict[str, list[int] | None],
    page_offset: int,
    logger: logging.Logger,
) -> dict[str, list[int]]:
    """
    Tier A Fallback：當 GRI 索引使用章節編號（如「第四章 4.2.2.1」）而非頁碼時，
    透過三步驟將章節編號轉換成實際頁碼：
      1. 從 GRI 索引文字找出各指標的 GRI 準則代號對應的章節編號（純 Regex，無 Gemini）
      2. 用 PyMuPDF-style 文字搜尋在全文中定位章節編號出現的頁面
      3. 過濾掉 GRI 索引自身頁面，取內容頁

    回傳：{indicator_key: [printed_page, ...]}（只包含新找到的指標）
    """
    missing = [k for k, v in indicator_pages.items() if not v]
    if not missing:
        return {}

    # ── Step 2A-1：從 GRI 索引文字提取章節編號 ──────────────────────
    # 合併所有 GRI 索引頁面的文字
    gri_text = "\n".join(p["text"] for p in gri_pages)
    gri_index_start_page = gri_pages[0]["page"] if gri_pages else len(all_pages)

    # 章節編號 pattern：X.X、X.X.X、X.X.X.X（前後不能是數字，避免誤配 GRI 305-1）
    SECTION_PAT = re.compile(r'(?<!\d)(\d+\.\d+(?:\.\d+){0,2})(?!\d)')

    # 找出各指標在 GRI 索引裡最可能的章節編號
    indicator_sections: dict[str, str] = {}
    for key in missing:
        gri_codes = INDICATOR_GRI_CODES.get(key, [])
        for code in gri_codes:
            # 找含有此 GRI 代號的行
            for line in gri_text.splitlines():
                if code in line:
                    sections = SECTION_PAT.findall(line)
                    # 取最長（最具體）的章節編號，且至少要有兩層（X.X）
                    candidates = [s for s in sections if s.count('.') >= 1]
                    if candidates:
                        # 優先選最具體的（點最多），相同則取最後一個（位置欄通常在右側）
                        best = max(candidates, key=lambda s: (s.count('.'), len(s)))
                        indicator_sections[key] = best
                        break
            if key in indicator_sections:
                break

    found_sections = len(indicator_sections)
    logger.info(f"[Step 2A] Regex 從 GRI 索引提取章節編號：{found_sections} 個")
    for k, s in indicator_sections.items():
        logger.debug(f"[Step 2A]   {k} → 章節 {s}")

    if not indicator_sections:
        logger.warning("[Step 2A] 未找到任何章節編號，Tier A 失敗")
        return {}

    # ── Step 2A-2：全文搜尋章節編號 → 找物理頁 ───────────────────────
    # 只搜尋「內容頁」：排除開頭 15 頁（封面/目錄）和 GRI 索引頁（最後 40 頁）
    content_pages = [
        p for p in all_pages
        if 15 < p["page"] < gri_index_start_page - 5
    ]

    result: dict[str, list[int]] = {}
    for key, section in indicator_sections.items():
        # 計算每頁的命中次數（優先選命中多的頁）
        page_hits: dict[int, int] = {}
        for page in content_pages:
            # 確保是獨立出現的章節編號（避免 "4.2" 誤配 "4.2.2.1"）
            count = len(re.findall(
                r'(?<![.\d])' + re.escape(section) + r'(?![.\d])',
                page["text"]
            ))
            if count > 0:
                printed = page["page"] - page_offset
                if printed > 0:
                    page_hits[printed] = count

        if page_hits:
            top_pages = sorted(page_hits, key=lambda p: -page_hits[p])[:2]
            result[key] = sorted(top_pages)
            logger.info(f"[Step 2A] {key}: 章節 {section} → 印刷頁 {result[key]}")
        else:
            logger.debug(f"[Step 2A] {key}: 章節 {section} 在內容頁未找到")

    logger.info(f"[Step 2A] 完成，新增 {len(result)} 個指標頁碼")
    return result


# ═══════════════════════════════════════════════════════════════════
# Step 2B: 關鍵字搜尋（Tier B Fallback）
# ═══════════════════════════════════════════════════════════════════

def search_by_keywords(
    all_pages: list[dict],
    missing_keys: list[str],
    page_offset: int,
    gri_index_start_page: int,
    logger: logging.Logger,
) -> dict[str, list[int]]:
    """
    Tier B Fallback：對每個仍缺頁碼的指標，在全文（排除 GRI 索引區）
    搜尋預定義關鍵字，取命中最多的前 2 頁作為候選。
    純 Python，不呼叫 Gemini。
    """
    if not missing_keys:
        return {}

    # 內容頁：排除開頭 15 頁和 GRI 索引頁
    content_pages = [
        p for p in all_pages
        if 15 < p["page"] < gri_index_start_page - 5
    ]

    result: dict[str, list[int]] = {}
    for key in missing_keys:
        keywords = INDICATOR_KEYWORDS.get(key, [])
        if not keywords:
            continue

        page_hits: dict[int, int] = {}
        for page in content_pages:
            text = page["text"]
            hits = sum(1 for kw in keywords if kw in text)
            if hits > 0:
                printed = page["page"] - page_offset
                if printed > 0:
                    page_hits[printed] = page_hits.get(printed, 0) + hits

        if page_hits:
            top_pages = sorted(page_hits, key=lambda p: -page_hits[p])[:2]
            result[key] = sorted(top_pages)
            logger.info(f"[Step 2B] {key}: 關鍵字命中 → 印刷頁 {result[key]}")

    logger.info(f"[Step 2B] 完成，新增 {len(result)} 個指標頁碼")
    return result


# ═══════════════════════════════════════════════════════════════════
# Step 3: pypdf 切片 → 精簡 PDF
# ═══════════════════════════════════════════════════════════════════

def collect_physical_pages(
    indicator_pages: dict[str, list[int] | None],
    page_offset: int,
    total_pdf_pages: int,
    logger: logging.Logger,
    logical_to_physical: dict[int, int] | None = None,
) -> list[int]:
    """
    將印刷頁碼清單轉換為 PDF 物理頁碼（0-indexed），加 ±1 頁 buffer。

    logical_to_physical: 由 core.page_map.build_logical_to_physical_map 建立的對照表。
      若提供，優先使用（正確處理 2-up A3 等多頁格式）。
      若未提供，退回舊公式：pdf_0idx = printed_page - 1 + page_offset。
    """
    physical = set()
    for key, printed_list in indicator_pages.items():
        if not printed_list:
            continue
        for printed_page in printed_list:
            if logical_to_physical is not None:
                pdf_0idx = logical_to_physical.get(printed_page)
                if pdf_0idx is None:
                    continue
            else:
                pdf_0idx = printed_page - 1 + page_offset

            for delta in (-1, 0, 1):     # ±1 頁 buffer
                idx = pdf_0idx + delta
                if 0 <= idx < total_pdf_pages:
                    physical.add(idx)

    sorted_pages = sorted(physical)
    logger.info(
        f"[Step 3] 收集物理頁碼（0-indexed）：{sorted_pages[:8]}{'...' if len(sorted_pages)>8 else ''}，"
        f"共 {len(sorted_pages)} 頁"
    )
    return sorted_pages


def slice_pdf(
    pdf_path: Path,
    physical_0idx_pages: list[int],
    output_path: Path,
    logger: logging.Logger,
) -> int:
    """用 pypdf 從原始 PDF 切出指定物理頁，輸出精簡 PDF。"""
    reader = PdfReader(str(pdf_path))
    total = len(reader.pages)
    writer = PdfWriter()

    included = []
    for idx in physical_0idx_pages:
        if 0 <= idx < total:
            writer.add_page(reader.pages[idx])
            included.append(idx + 1)    # log 用 1-indexed
        else:
            logger.warning(f"[Step 3] 物理頁 {idx} 超出範圍（PDF 共 {total} 頁），跳過")

    with open(output_path, "wb") as f:
        writer.write(f)

    size_kb = output_path.stat().st_size // 1024
    logger.info(
        f"[Step 3] 精簡 PDF 建立：{len(included)} 頁，{size_kb} KB → {output_path.name}"
    )
    logger.debug(f"[Step 3] 包含物理頁（1-indexed）：{included}")
    return len(included)

# ═══════════════════════════════════════════════════════════════════
# Step 4: Gemini Files API 讀精簡 PDF → 指標值抽取
# ═══════════════════════════════════════════════════════════════════

_EXTRACTOR_SYSTEM = """你是一位精確的 ESG 資料分析師，從企業永續報告書 PDF 中抽取量化指標。

重要數值語義（必讀，避免常見錯誤）：
- training_hours：員工「每人平均」訓練時數（小時/人/年），典型值 10–60。
  ⚠ 不要填組織總計時數（百萬小時量級）；請找「人均」或「每人」欄位。
- violations：GRI 2-27 主管機關重大裁罰【件數】，典型 0–30 件。
  不是罰款金額，不是內部稽查件數；若有多年取最新一年。
- renewable_ratio：再生能源佔總用電量的 %，直接填數字（76.0），不含 % 符號。
- has_sustainability_officer：公司是否設有「永續長」「ESG 長」或對等職位（true/false）。
- assurance：報告書是否有「第三方確信」「保證聲明」（true/false）。

一般規則：
- value：找到的數值（純數字，去除千分位逗號）；布林指標填 true/false；找不到填 null
- source_text：PDF 中該數值的「原始字串」，完整保留千分位符號、小數點、單位縮寫（例如 "16,809,455" 或 "16,809.455"）；
  此欄用於後續精確文字定位，請勿換算或修改；布林指標、找不到的指標填 null
- source_page：找到資料的印刷頁碼（數字）；不確定填 null
- confidence：0.95 = 清楚確定｜0.7 = 有點推測｜0.0 = 找不到
- 單位換算：value 欄才換算（千公噸 CO2e → 公噸 ×1000；MWh/千度 → kWh ×1000；百分比填純數字 38.5% → 38.5）
  source_text 保留原文，不換算
- 同指標有多年數據時，取最新一年

回傳嚴格 JSON（不含說明）：
{
  "ghg_scope1":                 {"value": null, "source_text": null, "unit": "公噸CO2e",        "source_page": null, "confidence": 0.0},
  "ghg_scope2":                 {"value": null, "source_text": null, "unit": "公噸CO2e",        "source_page": null, "confidence": 0.0},
  "ghg_scope3":                 {"value": null, "source_text": null, "unit": "公噸CO2e",        "source_page": null, "confidence": 0.0},
  "carbon_intensity":           {"value": null, "source_text": null, "unit": "公噸CO2e/百萬元", "source_page": null, "confidence": 0.0},
  "electricity":                {"value": null, "source_text": null, "unit": "kWh",             "source_page": null, "confidence": 0.0},
  "renewable_ratio":            {"value": null, "source_text": null, "unit": "%",               "source_page": null, "confidence": 0.0},
  "water":                      {"value": null, "source_text": null, "unit": "立方公尺",        "source_page": null, "confidence": 0.0},
  "waste":                      {"value": null, "source_text": null, "unit": "公噸",            "source_page": null, "confidence": 0.0},
  "injury_rate":                {"value": null, "source_text": null, "unit": "TRIR",            "source_page": null, "confidence": 0.0},
  "turnover":                   {"value": null, "source_text": null, "unit": "%",               "source_page": null, "confidence": 0.0},
  "female_ratio":               {"value": null, "source_text": null, "unit": "%",               "source_page": null, "confidence": 0.0},
  "female_mgmt_ratio":          {"value": null, "source_text": null, "unit": "%",               "source_page": null, "confidence": 0.0},
  "training_hours":             {"value": null, "source_text": null, "unit": "小時/人/年",      "source_page": null, "confidence": 0.0},
  "independent_director_ratio": {"value": null, "source_text": null, "unit": "%",               "source_page": null, "confidence": 0.0},
  "female_director_ratio":      {"value": null, "source_text": null, "unit": "%",               "source_page": null, "confidence": 0.0},
  "has_sustainability_officer": {"value": null, "source_text": null, "unit": "布林",            "source_page": null, "confidence": 0.0},
  "assurance":                  {"value": null, "source_text": null, "unit": "布林",            "source_page": null, "confidence": 0.0},
  "violations":                 {"value": null, "source_text": null, "unit": "次",              "source_page": null, "confidence": 0.0}
}
"""

# ── Step 5 Prompt：bbox 定位（獨立於值抽取）────────────────────────
_BBOX_SYSTEM = """你是一位精確的文件標注分析師，負責定位數值在 PDF 頁面上的位置。

任務：在 compact PDF 中找到使用者提供的「已知 ESG 指標值」，並回傳該數值的 bbox 座標。

bbox 格式：[x1, y1, x2, y2]，皆為 0.0~1.0 的比例座標（原點左上角，x 向右，y 向下）。

規則：
- compact_page：該數值在這份 compact PDF 中的頁碼（1-indexed）；找不到填 null
- bbox：框住「數值本身」的最小矩形（不需包含標籤欄）；找不到填 null
- 布林指標（has_sustainability_officer / assurance）通常無法精確定位，直接填 null
- 座標必須在 [0.0, 1.0] 範圍內；請勿回傳 pt 單位的像素值

回傳嚴格 JSON（不含說明）：
{
  "ghg_scope1":                 {"compact_page": null, "bbox": null},
  "ghg_scope2":                 {"compact_page": null, "bbox": null},
  "ghg_scope3":                 {"compact_page": null, "bbox": null},
  "carbon_intensity":           {"compact_page": null, "bbox": null},
  "electricity":                {"compact_page": null, "bbox": null},
  "renewable_ratio":            {"compact_page": null, "bbox": null},
  "water":                      {"compact_page": null, "bbox": null},
  "waste":                      {"compact_page": null, "bbox": null},
  "injury_rate":                {"compact_page": null, "bbox": null},
  "turnover":                   {"compact_page": null, "bbox": null},
  "female_ratio":               {"compact_page": null, "bbox": null},
  "female_mgmt_ratio":          {"compact_page": null, "bbox": null},
  "training_hours":             {"compact_page": null, "bbox": null},
  "independent_director_ratio": {"compact_page": null, "bbox": null},
  "female_director_ratio":      {"compact_page": null, "bbox": null},
  "has_sustainability_officer": {"compact_page": null, "bbox": null},
  "assurance":                  {"compact_page": null, "bbox": null},
  "violations":                 {"compact_page": null, "bbox": null}
}
"""

def call_step4_extractor(
    compact_pdf_path: Path,
    company: str,
    logger: logging.Logger,
    force_step: int | None,
) -> dict:
    """
    Step 4：透過 Gemini Files API 上傳精簡 PDF 並抽取指標值。
    有快取則跳過；Fallback 到 inline_data（如果 Files API 不可用）。
    """
    if force_step != 4:
        cached = load_step_cache(company, 4)
        if cached:
            logger.info("[Step 4] ✓ 使用快取，跳過 Gemini API（--force 或 --step 4 可重跑）")
            return cached

    size_kb = compact_pdf_path.stat().st_size // 1024
    logger.info(f"[Step 4] 精簡 PDF：{size_kb} KB，準備呼叫 Gemini...")

    prompt_text = f"公司：{company}\n請從這份 PDF 精確抽取所有 ESG 指標數值。"
    result = None

    # ── 優先：Gemini Files API ──────────────────────────────────
    try:
        logger.info("[Step 4] 嘗試 Files API 上傳...")
        uploaded = client.files.upload(
            file=pathlib.Path(compact_pdf_path),
        )
        logger.info(f"[Step 4] 上傳成功，URI = {uploaded.uri}")

        try:
            response = _generate_with_retry(
                model="gemini-2.5-flash",
                contents=[uploaded, prompt_text],
                config=types.GenerateContentConfig(
                    system_instruction=_EXTRACTOR_SYSTEM,
                    response_mime_type="application/json",
                    temperature=0.0,
                ),
                logger=logger,
                tag="Step 4 Files",
            )
            result = json.loads(response.text)
            logger.info("[Step 4] Files API 抽取成功")
        finally:
            try:
                client.files.delete(name=uploaded.name)
                logger.debug(f"[Step 4] Files API 檔案已刪除：{uploaded.name}")
            except Exception as e:
                logger.warning(f"[Step 4] Files API 刪除失敗（可忽略）：{e}")

    # ── Fallback：inline_data（適用 < 20 MB 的精簡 PDF）──────────
    except Exception as files_err:
        logger.warning(f"[Step 4] Files API 失敗：{files_err}")
        logger.info("[Step 4] 改用 inline_data fallback...")

        with open(compact_pdf_path, "rb") as f:
            pdf_bytes = f.read()

        logger.info(f"[Step 4] inline_data 模式，PDF bytes = {len(pdf_bytes):,}")
        response = _generate_with_retry(
            model="gemini-2.5-flash",
            contents=[
                types.Part(
                    inline_data=types.Blob(mime_type="application/pdf", data=pdf_bytes)
                ),
                types.Part(text=prompt_text),
            ],
            config=types.GenerateContentConfig(
                system_instruction=_EXTRACTOR_SYSTEM,
                response_mime_type="application/json",
                temperature=0.0,
            ),
            logger=logger,
            tag="Step 4 inline",
        )
        result = json.loads(response.text)
        logger.info("[Step 4] inline_data 抽取成功")

    found = sum(1 for v in result.values() if isinstance(v, dict) and v.get("value") is not None)
    high_conf = sum(
        1 for v in result.values()
        if isinstance(v, dict) and v.get("value") is not None and v.get("confidence", 0) >= 0.8
    )
    logger.info(f"[Step 4] 抽取結果：{found}/18 個指標有值，其中高信心（≥0.8）{high_conf} 個")
    logger.debug(f"[Step 4] 完整回應：\n{json.dumps(result, ensure_ascii=False, indent=2)}")

    save_step_cache(company, 4, result)
    logger.info(f"[Step 4] 快取已存：{_cache_path(company, 4).name}")
    return result

# ═══════════════════════════════════════════════════════════════════
# Step 5: Gemini 定位已知數值的 bbox（獨立於值抽取，認知負擔低）
# ═══════════════════════════════════════════════════════════════════

def call_step5_bbox_extractor(
    compact_pdf_path: Path,
    indicators: dict,
    company: str,
    logger: logging.Logger,
    force_step: int | None,
) -> dict:
    """
    Step 5：對 Step 4 已確認的指標值，找出 bbox 座標。
    任務比 Step 4 單純（只需定位數字位置），模型穩定性更高。
    有快取則跳過；--step 5 或 --force 可重跑。
    """
    if force_step != 5:
        cached = load_step_cache(company, 5)
        if cached:
            logger.info("[Step 5] ✓ 使用快取，跳過 Gemini API（--force 或 --step 5 可重跑）")
            return cached

    # 只傳入有值的指標（布林指標不需要 bbox）
    _BOOL_KEYS = {"has_sustainability_officer", "assurance"}
    known_values = {
        k: {"value": v.get("value"), "unit": v.get("unit")}
        for k, v in indicators.items()
        if isinstance(v, dict) and v.get("value") is not None and k not in _BOOL_KEYS
    }

    if not known_values:
        logger.info("[Step 5] 無可定位的指標（step 4 全為 null），跳過 bbox 抽取")
        return {}

    size_kb = compact_pdf_path.stat().st_size // 1024
    logger.info(f"[Step 5] 定位 {len(known_values)} 個指標的 bbox，PDF {size_kb} KB...")

    prompt_text = (
        f"公司：{company}\n\n"
        f"以下是已從本報告書確認的 ESG 指標值，請找出每個數值在 compact PDF 中的位置：\n\n"
        f"{json.dumps(known_values, ensure_ascii=False, indent=2)}\n\n"
        "請回傳每個指標的 compact PDF 頁碼（compact_page）和 bbox 座標（0.0~1.0 比例）。"
    )

    result = None

    try:
        logger.info("[Step 5] 嘗試 Files API 上傳...")
        uploaded = client.files.upload(file=pathlib.Path(compact_pdf_path))
        logger.info(f"[Step 5] 上傳成功，URI = {uploaded.uri}")

        try:
            response = _generate_with_retry(
                model="gemini-2.5-flash",
                contents=[uploaded, prompt_text],
                config=types.GenerateContentConfig(
                    system_instruction=_BBOX_SYSTEM,
                    response_mime_type="application/json",
                    temperature=0.0,
                ),
                logger=logger,
                tag="Step 5 Files",
            )
            result = json.loads(response.text)
            logger.info("[Step 5] Files API bbox 定位成功")
        finally:
            try:
                client.files.delete(name=uploaded.name)
                logger.debug(f"[Step 5] Files API 檔案已刪除：{uploaded.name}")
            except Exception as _e:
                logger.warning(f"[Step 5] Files API 刪除失敗（可忽略）：{_e}")

    except Exception as files_err:
        logger.warning(f"[Step 5] Files API 失敗：{files_err}")
        logger.info("[Step 5] 改用 inline_data fallback...")

        with open(compact_pdf_path, "rb") as f:
            pdf_bytes = f.read()

        response = _generate_with_retry(
            model="gemini-2.5-flash",
            contents=[
                types.Part(inline_data=types.Blob(mime_type="application/pdf", data=pdf_bytes)),
                types.Part(text=prompt_text),
            ],
            config=types.GenerateContentConfig(
                system_instruction=_BBOX_SYSTEM,
                response_mime_type="application/json",
                temperature=0.0,
            ),
            logger=logger,
            tag="Step 5 inline",
        )
        result = json.loads(response.text)
        logger.info("[Step 5] inline_data bbox 定位成功")

    bbox_found = sum(
        1 for v in result.values()
        if isinstance(v, dict) and v.get("bbox") is not None
    )
    logger.info(f"[Step 5] bbox 定位：{bbox_found}/{len(known_values)} 個有座標")
    logger.debug(f"[Step 5] 完整回應：\n{json.dumps(result, ensure_ascii=False, indent=2)}")

    save_step_cache(company, 5, result)
    logger.info(f"[Step 5] 快取已存：{_cache_path(company, 5).name}")
    return result

# ═══════════════════════════════════════════════════════════════════
# 主流程
# ═══════════════════════════════════════════════════════════════════

def process_company(info: dict, force_all: bool, force_step: int | None) -> bool:
    company  = info["company"]
    pdf_path = PDF_DIR / info["filename"]
    logger   = setup_logger(company)

    logger.info("=" * 60)
    logger.info(f"開始處理：{company} ({info['ticker']})  {info['year']}年報告書")
    logger.info(f"PDF：{pdf_path}")

    if not pdf_path.exists():
        logger.error("找不到 PDF，請先執行 python scripts/download_reports.py")
        return False

    # 如果 --force，清除所有快取
    if force_all:
        for step in (2, 4, 5):
            clear_step_cache(company, step)
        logger.info("已清除所有步驟快取（force 模式）")
    elif force_step:
        clear_step_cache(company, force_step)
        logger.info(f"已清除 Step {force_step} 快取")

    try:
        # ── Step 1 ─────────────────────────────────────────────
        logger.info("── Step 1: PDF 全文抽取 ─────────────────────────")
        pages = extract_all_pages(pdf_path, logger)
        total_pdf_pages = len(pages)

        offset_guess = detect_page_offset(pages, logger)
        gri_pages    = find_gri_index_pages(pages, logger)

        # ── Step 2 ─────────────────────────────────────────────
        logger.info("── Step 2: Gemini 解析 GRI 索引 ────────────────")
        time.sleep(2)
        try:
            gri_result = call_step2_gri_parser(gri_pages, company, logger, force_step)
            page_offset     = gri_result.get("page_offset", offset_guess)
            indicator_pages = gri_result.get("indicators", {})
        except Exception as step2_err:
            # Gemini 不可用（503/429）時，用空結果繼續，讓 Tier A/B fallback 接手
            logger.warning(f"[Step 2] Gemini 失敗（{step2_err}），跳過 GRI 解析，改用純文字 fallback")
            page_offset     = offset_guess
            indicator_pages = {k: None for k in INDICATOR_GRI_CODES}

        found_mappings = {k: v for k, v in indicator_pages.items() if v}

        # 合理性檢查：Gemini 的 page_offset 若和 Python 偵測值差距 > 15，改用 Python 值
        if abs(page_offset - offset_guess) > 15:
            logger.warning(
                f"Gemini page_offset={page_offset} 與 Python 偵測值 {offset_guess} 差距過大，"
                f"改用 Python 偵測值"
            )
            page_offset = offset_guess

        logger.info(f"使用 page_offset = {page_offset}（共 {len(found_mappings)}/18 個指標有頁碼）")

        # GRI 索引起始物理頁（用於 fallback 過濾）
        gri_index_start_page = gri_pages[0]["page"] if gri_pages else len(pages)

        # ── Step 2A/2B: Fallback — 章節編號解析 + 關鍵字搜尋 ────────
        fallback_triggered = False
        if len(found_mappings) < FALLBACK_THRESHOLD:
            fallback_triggered = True
            logger.info(
                f"[Fallback] Step 2 僅找到 {len(found_mappings)} 個頁碼（< {FALLBACK_THRESHOLD}），"
                "啟動 Tier A：章節編號解析"
            )
            section_pages = resolve_section_references(
                gri_pages, pages, indicator_pages, page_offset, logger
            )
            for k, v in section_pages.items():
                if k not in found_mappings or not found_mappings[k]:
                    found_mappings[k] = v
                    indicator_pages[k] = v
            logger.info(f"[Fallback] Tier A 後：共 {len(found_mappings)}/18 個指標有頁碼")

            # ── Step 2B: Tier B Fallback — 關鍵字搜尋 ──────────────
            if len(found_mappings) < FALLBACK_THRESHOLD:
                logger.info(
                    f"[Fallback] Tier A 後仍只有 {len(found_mappings)} 個，"
                    "啟動 Tier B：關鍵字搜尋"
                )
                still_missing = [k for k in indicator_pages if not found_mappings.get(k)]
                keyword_pages = search_by_keywords(
                    pages, still_missing, page_offset, gri_index_start_page, logger
                )
                for k, v in keyword_pages.items():
                    if k not in found_mappings or not found_mappings[k]:
                        found_mappings[k] = v
                        indicator_pages[k] = v
                logger.info(f"[Fallback] Tier B 後：共 {len(found_mappings)}/18 個指標有頁碼")

        # Fallback 補充了新頁面 → Step 4 的舊 cache 已過時，強制清除重跑
        if fallback_triggered and len(found_mappings) >= FALLBACK_THRESHOLD:
            if force_step not in (4, 5):   # 除非使用者明確指定只跑某步驟
                clear_step_cache(company, 4)
                clear_step_cache(company, 5)
                logger.info("[Fallback] 已清除 Step 4/5 cache，將用擴充後的 compact PDF 重新抽取")

        # ── Step 3 ─────────────────────────────────────────────
        logger.info("── Step 3: 切片精簡 PDF ─────────────────────────")
        # 建立邏輯頁 → 物理頁對照表（處理 2-up A3 等多頁格式）
        fitz_doc   = fitz.open(str(pdf_path))
        page_map   = build_logical_to_physical_map(fitz_doc, page_offset)
        fitz_doc.close()

        physical_pages = collect_physical_pages(
            indicator_pages, page_offset, total_pdf_pages, logger,
            logical_to_physical=page_map,
        )

        if not physical_pages:
            logger.warning("Step 2 無法取得任何頁碼，fallback 使用前 60 頁")
            physical_pages = list(range(min(60, total_pdf_pages)))

        compact_pdf = LOG_DIR / f"compact_{info['ticker']}.pdf"
        page_count  = slice_pdf(pdf_path, physical_pages, compact_pdf, logger)

        # compact_page_map：compact 1-indexed → 原始物理頁 1-indexed
        # 供 fix_bbox_with_pymupdf.py 用 _compact_page 反查正確原始頁，
        # 避免 GRI 解析錯誤（尤其是 A3 2-up PDF 混淆邏輯/物理頁對應）
        compact_page_map = {i + 1: physical_pages[i] + 1 for i in range(len(physical_pages))}

        # ── Step 4 ─────────────────────────────────────────────
        logger.info("── Step 4: Gemini 讀精簡 PDF 抽取指標 ──────────")
        time.sleep(4)
        indicators = call_step4_extractor(compact_pdf, company, logger, force_step)

        # ── Step 4 後處理：修正 source_page（保留 compact page 供 Step 5 使用）──
        for _key, _ind in indicators.items():
            if not isinstance(_ind, dict):
                continue
            # 保存 Gemini 給的 compact PDF 頁碼（Step 5 bbox 定位用）
            _ind["_compact_page"] = _ind.get("source_page")
            # 改用 GRI 頁碼映射（原始報告印刷頁碼）
            if _key in found_mappings and found_mappings[_key]:
                _ind["source_page"] = found_mappings[_key][0]
                logger.debug(f"[Post4] {_key} source_page：{_ind['_compact_page']} → {_ind['source_page']}")

        # ── Step 5: 定位已知數值的 bbox ───────────────────────────
        logger.info("── Step 5: Gemini 定位指標 bbox 座標 ────────────")
        time.sleep(4)
        try:
            bbox_result = call_step5_bbox_extractor(compact_pdf, indicators, company, logger, force_step)
        except Exception as step5_err:
            logger.warning(f"[Step 5] bbox 定位失敗（{step5_err}），略過，不影響 ESG 分數")
            bbox_result = {}

        # ── Step 5 後處理：bbox 正規化 + 合併進 indicators ─────────
        compact_page_dims: dict[int, tuple[float, float]] = {}
        try:
            with pdfplumber.open(compact_pdf) as _cpdf:
                for _i, _pg in enumerate(_cpdf.pages):
                    compact_page_dims[_i + 1] = (_pg.width, _pg.height)
        except Exception as _e:
            logger.warning(f"無法讀 compact PDF 頁面尺寸，bbox 正規化跳過：{_e}")

        for _key, _bbox_info in bbox_result.items():
            if not isinstance(_bbox_info, dict):
                continue
            if _key not in indicators or not isinstance(indicators[_key], dict):
                continue

            _compact_page = _bbox_info.get("compact_page")
            _bbox = _bbox_info.get("bbox")

            # bbox 正規化：若任何座標 > 1.0，視為 pt 座標，除以頁面尺寸
            if _bbox and isinstance(_bbox, list) and len(_bbox) == 4:
                if any(isinstance(v, (int, float)) and v > 1.0 for v in _bbox if v is not None):
                    _w, _h = compact_page_dims.get(_compact_page or 1, (595.0, 842.0))
                    _bbox = [
                        round(max(0.0, min(1.0, _bbox[0] / _w)), 4),
                        round(max(0.0, min(1.0, _bbox[1] / _h)), 4),
                        round(max(0.0, min(1.0, _bbox[2] / _w)), 4),
                        round(max(0.0, min(1.0, _bbox[3] / _h)), 4),
                    ]
                    logger.debug(f"[Post5] {_key} bbox 正規化 → {_bbox}")

            indicators[_key]["bbox"] = _bbox
            if _compact_page is not None:
                indicators[_key]["_compact_page"] = _compact_page

        # ── 儲存快取 ──────────────────────────────────────────
        found_count = sum(
            1 for v in indicators.values()
            if isinstance(v, dict) and v.get("value") is not None
        )

        output = {
            "company_name": company,
            "ticker":       info["ticker"],
            "industry":     info["industry"],
            "report_year":  info["year"],
            "report_title": f"{company}{info['year']}年永續報告書",
            "indicators":   indicators,
            "greenwash_claims": [],
            "_meta": {
                "pipeline_version":  "v2-hybrid",
                "total_pdf_pages":   total_pdf_pages,
                "compact_pdf_pages": page_count,
                "page_offset":       page_offset,
                "compact_page_map":  compact_page_map,
                "gri_page_map":      found_mappings,
                "indicators_found":  found_count,
                "pdf_path":          str(pdf_path),
            },
        }

        out_path = CACHE_DIR / f"{company}_indicators.json"
        out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")

        logger.info(f"✓ 完成｜抽取 {found_count}/18 個指標｜已存檔 {out_path.name}")
        logger.info("=" * 60)
        return True

    except Exception as e:
        logger.error(f"處理失敗：{e}", exc_info=True)
        logger.info("提示：若是 429 quota 錯誤，等待 quota 重置後重跑即可（快取會保留已完成的步驟）")
        return False


def main():
    parser = argparse.ArgumentParser(
        description="M1 ESG 指標抽取腳本 v2（混合模式）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
範例：
  python scripts/extract_indicators_m1.py                       # 正常執行（有快取則跳過 API）
  python scripts/extract_indicators_m1.py --force               # 強制重跑所有 API
  python scripts/extract_indicators_m1.py --company 台達電      # 只跑台達電
  python scripts/extract_indicators_m1.py --company 中鋼 --step 4   # 只重跑中鋼的 Step 4
        """,
    )
    parser.add_argument("--force",   action="store_true", help="清除所有快取，強制重跑所有 API 呼叫")
    parser.add_argument("--company", type=str, help="只處理指定公司（例：台達電）")
    parser.add_argument("--step",    type=int, choices=[2, 4, 5], help="只重跑指定步驟（2=GRI解析 / 4=指標抽取 / 5=bbox定位）")
    args = parser.parse_args()

    companies = COMPANIES
    if args.company:
        companies = [c for c in COMPANIES if c["company"] == args.company]
        if not companies:
            print(f"[錯誤] 找不到公司：{args.company}，可用：{[c['company'] for c in COMPANIES]}")
            return

    print("=" * 60)
    print("M1 指標抽取腳本 v2（混合模式）")
    print(f"模式：{'強制重跑' if args.force else f'快取優先（--step {args.step} 重跑）' if args.step else '快取優先'}")
    print(f"日誌目錄：{LOG_DIR}")
    print("=" * 60)

    success = 0
    for info in companies:
        try:
            if process_company(info, args.force, args.step):
                success += 1
        except Exception as e:
            print(f"[致命錯誤] {info['company']}：{e}")
        if len(companies) > 1:
            time.sleep(5)   # 公司之間間隔，避免 rate limit

    print(f"\n完成 {success}/{len(companies)} 家")
    if success > 0:
        print("下一步：python -X utf8 scripts/preprocess_cache.py")


if __name__ == "__main__":
    main()
