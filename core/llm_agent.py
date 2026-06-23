"""
M1 指標抽取模組（離線預處理用，demo 當天不執行）

使用方式：在 scripts/ 內的預處理腳本中呼叫，不在 API endpoint 裡使用。
"""

import json
import os
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise ValueError("找不到 GEMINI_API_KEY，請檢查 .env 設定")

client = genai.Client()

INDICATOR_EXTRACTION_PROMPT = """
你是一位專業的 ESG 資料分析師，負責從企業永續報告書中抽取量化指標。

請根據提供的報告內容，抽取以下指標。找不到的填 null，不要臆測或估算。

目標指標（依 GRI/SASB 框架）：
E 構面：
- ghg_scope1：範疇一溫室氣體排放（公噸CO2e）
- ghg_scope2：範疇二溫室氣體排放（公噸CO2e）
- ghg_scope3：範疇三溫室氣體排放（公噸CO2e）
- carbon_intensity：碳強度/每百萬元營收碳排（公噸CO2e/百萬元）
- electricity：總用電量（度/kWh）
- renewable_ratio：再生能源占比（%）
- water：用水量（立方公尺）
- waste：廢棄物總量（公噸）

S 構面：
- injury_rate：失能傷害頻率/TRIR（比率）
- turnover：員工流動率（%）
- female_ratio：女性員工比例（%）
- female_mgmt_ratio：女性主管比例（%）
- training_hours：員工平均訓練時數（小時/人/年）

G 構面：
- independent_director_ratio：獨立董事比例（%）
- female_director_ratio：女性董事比例（%）
- has_sustainability_officer：是否設永續長或永續委員會（true/false）
- assurance：報告是否取得第三方確信（true/false）
- violations：重大違規或裁罰次數（次）

回傳格式必須是以下 JSON，每個指標包含 value、unit、source_page、confidence：
{
  "ghg_scope1": {"value": 數字或null, "unit": "公噸CO2e", "source_page": 頁碼或null, "confidence": 0.0~1.0},
  ...
}
"""

NEWS_SCORING_PROMPT = """
你是一位 ESG 風險分析師，負責評估企業的負面新聞事件風險。

請根據提供的新聞標題和摘要清單，完成以下任務：
1. 分類每則新聞的事件類別（環境污染、勞工違規、治理缺失、產品安全、其他）
2. 評估嚴重度（low / medium / high / critical）
3. 計算整體 news_event_score（0~1，仿 TESG ERS 邏輯：強度 × 時間衰減）
4. 判斷是否有漂綠（greenwash）嫌疑

回傳 JSON 格式：
{
  "events": [
    {
      "title": "新聞標題",
      "date": "YYYY-MM-DD",
      "category": "類別",
      "severity": "low|medium|high|critical",
      "intensity": 0.0~1.0
    }
  ],
  "news_event_score": 0.0~1.0,
  "greenwash_flag": true|false,
  "greenwash_reasons": ["說明1", "說明2"]
}
"""


def extract_indicators_from_text(report_text: str) -> dict:
    """從報告書文字抽取 E/S/G 量化指標（離線預處理用）"""
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=report_text,
        config=types.GenerateContentConfig(
            system_instruction=INDICATOR_EXTRACTION_PROMPT,
            response_mime_type="application/json",
            temperature=0.1,
        ),
    )
    return json.loads(response.text)


def score_news_events(news_items: list[dict]) -> dict:
    """對新聞事件清單進行 ERS 式評分（離線預處理用）"""
    contents = json.dumps(news_items, ensure_ascii=False)
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=NEWS_SCORING_PROMPT,
            response_mime_type="application/json",
            temperature=0.1,
        ),
    )
    return json.loads(response.text)
