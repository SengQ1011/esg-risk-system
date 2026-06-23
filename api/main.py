from fastapi import FastAPI, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
import sys
import os

# 確保路徑正確，讓 API 能夠匯入專案根目錄的其他模組
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from database.models import SessionLocal
from database.crud import get_or_create_company, save_risk_score, get_company_history
from core.llm_agent import analyze_esg_risk
from core.scoring import calculate_final_risk

app = FastAPI(title="ESG-RISK API", description="提供 ESG 風險評分與歷史紀錄查詢")

# FastAPI 依賴注入：獲取資料庫連線 Session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# 定義前端傳來的 JSON 資料格式 (Pydantic Schema)
class AnalyzeRequest(BaseModel):
    company_name: str
    industry: str
    raw_text: str

@app.post("/api/analyze")
def analyze_company(request: AnalyzeRequest, db: Session = Depends(get_db)):
    """接收企業文本，執行 AI 評分並存入資料庫"""
    try:
        # 1. 呼叫 AI 引擎
        ai_result = analyze_esg_risk(request.raw_text)
        exp_score = ai_result.get("ExposureScore", 0)
        mgt_score = ai_result.get("ManagementScore", 0)
        reasoning = ai_result.get("Reasoning", "無說明")

        # 2. 帶入核心公式計算
        final_score = calculate_final_risk(exp_score, mgt_score)

        # 3. 寫入資料庫
        company = get_or_create_company(db, request.company_name, request.industry)
        record = save_risk_score(db, company.ID, exp_score, mgt_score, final_score, reasoning)

        # 4. 回傳處理結果
        return {
            "status": "success",
            "data": {
                "exposure_score": exp_score,
                "management_score": mgt_score,
                "final_score": final_score,
                "reasoning": reasoning
            }
        }
    except Exception as e:
        import traceback
        traceback.print_exc()  # <--- 這行會讓後端終端機印出紅色的詳細錯誤報告
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/history/{company_name}")
def get_history(company_name: str, industry: str = "金融保險業", db: Session = Depends(get_db)):
    """查詢特定公司的所有歷史評分紀錄"""
    company = get_or_create_company(db, company_name, industry)
    history = get_company_history(db, company.ID)
    
    return {
        "status": "success",
        "data": [
            {
                "timestamp": record.Timestamp,
                "final_score": record.FinalScore,
                "exposure_score": record.ExposureScore,
                "management_score": record.ManagementScore,
                "reasoning": record.Reasoning
            }
            for record in history
        ]
    }