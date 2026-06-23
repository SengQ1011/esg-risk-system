import json
from sqlalchemy.orm import Session
from database.models import Company, ESGScore


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
