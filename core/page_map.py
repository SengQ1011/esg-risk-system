"""
core/page_map.py

邏輯頁（印刷頁碼）↔ 物理頁（PDF page index）轉換工具。

問題背景：
  PDF 報告書有時把兩張 A4 排在一頁 A3 橫式輸出（2-up），
  GRI 索引記的是印刷頁碼（邏輯頁），直接當 PDF 頁碼會跳到錯誤位置。

解法：
  分析每頁物理寬度是否為 A4 寬的整數倍，
  藉此推算出「一張物理頁含幾個邏輯頁」，
  再建立完整的邏輯頁 → 物理頁對照表。
"""
from __future__ import annotations

import fitz  # PyMuPDF

A4_WIDTH_PT = 595.28  # A4 直式短邊（pt），2-up 偵測基準


def build_logical_to_physical_map(
    doc: fitz.Document,
    page_offset: int = 0,
) -> dict[int, int]:
    """
    建立印刷頁碼（1-based）→ 物理頁索引（0-based）的對照表。

    Args:
        doc:         已開啟的 PyMuPDF Document
        page_offset: 封面、目錄等無頁碼的物理頁數量
                     （這些頁跳過，不分配邏輯頁號）

    Returns:
        {printed_page: physical_0idx, ...}

    Example:
        中鋼 PDF：封面 1 頁 A4 + 82 頁 A3 2-up，page_offset=0
          → logical 1 = phys 0  (A4 封面)
          → logical 2,3 = phys 1  (A3，左右各一 A4)
          → logical 45 = phys 22
    """
    mapping: dict[int, int] = {}
    logical_page = 1

    for phys_idx, page in enumerate(doc):
        if phys_idx < page_offset:
            continue  # 跳過無頁碼的封面/目錄頁

        w = page.rect.width
        # 這張物理頁包含幾個邏輯 A4 頁面
        n_logical = max(1, round(w / A4_WIDTH_PT))

        for _ in range(n_logical):
            mapping[logical_page] = phys_idx
            logical_page += 1

    return mapping


def logical_to_physical_0idx(
    printed_page: int,
    mapping: dict[int, int],
) -> int | None:
    """印刷頁碼 (1-based) → 物理頁索引 (0-based)，找不到回傳 None。"""
    return mapping.get(printed_page)


def physical_0idx_to_pdf_page(phys_0idx: int) -> int:
    """物理頁索引 (0-based) → react-pdf 頁碼 (1-based)。"""
    return phys_0idx + 1
