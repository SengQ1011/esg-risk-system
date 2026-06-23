---
name: project-esg-context
description: ESG 風險評分系統核心背景：技術決策、架構、踩過的坑、目前分數
metadata:
  type: project
---

## 專案定位
大學期末專案，demo 導向，評分標準：能跑 + 畫面清楚。三家 demo 公司已確定且資料已跑完。

## 技術棧（不要更換）
- 後端：Python FastAPI（同步）+ SQLite（esg_risk.db）
- LLM：Google Gemini（GEMINI_API_KEY in .env）
- 前端：Next.js（frontend-next/）+ shadcn/ui + Recharts + react-pdf

## 目前分數（最終）
| 公司 | 總分 | 等級 |
|------|------|------|
| 台達電 | 82.2 | A |
| 中鋼 | 54.1 | B- |
| 南山人壽 | 66.2 | B |

## M1 pipeline 狀態（已完成）
三家公司已完成真實抽取。流程：GRI 索引 → 切片 compact PDF → Gemini Step 4 抽值。

**schema 包含**：`value`（換算數字）、`source_text`（PDF 原始字串）、`source_page`（印刷頁）、`pdf_page`（物理頁）、`bbox`（0~1 正規化座標）。

## PDF 指標 highlight 功能（已完成）
- 前端 `breakdown-table-client.tsx` 點擊指標 → 開 PDF viewer
- `pdf-viewer-modal.tsx`：react-pdf + CMap + bbox 黃色底色 highlight
- `fix_bbox_with_pymupdf.py` 負責搜尋精確 bbox

## 重要技術發現（踩過的坑）

**中鋼 A3 2-up PDF**
中鋼 PDF 第 2-83 頁是 A3（1190pt），每物理頁包含兩個 A4 並排。
`core/page_map.py` 處理邏輯頁↔物理頁轉換。
GRI 解析的邏輯頁碼在此格式下不可靠。

**compact_page_map（最關鍵）**
M1 Step 3 切片 PDF 時存 `compact_page → 原始物理頁` 對照表。
fix_bbox 優先用此（Gemini 實際看到的頁碼）而非 GRI source_page。
解決了中鋼 GHG 指標跳到能源章節而非 GHG 章節的問題。

**page_offset**：中鋼=7，台達電=2，南山人壽=1。存於 cache _meta。

**PDF 串流**：StaticFiles 不支援中文檔名 URL encoding，改用 `/api/pdf/{company}` FileResponse。

**bbox 搜尋順序**：source_text → 格式候選 → 過濾頁首尾（y<5% or y>93%）→ 年份評分選最佳。

## Demo 當天執行
```bash
uvicorn api.main:app --port 8000
cd frontend-next && npm run dev
```

## M1 重跑後標準流程
```bash
python -X utf8 scripts/fix_bbox_with_pymupdf.py
python -X utf8 scripts/preprocess_cache.py
```

**Why:** 所有 LLM 呼叫離線完成，demo 當天只讀快取。fix_bbox 必須在 M1 後重跑以更新 pdf_page 和 bbox。

**How to apply:** 新 session 若要改 M1 或分數，參考 CLAUDE.md 的完整腳本說明。
