"""
M4 透明評分引擎

輸入：indicators dict（M1 輸出）+ news_event_score（M2）+ greenwash_flag（M3）
輸出：E/S/G 子分、總分、等級、逐指標貢獻拆解

正規化方向：
  越低越好（碳排/傷害/違規）：normalized = max(0, 1 - value / max_ref)
  越高越好（再生能源/女性比例）：normalized = min(1, value / max_ref)
  布林值：1.0 = true，0.0 = false
"""

import yaml
from pathlib import Path

_CONFIG_PATH = Path(__file__).parent.parent / "config" / "weights.yaml"

_LOWER_IS_BETTER = {
    "ghg_scope1", "ghg_scope2", "ghg_scope3", "carbon_intensity",
    "electricity", "water", "waste",
    "injury_rate", "turnover",
    "violations",
}

_HIGHER_IS_BETTER = {
    "renewable_ratio",
    "female_ratio", "female_mgmt_ratio", "training_hours",
    "independent_director_ratio", "female_director_ratio",
}

_BOOLEAN_INDICATORS = {
    "has_sustainability_officer", "assurance",
}


def _load_config() -> dict:
    with open(_CONFIG_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def _normalize(key: str, value: float | None, norm_cfg: dict) -> float | None:
    if value is None:
        return None

    if key in _BOOLEAN_INDICATORS:
        return 1.0 if value else 0.0

    max_key = f"{key}_max"
    max_ref = norm_cfg.get(max_key)
    if max_ref is None or max_ref == 0:
        return None

    if key in _LOWER_IS_BETTER:
        return max(0.0, 1.0 - value / max_ref)
    if key in _HIGHER_IS_BETTER:
        return min(1.0, value / max_ref)

    return None


def _score_dimension(
    indicators: dict,
    weights: dict,
    norm_cfg: dict,
    dimension_name: str,
) -> tuple[float, list[dict]]:
    """
    回傳 (dimension_score_0_to_100, breakdown_list)

    Null 處理：Weight Redistribution — 缺漏指標不計入分母，
    讓分數反映「已揭露資料」而非懲罰未揭露。
    UI 應顯示「基於 N/M 個指標」讓用戶知道缺漏情形。
    """
    available_weight = 0.0
    weighted_sum = 0.0
    breakdown = []

    for key, weight in weights.items():
        raw_indicator = indicators.get(key)
        if isinstance(raw_indicator, dict):
            raw_value   = raw_indicator.get("value")
            source_page = raw_indicator.get("source_page")
            pdf_page    = raw_indicator.get("_pdf_page")   # 物理頁碼，PyMuPDF 確認
            unit        = raw_indicator.get("unit")
            confidence  = raw_indicator.get("confidence", 1.0)
            # bbox 可能是單一 [x0,y0,x1,y1] 或多個 [[x0,y0,x1,y1], ...]
            # 統一正規化為 list of lists，方便前端迭代渲染
            _raw_bbox = raw_indicator.get("bbox")
            if _raw_bbox is None:
                bbox = None
            elif isinstance(_raw_bbox[0], (int, float)):
                bbox = [_raw_bbox]          # 舊格式：升級為 list of lists
            else:
                bbox = _raw_bbox            # 新格式：已是 list of lists
        else:
            raw_value   = raw_indicator
            source_page = None
            pdf_page    = None
            bbox        = None
            unit        = None
            confidence  = 1.0 if raw_indicator is not None else 0.0

        normalized = _normalize(key, raw_value, norm_cfg)
        missing = normalized is None

        if not missing:
            contribution = normalized * weight
            weighted_sum += contribution
            available_weight += weight
        else:
            normalized = None
            contribution = 0.0

        breakdown.append({
            "key": key,
            "raw_value": raw_value,
            "unit": unit,
            "source_page": source_page,
            "pdf_page": pdf_page,
            "bbox": bbox,
            "confidence": confidence,
            "normalized": round(normalized, 4) if normalized is not None else None,
            "weight": weight,
            "contribution": round(contribution, 4),
            "missing": missing,
        })

    score = (weighted_sum / available_weight) * 100 if available_weight > 0 else 0.0
    return round(score, 2), breakdown


def calculate_esg_score(
    indicators: dict,
    news_event_score: float = 0.0,
    greenwash_flag: bool = False,
) -> dict:
    """
    主入口。

    Args:
        indicators: 各 key 對應數值（或 {"value": ..., "source_page": ...} dict）
        news_event_score: M2 輸出，0~1，越高代表負面新聞越嚴重
        greenwash_flag: M3 輸出，True 代表偵測到漂綠矛盾

    Returns:
        {
          "e_score": float,
          "s_score": float,
          "g_score": float,
          "total_score": float,
          "grade": str,
          "news_event_score": float,
          "greenwash_flag": bool,
          "penalties": dict,
          "breakdown": {"E": [...], "S": [...], "G": [...]}
        }
    """
    cfg = _load_config()
    norm_cfg = cfg["normalization"]
    event_cfg = cfg["events"]
    dim_weights = cfg["dimensions"]

    e_score, e_breakdown = _score_dimension(
        indicators, cfg["E_indicators"], norm_cfg, "E"
    )
    s_score, s_breakdown = _score_dimension(
        indicators, cfg["S_indicators"], norm_cfg, "S"
    )
    g_score, g_breakdown = _score_dimension(
        indicators, cfg["G_indicators"], norm_cfg, "G"
    )

    raw_total = (
        e_score * dim_weights["E"]
        + s_score * dim_weights["S"]
        + g_score * dim_weights["G"]
    )

    news_penalty = news_event_score * event_cfg["news_max_penalty"]
    greenwash_penalty = event_cfg["greenwash_penalty"] if greenwash_flag else 0.0
    total_penalty = news_penalty + greenwash_penalty

    total_score = max(0.0, min(100.0, raw_total - total_penalty))

    grade = _to_grade(total_score, cfg["grade_thresholds"])

    return {
        "e_score": e_score,
        "s_score": s_score,
        "g_score": g_score,
        "total_score": round(total_score, 2),
        "grade": grade,
        "news_event_score": news_event_score,
        "greenwash_flag": greenwash_flag,
        "penalties": {
            "news_penalty": round(news_penalty, 2),
            "greenwash_penalty": round(greenwash_penalty, 2),
            "total_penalty": round(total_penalty, 2),
            "raw_total_before_penalty": round(raw_total, 2),
        },
        "breakdown": {
            "E": e_breakdown,
            "S": s_breakdown,
            "G": g_breakdown,
        },
    }


def _to_grade(score: float, thresholds: dict) -> str:
    if score >= thresholds["A"]:
        return "A"
    if score >= thresholds["B+"]:
        return "B+"
    if score >= thresholds["B"]:
        return "B"
    if score >= thresholds["B-"]:
        return "B-"
    return "C"
