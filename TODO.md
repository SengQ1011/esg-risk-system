# ESG 系統待完成項目

> Demo 前必須完成的以 🔴 標示；選做以 🟡 標示。

---

## ✅ 已完成

### M1 — 指標抽取
- 三家公司 M1 真實抽取完成（gemini-2.5-flash）
- Step 4 schema 新增 `source_text`（PDF 原始字串，供 PyMuPDF 精確搜尋）
- Step 3 `_meta` 新增 `compact_page_map`（compact 頁碼 → 原始物理頁，修正 2-up 混淆）
- 修復 A3 2-up PDF（中鋼）的邏輯頁/物理頁對應：`core/page_map.py`

### M4 — 評分引擎
- Weight Redistribution（缺漏指標從分母剔除，不以 0 懲罰）
- breakdown 新增 `source_page`、`unit`、`confidence`、`pdf_page`、`bbox`

### M5-PDF — 指標 Highlight 視覺化 ✅ 完成
- `scripts/fix_bbox_with_pymupdf.py`：PyMuPDF text search 取代 AI 猜測 bbox
  - 優先 `source_text`（AI 回傳原始字串）→ 退回格式候選搜尋
  - 優先 `_compact_page + compact_page_map`（Gemini 實際看到的頁）→ 退回 GRI source_page
  - 過濾頁首/尾邊距命中（y < 5% 或 y > 93%）
  - 多命中時按 2023 年份關鍵字評分選最佳
- `core/page_map.py`：A3 2-up PDF 邏輯頁 ↔ 物理頁轉換
- `api/main.py`：`/api/pdf/{company}` FileResponse（繞過中文路徑 URL 編碼問題）
- `api/main.py`：`page_offset` 加入 company detail response
- `frontend-next/src/components/pdf-viewer-modal.tsx`
  - react-pdf + CMap（支援中文字體）
  - 自動縮放至 scroll area 寬度（消除 A3 右側空白）
  - bbox overlay（黃色底色，無邊框）
  - zoom 60%~200%、翻頁、跳回指標頁按鈕
  - 頁面渲染後自動 scrollLeft 置中 highlight
- `frontend-next/src/components/breakdown-table-client.tsx`
  - 點擊指標 → 開 PDF viewer
  - `raw_value === false`（布林否）→ 不可點擊
  - 優先用 `pdf_page`，fallback `source_page + pageOffset`

### M5-前端 — Next.js 評分卡 ✅ 完成
- `/`：三家公司列表（總分 + 等級燈號 + E/S/G 概覽）
- `/company/[name]`：完整評分卡（雷達圖、長條圖、breakdown 表格、警示清單、決策燈號）
- `/compare`：三家並排比較雷達圖

---

## 目前分數（最終）

| 公司 | E | S | G | 總分 | 等級 |
|------|---|---|---|------|------|
| 台達電 | 88.9 | 56.3 | 100.0 | 82.2 | A |
| 中鋼 | 28.1 | 52.9 | 100.0 | 54.1 | B- |
| 南山人壽 | 78.0 | 75.8 | 51.9 | 66.2 | B |

---

## 🟡 待改善（選做）

### M2：新聞爬取
目前手工快取已足夠 demo，三家公司正負面事件對比明顯。

### source_text prompt 優化
部分指標 Gemini 回傳整句話而非純數字（`electricity` 的 source_text 太長導致搜尋失敗）。
改法：Step 4 prompt 強調 source_text 只填「數值的原始字串」，不含標籤或單位描述。

### M2 重跑後標準流程
```bash
python -X utf8 scripts/fix_bbox_with_pymupdf.py
python -X utf8 scripts/preprocess_cache.py
```

---

## Demo 當天執行順序

```bash
# 後端
uvicorn api.main:app --port 8000

# 前端
cd frontend-next && npm run dev   # http://localhost:3000
```

> 所有 LLM 呼叫已離線跑完，demo 當天只讀快取，不需 Gemini API。
