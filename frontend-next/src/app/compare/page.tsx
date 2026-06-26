import { AlertTriangle } from "lucide-react"
import { fetchDashboard, fetchHistory } from "@/lib/api"
import type { DashboardCompany, HistoryEntry } from "@/lib/types"
import { CompareClient } from "@/components/compare-client"

export default async function ComparePage() {
  let data
  let error: string | null = null

  try {
    const res = await fetchDashboard()
    data = res.data
  } catch (e) {
    error = e instanceof Error ? e.message : "無法連線至後端 API"
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <AlertTriangle className="size-4 shrink-0" />
        {error} — 請確認後端 API 已啟動
      </div>
    )
  }

  const { companies } = data!

  const historyResults = await Promise.all(
    (companies as DashboardCompany[]).map(c =>
      fetchHistory(c.name).catch(() => ({ status: "error", data: [] as HistoryEntry[] }))
    )
  )

  const allHistory: Record<string, HistoryEntry[]> = Object.fromEntries(
    (companies as DashboardCompany[]).map((c, i) => [c.name, historyResults[i].data])
  )

  return <CompareClient companies={companies} allHistory={allHistory} />
}
