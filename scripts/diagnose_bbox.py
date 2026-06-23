"""
scripts/diagnose_bbox.py

診斷 bbox 定位問題：
- 列出指定指標在該頁所有命中位置
- 顯示周圍文字上下文，幫助判斷 2022/2023 年度選取是否正確

用法：
    python -X utf8 scripts/diagnose_bbox.py
    python -X utf8 scripts/diagnose_bbox.py --company 南山人壽 --keys ghg_scope2 carbon_intensity
"""
import json
import sys
import argparse
from pathlib import Path

try:
    import fitz
except ImportError:
    sys.exit("請先安裝 PyMuPDF：pip install PyMuPDF")

sys.path.insert(0, str(Path(__file__).parent.parent))
from core.page_map import build_logical_to_physical_map
from scripts.fix_bbox_with_pymupdf import _value_candidates, RATIO_KEYS

ROOT      = Path(__file__).parent.parent
CACHE_DIR = ROOT / "data" / "cache"
PDF_DIR   = ROOT / "data" / "pdfs"

COMPANIES = ["台達電", "中鋼", "南山人壽"]


def diagnose_indicator(doc, page_map, key, ind, company):
    value       = ind.get("value")
    source_page = ind.get("source_page")
    current_pdf = ind.get("_pdf_page")

    if value is None or source_page is None:
        print(f"  [{key}] 跳過（value 或 source_page 為 null）")
        return

    pdf_idx = page_map.get(int(source_page))
    if pdf_idx is None:
        print(f"  [{key}] 邏輯頁 {source_page} 無法對應物理頁")
        return

    page = doc[pdf_idx]
    w, h = page.rect.width, page.rect.height

    print(f"\n  [{key}]  value={value}  邏輯p.{source_page} → PDF p.{pdf_idx+1}")
    print(f"  目前存的 _pdf_page={current_pdf}  bbox={ind.get('bbox')}")
    print(f"  ── 所有候選字串及命中位置 ──")

    is_ratio = key in RATIO_KEYS
    found_any = False

    for candidate in _value_candidates(value, is_ratio=is_ratio):
        hits = page.search_for(candidate, quads=False)
        if not hits:
            continue
        found_any = True
        print(f"    候選「{candidate}」→ {len(hits)} 個命中：")
        for i, r in enumerate(hits):
            nx = [round(r.x0/w,4), round(r.y0/h,4), round(r.x1/w,4), round(r.y1/h,4)]
            # 抓周圍文字（同一頁 ±20pt 高度範圍）
            clip = fitz.Rect(0, r.y0 - 20, w, r.y1 + 20)
            nearby = page.get_text("text", clip=clip).replace("\n", " ").strip()[:120]
            print(f"      [{i}] bbox={nx}")
            print(f"           context: {nearby!r}")

    if not found_any:
        print(f"    （所有候選格式均未命中）")


def run(companies, filter_keys):
    for company in companies:
        cache_path = CACHE_DIR / f"{company}_indicators.json"
        pdf_path   = PDF_DIR   / f"{company}_2023.pdf"
        if not pdf_path.exists():
            continue

        with open(cache_path, encoding="utf-8") as f:
            data = json.load(f)

        page_offset = int(data.get("_meta", {}).get("page_offset", 0))
        indicators  = data["indicators"]
        doc         = fitz.open(str(pdf_path))
        page_map    = build_logical_to_physical_map(doc, page_offset)

        print(f"\n{'='*60}")
        print(f"  {company}")
        print(f"{'='*60}")

        for key, ind in indicators.items():
            if not isinstance(ind, dict):
                continue
            if filter_keys and key not in filter_keys:
                continue
            if ind.get("value") is None:
                continue
            diagnose_indicator(doc, page_map, key, ind, company)

        doc.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--company", nargs="+", default=None)
    parser.add_argument("--keys",    nargs="+", default=None,
                        help="只診斷指定 key，例如 --keys ghg_scope2 carbon_intensity")
    args = parser.parse_args()

    companies   = args.company if args.company else COMPANIES
    filter_keys = set(args.keys) if args.keys else None

    run(companies, filter_keys)
