import Link from "next/link"
import { ArrowRight, AlertTriangle, Leaf } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { GradeBadge } from "@/components/grade-badge"
import { fetchCompanies } from "@/lib/api"
import type { CompanySummary } from "@/lib/types"

function ScoreDot({ score, label }: { score: number | null; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-lg font-bold text-gray-800">
        {score != null ? score.toFixed(1) : "—"}
      </span>
    </div>
  )
}

function CompanyCard({ c }: { c: CompanySummary }) {
  const s = c.latest_score
  return (
    <Link href={`/company/${encodeURIComponent(c.name)}`}>
      <Card className="group cursor-pointer border hover:border-green-400 hover:shadow-md transition-all">
        <CardHeader className="flex flex-row items-start justify-between pb-2">
          <div>
            <p className="text-lg font-bold text-gray-900 group-hover:text-green-700">
              {c.name}
            </p>
            <p className="text-xs text-gray-400">
              {c.ticker} · {c.industry}
            </p>
          </div>
          <GradeBadge grade={s?.grade ?? null} size="lg" />
        </CardHeader>
        <CardContent>
          {s ? (
            <>
              <div className="mb-3 flex items-center gap-2">
                <span className="text-3xl font-extrabold text-gray-900">
                  {s.total_score?.toFixed(1)}
                </span>
                <span className="text-sm text-gray-400">/ 100</span>
                <span className="ml-auto text-sm text-gray-500">{s.grade_label}</span>
              </div>
              <div className="flex justify-around rounded-lg bg-gray-50 py-2">
                <ScoreDot score={s.e_score} label="E 環境" />
                <ScoreDot score={s.s_score} label="S 社會" />
                <ScoreDot score={s.g_score} label="G 治理" />
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400">尚無評分資料</p>
          )}
          <div className="mt-3 flex items-center justify-end text-xs text-gray-400 group-hover:text-green-600">
            查看完整報告 <ArrowRight className="ml-1 size-3" />
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

export default async function HomePage() {
  let companies: CompanySummary[] = []
  let error: string | null = null

  try {
    const res = await fetchCompanies()
    companies = res.data
  } catch (e) {
    error = e instanceof Error ? e.message : "無法連線至後端 API"
  }

  return (
    <div>
      <div className="mb-8 flex items-center gap-3">
        <Leaf className="size-7 text-green-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ESG 風險評分系統</h1>
          <p className="text-sm text-gray-500">
            透明可解釋的 E/S/G 三維評分 · 台灣上市公司永續報告書 2023
          </p>
        </div>
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertTriangle className="size-4 shrink-0" />
          {error} — 請確認後端 API 已啟動（uvicorn api.main:app --reload）
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {companies.map((c) => (
            <CompanyCard key={c.name} c={c} />
          ))}
          {companies.length === 0 &&
            [0, 1, 2].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-3 w-16" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-20" />
                </CardContent>
              </Card>
            ))}
        </div>
      )}

      <div className="mt-8 rounded-lg border bg-white p-4 text-xs text-gray-400">
        <span className="font-semibold text-gray-600">方法學說明：</span>
        E 40% + S 30% + G 30%，指標依 GRI/SASB 框架，新聞事件扣分仿 TESG ERS 機制。
        分級門檻：A ≥ 80 · B+ ≥ 70 · B ≥ 60 · B- ≥ 50 · C &lt; 50。
      </div>
    </div>
  )
}
