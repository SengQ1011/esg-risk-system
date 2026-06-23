# data/crawler.py
import requests
from bs4 import BeautifulSoup
import urllib.parse

def fetch_esg_news(company_name: str, max_items: int = 5) -> str:
    """
    爬取 Google News 上關於特定公司的 ESG 或爭議相關新聞。
    """
    # 設定搜尋關鍵字：公司名稱 + ESG 或 爭議 或 裁罰 等關鍵字
    query = f'"{company_name}" (ESG OR 永續 OR 綠能 OR 爭議 OR 裁罰 OR 弊案)'
    encoded_query = urllib.parse.quote(query)
    
    # Google News RSS 網址 (設定地區為台灣，語言為繁體中文)
    rss_url = f"https://news.google.com/rss/search?q={encoded_query}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"
    
    try:
        # 發送 HTTP 請求
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
        response = requests.get(rss_url, headers=headers, timeout=10)
        response.raise_for_status()
        
        # 使用 BeautifulSoup 解析 XML
        soup = BeautifulSoup(response.content, 'xml')
        items = soup.find_all('item')
        
        if not items:
            return f"近期無「{company_name}」的重大 ESG 或爭議新聞。"
        
        # 整理爬取到的新聞資料
        news_list = []
        for item in items[:max_items]:
            title = item.title.text
            pub_date = item.pubDate.text
            # 將標題與時間組合為純文字，方便 LLM 閱讀
            news_list.append(f"【新聞】{title} (發布時間: {pub_date})")
            
        return "\n".join(news_list)
        
    except Exception as e:
        return f"爬取新聞時發生錯誤: {e}"

# 簡單的單元測試 (直接執行此檔案時會觸發)
if __name__ == "__main__":
    print("正在測試爬取「國泰金」的 ESG 新聞...\n")
    print(fetch_esg_news("國泰金"))