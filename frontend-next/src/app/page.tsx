"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ExternalLink,
  Link2,
  Loader2,
  Search,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { analyzeCompany, deleteCompany, searchCompanyPdf } from "@/lib/api"
import type { PdfCandidate, SearchPdfResult } from "@/lib/api"
import type { CompanySummary } from "@/lib/types"

// ─────────────────────────────────────────────────────────────
// CompanyCard (same visual style as before)
// ─────────────────────────────────────────────────────────────
type Signal = "green" | "yellow" | "red"

function deriveSignal(score: number | null): Signal {
  if (score == null) return "yellow"
  return score >= 70 ? "green" : score >= 50 ? "yellow" : "red"
}

const signalConfig = {
  green:  { label: "低風險", dot: "bg-green-500", text: "text-green-600",  ring: "ring-green-500/30"  },
  yellow: { label: "中風險", dot: "bg-amber-500", text: "text-amber-500",  ring: "ring-amber-500/40"  },
  red:    { label: "高風險", dot: "bg-red-500",   text: "text-red-600",    ring: "ring-red-500/30"    },
} as const

const gradeColor: Record<string, string> = {
  A:    "text-green-700 bg-green-50 border-green-200",
  "B+": "text-emerald-700 bg-emerald-50 border-emerald-200",
  B:    "text-yellow-700 bg-yellow-50 border-yellow-200",
  "B-": "text-orange-700 bg-orange-50 border-orange-200",
  C:    "text-red-700 bg-red-50 border-red-200",
}

function CompanyCard({ c, onDelete }: { c: CompanySummary; onDelete: () => void }) {
  const s      = c.latest_score
  const signal = deriveSignal(s?.total_score ?? null)
  const cfg    = signalConfig[signal]
  const gCls   = gradeColor[s?.grade ?? ""] ?? "text-gray-700 bg-gray-50 border-gray-200"
  const [deleting, setDeleting] = useState(false)

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`確定要刪除「${c.name}」的所有評分紀錄嗎？`)) return
    setDeleting(true)
    try {
      await deleteCompany(c.name)
      onDelete()
    } catch {
      setDeleting(false)
    }
  }

  return (
    <div className="group relative">
      <button
        onClick={handleDelete}
        disabled={deleting}
        className="absolute right-2 top-2 z-10 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
        title="刪除紀錄"
      >
        <Trash2 className="size-3.5" />
      </button>
    <Link href={`/company/${encodeURIComponent(c.name)}`} className="block">
      <Card className="h-full transition-all hover:shadow-md hover:ring-1 hover:ring-primary/20">
        <CardContent className="flex h-full flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Building2 className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground group-hover:text-primary">
                  {c.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {c.ticker} · {c.industry}
                </p>
              </div>
            </div>
            {s?.grade && (
              <Badge variant="outline" className={cn("shrink-0 font-bold", gCls)}>
                {s.grade}
              </Badge>
            )}
          </div>

          {s ? (
            <div className="flex items-end justify-between gap-2">
              <div>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold tabular-nums">{s.total_score?.toFixed(1)}</span>
                  <span className="text-sm text-muted-foreground">/100</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.grade_label}</p>
              </div>
              <div className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 ring-1 ring-inset", cfg.ring)}>
                <span className="relative flex size-2.5">
                  <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", cfg.dot)} />
                  <span className={cn("relative inline-flex size-2.5 rounded-full", cfg.dot)} />
                </span>
                <span className={cn("text-xs font-medium", cfg.text)}>{cfg.label}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">尚無評分資料</p>
          )}

          {s && (
            <div className="grid grid-cols-3 gap-1.5 rounded-lg border bg-muted/30 p-2.5 text-center">
              {[
                { label: "E 環境", score: s.e_score, weight: "40%" },
                { label: "S 社會", score: s.s_score, weight: "30%" },
                { label: "G 治理", score: s.g_score, weight: "30%" },
              ].map(({ label, score, weight }) => (
                <div key={label}>
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className={cn(
                    "text-base font-bold tabular-nums",
                    score != null && score >= 70 ? "text-green-600"
                    : score != null && score >= 50 ? "text-amber-500"
                    : "text-red-600",
                  )}>
                    {score?.toFixed(1) ?? "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground/60">{weight}</p>
                </div>
              ))}
            </div>
          )}

          <div className="mt-auto flex items-center justify-end gap-1 text-xs text-muted-foreground group-hover:text-primary">
            查看完整評分卡 <ArrowRight className="size-3" />
          </div>
        </CardContent>
      </Card>
    </Link>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// AnalyzeForm — 多步驟：搜尋 → 候選清單 → PDF 預覽確認 → 分析
// ─────────────────────────────────────────────────────────────
const CURRENT_YEAR = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i)
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

type FormStep =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "picking"; candidates: PdfCandidate[]; companyName: string; year: number }
  | { kind: "previewing"; candidate: PdfCandidate; candidates: PdfCandidate[]; companyName: string; year: number }
  | { kind: "submitting" }

function proxyUrl(candidate: PdfCandidate): string {
  if (candidate.local) {
    // candidate.url 已經是 "/api/proxy-pdf?path=filename.pdf"
    return `${BASE_URL}${candidate.url}`
  }
  return `${BASE_URL}/api/proxy-pdf?url=${encodeURIComponent(candidate.url)}`
}

function AnalyzeForm() {
  const router      = useRouter()
  const [step, setStep]         = useState<FormStep>({ kind: "idle" })
  const [query, setQuery]       = useState("")
  const [year,  setYear]        = useState(CURRENT_YEAR - 1)
  const [file,  setFile]        = useState<File | null>(null)
  const [reportUrl, setReportUrl] = useState("")
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error,  setError]      = useState<string | null>(null)
  const [iframeError, setIframeError] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // previewing 換候選時重置 iframe 錯誤狀態，並對遠端 URL 做 pre-flight 檢查
  const previewUrl = step.kind === "previewing" ? proxyUrl(step.candidate) : null
  const previewIsLocal = step.kind === "previewing" ? step.candidate.local : false
  useEffect(() => {
    setIframeError(false)
    if (!previewUrl || previewIsLocal) return
    // 遠端 URL 透過 proxy：先確認 proxy 能拿到 PDF
    const ctrl = new AbortController()
    fetch(previewUrl, { signal: ctrl.signal, method: "GET", headers: { Range: "bytes=0-1023" } })
      .then((r) => {
        if (!r.ok) setIframeError(true)
        const ct = r.headers.get("content-type") ?? ""
        if (!ct.includes("pdf") && !ct.includes("octet-stream")) setIframeError(true)
      })
      .catch(() => {}) // abort = 正常，網路錯誤讓 onError 處理
    return () => ctrl.abort()
  }, [previewUrl, previewIsLocal])

  function reset() {
    setStep({ kind: "idle" })
    setFile(null)
    setReportUrl("")
    setError(null)
    setIframeError(false)
  }

  async function handleSubmit() {
    const raw  = query.trim()
    const url  = reportUrl.trim()

    if (!raw && !file && !url) {
      setError("請輸入公司名稱 / 股票代號、貼上報告書網址，或上傳 PDF")
      return
    }
    setError(null)

    // 從輸入解析 ticker（4位數字）和公司名稱
    // 支援：「2330」、「台積電 2330」、「台積電」
    const tickerMatch = raw.match(/\b(\d{4,5})\b/)
    const ticker = tickerMatch ? tickerMatch[1] : ""
    // 名稱：若輸入含非數字字元則取整段，否則用 ticker 當公司名（pipeline 會辨識）
    const name = raw.replace(/\b\d{4,5}\b/, "").trim() || raw

    // 有 file 或 URL → 直接送分析（不需確認）
    if (file || url) {
      setStep({ kind: "submitting" })
      try {
        const res = await analyzeCompany(name, file ?? undefined, url || undefined, year)
        const p = res.company_name ? `?company=${encodeURIComponent(res.company_name)}` : ""
        router.push(`/job/${res.job_id}${p}`)
      } catch (e) {
        setError(e instanceof Error ? e.message : "發生未知錯誤")
        setStep({ kind: "idle" })
      }
      return
    }

    // 只有名稱/ticker → 先搜尋候選 PDF，讓用戶確認
    setStep({ kind: "searching" })
    try {
      const result = await searchCompanyPdf(name || ticker, year, ticker)
      if (result.candidates.length === 0) {
        setError(result.hint || "找不到報告書，請手動上傳 PDF 或貼上網址")
        setStep({ kind: "idle" })
        return
      }
      setStep({ kind: "picking", candidates: result.candidates, companyName: name || ticker, year })
    } catch (e) {
      setError(e instanceof Error ? e.message : "搜尋失敗")
      setStep({ kind: "idle" })
    }
  }

  async function handleConfirm(candidate: PdfCandidate, companyName: string, yr: number) {
    setStep({ kind: "submitting" })
    try {
      const res = await analyzeCompany(companyName, undefined, candidate.local ? undefined : candidate.url, yr)
      const p = res.company_name ? `?company=${encodeURIComponent(res.company_name)}` : ""
      router.push(`/job/${res.job_id}${p}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析失敗")
      setStep({ kind: "idle" })
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped?.type === "application/pdf") setFile(dropped)
  }

  const isSubmitting = step.kind === "submitting"
  const isSearching  = step.kind === "searching"

  // ── 步驟：候選清單 ───────────────────────────────────────────
  if (step.kind === "picking") {
    const { candidates, companyName, year: yr } = step
    return (
      <Card className="border-primary/20 shadow-sm">
        <CardContent className="flex flex-col gap-4 p-6">
          <div className="flex items-center gap-2">
            <button onClick={reset} className="rounded p-1 text-muted-foreground hover:text-foreground">
              <ChevronLeft className="size-4" />
            </button>
            <h3 className="text-sm font-semibold">找到 {candidates.length} 份候選報告書 — 請選擇預覽</h3>
          </div>
          <div className="flex flex-col gap-2">
            {candidates.map((c, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                <span className="flex-1 truncate text-muted-foreground" title={c.label}>
                  {c.local ? "📁 " : "🌐 "}{c.label}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setStep({ kind: "previewing", candidate: c, candidates, companyName, year: yr })}
                >
                  預覽
                </Button>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">若以上均非正確報告書，請</p>
          <Button variant="ghost" size="sm" className="self-start" onClick={reset}>
            <UploadCloud className="mr-1.5 size-3.5" /> 改用手動上傳
          </Button>
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="size-4 shrink-0" />{error}
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  // ── 步驟：PDF 預覽確認 ───────────────────────────────────────
  if (step.kind === "previewing") {
    const { candidate, candidates, companyName, year: yr } = step
    const pUrl = proxyUrl(candidate)

    return (
      <Card className="border-primary/20 shadow-sm">
        <CardContent className="flex flex-col gap-4 p-6">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setStep({ kind: "picking", candidates, companyName, year: yr })}
              className="rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-4" />
            </button>
            <h3 className="text-sm font-semibold">確認這是 {companyName} {yr} 年的永續報告書？</h3>
          </div>

          {/* PDF 預覽 iframe，失敗時顯示 fallback */}
          <div className="relative overflow-hidden rounded-lg border bg-muted" style={{ height: 480 }}>
            {iframeError ? (
              <div className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
                <AlertTriangle className="size-8 text-amber-500" />
                <p className="font-medium text-foreground">無法在此預覽</p>
                <p className="text-xs">網站可能有 bot 防護或不允許嵌入。<br/>請點下方連結在新分頁確認是否為正確的報告書。</p>
                <a
                  href={candidate.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs text-primary hover:bg-muted"
                >
                  <ExternalLink className="size-3" />在新分頁開啟 PDF
                </a>
              </div>
            ) : (
              <iframe
                key={pUrl}
                src={pUrl}
                className="size-full"
                title="PDF 預覽"
                onError={() => setIframeError(true)}
              />
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              className="flex-1"
              onClick={() => handleConfirm(candidate, companyName, yr)}
              disabled={isSubmitting}
            >
              {isSubmitting
                ? <><Loader2 className="mr-1.5 size-4 animate-spin" />分析中…</>
                : <><Check className="mr-1.5 size-4" />是，開始分析</>}
            </Button>
            <Button
              variant="outline"
              onClick={() => setStep({ kind: "picking", candidates, companyName, year: yr })}
            >
              返回清單
            </Button>
            <Button variant="ghost" onClick={reset}>
              <UploadCloud className="mr-1.5 size-3.5" />手動上傳
            </Button>
          </div>
          {!candidate.local && !iframeError && (
            <a
              href={candidate.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="size-3" />在新分頁開啟原始連結
            </a>
          )}
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="size-4 shrink-0" />{error}
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  // ── 步驟：搜尋中 / 分析中（主表單） ─────────────────────────
  return (
    <Card className="border-primary/20 shadow-sm">
      <CardContent className="flex flex-col gap-5 p-6">
        {/* Search input + year selector */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="例：台積電 2330、2330（含代號可自動搜尋）"
              disabled={isSearching || isSubmitting}
              className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60"
            />
          </div>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            disabled={isSearching || isSubmitting}
            className="rounded-lg border bg-background px-2 py-2 text-sm outline-none ring-offset-background focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 shrink-0 disabled:opacity-60"
          >
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>{y} 年</option>
            ))}
          </select>
          <Button onClick={handleSubmit} disabled={isSearching || isSubmitting} size="lg" className="shrink-0">
            {isSearching
              ? <><Loader2 className="mr-1.5 size-4 animate-spin" />搜尋中…</>
              : isSubmitting
              ? <><Loader2 className="mr-1.5 size-4 animate-spin" />分析中…</>
              : "開始分析"}
          </Button>
        </div>

        {/* PDF drop zone */}
        <div
          className={cn(
            "flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
            dragging ? "border-primary bg-primary/5 text-primary"
                     : "border-border text-muted-foreground hover:border-primary/50 hover:bg-muted/30",
          )}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadCloud className="size-8 shrink-0" />
          {file ? (
            <p className="text-sm font-medium text-foreground">{file.name}</p>
          ) : (
            <>
              <p className="text-sm font-medium">拖曳或點擊上傳永續報告書 PDF</p>
              <p className="text-xs text-muted-foreground">支援 .pdf，最大 50 MB</p>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f) }}
          />
        </div>

        {/* 進階：貼上 URL */}
        <div>
          <button
            type="button"
            onClick={() => setShowUrlInput((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn("size-3 transition-transform", showUrlInput && "rotate-180")} />
            找不到報告書？貼上網址
          </button>
          {showUrlInput && (
            <div className="mt-2 flex items-center gap-2">
              <Link2 className="size-4 shrink-0 text-muted-foreground" />
              <input
                type="url"
                value={reportUrl}
                onChange={(e) => setReportUrl(e.target.value)}
                placeholder="貼上 PDF 直連 或 CSR 報告頁面網址"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
              />
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle className="size-4 shrink-0" />{error}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────
// CompanyListSection — fetches companies on the client
// ─────────────────────────────────────────────────────────────
import { fetchCompanies } from "@/lib/api"

function CompanyListSection() {
  const [companies, setCompanies] = useState<CompanySummary[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(true)

  function loadCompanies() {
    setListLoading(true)
    fetchCompanies()
      .then((res) => setCompanies(res.data))
      .catch((e) => setListError(e instanceof Error ? e.message : "無法連線至後端 API"))
      .finally(() => setListLoading(false))
  }

  useEffect(() => { loadCompanies() }, [])

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">已完成分析</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">點擊卡片直接查看完整評分卡</p>
      </div>

      {listError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertTriangle className="size-4 shrink-0" />
          {listError} — 請確認後端 API 已啟動（uvicorn api.main:app --port 8000）
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {listLoading
          ? [0, 1, 2].map((i) => (
              <Card key={i}>
                <CardContent className="flex flex-col gap-4 p-5">
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-10 rounded-lg" />
                    <div className="flex flex-col gap-1.5">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  </div>
                  <Skeleton className="h-10 w-20" />
                  <Skeleton className="h-12 w-full rounded-lg" />
                </CardContent>
              </Card>
            ))
          : companies.map((c) => <CompanyCard key={c.name} c={c} onDelete={loadCompanies} />)
        }
      </div>

      {!listLoading && !listError && companies.length === 0 && (
        <p className="text-sm text-muted-foreground">目前尚無已分析公司，使用上方搜尋框開始第一筆分析。</p>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
export default function HomePage() {
  return (
    <div className="flex flex-col gap-10">
      {/* Hero / Search section */}
      <section id="analyze" className="flex flex-col gap-4 scroll-mt-20">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">ESG 風險評估</h1>
          <p className="mt-1.5 text-muted-foreground">
            輸入台灣上市公司名稱或股票代號，或上傳永續報告書 PDF，自動產出 E/S/G 三維評分卡。
          </p>
        </div>
        <AnalyzeForm />
      </section>

      {/* Existing companies */}
      <CompanyListSection />

      {/* Method note */}
      <div className="rounded-lg border bg-muted/30 p-4 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">評分方法學：</span>
        指標正規化依 GRI/SASB，新聞事件扣分仿 TESG ERS（強度 × 時間衰減），
        權重設定檔外部可調（符合歐盟 2026 ESG 評級法規揭露方向）。
        分級門檻：A ≥ 80 · B+ ≥ 70 · B ≥ 60 · B- ≥ 50 · C &lt; 50。
      </div>
    </div>
  )
}
