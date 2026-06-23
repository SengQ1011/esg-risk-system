import os
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, Float, Text, DateTime, ForeignKey
from sqlalchemy.orm import declarative_base, relationship, sessionmaker
from dotenv import load_dotenv

load_dotenv()

# 預設使用 SQLite 進行本地快速開發，若 .env 中有 DB_URL 則優先使用 (例如未來的 PostgreSQL)
DATABASE_URL = os.environ.get("DB_URL", "sqlite:///./esg_risk.db")

# 建立資料庫引擎與連線 Session
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- 定義資料表 Schema ---

class Company(Base):
    __tablename__ = "Companies"
    ID = Column(Integer, primary_key=True, index=True)
    Name = Column(String, unique=True, nullable=False)
    Industry = Column(String, nullable=False)
    
    # 關聯到評分紀錄
    scores = relationship("RiskScore", back_populates="company")

class RiskScore(Base):
    __tablename__ = "Risk_Scores"
    ScoreID = Column(Integer, primary_key=True, index=True)
    CompanyID = Column(Integer, ForeignKey("Companies.ID"), nullable=False)
    ExposureScore = Column(Float, nullable=False)
    ManagementScore = Column(Float, nullable=False)
    FinalScore = Column(Float, nullable=False)
    Reasoning = Column(Text, nullable=False)
    Timestamp = Column(DateTime, default=datetime.utcnow)

    # 關聯回公司
    company = relationship("Company", back_populates="scores")

# 建立所有資料表 (如果資料庫中還沒有的話)
Base.metadata.create_all(bind=engine)