"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  Bot,
  CheckCircle2,
  Download,
  Search,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { fetchJobStatus, getWsUrl } from "@/lib/api"
import type { JobStatus } from "@/lib/types"

// ─────────────────────────────────────────────────────────────
// Step configuration
// ─────────────────────────────────────────────────────────────
interface StepConfig {
  label: string
  Icon: React.ElementType
  progress: number
}

const STEPS: StepConfig[] = [
  { label: "搜尋 ESG 報告書",   Icon: Search,   progress: 10  },
  { label: "下載 PDF",          Icon: Download, progress: 25  },
  { label: "GRI 索引解析",      Icon: BookOpen, progress: 45  },
  { label: "Gemini 指標抽取",   Icon: Bot,      progress: 70  },
  { label: "計算 E/S/G 分數",   Icon: BarChart3, progress: 90 },
]

const MOCK_FRAMES: JobStatus[] = STEPS.map((s) => ({
  job_id:       "mock",
  company_name: "",
  step:         s.label,
  progress:     s.progress,
  done:         false,
  error:        null,
})).concat([{
  job_id:       "mock",
  company_name: "",
  step:         "完成",
  progress:     100,
  done:         true,
  error:        null,
}])

// ─────────────────────────────────────────────────────────────
// StepList
// ─────────────────────────────────────────────────────────────
function StepList({ currentStep, progress }: { currentStep: string; progress: number }) {
  return (
    <ol className="flex flex-col gap-3">
      {STEPS.map(({ label, Icon }) => {
        const stepProgress = STEPS.find((s) => s.label === label)?.progress ?? 0
        const isDone    = progress > stepProgress
        const isActive  = currentStep === label && !isDone

        return (
          <li
            key={label}
            className={cn(
              "flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors",
              isDone   && "border-green-200 bg-green-50/60",
              isActive && "border-primary/30 bg-primary/5",
              !isDone && !isActive && "border-border bg-muted/20",
            )}
          >
            <div className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full",
              isDone   ? "bg-green-100 text-green-600"
              : isActive ? "bg-primary/15 text-primary"
              : "bg-muted text-muted-foreground",
            )}>
              {isDone
                ? <CheckCircle2 className="size-4" />
                : <Icon className={cn("size-4", isActive && "animate-pulse")} />
              }
            </div>
            <span className={cn(
              "flex-1 text-sm font-medium",
              isDone   ? "text-green-700"
              : isActive ? "text-foreground"
              : "text-muted-foreground",
            )}>
              {label}
            </span>
            {isDone && (
              <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700 text-xs">
                完成
              </Badge>
            )}
            {isActive && (
              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary text-xs">
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
  const [completed, setCompleted] = useState(false)
  const [countdown, setCountdown] = useState(3)
  const wsRef                     = useRef<WebSocket | null>(null)
  const pollRef                   = useRef<ReturnType<typeof setInterval> | null>(null)
  const doneRef                   = useRef(false)

  // Map backend job status to our JobStatus shape
  const applyJobData = useCallback((data: {
    job_id: string; company_name: string; status: string;
    current_step: string; progress: number; error_message: string | null
  }) => {
    if (doneRef.current) return
    const done  = data.status === "done"
    const error = data.status === "error" ? (data.error_message ?? "分析失敗") : null
    setStatus({
      job_id:       data.job_id,
      company_name: data.company_name || initialCompanyName,
      step:         data.current_step ?? "",
      progress:     data.progress ?? 0,
      done,
      error,
    })
    if (done || error) {
      doneRef.current = true
      if (done) setCompleted(true)
    }
  }, [initialCompanyName])

  // Polling fallback — used when WS is unavailable
  const startPolling = useCallback(() => {
    if (pollRef.current) return
    pollRef.current = setInterval(async () => {
      if (doneRef.current) {
        clearInterval(pollRef.current!)
        return
      }
      const data = await fetchJobStatus(jobId)
      if (data) applyJobData(data)
    }, 2500)
  }, [jobId, applyJobData])

  // WebSocket with polling fallback
  useEffect(() => {
    const wsUrl = getWsUrl(`/ws/job/${jobId}`)
    let ws: WebSocket

    try {
      ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onmessage = (evt) => {
        try {
          // WS sends: {step, progress, done, company_name, error?}
          const msg = JSON.parse(evt.data) as {
            step: string; progress: number; done: boolean;
            company_name?: string; error?: string
          }
          if (doneRef.current) return
          const company = msg.company_name || initialCompanyName
          const error   = msg.error ?? null
          setStatus({
            job_id:       jobId,
            company_name: company,
            step:         msg.step,
            progress:     msg.progress,
            done:         msg.done,
            error,
          })
          if (msg.done || error) {
            doneRef.current = true
            if (msg.done) setCompleted(true)
          }
        } catch { /* ignore parse errors */ }
      }

      ws.onerror = () => startPolling()
      ws.onclose = () => {
        // If not yet done, fall back to polling to catch final status
        if (!doneRef.current) startPolling()
      }
    } catch {
      // WebSocket not available — use polling
      startPolling()
    }

    return () => {
      wsRef.current?.close()
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [jobId, initialCompanyName, startPolling])

  // Countdown + auto-redirect when done
  useEffect(() => {
    if (!completed) return

    const tick = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(tick)
          router.push(`/company/${encodeURIComponent(initialCompanyName)}`)
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(tick)
  }, [completed, initialCompanyName, router])

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{initialCompanyName}</h1>
        <p className="text-sm text-muted-foreground">ESG 報告書分析進度</p>
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

      {/* Error state */}
      {status.error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">分析失敗</p>
            <p className="mt-0.5">{status.error}</p>
          </div>
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
            onClick={() => router.push(`/company/${encodeURIComponent(initialCompanyName)}`)}
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
