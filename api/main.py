import json
import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from database.models import SessionLocal
from database.crud import (
    get_all_companies,
    get_company_by_name,
    get_latest_esg_score,
    get_company_score_history,
)

app = FastAPI(
    title="ESG Risk Scoring API",
    description="透明可解釋的 ESG 風險評分系統 — 讀取預處理快取，demo 當天不呼叫 LLM",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_PDF_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "pdfs"))
app.mount("/pdfs", StaticFiles(directory=_PDF_DIR), name="pdfs")


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
        "credit": {"level": level, "color": color},
        "investment": {"level": level, "color": color},
        "underwriting": {"level": level, "color": color},
    }


@app.get("/api/companies")
def list_companies(db: Session = Depends(get_db)):
    """列出所有公司及其最新 ESG 總分概覽"""
    companies = get_all_companies(db)
    result = []
    for company in companies:
        latest = get_latest_esg_score(db, company.ID)
        result.append({
            "name": company.Name,
            "ticker": company.Ticker,
            "industry": company.Industry,
            "latest_score": {
                "total_score": latest.TotalScore if latest else None,
                "grade": latest.Grade if latest else None,
                "grade_label": _grade_label(latest.Grade) if latest else None,
                "e_score": latest.EScore if latest else None,
                "s_score": latest.SScore if latest else None,
                "g_score": latest.GScore if latest else None,
                "report_year": latest.ReportYear if latest else None,
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
        raise HTTPException(status_code=404, detail=f"{company_name} 尚無評分資料，請先執行預處理腳本")

    breakdown = json.loads(latest.Breakdown) if latest.Breakdown else {}

    warnings = []
    if latest.GreenwashFlag:
        warnings.append({"type": "greenwash", "level": "high", "message": "偵測到漂綠矛盾：報告宣稱與實際碳排數據不一致"})
    if latest.NewsEventScore >= 0.5:
        warnings.append({"type": "news", "level": "high", "message": f"負面新聞風險偏高（ERS 分數：{latest.NewsEventScore:.2f}）"})
    elif latest.NewsEventScore >= 0.2:
        warnings.append({"type": "news", "level": "medium", "message": f"存在中度負面新聞（ERS 分數：{latest.NewsEventScore:.2f}）"})

    return {
        "status": "success",
        "data": {
            "company": {
                "name": company.Name,
                "ticker": company.Ticker,
                "industry": company.Industry,
            },
            "score": {
                "total_score": latest.TotalScore,
                "grade": latest.Grade,
                "grade_label": _grade_label(latest.Grade),
                "e_score": latest.EScore,
                "s_score": latest.SScore,
                "g_score": latest.GScore,
                "news_event_score": latest.NewsEventScore,
                "greenwash_flag": latest.GreenwashFlag,
                "report_year": latest.ReportYear,
                "timestamp": latest.Timestamp.isoformat() if latest.Timestamp else None,
            },
            "breakdown": breakdown,
            "warnings": warnings,
            "reasoning": latest.Reasoning,
            "decision": _decision_lights(latest.TotalScore),
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
                "score_id": r.ScoreID,
                "total_score": r.TotalScore,
                "grade": r.Grade,
                "e_score": r.EScore,
                "s_score": r.SScore,
                "g_score": r.GScore,
                "report_year": r.ReportYear,
                "timestamp": r.Timestamp.isoformat() if r.Timestamp else None,
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
            "name": company.Name,
            "ticker": company.Ticker,
            "industry": company.Industry,
            "total_score": latest.TotalScore,
            "grade": latest.Grade,
            "e_score": latest.EScore,
            "s_score": latest.SScore,
            "g_score": latest.GScore,
            "greenwash_flag": latest.GreenwashFlag,
            "news_event_score": latest.NewsEventScore,
        })

    radar_data = [
        {
            "subject": "E 環境",
            **{c["name"]: c["e_score"] for c in comparison},
        },
        {
            "subject": "S 社會",
            **{c["name"]: c["s_score"] for c in comparison},
        },
        {
            "subject": "G 治理",
            **{c["name"]: c["g_score"] for c in comparison},
        },
    ]

    return {
        "status": "success",
        "data": {
            "companies": comparison,
            "radar_data": radar_data,
        },
    }


@app.get("/api/pdf/{company_name}")
def get_pdf_url(company_name: str, db: Session = Depends(get_db)):
    """回傳指定公司的 PDF 靜態 URL（供前端 PDF viewer 使用）"""
    company = get_company_by_name(db, company_name)
    if not company:
        raise HTTPException(status_code=404, detail=f"找不到公司：{company_name}")

    filename = f"{company_name}_{2023}.pdf"
    pdf_path = os.path.join(_PDF_DIR, filename)
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail=f"PDF 檔案不存在：{filename}")

    return {
        "status": "success",
        "data": {
            "company_name": company_name,
            "pdf_url": f"/pdfs/{filename}",
            "filename": filename,
        },
    }


@app.get("/health")
def health_check():
    return {"status": "ok"}
