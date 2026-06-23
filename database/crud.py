from sqlalchemy.orm import Session
from database.models import Company, RiskScore

def get_or_create_company(db: Session, name: str, industry: str):
    """查詢公司，若不存在則新增一筆"""
    company = db.query(Company).filter(Company.Name == name).first()
    if not company:
        company = Company(Name=name, Industry=industry)
        db.add(company)
        db.commit()
        db.refresh(company)
    return company

def save_risk_score(db: Session, company_id: int, exposure: float, management: float, final_score: float, reasoning: str):
    """將 AI 評分結果存入資料庫"""
    new_score = RiskScore(
        CompanyID=company_id,
        ExposureScore=exposure,
        ManagementScore=management,
        FinalScore=final_score,
        Reasoning=reasoning
    )
    db.add(new_score)
    db.commit()
    db.refresh(new_score)
    return new_score

def get_company_history(db: Session, company_id: int):
    """取得特定公司的所有歷史評分紀錄，依照時間排序"""
    return db.query(RiskScore).filter(RiskScore.CompanyID == company_id).order_by(RiskScore.Timestamp.desc()).all()