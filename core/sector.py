"""
產業分類模組 — 將公司 industry 字串對應至 sector_normalization key

分類優先順序：
  semiconductor → heavy_industry → financial_services → default

sector key 對應 config/weights.yaml sector_normalization 的頂層 key；
若無對應則回傳 'default'（使用全域 normalization 預設值）。
"""

_SECTOR_KEYWORDS: list[tuple[str, list[str]]] = [
    (
        "semiconductor",
        ["半導體", "晶圓", "積體電路", "tsmc", "台積", "聯電", "umc",
         "ic 設計", "ic設計", "封裝測試", "先進製程"],
    ),
    (
        "heavy_industry",
        ["鋼鐵", "鋼", "水泥", "石化", "煉油", "造紙", "金屬",
         "煤", "鋁", "銅", "冶煉", "焦炭", "化工",
         "塑膠", "橡膠", "纖維", "紡織", "玻璃"],
    ),
    (
        "financial_services",
        ["銀行", "保險", "壽險", "產險", "金融", "證券",
         "投信", "資產管理", "期貨", "租賃"],
    ),
]


def classify_sector(industry: str, company_name: str = "") -> str:
    """
    根據 industry 欄位和公司名稱，回傳對應的 sector key。

    Args:
        industry:     ESG 報告書中的產業描述（可能為中文或英文）
        company_name: 公司名稱（輔助判斷，優先順序低於 industry）

    Returns:
        "semiconductor" | "heavy_industry" | "financial_services" | "default"
    """
    text = (industry + " " + company_name).lower()
    for sector_key, keywords in _SECTOR_KEYWORDS:
        if any(kw in text for kw in keywords):
            return sector_key
    return "default"
