"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  Bot,
  CheckCircle2,
  FileSearch,
  Leaf,
  Minimize2,
  Newspaper,
  ScanSearch,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { fetchJobStatus, getWsUrl, cancelJob, PIP_KEY } from "@/lib/api"
import type { JobStatus } from "@/lib/types"

// ─────────────────────────────────────────────────────────────
// Step 配置（label 對齊後端 _db_update 字串，progress 對齊 pipeline）
// ─────────────────────────────────────────────────────────────
interface StepConfig {
  label: string
  Icon: React.ElementType
  progress: number
}

const STEPS: StepConfig[] = [
  { label: "搜尋/下載報告書 PDF", Icon: FileSearch,  progress: 10 },
  { label: "識別公司名稱",         Icon: ScanSearch,  progress: 20 },
  { label: "M1：GRI 索引解析",    Icon: BookOpen,    progress: 40 },
  { label: "M1：指標抽取完成",    Icon: Bot,         progress: 65 },
  { label: "修正指標 bbox 座標",   Icon: ScanSearch,  progress: 80 },
  { label: "M2：新聞事件評分",    Icon: Newspaper,   progress: 88 },
  { label: "M3：漂綠偵測",        Icon: Leaf,        progress: 94 },
  { label: "計算並儲存 ESG 分數", Icon: BarChart3,   progress: 98 },
]

// ─────────────────────────────────────────────────────────────
// StepList — active item 以矩形邊線彗星動畫取代 icon 圓環
// ─────────────────────────────────────────────────────────────
function StepList({ currentStep, progress }: { currentStep: string; progress: number }) {
  return (
    <ol className="flex flex-col gap-2.5">
      {STEPS.map(({ label, Icon, progress: stepProgress }) => {
        const isDone   = progress > stepProgress
        const isActive = currentStep === label && !isDone

        return (
          <li
            key={label}
            className={cn(
              "relative flex items-center gap-3 rounded-lg px-4 py-2.5 transition-colors",
              isDone   && "border border-green-200 bg-green-50/60",
              isActive && "bg-orange-50",
              !isDone && !isActive && "border border-border bg-muted/20",
            )}
          >
            {/* SVG 彗星邊框：6 層無縫接合，每段精確接合模擬沿路徑的平滑漸層 */}
            {isActive && (
              <svg
                aria-hidden
                className="pointer-events-none absolute inset-0 h-full w-full"
              >
                {/* 段長 2-4-6-8-10-12，offset 2-6-12-20-30-42，精確首尾相接 */}
                {([
                  { anim: "comet-s42", op: 0.05, len: 12, color: "#f97316" },
                  { anim: "comet-s30", op: 0.12, len: 10, color: "#f97316" },
                  { anim: "comet-s20", op: 0.25, len: 8,  color: "#fb923c" },
                  { anim: "comet-s12", op: 0.45, len: 6,  color: "#fb923c" },
                  { anim: "comet-s6",  op: 0.70, len: 4,  color: "#fb923c" },
                  { anim: "comet-s2",  op: 1.00, len: 2,  color: "#f97316" },
                ] as const).map(({ anim, op, len, color }) => (
                  <rect key={anim}
                    x="1" y="1" width="calc(100% - 2px)" height="calc(100% - 2px)"
                    rx="7" ry="7" fill="none"
                    stroke={color} strokeOpacity={op} strokeWidth={2}
                    pathLength={100} strokeDasharray={`${len} ${100 - len}`}
                    style={{ animation: `${anim} 1.6s linear infinite` }}
                  />
                ))}
              </svg>
            )}

            {/* icon */}
            <div className={cn(
              "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full",
              isDone   && "bg-green-100 text-green-600",
              isActive && "text-orange-600",
              !isDone && !isActive && "bg-muted text-muted-foreground",
            )}>
              {isDone
                ? <CheckCircle2 className="size-4" />
                : <Icon className="size-4" />
              }
            </div>

            <span className={cn(
              "relative z-10 flex-1 text-sm font-medium",
              isDone   && "text-green-700",
              isActive && "text-orange-700",
              !isDone && !isActive && "text-muted-foreground",
            )}>
              {label}
            </span>

            {isDone && (
              <Badge variant="outline" className="relative z-10 border-green-200 bg-green-50 text-green-700 text-xs">
                完成
              </Badge>
            )}
            {isActive && (
              <Badge
                variant="outline"
                className="relative z-10 border-orange-300 bg-orange-50 text-orange-600 text-xs"
              >
                進行中
              </Badge>
            )}
          </li>
        )
      })}
    </ol>
  )
}

// ─────────────────────────────────────────────────────────────
// ProgressBar
// ─────────────────────────────────────────────────────────────
function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary transition-all duration-700 ease-out"
        style={{ width: `${value}%` }}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// JobProgressClient
// ─────────────────────────────────────────────────────────────
interface Props {
  jobId: string
  initialCompanyName: string
}

export function JobProgressClient({ jobId, initialCompanyName }: Props) {
  const router = useRouter()
  const [status, setStatus]     = useState<JobStatus>({
    job_id:       jobId,
    company_name: initialCompanyName,
    step:         STEPS[0].label,
    progress:     0,
    done:         false,
    error:        null,
  })
  const [completed, setCompleted]   = useState(false)
  const [cancelled, setCancelled]   = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [countdown, setCountdown]   = useState(3)

  // render 用：從 state 推導，不讀 ref（ref 只在 effect/callback 裡用）
  const isFinished = completed || cancelled || !!status.error

  const wsRef          = useRef<WebSocket | null>(null)
  const pollRef        = useRef<ReturnType<typeof setInterval> | null>(null)
  const doneRef        = useRef(false)
  const companyNameRef = useRef(initialCompanyName)

  const applyJobData = useCallback((data: {
    job_id: string; company_name: string; status: string;
    current_step: string; progress: number; error_message: string | null
  }) => {
    if (doneRef.current) return
    const done      = data.status === "done"
    const isFailed  = data.status === "error"
    const isCancelled = data.status === "cancelled"
    const error     = isFailed ? (data.error_message ?? "分析失敗") : null
    const resolvedName = data.company_name || initialCompanyName
    if (resolvedName) companyNameRef.current = resolvedName
    setStatus({
      job_id:       data.job_id,
      company_name: resolvedName,
      step:         data.current_step ?? "",
      progress:     data.progress ?? 0,
      done,
      error,
    })
    if (done || isFailed || isCancelled || error) {
      doneRef.current = true
      if (done && !error) setCompleted(true)
      if (isCancelled) setCancelled(true)
    }
  }, [initialCompanyName])

  const startPolling = useCallback(() => {
    if (pollRef.current) return
    pollRef.current = setInterval(async () => {
      if (doneRef.current) { clearInterval(pollRef.current!); return }
      const data = await fetchJobStatus(jobId)
      if (data) applyJobData(data)
    }, 2500)
  }, [jobId, applyJobData])

  useEffect(() => {
    const wsUrl = getWsUrl(`/ws/job/${jobId}`)
    let ws: WebSocket

    try {
      ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data) as {
            step: string; progress: number; done: boolean; failed?: boolean;
            cancelled?: boolean; company_name?: string; error?: string
          }
          if (doneRef.current) return
          const company = msg.company_name || initialCompanyName
          if (company) companyNameRef.current = company
          const error = (msg.failed || msg.error) ? (msg.error || "分析失敗") : null
          setStatus({
            job_id:       jobId,
            company_name: company,
            step:         msg.step,
            progress:     msg.progress,
            done:         msg.done,
            error,
          })
          if (msg.done || msg.failed || msg.cancelled || error) {
            doneRef.current = true
            if (msg.done && !error) setCompleted(true)
            if (msg.cancelled) setCancelled(true)
          }
        } catch { /* ignore parse errors */ }
      }

      ws.onerror = () => startPolling()
      ws.onclose = () => { if (!doneRef.current) startPolling() }
    } catch {
      startPolling()
    }

    return () => {
      wsRef.current?.close()
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [jobId, initialCompanyName, startPolling])

  // 倒數計時
  useEffect(() => {
    if (!completed) return
    const tick = setInterval(() => setCountdown((prev) => prev - 1), 1000)
    return () => clearInterval(tick)
  }, [completed])

  // 跳轉
  useEffect(() => {
    if (!completed || countdown > 0) return
    router.push(`/company/${encodeURIComponent(companyNameRef.current)}`)
  }, [completed, countdown, router])

  // 取消
  async function handleCancel() {
    if (cancelling || doneRef.current) return
    if (!confirm("確定要取消分析嗎？已產生的中間檔案將一併刪除。")) return
    setCancelling(true)
    try {
      await cancelJob(jobId)
      // 清除 PiP localStorage
      localStorage.removeItem(PIP_KEY)
      doneRef.current = true
      setCancelled(true)
    } catch {
      setCancelling(false)
    }
  }

  // 最小化（PiP）
  function handleMinimize() {
    localStorage.setItem(PIP_KEY, JSON.stringify({
      jobId,
      companyName: companyNameRef.current || initialCompanyName || "",
    }))
    router.push("/")
  }

  const displayName = status.company_name || initialCompanyName || "公司識別中…"

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{displayName}</h1>
          <p className="text-sm text-muted-foreground">ESG 報告書分析進度</p>
        </div>
        {/* 最小化 & 取消 按鈕（分析進行中才顯示）*/}
        {!isFinished && !cancelled && (
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleMinimize}
              title="最小化（背景執行）"
            >
              <Minimize2 className="size-3.5" />
              最小化
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              disabled={cancelling}
              className="border-red-200 text-red-600 hover:bg-red-50"
              title="取消分析"
            >
              <X className="size-3.5" />
              取消
            </Button>
          </div>
        )}
      </div>

      {/* Progress card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base">
            <span>分析進度</span>
            <span className="tabular-nums text-primary">{status.progress}%</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <ProgressBar value={status.progress} />
          <StepList currentStep={status.step} progress={status.progress} />
        </CardContent>
      </Card>

      {/* 取消狀態 */}
      {cancelled && (
        <div className="flex flex-col gap-3 rounded-lg border border-muted bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">分析已取消，中間檔案已清除。</p>
          <Button variant="outline" size="sm" className="self-start" onClick={() => router.push("/")}>
            <ArrowLeft className="size-3.5" />
            返回首頁
          </Button>
        </div>
      )}

      {/* Error state */}
      {status.error && !cancelled && (
        <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">分析失敗</p>
              <p className="mt-0.5">{status.error}</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="self-start border-red-200 text-red-700 hover:bg-red-100"
            onClick={() => router.push("/")}
          >
            <ArrowLeft className="size-3.5" />
            返回重新輸入
          </Button>
        </div>
      )}

      {/* Completion banner */}
      {completed && !status.error && (
        <div className="flex flex-col gap-3 rounded-lg border border-green-200 bg-green-50 p-4">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle2 className="size-5 shrink-0" />
            <p className="font-semibold">分析完成！</p>
          </div>
          <p className="text-sm text-green-700/80">
            正在前往評分卡… {countdown} 秒後自動跳轉
          </p>
          <Button
            onClick={() => router.push(`/company/${encodeURIComponent(companyNameRef.current)}`)}
            className="self-start"
            size="sm"
          >
            立即查看評分卡 <ArrowRight className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}
