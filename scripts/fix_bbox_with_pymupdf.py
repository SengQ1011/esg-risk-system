"""
scripts/fix_bbox_with_pymupdf.py

用 PyMuPDF 文字搜尋取代 Gemini AI 生成的 bbox 座標，
同時儲存精確的物理頁碼（_pdf_page）供前端直接跳頁使用。

執行：
    python scripts/fix_bbox_with_pymupdf.py
    python scripts/preprocess_cache.py   # 更新 SQLite
"""
import json
import sys
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit("請先安裝 PyMuPDF：pip install PyMuPDF")

# 引入頁碼轉換工具
sys.path.insert(0, str(Path(__file__).parent.parent))
from core.page_map import build_logical_to_physical_map, physical_0idx_to_pdf_page

ROOT      = Path(__file__).parent.parent
CACHE_DIR = ROOT / "data" / "cache"
PDF_DIR   = ROOT / "data" / "pdfs"

COMPANIES    = ["台達電", "中鋼", "南山人壽"]
BOOLEAN_KEYS = {"has_sustainability_officer", "assurance"}

RATIO_KEYS = {
    "renewable_ratio", "female_ratio", "female_mgmt_ratio",
    "independent_director_ratio", "female_director_ratio",
    "carbon_intensity",
}


def _value_candidates(value: float | int, is_ratio: bool = False) -> list[str]:
    candidates: list[str] = []
    v = float(value)

    def _add(val: float) -> None:
        if val == int(val):
            iv = int(val)
            candidates.append(f"{iv:,}")
            candidates.append(str(iv))
            candidates.append(f"{iv:,.2f}")
        else:
            # 從最多位小數開始試，避免 "18,740.4" 比 "18,740.407" 先命中（子字串誤匹配）
            for dp in range(3, 0, -1):
                candidates.append(f"{val:,.{dp}f}")
                candidates.append(f"{val:.{dp}f}")

    _add(v)

    if is_ratio or (0 < v < 100 and v != int(v)):
        for dp in range(1, 3):
            candidates.append(f"{v:.{dp}f}%")

    if abs(v) >= 1_000_000:
        _add(v / 1_000)
        _add(v / 1_000_000)
    elif abs(v) >= 10_000:
        _add(v / 1_000)

    return list(dict.fromkeys(candidates))


def _year_score(page: fitz.Page, rect: fitz.Rect) -> int:
    """
    計算命中位置周圍是否含有 2023（民國 112）年的線索。
    用於多命中時選取最可能是最新年度資料的那個。
    """
    clip = fitz.Rect(0, rect.y0 - 60, page.rect.width, rect.y1 + 60)
    ctx  = page.get_text("text", clip=clip)
    score = 0
    if "2023" in ctx or "112年" in ctx or "112" in ctx:
        score += 2
    if "2022" in ctx or "111年" in ctx:
        score -= 1
    return score


def _is_margin_hit(rect: fitz.Rect, page: fitz.Page) -> bool:
    """判斷命中位置是否在頁首/頁尾邊距內（頁碼、頁腳、頁眉都在這裡）。"""
    h = page.rect.height
    return rect.y0 > h * 0.93 or rect.y1 < h * 0.05


def _best_hit(page: fitz.Page, hits: list) -> fitz.Rect | None:
    """從多個命中中選取最可能是 2023 年度資料的位置。
    先過濾掉頁首/頁尾（頁碼區），再用年份分數排序。
    """
    content_hits = [r for r in hits if not _is_margin_hit(r, page)]
    if not content_hits:
        return None  # 全部都在邊距，視為誤匹配
    if len(content_hits) == 1:
        return content_hits[0]
    scored = sorted(content_hits, key=lambda r: _year_score(page, r), reverse=True)
    return scored[0]


def _search_on_page(
    page: fitz.Page,
    value: float | int,
    key: str = "",
    source_text: str | None = None,
) -> list[float] | None:
    w = page.rect.width
    h = page.rect.height
    is_ratio = key in RATIO_KEYS

    # source_text（AI 回傳的原始字串）優先，再退回格式猜測
    candidates: list[str] = []
    if source_text:
        candidates.append(source_text)
    candidates.extend(_value_candidates(value, is_ratio=is_ratio))

    for candidate in candidates:
        hits = page.search_for(candidate, quads=False)
        if hits:
            r = _best_hit(page, hits)
            if r is None:
                continue  # 全在頁首/尾邊距，跳過這個候選字串
            return [
                round(r.x0 / w, 4),
                round(r.y0 / h, 4),
                round(r.x1 / w, 4),
                round(r.y1 / h, 4),
            ]
    return None


def _search_nearby(
    doc: fitz.Document,
    pdf_idx: int,
    value: float | int,
    key: str = "",
    source_text: str | None = None,
) -> tuple[list[float] | None, int]:
    """先搜目標頁，找不到再搜鄰近 ±2 頁。回傳 (bbox, 找到的 pdf_idx)。"""
    for delta in (0, 1, -1, 2, -2):
        idx = pdf_idx + delta
        if 0 <= idx < len(doc):
            bbox = _search_on_page(doc[idx], value, key, source_text=source_text)
            if bbox:
                return bbox, idx
    return None, pdf_idx


def fix_company(company: str) -> tuple[int, int, int]:
    """回傳 (fixed, not_found, skipped)。"""
    cache_path = CACHE_DIR / f"{company}_indicators.json"
    pdf_path   = PDF_DIR   / f"{company}_2023.pdf"

    if not pdf_path.exists():
        print(f"  [!] PDF 不存在：{pdf_path}")
        return 0, 0, 0

    with open(cache_path, encoding="utf-8") as f:
        data = json.load(f)

    meta        = data.get("_meta", {})
    page_offset = int(meta.get("page_offset", 0))
    indicators  = data["indicators"]

    doc         = fitz.open(str(pdf_path))
    total_pages = len(doc)

    # 建立邏輯頁 → 物理頁對照表（處理 2-up A3 等多頁格式）
    page_map = build_logical_to_physical_map(doc, page_offset)

    # compact_page_map：compact 1-indexed → 原始物理頁 1-indexed
    # 由 M1 Step 3 儲存，是 Gemini 實際看到的頁碼對應，比 GRI 解析更可靠
    compact_page_map: dict[int, int] = {
        int(k): int(v) for k, v in meta.get("compact_page_map", {}).items()
    }

    fixed = not_found = skipped = 0

    for key, ind in indicators.items():
        if not isinstance(ind, dict):
            skipped += 1
            continue
        if key in BOOLEAN_KEYS:
            skipped += 1
            continue

        value        = ind.get("value")
        source_page  = ind.get("source_page")
        source_text  = ind.get("source_text") or None
        compact_page = ind.get("_compact_page")

        if value is None or source_page is None:
            skipped += 1
            continue

        # ── 決定要搜尋的物理頁 ───────────────────────────────────────
        # 優先：_compact_page + compact_page_map（Gemini 實際讀到的頁，最可靠）
        # 退回：page_map[source_page]（GRI 解析，A3 2-up PDF 容易偏移）
        if compact_page and compact_page in compact_page_map:
            orig_phys_1idx = compact_page_map[compact_page]
            pdf_idx        = orig_phys_1idx - 1  # 0-indexed
            page_src_note  = f"compact p.{compact_page}→orig p.{orig_phys_1idx}"
        else:
            pdf_idx       = page_map.get(int(source_page))
            page_src_note = f"GRI 邏輯p.{source_page}"

        if pdf_idx is None or not (0 <= pdf_idx < total_pages):
            had = ind.get("bbox") is not None
            ind["bbox"]      = None
            ind["_pdf_page"] = None
            print(f"  [{key}] 無法對應物理頁（{page_src_note}）{'（已清除 AI bbox）' if had else ''}")
            not_found += 1
            continue

        correct_pdf_page = physical_0idx_to_pdf_page(pdf_idx)

        bbox, found_idx = _search_nearby(doc, pdf_idx, value, key, source_text=source_text)

        if bbox:
            old_bbox = ind.get("bbox")
            ind["bbox"]      = bbox
            ind["_pdf_page"] = physical_0idx_to_pdf_page(found_idx)
            page_note  = f"PDF[{found_idx}→p.{found_idx+1}]"
            marker = "✓ 更新" if old_bbox != bbox else "= 相同"
            print(f"  [{key}] {marker}  值={value}  [{page_src_note}]→{page_note}  {bbox}")
            fixed += 1
        else:
            had_ai_bbox = ind.get("bbox") is not None
            ind["bbox"]      = None
            ind["_pdf_page"] = correct_pdf_page
            tried = ([source_text] if source_text else []) + _value_candidates(value, key in RATIO_KEYS)[:3]
            suffix = "（已清除舊 AI bbox）" if had_ai_bbox else ""
            print(f"  [{key}] ✗ 找不到 '{value}' → 跳頁仍存 p.{correct_pdf_page}（嘗試：{tried}）{suffix}")
            not_found += 1

    doc.close()

    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    return fixed, not_found, skipped


def main() -> None:
    total_fixed = total_nf = total_sk = 0

    for company in COMPANIES:
        print(f"\n{'='*50}")
        print(f"  {company}")
        print(f"{'='*50}")
        f, nf, sk = fix_company(company)
        print(f"  → 更新 {f} 個 | 找不到 {nf} 個 | 跳過 {sk} 個")
        total_fixed += f
        total_nf += nf
        total_sk += sk

    print(f"\n{'='*50}")
    print(f"全部完成：更新 {total_fixed} 個 | 找不到 {total_nf} 個 | 跳過 {total_sk} 個")
    print("下一步：python scripts/preprocess_cache.py")


if __name__ == "__main__":
    main()
