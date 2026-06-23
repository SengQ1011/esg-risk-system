# ESG 系統待完成項目

---

## ✅ 已完成（main branch）

### M1 — 指標抽取
- 三家公司 M1 真實抽取完成（gemini-2.5-flash）
- Step 4 schema 新增 `source_text`（PDF 原始字串，供 PyMuPDF 精確搜尋）
- Step 3 `_meta` 新增 `compact_page_map`（修正 A3 2-up 混淆）
- `core/page_map.py`：A3 2-up PDF 邏輯頁 ↔ 物理頁轉換

### M4 — 評分引擎
- Weight Redistribution（缺漏指標從分母剔除）
- breakdown 含 `source_page`、`unit`、`confidence`、`pdf_page`、`bbox`

### M5 — 前端 + PDF Viewer
- 三頁面（列表 / 評分卡 / 比較）採用新 UI 設計（朋友整合版）
- PDF viewer：react-pdf + CMap + bbox highlight + 自動 scroll
- `fix_bbox_with_pymupdf.py`：PyMuPDF text search 精確座標
- `indicator-details-client.tsx`：Accordion 展開指標表 + PDF viewer 整合

---

## 目前分數（main）

| 公司 | E | S | G | 總分 | 等級 |
|------|---|---|---|------|------|
| 台達電 | 88.9 | 56.3 | 100.0 | 82.2 | A |
| 中鋼 | 28.1 | 52.9 | 100.0 | 54.1 | B- |
| 南山人壽 | 78.0 | 75.8 | 51.9 | 66.2 | B |

---

## 🔵 進行中：feat/general-company（前端通用化）

**目標**：讓系統支援任意台灣上市公司，不限三家 demo 公司。

### 任務清單
- [ ] 首頁改為搜尋頁（公司名稱 / 股票代號輸入框）
- [ ] 首頁下方「已分析的公司」區塊（從 /api/companies 讀取，方便 demo 直接點擊）
- [ ] 上傳 PDF 功能（拖曳上傳，POST /api/company/analyze）
- [ ] 進度頁面 `/job/[jobId]`（WebSocket 連線，顯示 M1 各 step）
- [ ] 分析完成後彈通知 + 自動跳轉評分卡
- [ ] 公司不在 DB 時顯示「開始分析」入口
- [ ] **mock API**：前端先用假 response 開發，等後端完成再串

### Mock API 格式（前端 agent 使用）

`POST /api/company/analyze` response:
```json
{
  "status": "success",
  "data": { "job_id": "mock-abc123", "company_name": "鴻海" }
}
```

WebSocket `ws://localhost:8000/ws/job/{job_id}` 推送格式:
```json
{"step": "搜尋 ESG 報告書", "progress": 10, "done": false}
{"step": "下載 PDF", "progress": 25, "done": false}
{"step": "GRI 索引解析", "progress": 45, "done": false}
{"step": "Gemini 指標抽取", "progress": 70, "done": false}
{"step": "計算 E/S/G 分數", "progress": 90, "done": false}
{"step": "完成", "progress": 100, "done": true, "company_name": "鴻海"}
```

---

## 🔵 進行中：feat/real-m2-m3（後端 M2/M3 + 通用分析）

**目標**：取代假資料，支援任意公司即時分析。

### 任務清單

#### Job 系統
- [ ] `database/models.py` 新增 `Jobs` 資料表（job_id, company_name, status, step, progress, error, created_at）
- [ ] `database/crud.py` 新增 Job CRUD
- [ ] `POST /api/company/analyze` endpoint（接公司名稱 or 上傳 PDF）
- [ ] `GET /api/job/{job_id}` endpoint（查詢 job 狀態）
- [ ] `WS /ws/job/{job_id}` WebSocket（即時推送進度）

#### M1 通用化
- [ ] Gemini Search 搜尋 ESG 報告 PDF URL（台灣上市公司）
- [ ] 下載 PDF → `data/pdfs/{ticker}_{year}.pdf`
- [ ] 背景執行現有 M1 pipeline（`asyncio.run_in_executor`）
- [ ] AI 自動識別 PDF 是哪家公司（from filename or content）
- [ ] 執行完後跑 `fix_bbox_with_pymupdf.py` + `preprocess_cache.py`

#### M2 — 新聞評分（取代假資料）
- [ ] `scripts/fetch_news_m2.py`：Google News RSS 抓取
  - URL: `https://news.google.com/rss/search?q={公司名稱}+ESG&hl=zh-TW&gl=TW`
  - BeautifulSoup 解析，Gemini 分類 severity
  - ERS = Σ(intensity × e^(-λ·days))，λ=0.005
- [ ] 快取到期邏輯：`news_updated_at` 超過 1 個月 → 觸發重抓

#### M3 — 漂綠偵測（取代假 flag）
- [ ] `scripts/detect_greenwash_m3.py`：
  - 重用 M1 compact PDF（已過濾至相關頁，約 20-55 頁）
  - Gemini 擷取承諾聲明（減碳目標、淨零承諾、再生能源宣稱）
  - 對照 M1 量化指標（ghg_scope1 年增？assurance=false？）
  - 三種矛盾模式：趨勢矛盾、缺乏第三方確信、範疇選擇性揭露

---

## Demo 當天執行（main branch）

```bash
uvicorn api.main:app --port 8000
cd frontend-next && npm run dev
```
