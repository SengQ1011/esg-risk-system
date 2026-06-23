# ESG Risk Scoring System

這是一個為金融業設計的 AI ESG 風險評分原型系統。透過 AI 自動化處理非結構化數據，將企業的「風險曝露」與「風險管理」能力轉化為可視化的風險評分，並具備歷史紀錄追蹤功能。

## 系統特色
- **AI 語意解析**：整合 Gemini API 進行專業的 ESG 風險文本分析。
- **量化評分模型**：採用「風險曝露 x 風險管理」雙維度評分架構。
- **前後端分離架構**：以 FastAPI 提供穩定可靠的 RESTful API，並以 Streamlit 打造互動式決策儀表板。
- **歷史風險追蹤**：內建關聯式資料庫，自動記錄並視覺化企業風險趨勢。

## 文件導覽

- [產品規格書 (PRD)](docs/PRD.md)
- [系統設計 (Design)](docs/DESIGN.md)

## 環境建置

1. 安裝所需套件：

```bash
pip install -r requirements.txt
```

2. 在專案根目錄建立 `.env` 檔案，並設定你的 API 金鑰：

```text
GEMINI_API_KEY="你的_Google_Gemini_API_Key"
```

## 🚀 快速啟動（需開啟兩個終端機）

### 啟動後端 API 伺服器（終端機 1）

```bash
uvicorn api.main:app --reload
```

> 後端成功啟動後，可至 `http://localhost:8000/docs` 查看 API 規格文件。

### 啟動前端儀表板（終端機 2）

```bash
streamlit run frontend/app.py
```

> 前端成功啟動後，瀏覽器將自動開啟 `http://localhost:8501`。
