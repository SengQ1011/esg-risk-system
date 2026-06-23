# ESG Risk Scoring System

這是一個為金融業設計的 AI ESG 風險評分原型系統。透過 AI 自動化處理非結構化數據，將企業的「風險曝露」與「風險管理」能力轉化為可視化的風險評分，並具備歷史紀錄追蹤功能。

## 系統特色

- **AI 語意解析**：整合 Gemini API 進行專業的 ESG 風險文本分析
- **量化評分模型**：採用「風險曝露 × 風險管理」雙維度評分架構
- **前後端分離架構**：以 FastAPI 提供穩定可靠的 RESTful API，並以 Streamlit 打造互動式決策儀表板
- **歷史風險追蹤**：內建關聯式資料庫，自動記錄並視覺化企業風險趨勢

## 文件導覽

- [產品規格書 (PRD)](docs/PRD.md)
- [系統設計 (Design)](docs/DESIGN.md)

## 環境建置

### 1. 安裝所需套件

```bash
pip install -r requirements.txt
```

### 2. 設定環境變數

複製範本並填入你的 API 金鑰：

```bash
cp .env.example .env
```

編輯 `.env`：

```text
GEMINI_API_KEY="你的_Google_Gemini_API_Key"
```

> 到 [Google AI Studio](https://aistudio.google.com/app/apikey) 取得免費 API 金鑰。

### 3. 資料庫初始化（自動）

**不需要任何手動操作。** 首次啟動後端時，SQLAlchemy 會自動在專案根目錄建立 `esg_risk.db`，並建立所需的資料表（`Companies`、`Risk_Scores`）。

若未來需要遷移至 PostgreSQL，只需在 `.env` 加入：

```text
DB_URL="postgresql://user:password@localhost:5432/esg_db"
```

## 快速啟動（需開啟兩個終端機）

### 啟動後端 API 伺服器（終端機 1）

```bash
uvicorn api.main:app --reload
```

後端成功啟動後，可至 `http://localhost:8000/docs` 查看互動式 API 規格文件。

### 啟動前端儀表板（終端機 2）

```bash
streamlit run frontend/app.py
```

前端成功啟動後，瀏覽器將自動開啟 `http://localhost:8501`。

## 專案結構

```
esg-risk-system/
├── api/
│   └── main.py           # FastAPI 路由與端點
├── core/
│   ├── llm_agent.py      # Gemini AI 語意解析
│   └── scoring.py        # 風險評分公式
├── data/
│   ├── crawler.py        # 新聞爬蟲
│   └── esg_dataset.py    # 資料集處理
├── database/
│   ├── models.py         # SQLAlchemy 資料表定義（含自動初始化）
│   └── crud.py           # 資料庫讀寫操作
├── frontend/
│   └── app.py            # Streamlit 儀表板
├── docs/
│   ├── PRD.md
│   └── DESIGN.md
├── .env.example          # 環境變數範本
└── requirements.txt
```

## 授權

MIT License — 詳見 [LICENSE](LICENSE)
