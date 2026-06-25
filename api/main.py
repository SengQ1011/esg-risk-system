import asyncio
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from database.models import SessionLocal
from database.crud import (
    get_all_companies,
    get_company_by_name,
    get_latest_esg_score,
    get_company_score_history,
    create_job,
    get_job,
    delete_company,
    cancel_job,
)

app = FastAPI(
    title="ESG Risk Scoring API",
    description="透明可解釋的 ESG 風險評分系統 — 讀取預處理快取，demo 當天不呼叫 LLM",
    version="2.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # 允許所有 origin（含 Cloudflare tunnel URL）
    allow_credentials=False,  # credentials=True 與 origins=["*"] 互斥，會讓 header 消失
    allow_methods=["*"],
    allow_headers=["*"],
)

_PDF_DIR   = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "pdfs"))
_CACHE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "cache"))
app.mount("/pdfs", StaticFiles(directory=_PDF_DIR), name="pdfs")

# 快取到期天數（超過此天數回傳 cache_stale=true）
_CACHE_STALE_DAYS = 30


def _get_news_cache(company_name: str) -> dict:
    """讀取 news cache JSON（含事件列表與漂綠詳情）。"""
    news_path = os.path.join(_CACHE_DIR, f"{company_name}_news.json")
    try:
        with open(news_path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _get_page_offset(company_name: str) -> int:
    """從 indicators cache JSON 讀取 page_offset（封面/目錄頁數）。"""
    cache_path = os.path.join(_CACHE_DIR, f"{company_name}_indicators.json")
    try:
        with open(cache_path, encoding="utf-8") as f:
            data = json.load(f)
        return int(data.get("_meta", {}).get("page_offset", 0))
    except Exception:
        return 0


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _grade_label(grade: str) -> str:
    labels = {"A": "優良", "B+": "良好", "B": "普通", "B-": "待改善", "C": "高風險"}
    return labels.get(grade, grade)


def _decision_lights(total_score: float) -> dict:
    if total_score >= 70:
        level, color = "低風險", "green"
    elif total_score >= 50:
        level, color = "中風險", "yellow"
    else:
        level, color = "高風險", "red"
    return {
        "credit":       {"level": level, "color": color},
        "investment":   {"level": level, "color": color},
        "underwriting": {"level": level, "color": color},
    }


def _is_cache_stale(timestamp: datetime | None) -> bool:
    """判斷快取是否超過 _CACHE_STALE_DAYS 天。"""
    if timestamp is None:
        return False
    now = datetime.utcnow()
    # timestamp 可能有 tzinfo，統一去掉
    ts = timestamp.replace(tzinfo=None) if timestamp.tzinfo else timestamp
    return (now - ts).days > _CACHE_STALE_DAYS


# ═══════════════════════════════════════════════════════════════════════════════
# 現有 Endpoints（唯讀快取）
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/companies")
def list_companies(db: Session = Depends(get_db)):
    """列出所有公司及其最新 ESG 總分概覽"""
    companies = get_all_companies(db)
    result = []
    for company in companies:
        latest = get_latest_esg_score(db, company.ID)
        result.append({
            "name":     company.Name,
            "ticker":   company.Ticker,
            "industry": company.Industry,
            "latest_score": {
                "total_score": latest.TotalScore if latest else None,
                "grade":       latest.Grade if latest else None,
                "grade_label": _grade_label(latest.Grade) if latest else None,
                "e_score":     latest.EScore if latest else None,
                "s_score":     latest.SScore if latest else None,
                "g_score":     latest.GScore if latest else None,
                "report_year": latest.ReportYear if latest else None,
                "cache_stale": _is_cache_stale(latest.Timestamp) if latest else False,
            } if latest else None,
        })
    return {"status": "success", "data": result}


@app.get("/api/company/{company_name}")
def get_company_detail(company_name: str, db: Session = Depends(get_db)):
    """取得單一公司完整 ESG 評分卡（含逐指標拆解、警示、決策燈號）"""
    company = get_company_by_name(db, company_name)
    if not company:
        raise HTTPException(status_code=404, detail=f"找不到公司：{company_name}")

    latest = get_latest_esg_score(db, company.ID)
    if not latest:
        raise HTTPException(
            status_code=404,
            detail=f"{company_name} 尚無評分資料，請先執行預處理腳本",
        )

    breakdown = json.loads(latest.Breakdown) if latest.Breakdown else {}

    warnings = []
    if latest.GreenwashFlag:
        warnings.append({
            "type":    "greenwash",
            "level":   "high",
            "message": "偵測到漂綠矛盾：報告宣稱與實際碳排數據不一致",
        })
    if latest.NewsEventScore >= 0.5:
        warnings.append({
            "type":    "news",
            "level":   "high",
            "message": f"負面新聞風險偏高（ERS 分數：{latest.NewsEventScore:.2f}）",
        })
    elif latest.NewsEventScore >= 0.2:
        warnings.append({
            "type":    "news",
            "level":   "medium",
            "message": f"存在中度負面新聞（ERS 分數：{latest.NewsEventScore:.2f}）",
        })

    page_offset  = _get_page_offset(company.Name)
    cache_stale  = _is_cache_stale(latest.Timestamp)
    news_cache   = _get_news_cache(company.Name)
    news_events  = news_cache.get("events", [])          # 含 url、title、date、severity
    gw_details   = news_cache.get("greenwash_details", [])  # 含 description、claim_quote、source_page

    return {
        "status": "success",
        "data": {
            "company": {
                "name":     company.Name,
                "ticker":   company.Ticker,
                "industry": company.Industry,
            },
            "page_offset": page_offset,
            "cache_stale": cache_stale,
            "score": {
                "total_score":     latest.TotalScore,
                "grade":           latest.Grade,
                "grade_label":     _grade_label(latest.Grade),
                "e_score":         latest.EScore,
                "s_score":         latest.SScore,
                "g_score":         latest.GScore,
                "news_event_score": latest.NewsEventScore,
                "greenwash_flag":  latest.GreenwashFlag,
                "report_year":     latest.ReportYear,
                "timestamp":       latest.Timestamp.isoformat() if latest.Timestamp else None,
            },
            "breakdown":        breakdown,
            "warnings":         warnings,
            "reasoning":        latest.Reasoning,
            "decision":         _decision_lights(latest.TotalScore),
            "news_events":      news_events,    # 新：含 url 的完整新聞事件列表
            "greenwash_details": gw_details,    # 新：含 source_page 的漂綠矛盾列表
        },
    }


@app.get("/api/company/{company_name}/history")
def get_company_history(company_name: str, db: Session = Depends(get_db)):
    """取得特定公司的歷史評分紀錄"""
    company = get_company_by_name(db, company_name)
    if not company:
        raise HTTPException(status_code=404, detail=f"找不到公司：{company_name}")

    history = get_company_score_history(db, company.ID)
    return {
        "status": "success",
        "data": [
            {
                "score_id":   r.ScoreID,
                "total_score": r.TotalScore,
                "grade":      r.Grade,
                "e_score":    r.EScore,
                "s_score":    r.SScore,
                "g_score":    r.GScore,
                "report_year": r.ReportYear,
                "timestamp":  r.Timestamp.isoformat() if r.Timestamp else None,
            }
            for r in history
        ],
    }


@app.get("/api/dashboard")
def get_dashboard(db: Session = Depends(get_db)):
    """儀表板資料：三家公司並排比較"""
    companies = get_all_companies(db)
    comparison = []
    for company in companies:
        latest = get_latest_esg_score(db, company.ID)
        if not latest:
            continue
        comparison.append({
            "name":              company.Name,
            "ticker":            company.Ticker,
            "industry":          company.Industry,
            "total_score":       latest.TotalScore,
            "grade":             latest.Grade,
            "e_score":           latest.EScore,
            "s_score":           latest.SScore,
            "g_score":           latest.GScore,
            "greenwash_flag":    latest.GreenwashFlag,
            "news_event_score":  latest.NewsEventScore,
        })

    radar_data = [
        {"subject": "E 環境", **{c["name"]: c["e_score"] for c in comparison}},
        {"subject": "S 社會", **{c["name"]: c["s_score"] for c in comparison}},
        {"subject": "G 治理", **{c["name"]: c["g_score"] for c in comparison}},
    ]

    return {
        "status": "success",
        "data": {
            "companies":  comparison,
            "radar_data": radar_data,
        },
    }


@app.get("/api/pdf/{company_name}")
def stream_pdf(company_name: str, db: Session = Depends(get_db)):
    """直接串流指定公司的永續報告書 PDF（繞過中文檔名 URL 編碼問題）"""
    company = get_company_by_name(db, company_name)
    if not company:
        raise HTTPException(status_code=404, detail=f"找不到公司：{company_name}")

    # 支援任意年份（_2023 / _2024 / _2025 等）
    import glob as _glob
    candidates = sorted(_glob.glob(os.path.join(_PDF_DIR, f"{company.Name}_*.pdf")))
    pdf_path = candidates[-1] if candidates else ""
    filename  = os.path.basename(pdf_path) if pdf_path else ""

    if not pdf_path or not os.path.exists(pdf_path):
        # Fallback：從 indicators cache 找原始上傳路徑
        cache_path = os.path.join(
            os.path.dirname(__file__), "..", "data", "cache",
            f"{company.Name}_indicators.json"
        )
        if os.path.exists(cache_path):
            import json as _json
            meta = _json.loads(open(cache_path, encoding="utf-8").read()).get("_meta", {})
            cached_pdf = meta.get("pdf_path")
            if cached_pdf and os.path.exists(cached_pdf):
                pdf_path = cached_pdf
                filename = os.path.basename(cached_pdf)
        if not os.path.exists(pdf_path):
            raise HTTPException(status_code=404, detail=f"PDF 檔案不存在：{filename}")

    return FileResponse(pdf_path, media_type="application/pdf", filename=filename)


# ═══════════════════════════════════════════════════════════════════════════════
# 新 Endpoints：PDF 搜尋預覽 + Job 系統 + 分析觸發
# ═══════════════════════════════════════════════════════════════════════════════

def _resolve_ticker(company: str, ticker: str) -> str:
    """
    若 ticker 為空，嘗試從 TWSE codeQuery API 以公司名稱查代號。
    查詢失敗或無結果時靜默回傳空字串。
    """
    if ticker:
        return ticker
    try:
        import requests as _req
        r = _req.get(
            "https://www.twse.com.tw/zh/api/codeQuery",
            params={"query": company},
            timeout=5,
            headers={"User-Agent": "Mozilla/5.0"},
        )
        if r.status_code == 200:
            data = r.json()
            suggestions = data.get("suggestions", [])
            for item in suggestions:
                # item 格式："2330\t台積電"
                parts = str(item).split("\t")
                if len(parts) >= 2 and parts[0].strip().isdigit():
                    resolved = parts[0].strip()
                    print(f"[resolve_ticker] {company} → {resolved}")
                    return resolved
    except Exception as e:
        print(f"[resolve_ticker] 查詢失敗：{e}")
    return ""


@app.get("/api/search-pdf")
def search_pdf(company: str, year: int = 2023, ticker: str = ""):
    """
    用 Gemini Search 搜尋公司 ESG 報告書的候選 PDF 連結，
    回傳 URL 清單供前端讓用戶選擇預覽。不下載、不開 Job。
    """
    from api.analysis_pipeline import search_esg_report_url
    import glob as _glob

    # ticker 為空時嘗試從 TWSE 自動解析（讓 CGC 查詢能啟動）
    resolved_ticker = _resolve_ticker(company, ticker)

    # 先檢查本地是否已有（任意年份）
    local_pdfs = sorted(_glob.glob(os.path.join(_PDF_DIR, f"{company}_*.pdf")))
    local_urls = [
        f"/api/pdf/{company}?local=1"   # 用既有 stream_pdf endpoint
        for _ in local_pdfs[:1]
    ]

    # Gemini Search 找候選
    remote_urls = search_esg_report_url(company, resolved_ticker, year)

    candidates = []
    if local_pdfs:
        candidates.append({
            "url": f"/api/proxy-pdf?path={os.path.basename(local_pdfs[-1])}",
            "label": f"本地已存在 {os.path.basename(local_pdfs[-1])}",
            "local": True,
        })
    for url in remote_urls:
        candidates.append({"url": url, "label": url, "local": False})

    hint = ""
    if not candidates:
        hint = f"找不到 {company} {year} 年永續報告書，可能原因：①報告書尚未發布 ②Gemini Search 暫時故障，請稍後重試或手動上傳 PDF"

    return {"status": "success", "data": {"candidates": candidates, "hint": hint}}


@app.get("/api/proxy-pdf")
def proxy_pdf(url: str = "", path: str = ""):
    """
    代理下載外部 PDF 並以 application/pdf 串流回傳，讓前端繞過 CORS 限制預覽。
    url：外部 HTTP URL；path：本地 pdfs/ 下的檔名（優先）。
    """
    from fastapi.responses import StreamingResponse
    import requests as _req

    if path:
        # 本地檔案
        local = os.path.join(_PDF_DIR, os.path.basename(path))  # basename 防路徑穿透
        if not os.path.exists(local):
            raise HTTPException(status_code=404, detail="本地 PDF 不存在")
        def _iter_local():
            with open(local, "rb") as f:
                while chunk := f.read(65536):
                    yield chunk
        return StreamingResponse(_iter_local(), media_type="application/pdf")

    if not url or not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="無效的 URL")

    try:
        resp = _req.get(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/pdf,*/*",
                "Referer": url,
            },
            timeout=20,
            stream=True,
            allow_redirects=True,
        )
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        if "pdf" not in content_type and "octet-stream" not in content_type:
            # 目標回傳的不是 PDF（可能是 HTML 錯誤頁或需要登入）
            raise HTTPException(
                status_code=422,
                detail=f"目標回傳的不是 PDF（Content-Type: {content_type}）。網站可能有 bot 防護，請直接在新分頁開啟連結。",
            )
        return StreamingResponse(
            resp.iter_content(65536),
            media_type="application/pdf",
            headers={"Content-Disposition": "inline", "X-Source-Url": url},
        )
    except HTTPException:
        raise
    except _req.exceptions.Timeout:
        raise HTTPException(status_code=504, detail=f"下載逾時（20s），請直接在新分頁開啟連結。")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"無法下載 PDF（{type(e).__name__}），請直接在新分頁開啟連結。")


@app.delete("/api/company/{company_name}")
def remove_company(company_name: str, db: Session = Depends(get_db)):
    """刪除公司及其所有 ESG 評分紀錄，同時清除 step cache，確保重新分析時得到新結果。"""
    # 先取 ticker（compact PDF 需要用到）
    company = get_company_by_name(db, company_name)
    if not company:
        raise HTTPException(status_code=404, detail=f"找不到公司：{company_name}")
    ticker = company.Ticker or ""

    delete_company(db, company_name)

    # 清除所有分析 cache，避免重跑時讀到舊的錯誤結果
    _ROOT = os.path.dirname(os.path.dirname(__file__))
    cache_files = [
        os.path.join(_ROOT, "data", "logs",  f"{company_name}_step2_cache.json"),
        os.path.join(_ROOT, "data", "logs",  f"{company_name}_step4_cache.json"),
        os.path.join(_ROOT, "data", "logs",  f"{company_name}_step5_cache.json"),
        os.path.join(_ROOT, "data", "logs",  f"{company_name}_extraction.log"),
        os.path.join(_ROOT, "data", "cache", f"{company_name}_indicators.json"),
        os.path.join(_ROOT, "data", "cache", f"{company_name}_news.json"),
    ]
    if ticker:
        cache_files.append(os.path.join(_ROOT, "data", "logs", f"compact_{ticker}.pdf"))

    deleted_files = []
    for path in cache_files:
        if os.path.exists(path):
            os.remove(path)
            deleted_files.append(os.path.basename(path))

    return {"status": "success", "data": {"deleted": company_name, "cleared_cache": deleted_files}}


@app.post("/api/company/analyze")
def trigger_analysis(
    background_tasks: BackgroundTasks,
    company_name: str = Form(default=None),
    ticker: str = Form(default=""),
    year: int = Form(default=2023),
    industry: str = Form(default="其他"),
    report_url: str = Form(default=""),
    pdf_file: UploadFile = File(default=None),
    db: Session = Depends(get_db),
):
    """
    觸發公司 ESG 分析（M1 + M2 + M3 完整流程）。

    接受 multipart/form-data：
    - company_name：公司名稱（str，可選，未提供時從 PDF 識別）
    - ticker：股票代號（str，可選）
    - year：報告年度（int，預設 2023）
    - industry：產業別（str，預設 "其他"）
    - report_url：PDF 直連或 CSR 報告頁面 URL（str，可選；提供時跳過 Gemini Search）
    - pdf_file：PDF 檔案（可選，未提供時用 report_url 或 Gemini Search 下載）
    """
    if not company_name and pdf_file is None and not report_url:
        raise HTTPException(
            status_code=400,
            detail="至少需要提供 company_name、report_url 或上傳 pdf_file",
        )

    # 建立 Job 記錄
    job = create_job(db, company_name=company_name, ticker=ticker or None)
    job_id = job.JobID

    # 儲存上傳的 PDF（若有）
    saved_pdf_path: str | None = None
    if pdf_file is not None and pdf_file.filename:
        pdf_dir = os.path.join(os.path.dirname(__file__), "..", "data", "pdfs")
        os.makedirs(pdf_dir, exist_ok=True)

        # 使用公司名（或 ticker）作為檔名
        if company_name:
            filename = f"{company_name}_{year}.pdf"
        elif ticker:
            filename = f"{ticker}_{year}.pdf"
        else:
            filename = f"upload_{job_id[:8]}_{year}.pdf"

        dest = os.path.join(pdf_dir, filename)
        with open(dest, "wb") as f:
            shutil.copyfileobj(pdf_file.file, f)
        saved_pdf_path = dest

    # 匯入 pipeline（避免 import 時產生副作用）
    from api.analysis_pipeline import run_analysis

    # 加入背景任務（FastAPI BackgroundTasks 支援 async 函式）
    background_tasks.add_task(
        run_analysis,
        job_id=job_id,
        company_name=company_name,
        ticker=ticker or "",
        pdf_path=saved_pdf_path,
        year=year,
        industry=industry,
        report_url=report_url or "",
    )

    return {
        "status": "success",
        "data": {
            "job_id":       job_id,
            "company_name": company_name,
            "ticker":       ticker,
            "year":         year,
        },
    }


@app.get("/api/job/{job_id}")
def get_job_status(job_id: str, db: Session = Depends(get_db)):
    """查詢分析 Job 的執行狀態。"""
    job = get_job(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"找不到 Job：{job_id}")

    return {
        "status": "success",
        "data": {
            "job_id":        job.JobID,
            "company_name":  job.CompanyName,
            "ticker":        job.Ticker,
            "status":        job.Status,
            "current_step":  job.CurrentStep,
            "progress":      job.Progress,
            "error_message": job.ErrorMessage,
            "created_at":    job.CreatedAt.isoformat() if job.CreatedAt else None,
            "updated_at":    job.UpdatedAt.isoformat() if job.UpdatedAt else None,
        },
    }


@app.delete("/api/job/{job_id}")
def cancel_job_endpoint(job_id: str, db: Session = Depends(get_db)):
    """取消進行中的分析 Job，並清除已產生的中間檔案。"""
    job = get_job(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"找不到 Job：{job_id}")
    if job.Status in ("done", "cancelled"):
        return {"status": "success", "data": {"cancelled": job_id, "deleted_files": []}}

    company_name = job.CompanyName
    ticker       = job.Ticker or ""

    cancel_job(db, job_id)

    _ROOT = os.path.dirname(os.path.dirname(__file__))
    demo_companies = {"台達電", "中鋼", "南山人壽", "臺積電"}
    files_to_delete = []

    if company_name:
        files_to_delete += [
            os.path.join(_ROOT, "data", "logs",  f"{company_name}_step2_cache.json"),
            os.path.join(_ROOT, "data", "logs",  f"{company_name}_step4_cache.json"),
            os.path.join(_ROOT, "data", "logs",  f"{company_name}_step5_cache.json"),
            os.path.join(_ROOT, "data", "logs",  f"{company_name}_extraction.log"),
            os.path.join(_ROOT, "data", "cache", f"{company_name}_indicators.json"),
            os.path.join(_ROOT, "data", "cache", f"{company_name}_news.json"),
        ]
        if ticker:
            files_to_delete.append(os.path.join(_ROOT, "data", "logs", f"compact_{ticker}.pdf"))
        # 只刪除非 demo 公司的 PDF
        if company_name not in demo_companies:
            files_to_delete.append(os.path.join(_ROOT, "data", "pdfs", f"{company_name}_2023.pdf"))

    # 刪除 upload 暫存 PDF（job_id 前 8 碼命名）
    upload_pdf = os.path.join(_ROOT, "data", "pdfs", f"upload_{job_id[:8]}_2023.pdf")
    files_to_delete.append(upload_pdf)

    deleted = []
    for path in files_to_delete:
        if os.path.exists(path):
            try:
                os.remove(path)
                deleted.append(os.path.basename(path))
            except Exception:
                pass

    return {"status": "success", "data": {"cancelled": job_id, "deleted_files": deleted}}


# ═══════════════════════════════════════════════════════════════════════════════
# WebSocket：即時 Job 進度推送
# ═══════════════════════════════════════════════════════════════════════════════

@app.websocket("/ws/job/{job_id}")
async def ws_job_progress(websocket: WebSocket, job_id: str):
    """
    WebSocket 推送 Job 進度。
    每 1.5 秒推送一次，當 status=done 或 status=error 時關閉連線。
    """
    await websocket.accept()
    try:
        while True:
            db = SessionLocal()
            try:
                job = get_job(db, job_id)
            finally:
                db.close()

            if not job:
                await websocket.send_json({
                    "step":     "error",
                    "progress": 0,
                    "done":     True,
                    "error":    f"找不到 Job：{job_id}",
                })
                break

            payload = {
                "step":         job.CurrentStep or "",
                "progress":     job.Progress,
                "done":         job.Status == "done",
                "failed":       job.Status == "error",
                "cancelled":    job.Status == "cancelled",
                "status":       job.Status,
                "company_name": job.CompanyName or "",
                "error":        job.ErrorMessage or "",
            }
            await websocket.send_json(payload)

            if payload["done"]:
                break

            await asyncio.sleep(1.5)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"step": "error", "progress": 0, "done": True, "error": str(e)})
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# ═══════════════════════════════════════════════════════════════════════════════
# Health
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/health")
def health_check():
    return {"status": "ok"}
