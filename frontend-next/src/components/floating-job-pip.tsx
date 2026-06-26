"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { CheckCircle2, XCircle } from "lucide-react"
import { SnakeSpinner } from "@/components/snake-spinner"
import { fetchJobStatus, PIP_KEY } from "@/lib/api"
import { cn } from "@/lib/utils"

interface PipJob {
  jobId: string
  companyName: string
}

/**
 * 固定在右下角的分析進度浮動圓點（PiP 模式）。
 * 從 localStorage[PIP_KEY] 讀取 active job，
 * 每 2.5s 輪詢進度，完成後跳轉評分卡並清除。
 */
export function FloatingJobPip() {
  const router   = useRouter()
  const pathname = usePathname()

  const [pipJob,    setPipJob]    = useState<PipJob | null>(null)
  const [progress,  setProgress]  = useState(0)
  const [jobStatus, setJobStatus] = useState<"running" | "done" | "error" | "cancelled">("running")
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const companyRef  = useRef("")

  // 讀 localStorage — 依賴 pathname 確保同一 tab 最小化跳回主頁時也能重新讀取
  // （window.storage 只在跨 tab 寫入時觸發，同 tab 內必須靠 pathname 變化觸發）
  useEffect(() => {
    function readPip() {
      try {
        const raw = localStorage.getItem(PIP_KEY)
        if (!raw) { setPipJob(null); return }
        const parsed: PipJob = JSON.parse(raw)
        setPipJob(parsed)
        companyRef.current = parsed.companyName
      } catch {
        setPipJob(null)
      }
    }
    readPip()
    window.addEventListener("storage", readPip)
    return () => window.removeEventListener("storage", readPip)
  }, [pathname])

  // 輪詢 job 狀態
  useEffect(() => {
    if (!pipJob) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      return
    }

    async function poll() {
      if (!pipJob) return
      const data = await fetchJobStatus(pipJob.jobId)
      if (!data) return
      setProgress(data.progress)
      if (data.company_name) companyRef.current = data.company_name

      if (data.status === "done") {
        setJobStatus("done")
        clearInterval(intervalRef.current!)
        localStorage.removeItem(PIP_KEY)
        setPipJob(null)
        setTimeout(() => {
          router.push(`/company/${encodeURIComponent(companyRef.current || pipJob.companyName)}`)
        }, 1200)
      } else if (data.status === "error") {
        setJobStatus("error")
        clearInterval(intervalRef.current!)
      } else if (data.status === "cancelled") {
        clearInterval(intervalRef.current!)
        localStorage.removeItem(PIP_KEY)
        setPipJob(null)
      }
    }

    poll()
    intervalRef.current = setInterval(poll, 2500)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [pipJob, router])

  // 已在 job 進度頁時不顯示
  if (!pipJob || pathname.startsWith("/job/")) return null

  const isRunning = jobStatus === "running"
  const isDone    = jobStatus === "done"
  const isError   = jobStatus === "error"

  function handleClick() {
    if (isError) {
      localStorage.removeItem(PIP_KEY)
      setPipJob(null)
      return
    }
    router.push(`/job/${pipJob!.jobId}`)
  }

  return (
    <button
      onClick={handleClick}
      title={isError ? "分析失敗，點擊關閉" : `${pipJob.companyName || "分析中"} — ${progress}%`}
      className={cn(
        "fixed bottom-6 right-6 z-50 flex flex-col items-center gap-1.5",
        "transition-transform hover:scale-105 active:scale-95",
      )}
    >
      {/* 外圈 + 內容 */}
      <div className="relative size-14">
        {/* running：SnakeSpinner 絕對定位填滿，提供橙色環 + 白色內圓遮罩 */}
        {isRunning && (
          <SnakeSpinner
            size={56}
            thickness={4}
            speed="1.4s"
            className="absolute inset-0"
            innerClassName="absolute rounded-full bg-background"
          />
        )}

        {/* done / error：靜態邊框 */}
        {!isRunning && (
          <div
            className={cn(
              "absolute inset-0 rounded-full border-4 bg-background shadow-lg",
              isDone  && "border-green-500",
              isError && "border-red-500",
            )}
          />
        )}

        {/* 內容：z-10 浮到 SnakeSpinner 上層，無背景（透過 SnakeSpinner 的白色內圓） */}
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-full">
          {isDone && <CheckCircle2 className="size-6 text-green-500" />}
          {isError && <XCircle className="size-6 text-red-500" />}
          {isRunning && (
            <span className="text-xs font-bold tabular-nums text-orange-500">
              {progress}%
            </span>
          )}
        </div>
      </div>

      {/* 公司名稱標籤 */}
      <span className="max-w-[80px] truncate rounded-md bg-background/90 px-1.5 py-0.5 text-[11px] font-medium shadow-sm ring-1 ring-border">
        {pipJob.companyName || "分析中"}
      </span>
    </button>
  )
}
