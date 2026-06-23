def calculate_final_risk(exposure: float, management: float) -> float:
    """
    依據系統設計文件 (Design Document) 定義的核心公式計算 Final Risk Score
    公式: Final_Risk_Score = α * Exposure + β * (100 - Management)
    其中 α = 0.6, β = 0.4。將管理能力的百分比轉換為風險值。
    """
    alpha = 0.6
    beta = 0.4
    final_score = (alpha * exposure) + (beta * (100 - management))
    return round(final_score, 2)