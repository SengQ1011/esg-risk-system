import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Building2, Calendar } from "lucide-react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { EsgRadarChartClient } from "@/components/esg-radar-chart-client"
import { IndicatorDetailsClient } from "@/components/indicator-details-client"
import { WarningListClient } from "@/components/warning-list-client"
import { fetchCompanyDetail } from "@/lib/api"
import type { CompanyDetail, IndicatorBreakdownItem } from "@/lib/types"

type Signal = "green" | "yellow" | "red"

function deriveSignal(score: number): Signal {
  return score >= 70 ? "green" : score >= 50 ? "yellow" : "red"
}

const signalConfig = {
  green:  { label: "建議納入", dot: "bg-green-500", ring: "ring-green-500/30", text: "text-green-600", reco: "評分表現優良，ESG 風險低，可納入授信 / 投資觀察名單。" },
  yellow: { label: "審慎觀察", dot: "bg-amber-500", ring: "ring-amber-500/40", text: "text-amber-500", reco: "評分中等，建議審慎評估，於盡職調查階段補充缺漏指標資料。" },
  red:    { label: "建議排除", dot: "bg-red-500",   ring: "ring-red-500/30",   text: "text-red-600",  reco: "ESG 風險偏高，建議排除或限縮授信 / 投資額度，待改善後複評。" },
} as const

function ScorecardHeader({ detail }: { detail: CompanyDetail }) {
  const { company, score } = detail
  const signal = deriveSignal(score.total_score)
  const cfg = signalConfig[signal]

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-col gap-6 p-5 md:flex-row md:items-center md:justify-between md:p-6">
        <div className="flex items-center gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Building2 className="size-6" />
          </div>
          <div className="min-w-0">
            <h1 className="text-pretty text-xl font-semibold leading-tight tracking-tight md:text-2xl">
              {company.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="font-mono">{company.ticker}</span>
              <span className="size-1 rounded-full bg-border" />
              <span>{company.industry}</span>
              {score.report_year && (
                <>
                  <span className="size-1 rounded-full bg-border" />
                  <span className="flex items-center gap-1">
                    <Calendar className="size-3" />
                    {score.report_year} 年度
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 md:flex md:items-stretch md:gap-4">
          <div className="flex flex-col justify-center rounded-lg border bg-muted/40 px-4 py-3">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">最終總分</span>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-3xl font-bold tabular-nums leading-none">{score.total_score.toFixed(1)}</span>
              <span className="text-sm text-muted-foreground">/100</span>
            </div>
          </div>

          <div className="flex flex-col justify-center rounded-lg border bg-muted/40 px-4 py-3">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">風險等級</span>
            <span className="mt-1 text-3xl font-bold leading-none text-primary">{score.grade}</span>
            <span className="mt-1.5 text-xs text-muted-foreground">{score.grade_label}</span>
          </div>

          <div className={cn("flex flex-col justify-center rounded-lg border bg-muted/40 px-4 py-3 ring-1 ring-inset", cfg.ring)}>
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">決策燈號</span>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="relative flex size-3.5">
                <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", cfg.dot)} />
                <span className={cn("relative inline-flex size-3.5 rounded-full", cfg.dot)} />
              </span>
              <span className={cn("text-base font-semibold leading-none", cfg.text)}>{cfg.label}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t bg-muted/30 px-5 py-3 md:px-6">
        <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">決策建議：</span>
          {cfg.reco}
        </p>
      </div>
    </Card>
  )
}


interface PageProps {
  params: Promise<{ name: string }>
}

export default async function CompanyPage({ params }: PageProps) {
  const { name } = await params
  const decodedName = decodeURIComponent(name)

  let detail: CompanyDetail
  try {
    const res = await fetchCompanyDetail(decodedName)
    detail = res.data
  } catch {
    notFound()
  }

  const { score, breakdown, warnings, reasoning, page_offset, news_events, greenwash_details } = detail

  const eMissing = (breakdown.E ?? []).filter((i: IndicatorBreakdownItem) => i.missing).length
  const sMissing = (breakdown.S ?? []).filter((i: IndicatorBreakdownItem) => i.missing).length
  const gMissing = (breakdown.G ?? []).filter((i: IndicatorBreakdownItem) => i.missing).length

  return (
    <div className="flex flex-col gap-6">
      <Link href="/" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        返回列表
      </Link>

      <ScorecardHeader detail={detail} />

      <section className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <EsgRadarChartClient
          eScore={score.e_score} sScore={score.s_score} gScore={score.g_score}
          eMissing={eMissing} sMissing={sMissing} gMissing={gMissing}
        />
        <WarningListClient
          warnings={warnings}
          reasoning={reasoning}
          newsEvents={news_events ?? []}
          greenwashDetails={greenwash_details ?? []}
        />
      </section>

      <IndicatorDetailsClient
        breakdown={breakdown}
        companyName={detail.company.name}
      />

      <footer className="border-t pt-5 text-xs leading-relaxed text-muted-foreground">
        本評分卡資料來源為企業永續報告書，指標依 GRI/SASB 框架，僅供內部決策參考，不構成投資建議。
        標示「未揭露」表示報告書中未提供對應數據或系統抽取失敗。
      </footer>
    </div>
  )
}
