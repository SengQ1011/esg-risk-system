# frontend/app.py
import streamlit as st
import pandas as pd
import requests
import sys
import os
import time

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from data.esg_dataset import golden_dataset
from data.crawler import fetch_esg_news

# 設定後端 API 的位址
API_BASE_URL = "http://localhost:8000"

st.set_page_config(page_title="ESG-RISK 1.0", page_icon="🌍", layout="wide")
st.title("🌍 金融業 ESG 風險評分系統 (ESG-RISK 1.0)")
st.markdown("這是一個為金融機構設計的 AI 輔助決策原型，透過分析非結構化文本，量化企業的潛在 ESG 風險。")
st.divider()

# --- 側邊欄：設定區 ---
st.sidebar.header("設定區")

data_source = st.sidebar.radio("資料來源", ["使用內建測試資料", "即時爬取網路新聞"])

# 初始化變數
company_to_analyze = ""
industry_to_analyze = "金融保險業" 
text_to_analyze = ""

if data_source == "使用內建測試資料":
    company_names = [comp["company_name"] for comp in golden_dataset]
    selected_company = st.sidebar.selectbox("請選擇測試企業：", company_names)
    target_data = next(item for item in golden_dataset if item["company_name"] == selected_company)
    
    company_to_analyze = target_data["company_name"]
    text_to_analyze = target_data["raw_text"]
    st.sidebar.markdown("### 內建資料片段：")
    st.sidebar.info(text_to_analyze)

elif data_source == "即時爬取網路新聞":
    manual_company_name = st.sidebar.text_input("輸入真實企業名稱 (例如: 富邦金, 台積電):", "")
    company_to_analyze = manual_company_name if manual_company_name else "某企業"
    st.sidebar.caption("💡 提示：輸入名稱後，點擊右側按鈕即可一鍵完成爬蟲與 AI 分析。")

# --- 主畫面：執行自動化流程 ---
if st.button("🚀 執行 AI 風險評估", type="primary"):
    if data_source == "即時爬取網路新聞" and not manual_company_name:
        st.warning("請先在左側選單輸入真實企業名稱！")
    else:
        # 使用 st.status 呈現多步驟的處理狀態
        with st.status("啟動自動化風險評估流程...", expanded=True) as status:
            try:
                # 階段 1：動態爬蟲 (僅限選擇網路新聞時執行)
                if data_source == "即時爬取網路新聞":
                    st.write(f"🔍 正在 Google News 搜尋 `{company_to_analyze}` 的最新爭議/ESG新聞...")
                    text_to_analyze = fetch_esg_news(company_to_analyze)
                    st.write("✅ 新聞爬取完成！")
                    
                    # 將爬到的文本顯示在畫面上供審閱
                    with st.expander("展開查看爬取到的新聞文本"):
                        st.info(text_to_analyze)
                else:
                    st.write("✅ 載入內建測試文本完成！")

                # 階段 2：後端 API 與 AI 分析
                st.write("🧠 正在將文本傳送至後端 API 進行 Gemini AI 語意解析...")
                payload = {
                    "company_name": company_to_analyze,
                    "industry": industry_to_analyze,
                    "raw_text": text_to_analyze
                }
                
                response = requests.post(f"{API_BASE_URL}/api/analyze", json=payload)
                response.raise_for_status() 
                result = response.json()["data"]
                
                st.write("💾 評分結果已寫入關聯式資料庫！")
                status.update(label="✅ 風險評估完成！", state="complete", expanded=False)

            except requests.exceptions.RequestException as e:
                status.update(label="❌ 系統連線錯誤", state="error")
                st.error(f"無法連線至後端 API，錯誤細節：{e}")
                st.stop() # 停止執行後續繪圖邏輯
            except Exception as e:
                status.update(label="❌ 分析過程發生未預期錯誤", state="error")
                st.error(str(e))
                st.stop()

        # --- 視覺化呈現成果 ---
        st.success(f"**{company_to_analyze}** 的 ESG 風險分析報告已產出：")
        
        col1, col2, col3 = st.columns(3)
        col1.metric("最終風險總分 (Final Risk)", result["final_score"], delta_color="inverse")
        col2.metric("風險曝露分數 (Exposure)", result["exposure_score"])
        col3.metric("風險管理能力 (Management)", result["management_score"])
        
        st.subheader("🤖 AI 評分理據 (Reasoning)")
        st.write(result["reasoning"])
        
        st.subheader("📊 風險維度對比")
        chart_data = pd.DataFrame({
            "分數": [result["exposure_score"], result["management_score"]],
            "維度": ["風險曝露 (低較好)", "管理能力 (高較好)"]
        }).set_index("維度")
        st.bar_chart(chart_data)

# --- 歷史紀錄追蹤區塊 ---
st.divider()
st.subheader(f"📂 {company_to_analyze} - 歷史評分紀錄")

if company_to_analyze and company_to_analyze != "某企業":
    try:
        history_response = requests.get(f"{API_BASE_URL}/api/history/{company_to_analyze}", params={"industry": industry_to_analyze})
        history_response.raise_for_status()
        history_data = history_response.json()["data"]

        if history_data:
            formatted_history = [
                {
                    "評估時間": pd.to_datetime(record["timestamp"]).strftime("%Y-%m-%d %H:%M:%S"),
                    "總風險分": record["final_score"],
                    "風險曝露": record["exposure_score"],
                    "管理能力": record["management_score"],
                    "AI 評分理據": record["reasoning"]
                }
                for record in history_data
            ]
            
            df_history = pd.DataFrame(formatted_history)
            st.dataframe(df_history, use_container_width=True)
            
            if len(history_data) > 1:
                st.line_chart(df_history.set_index("評估時間")["總風險分"])
        else:
            st.info("目前尚無歷史評分紀錄。")
    except requests.exceptions.RequestException:
        st.warning("無法取得歷史紀錄，請確認 FastAPI 後端已啟動。")