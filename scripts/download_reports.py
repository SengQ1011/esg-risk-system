"""
自動下載三家 Demo 公司的永續報告書 PDF

執行方式（在專案根目錄）：
  python scripts/download_reports.py
"""

import sys
import time
from pathlib import Path
import requests

sys.stdout.reconfigure(encoding="utf-8")

PDF_DIR = Path(__file__).parent.parent / "data" / "pdfs"
PDF_DIR.mkdir(parents=True, exist_ok=True)

REPORTS = [
    {
        "company": "台達電",
        "ticker": "2308",
        "year": 2023,
        "url": "https://filecenter.deltaww.com/about/download/2023_Delta_ESG_Report_CH.pdf",
        "filename": "台達電_2023.pdf",
    },
    {
        "company": "中鋼",
        "ticker": "2002",
        "year": 2023,
        "url": "https://www.csc.com.tw/csc/esg/pdf/hr-2023.pdf",
        "filename": "中鋼_2023.pdf",
    },
    {
        "company": "南山人壽",
        "ticker": "5874",
        "year": 2023,
        "url": "https://www.nanshanlife.com.tw/nanshanlife/portal-api/File/7998",
        "filename": "南山人壽_2023.pdf",
    },
]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/pdf,*/*",
}


def _do_download(url: str, dest: Path, verify_ssl: bool = True) -> bool:
    import urllib3
    if not verify_ssl:
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    resp = requests.get(
        url,
        headers=HEADERS,
        timeout=120,
        stream=True,
        allow_redirects=True,
        verify=verify_ssl,
    )
    resp.raise_for_status()

    content_type = resp.headers.get("Content-Type", "")
    if "pdf" not in content_type.lower() and "octet-stream" not in content_type.lower():
        print(f"  [警告] Content-Type 非 PDF：{content_type}")

    total = int(resp.headers.get("Content-Length", 0))
    downloaded = 0
    with open(dest, "wb") as f:
        for chunk in resp.iter_content(chunk_size=65536):
            f.write(chunk)
            downloaded += len(chunk)
            if total:
                pct = downloaded / total * 100
                print(f"\r  進度：{pct:.1f}%  ({downloaded//1024} KB)", end="", flush=True)
    print()
    return True


def download_pdf(report: dict) -> Path | None:
    dest = PDF_DIR / report["filename"]
    if dest.exists():
        print(f"  已存在，跳過下載：{dest.name}")
        return dest

    print(f"  下載中：{report['url']}")
    try:
        _do_download(report["url"], dest, verify_ssl=True)
    except requests.exceptions.SSLError:
        print("  [SSL 驗證失敗] 跳過憑證驗證重試...")
        try:
            _do_download(report["url"], dest, verify_ssl=False)
        except requests.RequestException as e:
            print(f"  [失敗] {e}")
            if dest.exists():
                dest.unlink()
            return None
    except requests.RequestException as e:
        print(f"  [失敗] {e}")
        if dest.exists():
            dest.unlink()
        return None

    size_kb = dest.stat().st_size // 1024
    print(f"  完成：{dest.name}  ({size_kb} KB)")
    return dest


def main():
    print("=== 永續報告書 PDF 下載 ===")
    print(f"儲存目錄：{PDF_DIR}\n")

    results = {}
    for report in REPORTS:
        print(f"[{report['company']} {report['ticker']}] {report['year']} 年報告書")
        path = download_pdf(report)
        results[report["company"]] = path
        time.sleep(1)

    print("\n=== 下載結果 ===")
    for company, path in results.items():
        status = f"OK  {path}" if path else "FAIL"
        print(f"  {company}: {status}")

    failed = [c for c, p in results.items() if p is None]
    if failed:
        print(f"\n[注意] {len(failed)} 家公司下載失敗：{failed}")
        print("請手動下載後放入 data/pdfs/ 並依照 filename 命名")
    else:
        print("\n全部下載成功！可執行：python scripts/extract_indicators_m1.py")


if __name__ == "__main__":
    main()
