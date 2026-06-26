"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { ArrowRight, CheckCircle2, X, XCircle } from "lucide-react"
import { SnakeSpinner } from "@/components/snake-spinner"
import { fetchJobStatus, getPipJobs, removePipJob } from "@/lib/api"
import { cn } from "@/lib/utils"

interface ActiveJob {
  jobId: string
  companyName: string
  progress: number
  status: "running" | "error"
}

interface CompletionToast {
  id: string
  companyName: string
  countdown: number
}

const TOAST_DURATION = 5

/**
 * 固定在右下角的分析進度浮動圓點（PiP 模式），支援多個並行 job。
 * 從 localStorage[PIP_KEY] 讀取 active jobs 陣列，每 2.5s 輪詢進度。
 * 每個 job 完成後在正上方彈出 toast，讓用戶自行決定是否跳轉評分卡。
 */
export function FloatingJobPip() {
  const router   = useRouter()
  const pathname = usePathname()

  const [jobs,   setJobs]   = useState<ActiveJob[]>([])
  const [toasts, setToasts] = useState<CompletionToast[]>([])

  const jobsRef    = useRef<ActiveJob[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function applyJobs(next: ActiveJob[]) {
    jobsRef.current = next
    setJobs([...next])
  }

  // 讀 localStorage — 依賴 pathname 確保同 tab 最小化後能立即感知
  // window.storage 只在跨 tab 寫入時觸發，同 tab 靠 pathname 變化補足
  useEffect(() => {
    function sync() {
      const pip = getPipJobs()
      const byId = new Map(jobsRef.current.map(j => [j.jobId, j]))
      applyJobs(
        pip.map(p => byId.get(p.jobId) ?? {
          jobId: p.jobId,
          companyName: p.companyName,
          progress: 0,
          status: "running" as const,
        })
      )
    }
    sync()
    window.addEventListener("storage", sync)
    return () => window.removeEventListener("storage", sync)
  }, [pathname])

  // 輪詢 — 所有 active jobs 共用一個 interval，讀 ref 確保取得最新列表
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (jobs.length === 0) return

    async function pollAll() {
      const cur = jobsRef.current
      if (cur.length === 0) return

      const next: ActiveJob[] = []
      const completed: string[] = []

      for (const job of cur) {
        if (job.status === "error") { next.push(job); continue }

        const data = await fetchJobStatus(job.jobId)
        if (!data) { next.push(job); continue }

        const name = data.company_name || job.companyName

        if (data.status === "done") {
          removePipJob(job.jobId)
          completed.push(name)
        } else if (data.status === "error") {
          next.push({ ...job, status: "error", companyName: name })
        } else if (data.status === "cancelled") {
          removePipJob(job.jobId)
        } else {
          next.push({ ...job, progress: data.progress, companyName: name })
        }
      }

      applyJobs(next)

      if (completed.length > 0) {
        setToasts(prev => [
          ...prev,
          ...completed.map(name => ({
            id: `${name}-${Date.now()}`,
            companyName: name,
            countdown: TOAST_DURATION,
          })),
        ])
      }
    }

    pollAll()
    intervalRef.current = setInterval(pollAll, 2500)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [jobs.length])  // job 數量變化才重建 interval，進度更新透過 ref 讀取

  // Toast 倒數計時 — 單一持久 interval，toasts 為空時 no-op
  useEffect(() => {
    const timer = setInterval(() => {
      setToasts(prev => {
        if (prev.length === 0) return prev
        return prev
          .map(t => ({ ...t, countdown: t.countdown - 1 }))
          .filter(t => t.countdown > 0)
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  function dismissToast(id: string) {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  function handleNavigate(companyName: string, toastId: string) {
    dismissToast(toastId)
    router.push(`/company/${encodeURIComponent(companyName)}`)
  }

  function handlePipClick(job: ActiveJob) {
    if (job.status === "error") {
      removePipJob(job.jobId)
      applyJobs(jobsRef.current.filter(j => j.jobId !== job.jobId))
      return
    }
    router.push(`/job/${job.jobId}`)
  }

  // job 進度頁本身不顯示對應 bubble（避免重複）
  const visibleJobs = jobs.filter(j =>
    !pathname.startsWith(`/job/${j.jobId}`)
  )

  return (
    <>
      {/* 完成通知 Toast — 正上方置中，多個垂直堆疊 */}
      <div className="pointer-events-none fixed top-6 left-1/2 z-50 flex w-[340px] -translate-x-1/2 flex-col gap-2">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className="pointer-events-auto overflow-hidden rounded-xl border border-green-200 bg-white shadow-2xl"
            role="alert"
            aria-live="polite"
          >
            <div className="flex items-start gap-3 px-4 pt-4 pb-3">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-green-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900">
                  {toast.companyName} ESG 分析完成
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {toast.countdown} 秒後自動關閉
                </p>
              </div>
              <button
                onClick={() => dismissToast(toast.id)}
                title="關閉"
                className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:text-gray-700"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="px-4 pb-4">
              <button
                onClick={() => handleNavigate(toast.companyName, toast.id)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white transition-all hover:bg-green-700 active:scale-[0.98]"
              >
                前往評分卡
                <ArrowRight className="size-3.5" />
              </button>
            </div>

            <div className="h-1 w-full bg-gray-100">
              <div
                className="h-full bg-green-400 transition-all duration-1000 ease-linear"
                style={{ width: `${(toast.countdown / TOAST_DURATION) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* PiP 浮動圓點 — 右下角，多個向上堆疊 */}
      {visibleJobs.length > 0 && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col-reverse items-end gap-3">
          {visibleJobs.map(job => (
            <button
              key={job.jobId}
              onClick={() => handlePipClick(job)}
              title={
                job.status === "error"
                  ? "分析失敗，點擊關閉"
                  : `${job.companyName || "分析中"} — ${job.progress}%`
              }
              className={cn(
                "flex flex-col items-center gap-1.5",
                "transition-transform hover:scale-105 active:scale-95",
              )}
            >
              <div className="relative size-14">
                {job.status !== "error" && (
                  <SnakeSpinner
                    size={56}
                    thickness={4}
                    speed="1.4s"
                    className="absolute inset-0"
                    innerClassName="absolute rounded-full bg-background"
                  />
                )}
                {job.status === "error" && (
                  <div className="absolute inset-0 rounded-full border-4 border-red-500 bg-background shadow-lg" />
                )}
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-full">
                  {job.status === "error"
                    ? <XCircle className="size-6 text-red-500" />
                    : (
                      <span className="text-xs font-bold tabular-nums text-orange-500">
                        {job.progress}%
                      </span>
                    )
                  }
                </div>
              </div>

              <span className="max-w-[80px] truncate rounded-md bg-background/90 px-1.5 py-0.5 text-[11px] font-medium shadow-sm ring-1 ring-border">
                {job.companyName || "分析中"}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}
