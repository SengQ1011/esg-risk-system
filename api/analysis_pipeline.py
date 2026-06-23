"""
背景分析 Pipeline — M1 + M2 + M3 完整流程

由 POST /api/company/analyze 的 BackgroundTasks 呼叫，
使用 asyncio.run_in_executor 執行同步的 M1/M2/M3 腳本。

流程步驟（progress 百分比）：
  10  → 搜尋/下載 PDF
  20  → AI 識別公司名稱（僅上傳 PDF 模式）
  40  → GRI 索引解析（M1 Step 2）
  65  → 指標抽取（M1 Step 4）
  80  → bbox 修正（fix_bbox_with_pymupdf）
  88  → M2 新聞評分
  94  → M3 漂綠偵測
  100 → 計算並儲存分數（preprocess_cache）
"""

import asyncio
import json
import os
import re
import sys
import traceback
from pathlib import Path
from functools import partial

# 確保 project root 在 sys.path
_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(_ROOT))

from database.models import SessionLocal
from database.crud import update_job_progress, finish_job, fail_job, get_job

# ── 路徑常數 ──────────────────────────────────────────────────────────────────
PDF_DIR   = _ROOT / "data" / "pdfs"
CACHE_DIR = _ROOT / "data" / "cache"
LOG_DIR   = _ROOT / "data" / "logs"

PDF_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)


# ── DB session helper（同步，在 executor 中使用）──────────────────────────────

def _db_update(job_id: str, step: str, progress: int) -> None:
    db = SessionLocal()
    try:
        update_job_progress(db, job_id, step, progress)
    finally:
        db.close()


def _db_finish(job_id: str, company_name: str) -> None:
    db = SessionLocal()
    try:
        finish_job(db, job_id, company_name)
    finally:
        db.close()


def _db_fail(job_id: str, error: str) -> None:
    db = SessionLocal()
    try:
        fail_job(db, job_id, error)
    finally:
        db.close()


# ── PDF 下載（Gemini Search）─────────────────────────────────────────────────

def search_esg_report_url(company_name: str, ticker: str, year: int) -> str | None:
    """用 Gemini Search 找永續報告書的 PDF 直連下載 URL。"""
    from google import genai
    from google.genai import types

    client = genai.Client()
    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=(
                f"請找出{company_name}（股票代號 {ticker}）{year} 年永續報告書的 PDF 直連下載網址，"
                "只回傳 URL，不要其他說明文字。"
            ),
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())]
            ),
        )
        text = response.text or ""
        urls = re.findall(r"https?://[^\s\)\"\'\n]+\.pdf", text, re.IGNORECASE)
        return urls[0] if urls else None
    except Exception as e:
        print(f"[search_esg_report_url] Gemini Search 失敗：{e}")
        return None


def download_pdf(url: str, dest: Path) -> bool:
    """下載 PDF 到 dest 路徑，成功回傳 True。"""
    import requests
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        )
    }
    try:
        resp = requests.get(url, headers=headers, timeout=60, stream=True)
        resp.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in resp.iter_content(chunk_size=65536):
                f.write(chunk)
        size_mb = dest.stat().st_size / 1024 / 1024
        print(f"[download_pdf] 下載完成：{dest.name}（{size_mb:.1f} MB）")
        return True
    except Exception as e:
        print(f"[download_pdf] 下載失敗：{e}")
        return False


# ── AI 識別公司名稱 ────────────────────────────────────────────────────────────

def identify_company_from_pdf(pdf_path: Path) -> dict | None:
    """從 PDF 首頁識別公司名稱和 ticker（僅上傳 PDF 未提供名稱時用）。"""
    import pathlib
    from google import genai
    from google.genai import types

    client = genai.Client()
    uploaded = None
    try:
        uploaded = client.files.upload(file=pathlib.Path(pdf_path))
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                uploaded,
                "這是一份台灣上市公司的永續報告書，請從封面和前幾頁識別：公司名稱（繁體中文）和股票代號（4位數字）。"
                '只回傳 JSON：{"company_name": "公司名", "ticker": "XXXX"}',
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.0,
            ),
        )
        return json.loads(response.text)
    except Exception as e:
        print(f"[identify_company] 識別失敗：{e}")
        return None
    finally:
        if uploaded:
            try:
                client.files.delete(name=uploaded.name)
            except Exception:
                pass


# ── M1 同步包裝 ────────────────────────────────────────────────────────────────

def _run_m1(company_name: str, ticker: str, industry: str, pdf_path: Path, year: int) -> bool:
    """同步執行 M1 指標抽取（在 executor 中呼叫）。"""
    from scripts.extract_indicators_m1 import process_company

    info = {
        "company":  company_name,
        "ticker":   ticker,
        "industry": industry,
        "filename": pdf_path.name,
        "year":     year,
    }

    # M1 process_company 預設從 PDF_DIR 讀取，若 pdf_path 已在 PDF_DIR 就可以直接呼叫
    # 若不在，先複製過去
    target = PDF_DIR / pdf_path.name
    if pdf_path.resolve() != target.resolve() and not target.exists():
        import shutil
        shutil.copy2(str(pdf_path), str(target))

    # patch PDF_DIR reference（M1 腳本的 PDF_DIR 是模組級常數）
    import scripts.extract_indicators_m1 as m1_mod
    original_pdf_dir = m1_mod.PDF_DIR
    m1_mod.PDF_DIR = PDF_DIR
    try:
        return process_company(info, force_all=False, force_step=None)
    finally:
        m1_mod.PDF_DIR = original_pdf_dir


def _run_fix_bbox(company_name: str) -> None:
    """同步執行 bbox 修正。"""
    from scripts.fix_bbox_with_pymupdf import fix_company
    try:
        fix_company(company_name)
    except Exception as e:
        print(f"[fix_bbox] 失敗（非致命）：{e}")


def _run_m2(company_name: str, ticker: str) -> None:
    """同步執行 M2 新聞爬取。"""
    from scripts.fetch_news_m2 import fetch_news_for_company
    fetch_news_for_company(company_name, ticker, force=True)


def _run_m3(company_name: str, ticker: str) -> None:
    """同步執行 M3 漂綠偵測。"""
    from scripts.detect_greenwash_m3 import detect_greenwash
    detect_greenwash(company_name, ticker, force=True)


def _run_preprocess(company_name: str, ticker: str, industry: str) -> None:
    """同步執行 preprocess_cache（計算分數並寫入 SQLite）。"""
    from database.models import SessionLocal as SL
    from database.crud import get_or_create_company, save_esg_score
    from core.scoring import calculate_esg_score

    ind_path  = CACHE_DIR / f"{company_name}_indicators.json"
    news_path = CACHE_DIR / f"{company_name}_news.json"

    if not ind_path.exists():
        raise FileNotFoundError(f"找不到指標快取：{ind_path}")
    if not news_path.exists():
        raise FileNotFoundError(f"找不到新聞快取：{news_path}")

    indicators_data = json.loads(ind_path.read_text(encoding="utf-8"))
    news_data       = json.loads(news_path.read_text(encoding="utf-8"))

    indicators       = indicators_data.get("indicators", {})
    news_event_score = news_data.get("news_event_score", 0.0)
    greenwash_flag   = news_data.get("greenwash_flag", False)
    report_year      = indicators_data.get("report_year")

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
        reasoning_parts.append("【重大事件】" + "；".join(e["title"] for e in red_flags))
    reasoning = "\n".join(reasoning_parts) if reasoning_parts else "無重大警示事件。"

    db = SL()
    try:
        company_obj = get_or_create_company(db, name=company_name, industry=industry, ticker=ticker)
        save_esg_score(
            db=db,
            company_id=company_obj.ID,
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
        print(f"[preprocess] {company_name}：總分 {result['total_score']} 等級 {result['grade']}")
    finally:
        db.close()


# ── 主 Pipeline（async）────────────────────────────────────────────────────────

async def run_analysis(
    job_id: str,
    company_name: str | None,
    ticker: str,
    pdf_path: str | None,
    year: int,
    industry: str = "其他",
) -> None:
    """
    完整 M1 + M2 + M3 分析 pipeline。
    由 FastAPI BackgroundTasks 呼叫（async）；
    同步的重計算工作透過 asyncio.run_in_executor 執行。
    """
    loop = asyncio.get_event_loop()

    # 確保 news.json 存在（M3 更新用）
    def _ensure_news_cache(cname: str, tic: str) -> None:
        news_path = CACHE_DIR / f"{cname}_news.json"
        if not news_path.exists():
            default = {
                "company_name":     cname,
                "ticker":           tic,
                "events":           [],
                "news_event_score": 0.0,
                "greenwash_flag":   False,
                "greenwash_reasons": [],
            }
            news_path.write_text(json.dumps(default, ensure_ascii=False, indent=2), encoding="utf-8")

    try:
        # ── Step 1：搜尋/下載 PDF（progress 10）────────────────────────────
        await loop.run_in_executor(None, _db_update, job_id, "搜尋/下載報告書 PDF", 10)

        actual_pdf_path: Path | None = None

        if pdf_path:
            actual_pdf_path = Path(pdf_path)
        else:
            # 嘗試用現有 PDF（三家 Demo 公司的命名規則）
            if company_name:
                guessed = PDF_DIR / f"{company_name}_2023.pdf"
                if guessed.exists():
                    actual_pdf_path = guessed
                    print(f"[pipeline] 找到既有 PDF：{guessed.name}")

            # 若無，用 Gemini Search 搜尋並下載
            if actual_pdf_path is None and company_name:
                url = await loop.run_in_executor(
                    None,
                    partial(search_esg_report_url, company_name, ticker, year),
                )
                if url:
                    dest = PDF_DIR / f"{company_name}_{year}.pdf"
                    ok = await loop.run_in_executor(None, partial(download_pdf, url, dest))
                    if ok:
                        actual_pdf_path = dest

        if actual_pdf_path is None or not actual_pdf_path.exists():
            raise FileNotFoundError(
                f"無法取得 PDF：company={company_name}, ticker={ticker}, year={year}"
            )

        # ── Step 2：AI 識別公司名稱（progress 20）──────────────────────────
        await loop.run_in_executor(None, _db_update, job_id, "識別公司名稱", 20)

        if not company_name:
            identified = await loop.run_in_executor(
                None, partial(identify_company_from_pdf, actual_pdf_path)
            )
            if identified:
                company_name = identified.get("company_name", "未知公司")
                if not ticker:
                    ticker = identified.get("ticker", "")
            else:
                company_name = actual_pdf_path.stem  # fallback：用檔名

        # 確保 news cache 存在
        await loop.run_in_executor(None, _ensure_news_cache, company_name, ticker)

        # ── Step 3-4：M1 GRI 解析 + 指標抽取（progress 40 → 65）──────────
        await loop.run_in_executor(None, _db_update, job_id, "M1：GRI 索引解析", 40)

        m1_success = await loop.run_in_executor(
            None,
            partial(_run_m1, company_name, ticker, industry, actual_pdf_path, year),
        )

        if not m1_success:
            raise RuntimeError(f"M1 指標抽取失敗：{company_name}")

        await loop.run_in_executor(None, _db_update, job_id, "M1：指標抽取完成", 65)

        # ── Step 5：bbox 修正（progress 80）────────────────────────────────
        await loop.run_in_executor(None, _db_update, job_id, "修正指標 bbox 座標", 80)
        await loop.run_in_executor(None, partial(_run_fix_bbox, company_name))

        # ── Step 6：M2 新聞評分（progress 88）─────────────────────────────
        await loop.run_in_executor(None, _db_update, job_id, "M2：新聞事件評分", 88)
        await loop.run_in_executor(None, partial(_run_m2, company_name, ticker))

        # ── Step 7：M3 漂綠偵測（progress 94）─────────────────────────────
        await loop.run_in_executor(None, _db_update, job_id, "M3：漂綠偵測", 94)
        await loop.run_in_executor(None, partial(_run_m3, company_name, ticker))

        # ── Step 8：計算並儲存分數（progress 100）──────────────────────────
        await loop.run_in_executor(None, _db_update, job_id, "計算並儲存 ESG 分數", 98)
        await loop.run_in_executor(
            None, partial(_run_preprocess, company_name, ticker, industry)
        )

        await loop.run_in_executor(None, _db_finish, job_id, company_name)
        print(f"[pipeline] 完成：{company_name}（job_id={job_id}）")

    except Exception as exc:
        error_msg = f"{type(exc).__name__}: {exc}"
        print(f"[pipeline] 錯誤（job_id={job_id}）：{error_msg}")
        traceback.print_exc()
        await loop.run_in_executor(None, partial(_db_fail, job_id, error_msg))
