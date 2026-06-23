import os
import json
from dotenv import load_dotenv
from google import genai
from google.genai import types
from data.esg_dataset import golden_dataset

# 1. 載入 .env 檔案中的環境變數
load_dotenv()

# 2. 確保有讀取到金鑰 (這行可留作除錯用)
if not os.environ.get("GEMINI_API_KEY"):
    raise ValueError("找不到 GEMINI_API_KEY！請檢查 .env 檔案是否設定正確。")

# 3. 初始化 Gemini 客戶端 (它會自動去抓 os.environ 裡面的金鑰)
client = genai.Client()

SYSTEM_PROMPT = """
你是一位資深的金融風險稽核員，專門評估金融保險業的 ESG（環境、社會、公司治理）潛在風險。
請根據使用者提供的企業文字片段，評估該企業的「風險曝露 (ExposureScore)」與「風險管理 (ManagementScore)」。

評分準則：
1. 風險曝露 (ExposureScore) - 範圍 0~100（分數越高代表該企業曝露在高風險環境、高碳排投融資、或漂綠風暴的風險越高）。
2. 風險管理 (ManagementScore) - 範圍 0~100（分數越高代表該企業具備完善的減碳方針、SBTi承諾、嚴格的授信審查與爭議處理能力）。

你必須嚴格以下列 JSON 格式回傳，不要包含任何額外的 Markdown 標籤或說明：
{
  "ExposureScore": 數字(0-100),
  "ManagementScore": 數字(0-100),
  "Reasoning": "簡短的繁體中文評分理據，說明為何給出此分數"
}
"""

def analyze_esg_risk(raw_text: str) -> dict:
    """發送文字給 Gemini，並確保回傳結構化的 JSON 評分資料"""
    response = client.models.generate_content(
        model='gemini-3.5-flash',
        contents=raw_text,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            # 強制要求模型回傳 JSON 物件
            response_mime_type="application/json",
            temperature=0.2 # 降低隨機性，確保評分標準一致
        ),
    )
    
    # 解析回傳的 JSON 字串
    return json.loads(response.text)

# 測試單筆資料
try:
    test_result = analyze_esg_risk(golden_dataset[0]["raw_text"])
    print("Gemini 測試成功！回傳結果：")
    print(json.dumps(test_result, indent=2, ensure_ascii=False))
except Exception as e:
    print(f"測試失敗，錯誤訊息: {e}")