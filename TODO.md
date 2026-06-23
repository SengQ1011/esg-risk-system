# ESG 系統待完成項目

> Demo 前必須完成的以 🔴 標示；選做以 🟡 標示。

---

## ✅ 已完成（本 session）

- M1 三家公司真實抽取完成（gemini-2.5-flash，台達電 15/18、中鋼 17/18、南山人壽 17/18）
- Null 處理改為 Weight Redistribution（缺漏指標從分母剔除，不以 0 懲罰）
- ghg_scope3_max 調整為 15,000,000（避免完整揭露 scope3 的電子業被錯誤懲罰）
- API breakdown 新增 `source_page`、`unit`、`confidence` 三欄位
- 最終分數：台達電 A(81)、中鋼 C(45.7)、南山人壽 B(63.2)
- 修復 Files API 中文路徑 bug（compact PDF 改用 ticker 命名）
- 修復 page_offset 合理性檢查（Gemini vs Python 差 >15 時改用 Python 值）

---

## 🔴 M5-PDF：指標 Highlight 視覺化（前端核心功能）

**目標**：用戶點擊評分卡上的指標數值，直接在原始 PDF 上 highlight 並跳到對應頁。

### 現有資料（API 已回傳）

```json
{
  "key": "ghg_scope1",
  "raw_value": 26283,
  "unit": "公噸CO2e",
  "source_page": 101,      ← 已有頁碼
  "confidence": 0.95,      ← 已有信心度
  "normalized": 0.9974,
  "weight": 0.25,
  "contribution": 0.2493,
  "missing": false
}
```

### Phase 1：跳頁版本（可立即實作，source_page 已就緒）

- 前端：`react-pdf`（`@react-pdf-viewer/core`）嵌入 PDF viewer
- 指標卡點擊 → 帶入 `source_page` 跳頁 + 該頁閃爍高亮動畫
- PDF 來源：後端直接 serve 靜態檔 `data/pdfs/{company}_2023.pdf`
  - 需在 `api/main.py` 加 `StaticFiles` mount 或新增 `/pdf/{company}` endpoint

```python
# api/main.py 新增
from fastapi.staticfiles import StaticFiles
app.mount("/pdfs", StaticFiles(directory="data/pdfs"), name="pdfs")
# 前端取：http://localhost:8000/pdfs/台達電_2023.pdf
```

### Phase 2：精確 Highlight（需改 M1 抽取 bbox 座標）

- 目前 Gemini Step 4 只回傳 `source_page`，不回傳座標
- 需改 `scripts/extract_indicators_m1.py` 的 `_EXTRACTOR_SYSTEM` prompt，要求 Gemini 額外回傳：
  ```json
  "ghg_scope1": {
    "value": 26283,
    "source_page": 101,
    "bbox": [x1, y1, x2, y2],   ← 新增：數值在頁面上的位置（百分比座標）
    "confidence": 0.95
  }
  ```
- 前端用 `react-pdf` 的 `highlightPlugin` 或自製 canvas overlay 繪製 highlight 框
- **注意**：Gemini 回傳 bbox 的準確度依版面設計而定，需人工驗收

### 執行順序

```
Phase 1（跳頁）：
1. api/main.py 加 StaticFiles PDF serve
2. 前端建 PDF viewer 元件（react-pdf）
3. 指標卡點擊 → jumpToPage(source_page)

Phase 2（精確 highlight，選做）：
1. 修改 _EXTRACTOR_SYSTEM prompt 加 bbox 欄位
2. 對三家公司重跑 --step 4（清除 step4 cache）
3. 重跑 preprocess_cache.py 更新 SQLite
4. 前端 canvas overlay 繪製 highlight
```

---

## 🔴 M5-前端：Next.js 評分卡系統（主要工作）

核心頁面：
- `/`：三家公司列表（總分 + 等級燈號 + E/S/G 概覽）
- `/company/[name]`：完整評分卡
  - 總分 + 等級 + 決策燈號（授信/投資/核保）
  - E/S/G 雷達圖（Recharts RadarChart）
  - 各構面 breakdown 表格（含 source_page，點擊跳 PDF）
  - 缺漏指標警示：`G 100分（基於 3/5 指標）⚠ 2項指標未揭露`
  - 警示清單（負面事件 + 漂綠旗標）
- `/compare`：三家並排比較雷達圖（Recharts，使用 /api/dashboard）

**重要**：台達電 G=100 是「基於 3/5 指標」的人工製品，UI 必須顯示缺漏指標數量，避免誤導。

---

## 🟡 M2：新聞爬取（選做）

目前手工快取已足夠 demo，三家公司的正負面事件對比明顯。

實作路徑（`scripts/fetch_news_m2.py` 尚未建立）：

```
Google News RSS
  → 關鍵字：公司名稱 + ESG/違規/裁罰/碳排
  → 抓最近 12 個月（BeautifulSoup 解析 RSS）
  → Gemini 分類（severity: critical/high/medium/low）
  → ERS = Σ(intensity × e^(-λ·days))，λ=0.005
  → 更新 data/cache/{company}_news.json
  → 重跑 preprocess_cache.py
```

---

## Demo 前執行順序

```bash
# 後端（已完成）
python -X utf8 scripts/preprocess_cache.py   # 如需重建 SQLite
uvicorn api.main:app --port 8000             # 啟動 API

# 前端（待建立）
cd frontend-next && npm run dev              # http://localhost:3000
```

---

## 🔴 M1-A：套用台達電真實指標（Gemini 已跑完，不需 quota）

台達電的 M1 結果已存在 `data/logs/台達電_step4_cache.json`，**尚未更新到快取和資料庫**。

**缺失指標**（step4_cache 裡 confidence=0）：
- `carbon_intensity`（無法從 PDF 定位）
- `independent_director_ratio`
- `female_director_ratio`

處理步驟：
1. 將 `data/logs/台達電_step4_cache.json` 的內容合併回 `data/cache/台達電_indicators.json`
2. 對三個缺失指標，決定要保留手工估算值或標記為 null
3. 執行 `python scripts/preprocess_cache.py` 重新寫入 SQLite

---

## 🔴 M1-B：中鋼 + 南山人壽指標抽取（需要 Gemini quota）

目前 `data/cache/中鋼_indicators.json` 與 `data/cache/南山人壽_indicators.json` 全為手工估算值。

```bash
# quota 恢復後執行（每家公司約 $0.01 USD）
python scripts/extract_indicators_m1.py --company 中鋼
python scripts/extract_indicators_m1.py --company 南山人壽

# 全部跑完後更新 SQLite
python scripts/preprocess_cache.py
```

**注意：** 中鋼和南山人壽的 M1 若跑出的指標有 null（confidence=0），
需決定是補手工估算值還是在計分時以 0 填補（目前 `core/scoring.py` 已設定缺失指標填 0，為保守估計）。

---

## 🔴 驗證分數方向合理性

M1 真實資料跑完後，確認三家公司分數的**相對排序**符合 demo 設計：

| 公司 | 預期 | 關鍵驅動 |
|------|------|---------|
| 台達電 | 最高（B+ 以上） | 再生能源高、碳排低、治理完整 |
| 中鋼 | E 分極低 | 碳排強度超高（385 tCO2e/百萬元） |
| 南山人壽 | S/G 分低 | violations=6、turnover=22.5%、無永續長、無第三方確信 |

若分數跑歪（例如台達電不是最高），需檢查 `config/weights.yaml` 的正規化基準值（`normalization` 欄位）是否合理。

---

## 🟡 M2：新聞爬取（選做）

目前 `data/cache/*_news.json` 為手工構造，事件標題/摘要符合公開資訊但細節未驗證。

實作路徑（`scripts/fetch_news_m2.py` 尚未建立）：

```
Google News RSS
  → 關鍵字：公司名稱 + ESG/違規/裁罰/碳排
  → 抓最近 12 個月的文章（BeautifulSoup 解析 RSS）
  → Gemini 分類（severity: critical/high/medium/low）
  → 計算 ERS = Σ(intensity × e^(-λ·days))，λ=0.005
  → 更新 data/cache/{company}_news.json
  → 重跑 preprocess_cache.py
```

目前手工快取已足夠 demo，三家公司的正負面事件對比明顯。

---

## 🟡 修正 `carbon_intensity` 正規化異常（可選）

台達電 M1 未能抽取 `carbon_intensity`（confidence=0），但 `config/weights.yaml` 給它 0.25 的高權重。
若填 0（缺失懲罰），台達電的 E 分會被壓低，不利於正確呈現其 ESG 優勢。

選擇：
- **方案 A**：手動填入台達電年報公開的碳強度數字，維持 0.25 權重
- **方案 B**：若三家公司都缺此值，暫時降低 `carbon_intensity` 權重（在 `weights.yaml` 調整），其他 E 指標等比補上至 1.0

---

## Demo 前執行順序

```bash
# 1. M1 跑完或手工補齊缺失指標後
python scripts/preprocess_cache.py          # 重建 SQLite

# 2. 確認 API 回傳分數正確
uvicorn api.main:app --port 8000
curl http://localhost:8000/api/companies    # 確認三家公司分數合理

# 3. 啟動前端
cd frontend-next && npm run dev
```
