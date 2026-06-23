"""
M1 指標抽取腳本 v2 — 混合模式（GRI AI 路由 + Gemini Files API）

流程：
  Step 1 [Python]       pdfplumber 全文抽取 → 定位 GRI 索引範圍 + 偵測頁碼偏移
  Step 2 [Gemini Text]  AI 解析 GRI 索引表 → 輸出結構化頁碼 JSON（含跨頁範圍）
  Step 3 [Python]       pypdf 切片 → 精簡 PDF（僅相關頁面 ±1 頁 buffer）
  Step 4 [Gemini PDF]   Files API 上傳精簡 PDF → AI 視覺抽取指標值

防重複 API 呼叫（Log 快取機制）：
  - Step 2 / Step 4 的 Gemini 回應存至 data/logs/{company}_step{n}_cache.json
  - 重跑時若快取存在，自動跳過 API 呼叫
  - --force  強制重跑所有 API 呼叫
  - --step 2 只重跑 Step 2（清除 Step 2 快取後重新呼叫）
  - --company 台達電  只處理指定公司

執行方式（在專案根目錄）：
  python scripts/extract_indicators_m1.py
  python scripts/extract_indicators_m1.py --force
  python scripts/extract_indicators_m1.py --company 中鋼 --step 4
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

load_dotenv()

# ── 路徑常數 ─────────────────────────────────────────────────────
PDF_DIR   = Path(__file__).parent.parent / "data" / "pdfs"
CACHE_DIR = Path(__file__).parent.parent / "data" / "cache"
LOG_DIR   = Path(__file__).parent.parent / "data" / "logs"

for _d in [CACHE_DIR, LOG_DIR]:
    _d.mkdir(parents=True, exist_ok=True)

client = genai.Client()

# ── Demo 公司清單 ─────────────────────────────────────────────────
COMPANIES = [
    {"company": "台達電",  "ticker": "2308", "industry": "電子製造業", "filename": "台達電_2023.pdf",  "year": 2023},
    {"company": "中鋼",    "ticker": "2002", "industry": "鋼鐵業",     "filename": "中鋼_2023.pdf",    "year": 2023},
    {"company": "南山人壽","ticker": "5874", "industry": "保險業",     "filename": "南山人壽_2023.pdf","year": 2023},
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

    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=f"以下是 GRI 索引頁面文字，請解析：\n\n{index_text}",
        config=types.GenerateContentConfig(
            system_instruction=_GRI_PARSER_SYSTEM,
            response_mime_type="application/json",
            temperature=0.0,
        ),
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
# Step 3: pypdf 切片 → 精簡 PDF
# ═══════════════════════════════════════════════════════════════════

def collect_physical_pages(
    indicator_pages: dict[str, list[int] | None],
    page_offset: int,
    total_pdf_pages: int,
    logger: logging.Logger,
) -> list[int]:
    """
    將印刷頁碼清單轉換為 PDF 物理頁碼（0-indexed），加 ±1 頁 buffer。
    公式：pdf_0idx = printed_page - 1 + page_offset
    """
    physical = set()
    for key, printed_list in indicator_pages.items():
        if not printed_list:
            continue
        for printed_page in printed_list:
            for delta in (-1, 0, 1):     # ±1 頁 buffer
                pdf_0idx = printed_page - 1 + page_offset + delta
                if 0 <= pdf_0idx < total_pdf_pages:
                    physical.add(pdf_0idx)

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

規則：
- value：找到的數值（純數字，去除千分位逗號）；布林指標填 true/false；找不到填 null
- source_page：找到資料的印刷頁碼（數字）；不確定填 null
- confidence：0.95 = 清楚確定｜0.7 = 有點推測｜0.0 = 找不到
- 單位換算：千公噸 CO2e → 公噸 (×1000)；MWh / 千度 → kWh (×1000)；百分比填純數字（38.5% → 38.5）
- 同指標有多年數據時，取最新一年

回傳嚴格 JSON（不含說明）：
{
  "ghg_scope1":                 {"value": null, "unit": "公噸CO2e",        "source_page": null, "confidence": 0.0},
  "ghg_scope2":                 {"value": null, "unit": "公噸CO2e",        "source_page": null, "confidence": 0.0},
  "ghg_scope3":                 {"value": null, "unit": "公噸CO2e",        "source_page": null, "confidence": 0.0},
  "carbon_intensity":           {"value": null, "unit": "公噸CO2e/百萬元", "source_page": null, "confidence": 0.0},
  "electricity":                {"value": null, "unit": "kWh",             "source_page": null, "confidence": 0.0},
  "renewable_ratio":            {"value": null, "unit": "%",               "source_page": null, "confidence": 0.0},
  "water":                      {"value": null, "unit": "立方公尺",        "source_page": null, "confidence": 0.0},
  "waste":                      {"value": null, "unit": "公噸",            "source_page": null, "confidence": 0.0},
  "injury_rate":                {"value": null, "unit": "TRIR",            "source_page": null, "confidence": 0.0},
  "turnover":                   {"value": null, "unit": "%",               "source_page": null, "confidence": 0.0},
  "female_ratio":               {"value": null, "unit": "%",               "source_page": null, "confidence": 0.0},
  "female_mgmt_ratio":          {"value": null, "unit": "%",               "source_page": null, "confidence": 0.0},
  "training_hours":             {"value": null, "unit": "小時/人/年",      "source_page": null, "confidence": 0.0},
  "independent_director_ratio": {"value": null, "unit": "%",               "source_page": null, "confidence": 0.0},
  "female_director_ratio":      {"value": null, "unit": "%",               "source_page": null, "confidence": 0.0},
  "has_sustainability_officer": {"value": null, "unit": "布林",            "source_page": null, "confidence": 0.0},
  "assurance":                  {"value": null, "unit": "布林",            "source_page": null, "confidence": 0.0},
  "violations":                 {"value": null, "unit": "次",              "source_page": null, "confidence": 0.0}
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
            response = client.models.generate_content(
                model="gemini-2.0-flash",
                contents=[uploaded, prompt_text],
                config=types.GenerateContentConfig(
                    system_instruction=_EXTRACTOR_SYSTEM,
                    response_mime_type="application/json",
                    temperature=0.0,
                ),
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
        response = client.models.generate_content(
            model="gemini-2.0-flash",
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
        for step in (2, 4):
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
        gri_result = call_step2_gri_parser(gri_pages, company, logger, force_step)

        page_offset      = gri_result.get("page_offset", offset_guess)
        indicator_pages  = gri_result.get("indicators", {})
        found_mappings   = {k: v for k, v in indicator_pages.items() if v}
        logger.info(f"使用 page_offset = {page_offset}（共 {len(found_mappings)}/18 個指標有頁碼）")

        # ── Step 3 ─────────────────────────────────────────────
        logger.info("── Step 3: 切片精簡 PDF ─────────────────────────")
        physical_pages = collect_physical_pages(
            indicator_pages, page_offset, total_pdf_pages, logger
        )

        if not physical_pages:
            logger.warning("Step 2 無法取得任何頁碼，fallback 使用前 60 頁")
            physical_pages = list(range(min(60, total_pdf_pages)))

        compact_pdf = LOG_DIR / f"{company}_compact.pdf"
        page_count  = slice_pdf(pdf_path, physical_pages, compact_pdf, logger)

        # ── Step 4 ─────────────────────────────────────────────
        logger.info("── Step 4: Gemini 讀精簡 PDF 抽取指標 ──────────")
        time.sleep(4)
        indicators = call_step4_extractor(compact_pdf, company, logger, force_step)

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
                "gri_page_map":      found_mappings,
                "indicators_found":  found_count,
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
    parser.add_argument("--step",    type=int, choices=[2, 4], help="只重跑指定步驟（2=GRI解析 / 4=指標抽取）")
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
