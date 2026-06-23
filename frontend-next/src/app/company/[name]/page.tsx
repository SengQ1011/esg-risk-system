import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, FileText, Calendar } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { GradeBadge } from "@/components/grade-badge"
import { ScoreRadarChart } from "@/components/score-radar-chart"
import { ScoreBarChart } from "@/components/score-bar-chart"
import { DecisionLights } from "@/components/decision-lights"
import { WarningList } from "@/components/warning-list"
import { BreakdownTableClient } from "@/components/breakdown-table-client"
import { fetchCompanyDetail } from "@/lib/api"

interface PageProps {
  params: Promise<{ name: string }>
}

export default async function CompanyPage({ params }: PageProps) {
  const { name } = await params
  const decodedName = decodeURIComponent(name)

  let detail
  try {
    const res = await fetchCompanyDetail(decodedName)
    detail = res.data
  } catch {
    notFound()
  }

  const { company, score, breakdown, warnings, reasoning, decision, page_offset } = detail

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-700"
        >
          <ArrowLeft className="size-4" />
          返回列表
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{company.name}</h1>
          <p className="mt-0.5 text-sm text-gray-400">
            {company.ticker} · {company.industry}
          </p>
          {score.report_year && (
            <div className="mt-2 flex items-center gap-1 text-xs text-gray-400">
              <Calendar className="size-3" />
              永續報告書 {score.report_year} 年
            </div>
          )}
        </div>
        <div className="flex items-center gap-4">
          <GradeBadge grade={score.grade} size="lg" />
          <div className="text-right">
            <div className="text-4xl font-extrabold text-gray-900">
              {score.total_score.toFixed(1)}
            </div>
            <div className="text-sm text-gray-400">/ 100 · {score.grade_label}</div>
          </div>
        </div>
      </div>

      {/* Warnings + Decision */}
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-gray-700">風險警示</CardTitle>
          </CardHeader>
          <CardContent>
            <WarningList warnings={warnings} />
            {reasoning && (
              <p className="mt-3 text-xs text-gray-400">{reasoning}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-gray-700">決策燈號</CardTitle>
          </CardHeader>
          <CardContent>
            <DecisionLights decision={decision} />
            <p className="mt-3 text-xs text-gray-400">
              依總分判定：≥ 70 低風險 · 50–69 中風險 · &lt; 50 高風險
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700">E/S/G 雷達圖</CardTitle>
          </CardHeader>
          <CardContent>
            <ScoreRadarChart
              eScore={score.e_score}
              sScore={score.s_score}
              gScore={score.g_score}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700">三維分數</CardTitle>
          </CardHeader>
          <CardContent>
            <ScoreBarChart
              eScore={score.e_score}
              sScore={score.s_score}
              gScore={score.g_score}
            />
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div>
                <div className="text-lg font-bold text-green-600">{score.e_score.toFixed(1)}</div>
                <div className="text-gray-500">E 環境 (40%)</div>
              </div>
              <div>
                <div className="text-lg font-bold text-blue-600">{score.s_score.toFixed(1)}</div>
                <div className="text-gray-500">S 社會 (30%)</div>
              </div>
              <div>
                <div className="text-lg font-bold text-purple-600">{score.g_score.toFixed(1)}</div>
                <div className="text-gray-500">G 治理 (30%)</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <FileText className="size-4" />
            指標貢獻拆解（可解釋性）
          </CardTitle>
          <p className="text-xs text-gray-400">點擊指標列可開啟 PDF 原始頁面</p>
        </CardHeader>
        <CardContent className="space-y-5">
          {(["E", "S", "G"] as const).map((dim) => (
            <div key={dim}>
              <h3 className="mb-2 text-sm font-semibold text-gray-600">
                {dim === "E" ? "E 環境" : dim === "S" ? "S 社會" : "G 治理"}
              </h3>
              <BreakdownTableClient
                items={breakdown[dim] ?? []}
                companyName={company.name}
                pageOffset={page_offset ?? 0}
              />
              {dim !== "G" && <Separator className="mt-4" />}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
