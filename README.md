# ESG 風險評分系統

金融業（授信／投資／核保）用的 ESG 風險評分原型。  
核心賣點：**透明、可解釋的評分** — 每個分數都能追溯到指標、權重與報告書頁碼。

> 大學期末專案，demo 導向。評分重點：能跑、畫面清楚、方法學說得清楚。

---

## 系統架構

```
永續報告書 PDF  →  M1 指標抽取（GRI 索引 + Gemini）  →  M4 評分引擎  ─→  FastAPI  →  Next.js 前端
負面新聞爬取   →  M2 ERS 評分                         ↗               (E/S/G 分數 + 決策燈號)
漂綠偵測      →  M3 矛盾旗標                          ↗
```

**評分維度：** E（環境）40%、S（社會）30%、G（治理）30%  
**分級：** A（80+）→ B+（70-79）→ B（60-69）→ B-（50-59）→ C（50 以下）  
**方法學依據：** GRI / SASB 指標框架，仿 TESG ERS 事件評分，權重公開揭露

---

## Demo 公司（3 家，資料已預先處理完畢）

| 公司 | 代號 | 角色 | 總分 | 等級 |
|------|------|------|------|------|
| 台達電 | 2308 | ESG 模範生（2025 TCSA 獲獎） | 82.2 | **A** |
| 南山人壽 | 5874 | 負面新聞代表（連年違反勞基法） | 66.3 | **B** |
| 中鋼 | 2002 | 高碳排壓力測試（E 分極低） | 54.1 | **B-** |

Demo 當天直接啟動前後端即可，**不需要任何 LLM 呼叫**，所有資料已快取至 SQLite。

---

## 技術棧

| 層 | 技術 |
|----|------|
| 後端 | Python FastAPI + uvicorn（同步，SQLite） |
| 資料庫 | SQLite（`esg_risk.db`，SQLAlchemy 同步 Session） |
| LLM | Google Gemini 2.5 Flash（僅離線預處理用） |
| 前端 | Next.js 16 + shadcn/ui + Recharts + Tailwind CSS |

---

## 環境需求

- Python 3.11+
- Node.js 18+
- Google Gemini API Key（僅執行 M1 離線抽取時需要，Demo 不需要）

---

## 快速啟動（Demo 模式）

> ⚠️ Demo 模式不需要 Gemini API Key，所有資料已預先快取。

### 1. Clone 並安裝依賴

```bash
git clone <repo-url>
cd esg-risk-system

# 後端依賴
pip install -r requirements.txt

# 前端依賴
cd frontend-next
npm install
cd ..
```

### 2. 設定後端環境變數

```bash
cp .env.example .env
# Demo 模式可留空 GEMINI_API_KEY，啟動後端仍然正常運行
```

### 3. 啟動後端

```bash
uvicorn api.main:app --port 8000
```

後端啟動後可在 `http://localhost:8000/docs` 查看 API 文件。

### 4. 啟動前端

```bash
cd frontend-next
npm run dev      # 開發模式（熱更新）
# 或
npm run build && npm run start   # 正式模式
```

前端運行於 `http://localhost:3000`。

---

## 對外分享（Cloudflare Tunnel）

讓隊友或評審透過公開連結體驗系統，無需部署。

### 前置作業

```bash
# 安裝 Cloudflare Tunnel
winget install Cloudflare.cloudflared   # Windows
# 或
brew install cloudflared                # macOS
```

### 一鍵啟動腳本（Windows）

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\start-demo.ps1
```

腳本會自動完成所有步驟並輸出分享連結。

### 手動步驟

```powershell
# Step 1：啟動後端
uvicorn api.main:app --port 8000

# Step 2：建立後端 Tunnel，記下 URL（例如 https://abc.trycloudflare.com）
cloudflared tunnel --url http://localhost:8000

# Step 3：寫入前端環境變數（重要：必須在 build 前設定）
echo "NEXT_PUBLIC_API_URL=https://abc.trycloudflare.com" > frontend-next/.env.local

# Step 4：Build 並啟動前端
cd frontend-next
npm run build
npm run start

# Step 5：建立前端 Tunnel，將此 URL 分享給他人
cloudflared tunnel --url http://localhost:3000
```

> **注意：** Cloudflare Quick Tunnel 每次重啟會產生新 URL，且 `.env.local` 中的後端 URL 是 Build 時燒入的，更換後端 URL 必須重新 build 前端。

---

## 通用公司分析（新功能）

除了預設三家 Demo 公司外，系統支援分析任意台灣上市公司。

**使用方式：**
1. 在首頁搜尋欄輸入公司名稱或股票代號，選擇報告年份
2. 系統會自動透過 Gemini Search 搜尋永續報告書 PDF
3. 若搜尋失敗，可點選「找不到報告書？貼上網址」手動貼入 PDF 連結或 CSR 頁面網址
4. 或直接上傳 PDF 檔案

> ⚠️ 通用分析需要 Gemini API Key（`GEMINI_API_KEY` 寫入 `.env`），且分析時間約 3-10 分鐘。

---

## 資料預處理（首次建置或更新資料）

僅在需要重新抽取指標時執行，Demo 不需要。

```bash
# 1. 下載三份永續報告書 PDF（約 60 MB）
python scripts/download_reports.py

# 2. M1 指標抽取（需 Gemini API，約 $0.01–0.02 USD/次）
python -X utf8 scripts/extract_indicators_m1.py
# 只跑特定公司：python -X utf8 scripts/extract_indicators_m1.py --company 台達電
# 只重跑 Step 4：python -X utf8 scripts/extract_indicators_m1.py --company 中鋼 --step 4

# 3. 修正指標 bbox 座標（PyMuPDF 精確定位，不需 Gemini）
python -X utf8 scripts/fix_bbox_with_pymupdf.py

# 4. M2 新聞評分（需 Gemini API）
python -X utf8 scripts/fetch_news_m2.py

# 5. M3 漂綠偵測（需 Gemini API）
python -X utf8 scripts/detect_greenwash_m3.py

# 6. 計算 ESG 分數並寫入 SQLite
python -X utf8 scripts/preprocess_cache.py
```

> **快取機制：** 每個步驟的 Gemini 回應皆快取於 `data/logs/`，重跑時自動跳過已完成步驟。

---

## API Endpoints

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/companies` | 所有公司列表 + 最新 ESG 總分 |
| GET | `/api/company/{name}` | 單一公司完整評分卡（E/S/G 拆解、警示、決策燈號） |
| GET | `/api/company/{name}/history` | 歷史評分紀錄 |
| DELETE | `/api/company/{name}` | 刪除公司及所有快取 |
| GET | `/api/dashboard` | 三家公司並排比較 |
| GET | `/api/pdf/{name}` | 串流永續報告書 PDF |
| POST | `/api/company/analyze` | 觸發通用公司分析（multipart/form-data） |
| GET | `/api/job/{job_id}` | 查詢分析進度 |
| DELETE | `/api/job/{job_id}` | 取消分析並清除中間檔案 |
| WS | `/ws/job/{job_id}` | WebSocket 即時進度推送 |

Response 格式統一：`{ "status": "success", "data": { ... } }`

---

## 專案結構

```
esg-risk-system/
├── api/
│   ├── main.py                    # FastAPI endpoints
│   └── analysis_pipeline.py       # 通用公司分析 Pipeline（M1→M2→M3→M4）
├── core/
│   ├── scoring.py                 # M4 評分引擎（E/S/G + 事件扣分）
│   ├── page_map.py                # 邏輯頁 ↔ 物理頁轉換（支援 A3 2-up PDF）
│   └── llm_agent.py               # Gemini API 包裝（離線預處理用）
├── database/
│   ├── models.py                  # SQLAlchemy：Companies / ESG_Scores / Jobs
│   └── crud.py                    # CRUD 函式
├── config/
│   └── weights.yaml               # E/S/G 指標權重（可外部調整）
├── scripts/
│   ├── extract_indicators_m1.py   # M1 v2：GRI 索引解析 + Gemini 指標抽取
│   ├── fix_bbox_with_pymupdf.py   # PyMuPDF 精確 bbox 定位
│   ├── fetch_news_m2.py           # M2 新聞爬取 + ERS 評分
│   ├── detect_greenwash_m3.py     # M3 漂綠偵測
│   ├── preprocess_cache.py        # Cache JSON → 計算分數 → 寫入 SQLite
│   └── download_reports.py        # 下載三份永續報告書 PDF
├── frontend-next/                 # Next.js 16 前端
│   └── src/
│       ├── app/
│       │   ├── page.tsx           # 首頁（公司列表 + 搜尋）
│       │   ├── company/[name]/    # 個別公司評分卡
│       │   ├── compare/           # 三家公司並排比較
│       │   └── job/[jobId]/       # 分析進度頁（WebSocket）
│       └── components/
│           ├── snake-spinner.tsx  # 彗星拖尾旋轉動畫
│           ├── floating-job-pip.tsx  # 分析進度浮動圓點（PiP）
│           ├── pdf-viewer-modal.tsx  # PDF 檢視器（含 bbox 高亮）
│           └── ...
├── data/
│   ├── cache/                     # ✅ 已 commit：Demo 三家公司的 JSON 快取
│   ├── pdfs/                      # ⛔ gitignored：永續報告書 PDF
│   └── logs/                      # ⛔ gitignored：M1 中間產物與 Gemini 快取
├── esg_risk.db                    # SQLite（⛔ gitignored，從 preprocess_cache.py 重建）
├── .env                           # API 金鑰（⛔ gitignored）
├── .env.example                   # 環境變數範本
├── start-demo.ps1                 # Windows 一鍵 Demo 啟動腳本（含 Cloudflare Tunnel）
└── requirements.txt
```

---

## 注意事項

- **CORS：** 後端已設定 `allow_origins=["*"]`，支援 Cloudflare Tunnel 等任意 origin
- **SQLite 非線程安全：** 系統使用同步 Session，不使用 async，符合 SQLite 限制
- **Gemini 503：** Gemini API 高峰期可能遇到 503，M1 已內建三次重試機制，失敗後自動 fallback 至關鍵字搜尋（不需 Gemini）
- **A3 2-up PDF：** 中鋼報告書為 A3 橫式雙頁格式，`core/page_map.py` 自動偵測並轉換頁碼
- **Windows 執行 Python 腳本：** 需加 `-X utf8` 旗標避免中文編碼問題（`python -X utf8 scripts/...`）

---

## 授權

MIT License
