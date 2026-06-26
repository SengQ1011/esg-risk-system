import os
import uuid
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, Float, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import declarative_base, relationship, sessionmaker
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ.get("DB_URL", "sqlite:///./esg_risk.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Company(Base):
    __tablename__ = "Companies"

    ID = Column(Integer, primary_key=True, index=True)
    Name = Column(String, unique=True, nullable=False)
    Ticker = Column(String, nullable=True)
    Industry = Column(String, nullable=False)

    scores = relationship("ESGScore", back_populates="company")


class ESGScore(Base):
    __tablename__ = "ESG_Scores"

    ScoreID = Column(Integer, primary_key=True, index=True)
    CompanyID = Column(Integer, ForeignKey("Companies.ID"), nullable=False)

    EScore = Column(Float, nullable=False)
    SScore = Column(Float, nullable=False)
    GScore = Column(Float, nullable=False)
    TotalScore = Column(Float, nullable=False)
    Grade = Column(String(5), nullable=False)   # A / B+ / B / B- / C

    NewsEventScore = Column(Float, nullable=False, default=0.0)
    GreenwashFlag = Column(Boolean, nullable=False, default=False)

    Reasoning = Column(Text, nullable=True)
    Breakdown = Column(Text, nullable=True)     # JSON 字串，存各指標貢獻
    SectorKey = Column(String(50), nullable=True, default="default")  # 產業分類

    ReportYear = Column(Integer, nullable=True)
    Timestamp = Column(DateTime, default=datetime.utcnow)

    company = relationship("Company", back_populates="scores")


class Job(Base):
    __tablename__ = "Jobs"

    JobID = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    CompanyName = Column(String, nullable=True)
    Ticker = Column(String, nullable=True)
    Status = Column(String, default="pending")   # pending / running / done / error
    CurrentStep = Column(String, nullable=True)
    Progress = Column(Integer, default=0)        # 0–100
    ErrorMessage = Column(Text, nullable=True)
    CreatedAt = Column(DateTime, default=datetime.utcnow)
    UpdatedAt = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


Base.metadata.create_all(bind=engine)


def run_migrations() -> None:
    """SQLite 不支援 ALTER TABLE 自動新增欄位，手動補齊。"""
    from sqlalchemy import text, inspect
    with engine.connect() as conn:
        inspector = inspect(engine)
        existing = {c["name"] for c in inspector.get_columns("ESG_Scores")}
        if "SectorKey" not in existing:
            conn.execute(text("ALTER TABLE ESG_Scores ADD COLUMN SectorKey VARCHAR(50) DEFAULT 'default'"))
            conn.commit()


run_migrations()
