import json
import uuid
from datetime import datetime
from sqlalchemy.orm import Session
from database.models import Company, ESGScore, Job


def get_or_create_company(db: Session, name: str, industry: str, ticker: str = None) -> Company:
    company = db.query(Company).filter(Company.Name == name).first()
    if not company:
        company = Company(Name=name, Industry=industry, Ticker=ticker)
        db.add(company)
        db.commit()
        db.refresh(company)
    return company


def get_company_by_name(db: Session, name: str) -> Company:
    return db.query(Company).filter(Company.Name == name).first()


def get_all_companies(db: Session) -> list[Company]:
    return db.query(Company).all()


def save_esg_score(
    db: Session,
    company_id: int,
    e_score: float,
    s_score: float,
    g_score: float,
    total_score: float,
    grade: str,
    news_event_score: float = 0.0,
    greenwash_flag: bool = False,
    reasoning: str = "",
    breakdown: dict = None,
    report_year: int = None,
    sector_key: str = "default",
) -> ESGScore:
    score = ESGScore(
        CompanyID=company_id,
        EScore=round(e_score, 2),
        SScore=round(s_score, 2),
        GScore=round(g_score, 2),
        TotalScore=round(total_score, 2),
        Grade=grade,
        NewsEventScore=round(news_event_score, 4),
        GreenwashFlag=greenwash_flag,
        Reasoning=reasoning,
        Breakdown=json.dumps(breakdown, ensure_ascii=False) if breakdown else None,
        ReportYear=report_year,
        SectorKey=sector_key,
    )
    db.add(score)
    db.commit()
    db.refresh(score)
    return score


def get_latest_esg_score(db: Session, company_id: int) -> ESGScore | None:
    return (
        db.query(ESGScore)
        .filter(ESGScore.CompanyID == company_id)
        .order_by(ESGScore.Timestamp.desc())
        .first()
    )


def get_company_score_history(db: Session, company_id: int) -> list[ESGScore]:
    return (
        db.query(ESGScore)
        .filter(ESGScore.CompanyID == company_id)
        .order_by(ESGScore.Timestamp.desc())
        .all()
    )


# ── Job CRUD ─────────────────────────────────────────────────────────────────

def create_job(db: Session, company_name: str | None, ticker: str | None) -> Job:
    job = Job(
        JobID=str(uuid.uuid4()),
        CompanyName=company_name,
        Ticker=ticker,
        Status="pending",
        Progress=0,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def update_job_progress(db: Session, job_id: str, step: str, progress: int) -> None:
    job = db.query(Job).filter(Job.JobID == job_id).first()
    if job:
        job.Status = "running"
        job.CurrentStep = step
        job.Progress = progress
        job.UpdatedAt = datetime.utcnow()
        db.commit()


def update_job_company_name(db: Session, job_id: str, company_name: str) -> None:
    job = db.query(Job).filter(Job.JobID == job_id).first()
    if job:
        job.CompanyName = company_name
        job.UpdatedAt = datetime.utcnow()
        db.commit()


def finish_job(db: Session, job_id: str, company_name: str) -> None:
    job = db.query(Job).filter(Job.JobID == job_id).first()
    if job:
        job.Status = "done"
        job.Progress = 100
        job.CompanyName = company_name
        job.UpdatedAt = datetime.utcnow()
        db.commit()


def fail_job(db: Session, job_id: str, error: str) -> None:
    job = db.query(Job).filter(Job.JobID == job_id).first()
    if job:
        job.Status = "error"
        job.ErrorMessage = error
        job.UpdatedAt = datetime.utcnow()
        db.commit()


def get_job(db: Session, job_id: str) -> Job | None:
    return db.query(Job).filter(Job.JobID == job_id).first()


def cancel_job(db: Session, job_id: str) -> None:
    job = db.query(Job).filter(Job.JobID == job_id).first()
    if job:
        job.Status = "cancelled"
        job.UpdatedAt = datetime.utcnow()
        db.commit()


def delete_company(db: Session, name: str) -> bool:
    """刪除公司及其所有 ESG 評分紀錄，回傳是否成功找到並刪除。"""
    company = db.query(Company).filter(Company.Name == name).first()
    if not company:
        return False
    db.query(ESGScore).filter(ESGScore.CompanyID == company.ID).delete()
    db.delete(company)
    db.commit()
    return True
