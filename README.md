# ESG 風險評分系統

金融業（授信／投資／核保）用的 ESG 風險評分原型。  
核心賣點：**透明、可解釋的評分** — 每個分數都能追溯到指標、權重與報告書頁碼。

> 大學期末專案，demo 導向。評分重點：能跑、畫面清楚、方法學說得清楚。

---

## 系統架構

```
永續報告書 PDF  →  M1 指標抽取  →  M4 評分引擎  →  FastAPI  →  Next.js 前端
負面新聞快取   →  M2 ERS 評分  ↗               (E/S/G 分數 + 決策燈號)
漂綠偵測      →  M3 矛盾旗標  ↗
```

**評分維度：** E（環境）40% × S（社會）30% × G（治理）30%  
**分級：** A（80+）→ B+（70-79）→ B（60-69）→ B-（50-59）→ C（50 以下）  
**方法學依據：** GRI / SASB 指標框架，仿 TESG ERS 事件評分，權重公開揭露（符合歐盟 ESG 評級法規方向）

---

## Demo 公司

| 公司 | 代號 | 角色 | 預期分數 |
|------|------|------|---------|
| 台達電 | 2308 | ESG 模範生（2025 TCSA 獲獎） | B+（~78 分） |
| 中鋼 | 2002 | 高碳排壓力測試（E 分極低） | C（~44 分） |
| 南山人壽 | 5874 | 負面新聞代表（連年違反勞基法） | C（~48 分） |

---

## 實作現況

| 模組 | 狀態 | 說明 |
|------|------|------|
| M4 評分引擎 | ✅ 完成 | `core/scoring.py`，權重由 `config/weights.yaml` 外部管理 |
| FastAPI 後端 | ✅ 完成 | 4 個 endpoints，cache-first，不做即時 LLM 呼叫 |
| 資料庫 | ✅ 完成 | SQLite，ESG_Scores 資料表，已預填手工快取資料 |
| M1 指標抽取 | ⏳ 待執行 | 腳本已寫好，等 Gemini API quota 恢復後跑 |
| M2/M3 快取 | ⚠️ 手工估算 | news.json 為人工填寫，真實爬取為後續工作 |
| Next.js 前端 | 🚧 尚未建立 | 評分卡、雷達圖、警示清單、決策建議 |

---

## 環境建置

### 1. 安裝依賴

```bash
pip install -r requirements.txt
```

### 2. 設定 API 金鑰

```bash
cp .env.example .env
# 編輯 .env，填入 GEMINI_API_KEY
```

到 [Google AI Studio](https://aistudio.google.com/app/apikey) 取得金鑰。  
> **注意：** M1 指標抽取需要付費方案（gemini-2.0-flash），費用約 $0.01–$0.02 USD／次。免費額度可能為 0。

---

## 執行順序

### Demo 當天（快取已備好，直接跑 API）

```bash
# 啟動後端
uvicorn api.main:app --reload

# API 文件
open http://localhost:8000/docs
```

### 首次環境建置（或更新真實資料）

```bash
# Step 1：下載三份永續報告書 PDF（約 58 MB）
python scripts/download_reports.py

# Step 2：M1 指標抽取（需 Gemini 付費 API，約 $0.01–$0.02）
python scripts/extract_indicators_m1.py
# 有快取自動跳過；除錯用：
# python scripts/extract_indicators_m1.py --company 台達電 --step 4

# Step 3：計算 ESG 分數並寫入 SQLite
python -X utf8 scripts/preprocess_cache.py

# Step 4：啟動後端
uvicorn api.main:app --reload
```

---

## API Endpoints

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/companies` | 所有公司列表 + 最新 ESG 總分 |
| GET | `/api/company/{name}` | 單一公司完整評分卡（含 E/S/G 拆解、警示、決策燈號） |
| GET | `/api/company/{name}/history` | 歷史評分紀錄 |
| GET | `/api/dashboard` | 三家公司並排比較（含雷達圖資料） |
| GET | `/health` | 健康檢查 |

Response 格式統一：
```json
{ "status": "success", "data": { ... } }
```

---

## 專案結構

```
esg-risk-system/
├── api/
│   └── main.py                   # FastAPI endpoints（cache-first，不呼叫 LLM）
├── core/
│   ├── scoring.py                # M4 評分引擎（E/S/G 三維）
│   └── llm_agent.py              # Gemini API（離線預處理用）
├── database/
│   ├── models.py                 # SQLAlchemy：Companies + ESG_Scores
│   └── crud.py                   # CRUD 函式
├── config/
│   └── weights.yaml              # E/S/G 指標權重（可調，對外揭露）
├── data/
│   ├── cache/                    # ✅ 已 commit，demo 快取資料
│   │   ├── 台達電_indicators.json  # M1 輸出（18 個 ESG 指標）
│   │   ├── 台達電_news.json        # M2 輸出（ERS 分數 + 漂綠旗標）
│   │   ├── 中鋼_indicators.json
│   │   ├── 中鋼_news.json
│   │   ├── 南山人壽_indicators.json
│   │   └── 南山人壽_news.json
│   ├── pdfs/                     # ⛔ gitignored，執行 download_reports.py 取得
│   └── logs/                     # ⛔ gitignored，M1 執行中間產物
├── scripts/
│   ├── download_reports.py       # 自動從官網下載三份 PDF
│   ├── extract_indicators_m1.py  # M1 v2：GRI AI 路由 + pypdf 切片 + Gemini Files API
│   └── preprocess_cache.py       # cache JSON → ESG 分數 → SQLite
├── docs/
│   ├── esg_risk_scoring_system_design.md  # 完整系統設計文件
│   └── esg_risk_scoring_architecture.svg  # 架構流程圖
├── esg_risk.db                   # SQLite（gitignored，從 preprocess_cache.py 重建）
├── .env                          # API 金鑰（gitignored）
└── requirements.txt
```

---

## M1 指標抽取說明

M1 採用「混合模式」，比直接送整本 PDF 便宜約 80%：

```
Step 1  pdfplumber 全文抽取，定位 GRI 索引頁範圍
   ↓
Step 2  Gemini（text）解析 GRI 索引表 → 輸出各指標頁碼 JSON
   ↓
Step 3  pypdf 切出相關頁面（含 ±1 頁 buffer）→ 精簡 PDF（~25 頁）
   ↓
Step 4  Gemini Files API 原生讀取精簡 PDF → 視覺抽取指標值
```

中間結果快取在 `data/logs/`，重跑時自動跳過已完成的步驟，不重複消耗 token。

---

## 重要文件

- [系統設計文件](docs/esg_risk_scoring_system_design.md)：評分方法學、指標 schema、模組規格
- [weights.yaml](config/weights.yaml)：E/S/G 指標權重（可在此調整權重並重跑 preprocess_cache.py）

---

## 授權

MIT License — 詳見 [LICENSE](LICENSE)
