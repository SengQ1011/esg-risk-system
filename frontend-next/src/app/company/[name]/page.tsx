"use client"

import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  ExternalLink,
  FileText,
  Leaf,
  Minus,
  Newspaper,
  Scale,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from "lucide-react"
import { PolarAngleAxis, PolarGrid, Radar, RadarChart } from "recharts"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

type Signal = "green" | "yellow" | "red"

type Indicator = {
  name: string
  value: string
  unit: string
  sourcePage: number | null
  trend?: "up" | "down" | "flat"
  disclosed: boolean
}

type Dimension = {
  key: "E" | "S" | "G"
  label: string
  fullLabel: string
  score: number
  undisclosedCount: number
  indicators: Indicator[]
}

type Warning = {
  id: string
  title: string
  source: string
  date: string
  severity: "high" | "medium" | "low"
  category: "負面新聞" | "漂綠爭議" | "監管處分"
}

type Company = {
  name: string
  ticker: string
  industry: string
  reportYear: number
  totalScore: number
  rating: string
  signal: Signal
  recommendation: string
  scoreDelta: number
}

/* -------------------------------------------------------------------------- */
/*                                 Mock Data                                  */
/* -------------------------------------------------------------------------- */

const company: Company = {
  name: "永鴻綠能科技股份有限公司",
  ticker: "TWSE: 6841",
  industry: "再生能源 / 電力設備",
  reportYear: 2025,
  totalScore: 72,
  rating: "B+",
  signal: "yellow",
  recommendation: "可納入觀察名單，惟治理面資料缺漏需於盡職調查階段補件確認。",
  scoreDelta: -4,
}

const dimensions: Dimension[] = [
  {
    key: "E",
    label: "E",
    fullLabel: "環境 Environment",
    score: 81,
    undisclosedCount: 0,
    indicators: [
      { name: "範疇一溫室氣體排放量", value: "124,500", unit: "tCO₂e", sourcePage: 48, trend: "down", disclosed: true },
      { name: "範疇二溫室氣體排放量", value: "63,200", unit: "tCO₂e", sourcePage: 49, trend: "down", disclosed: true },
      { name: "再生能源使用佔比", value: "42.5", unit: "%", sourcePage: 52, trend: "up", disclosed: true },
      { name: "用水密集度", value: "3.8", unit: "m³/百萬營收", sourcePage: 55, trend: "flat", disclosed: true },
      { name: "廢棄物回收率", value: "88.0", unit: "%", sourcePage: 57, trend: "up", disclosed: true },
    ],
  },
  {
    key: "S",
    label: "S",
    fullLabel: "社會 Social",
    score: 74,
    undisclosedCount: 0,
    indicators: [
      { name: "員工流動率", value: "11.3", unit: "%", sourcePage: 63, trend: "down", disclosed: true },
      { name: "職業災害失能傷害頻率 (FR)", value: "0.42", unit: "次/百萬工時", sourcePage: 66, trend: "down", disclosed: true },
      { name: "女性主管比例", value: "29.0", unit: "%", sourcePage: 68, trend: "up", disclosed: true },
      { name: "員工年均訓練時數", value: "31.5", unit: "小時/人", sourcePage: 70, trend: "up", disclosed: true },
      { name: "供應商人權稽核覆蓋率", value: "76.0", unit: "%", sourcePage: 73, trend: "up", disclosed: true },
    ],
  },
  {
    key: "G",
    label: "G",
    fullLabel: "治理 Governance",
    score: 58,
    undisclosedCount: 2,
    indicators: [
      { name: "獨立董事席次比例", value: "33.3", unit: "%", sourcePage: 22, trend: "flat", disclosed: true },
      { name: "董事會出席率", value: "94.0", unit: "%", sourcePage: 24, trend: "up", disclosed: true },
      { name: "高階主管薪酬與績效連結度", value: "未揭露", unit: "—", sourcePage: null, disclosed: false },
      { name: "重大資安事件次數", value: "未揭露", unit: "—", sourcePage: null, disclosed: false },
      { name: "誠信經營申訴案件處理率", value: "100", unit: "%", sourcePage: 31, trend: "flat", disclosed: true },
    ],
  },
]

const radarData = dimensions.map((d) => ({
  dimension: d.fullLabel.split(" ")[0],
  score: d.score,
  fullMark: 100,
}))

const warnings: Warning[] = [
  {
    id: "w1",
    title: "子公司遭環保署裁罰：廢水排放超標逾法定標準 1.8 倍",
    source: "環境部新聞稿",
    date: "2025-09-12",
    severity: "high",
    category: "監管處分",
  },
  {
    id: "w2",
    title: "「100% 綠電」行銷宣稱與實際再生能源佔比 (42.5%) 不符，遭公平會關切",
    source: "財經週刊調查報導",
    date: "2025-08-03",
    severity: "high",
    category: "漂綠爭議",
  },
  {
    id: "w3",
    title: "碳中和承諾缺乏第三方查證，被環保團體列入「漂綠觀察名單」",
    source: "綠色和平組織",
    date: "2025-06-21",
    severity: "medium",
    category: "漂綠爭議",
  },
  {
    id: "w4",
    title: "獨立董事於審計委員會缺席率偏高，公司治理評鑑下滑一級距",
    source: "證交所公司治理中心",
    date: "2025-05-09",
    severity: "medium",
    category: "負面新聞",
  },
  {
    id: "w5",
    title: "供應鏈傳出移工勞動條件爭議，已啟動內部調查",
    source: "勞動權益通訊社",
    date: "2025-03-17",
    severity: "low",
    category: "負面新聞",
  },
]

/* -------------------------------------------------------------------------- */
/*                              Scorecard Header                              */
/* -------------------------------------------------------------------------- */

const signalConfig = {
  green: { label: "建議納入", dot: "bg-success", ring: "ring-success/30", text: "text-success" },
  yellow: { label: "審慎觀察", dot: "bg-warning", ring: "ring-warning/40", text: "text-warning" },
  red: { label: "建議排除", dot: "bg-danger", ring: "ring-danger/30", text: "text-danger" },
} as const

function ScorecardHeader({ company }: { company: Company }) {
  const signal = signalConfig[company.signal]
  const isPositive = company.scoreDelta >= 0

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-col gap-6 p-5 md:flex-row md:items-center md:justify-between md:p-6">
        {/* Company identity */}
        <div className="flex items-center gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Building2 className="size-6" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="text-pretty text-xl font-semibold leading-tight tracking-tight md:text-2xl">
              {company.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="font-mono">{company.ticker}</span>
              <span className="h-1 w-1 rounded-full bg-border" aria-hidden="true" />
              <span>{company.industry}</span>
              <span className="h-1 w-1 rounded-full bg-border" aria-hidden="true" />
              <span>{company.reportYear} 年度評估</span>
            </div>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-3 gap-3 md:flex md:items-stretch md:gap-4">
          {/* Total score */}
          <div className="flex flex-col justify-center rounded-lg border bg-muted/40 px-4 py-3">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">最終總分</span>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-3xl font-bold tabular-nums leading-none">{company.totalScore}</span>
              <span className="text-sm text-muted-foreground">/100</span>
            </div>
            <span
              className={cn(
                "mt-1.5 inline-flex items-center gap-1 text-xs font-medium tabular-nums",
                isPositive ? "text-success" : "text-danger",
              )}
            >
              {isPositive ? (
                <TrendingUp className="size-3.5" aria-hidden="true" />
              ) : (
                <TrendingDown className="size-3.5" aria-hidden="true" />
              )}
              {isPositive ? "+" : ""}
              {company.scoreDelta} vs. 去年
            </span>
          </div>

          {/* Rating */}
          <div className="flex flex-col justify-center rounded-lg border bg-muted/40 px-4 py-3">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">風險等級</span>
            <span className="mt-1 text-3xl font-bold leading-none text-primary">{company.rating}</span>
            <span className="mt-1.5 text-xs text-muted-foreground">中度信用風險</span>
          </div>

          {/* Signal */}
          <div
            className={cn(
              "flex flex-col justify-center rounded-lg border bg-muted/40 px-4 py-3 ring-1 ring-inset",
              signal.ring,
            )}
          >
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">決策燈號</span>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="relative flex size-3.5 items-center justify-center">
                <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", signal.dot)} />
                <span className={cn("relative inline-flex size-3.5 rounded-full", signal.dot)} />
              </span>
              <span className={cn("text-base font-semibold leading-none", signal.text)}>{signal.label}</span>
            </div>
            <Badge variant="outline" className="mt-2 w-fit text-[11px] font-normal">
              人工複核中
            </Badge>
          </div>
        </div>
      </div>

      <div className="border-t bg-muted/30 px-5 py-3 md:px-6">
        <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">決策建議：</span>
          {company.recommendation}
        </p>
      </div>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/*                                Radar Chart                                 */
/* -------------------------------------------------------------------------- */

const chartConfig = {
  score: {
    label: "得分",
    color: "var(--chart-2)",
  },
}

function EsgRadarChart() {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="text-base">ESG 三維度評分</CardTitle>
        <CardDescription>E / S / G 各維度標準化得分（滿分 100）</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <ChartContainer config={chartConfig} className="mx-auto aspect-square w-full max-h-[280px]">
          <RadarChart data={radarData}>
            <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
            <PolarGrid className="stroke-border" />
            <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 13, fill: "var(--muted-foreground)" }} />
            <Radar
              dataKey="score"
              fill="var(--color-score)"
              fillOpacity={0.25}
              stroke="var(--color-score)"
              strokeWidth={2}
              dot={{ r: 4, fillOpacity: 1, fill: "var(--color-score)" }}
            />
          </RadarChart>
        </ChartContainer>

        {/* Per-dimension breakdown */}
        <div className="mt-2 grid grid-cols-3 gap-2 border-t pt-4">
          {dimensions.map((d) => (
            <div key={d.key} className="flex flex-col items-center gap-1 text-center">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{d.fullLabel.split(" ")[0]}</span>
                {d.undisclosedCount > 0 && (
                  <Badge variant="destructive" className="h-4 gap-0.5 px-1 text-[10px] font-medium leading-none">
                    <AlertTriangle className="size-2.5" aria-hidden="true" />
                    {d.undisclosedCount}
                  </Badge>
                )}
              </div>
              <span
                className={cn(
                  "text-2xl font-bold tabular-nums leading-none",
                  d.score >= 75 ? "text-success" : d.score >= 60 ? "text-warning" : "text-danger",
                )}
              >
                {d.score}
              </span>
              {d.undisclosedCount > 0 && (
                <span className="text-[11px] leading-tight text-danger">{d.undisclosedCount}項指標未揭露</span>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/*                               Warning List                                 */
/* -------------------------------------------------------------------------- */

const severityConfig = {
  high: { label: "高", className: "bg-danger/10 text-danger ring-danger/20", bar: "bg-danger" },
  medium: { label: "中", className: "bg-warning/15 text-warning-foreground ring-warning/30", bar: "bg-warning" },
  low: { label: "低", className: "bg-muted text-muted-foreground ring-border", bar: "bg-muted-foreground/40" },
} as const

const categoryIcon = {
  負面新聞: Newspaper,
  漂綠爭議: Leaf,
  監管處分: Scale,
} as const

function WarningItem({ warning }: { warning: Warning }) {
  const sev = severityConfig[warning.severity]
  const Icon = categoryIcon[warning.category]

  return (
    <li className="relative flex gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/40">
      <span className={cn("absolute inset-y-2 left-0 w-1 rounded-full", sev.bar)} aria-hidden="true" />
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={cn("h-5 px-1.5 text-[11px] font-medium ring-1 ring-inset", sev.className)}>
            風險{sev.label}
          </Badge>
          <Badge variant="secondary" className="h-5 px-1.5 text-[11px] font-normal">
            {warning.category}
          </Badge>
        </div>
        <p className="mt-1.5 text-pretty text-sm font-medium leading-snug">{warning.title}</p>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate">
            {warning.source} · {warning.date}
          </span>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline"
          >
            來源
            <ExternalLink className="size-3" aria-hidden="true" />
          </button>
        </div>
      </div>
    </li>
  )
}

function WarningList() {
  const highCount = warnings.filter((w) => w.severity === "high").length

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-danger" aria-hidden="true" />
            <CardTitle className="text-base">風險警示清單</CardTitle>
          </div>
          <Badge variant="destructive" className="tabular-nums">
            {highCount} 項高風險
          </Badge>
        </div>
        <CardDescription>近 12 個月負面新聞與漂綠爭議追蹤</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        <ul className="flex flex-col gap-2.5">
          {warnings.map((w) => (
            <WarningItem key={w.id} warning={w} />
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/*                             Indicator Details                              */
/* -------------------------------------------------------------------------- */

const dimAccent = {
  E: "text-success",
  S: "text-chart-2",
  G: "text-warning-foreground",
} as const

function TrendIcon({ trend }: { trend?: Indicator["trend"] }) {
  if (trend === "up") return <ArrowUpRight className="size-3.5 text-success" aria-label="上升" />
  if (trend === "down") return <ArrowDownRight className="size-3.5 text-success" aria-label="下降" />
  if (trend === "flat") return <Minus className="size-3.5 text-muted-foreground" aria-label="持平" />
  return <span className="text-muted-foreground">—</span>
}

function IndicatorDetails() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">ESG 指標明細</CardTitle>
        <CardDescription>各維度量化指標、數值與報告書來源頁碼</CardDescription>
      </CardHeader>
      <CardContent>
        {/* @ts-ignore */}
        <Accordion type="multiple" defaultValue={["E", "S", "G"]} className="w-full">
          {dimensions.map((dim) => (
            <AccordionItem key={dim.key} value={dim.key} className="border-b last:border-b-0">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex flex-1 items-center justify-between gap-3 pr-2">
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "flex size-8 items-center justify-center rounded-md border bg-muted/50 text-sm font-bold",
                        dimAccent[dim.key],
                      )}
                    >
                      {dim.label}
                    </span>
                    <div className="text-left">
                      <span className="text-sm font-medium">{dim.fullLabel}</span>
                      <p className="text-xs text-muted-foreground">{dim.indicators.length} 項指標</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {dim.undisclosedCount > 0 && (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="size-3" aria-hidden="true" />
                        {dim.undisclosedCount}項指標未揭露
                      </Badge>
                    )}
                    <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                      {dim.score}
                      <span className="text-xs font-normal">/100</span>
                    </span>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="overflow-hidden rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableHead className="w-[45%]">指標名稱</TableHead>
                        <TableHead className="text-right">數值</TableHead>
                        <TableHead>單位</TableHead>
                        <TableHead className="w-12 text-center">趨勢</TableHead>
                        <TableHead className="text-right">來源頁碼</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dim.indicators.map((ind) => (
                        <TableRow key={ind.name} className={cn(!ind.disclosed && "bg-danger/5")}>
                          <TableCell className="font-medium">
                            <span className="flex items-center gap-2">
                              {ind.name}
                              {!ind.disclosed && (
                                <Badge
                                  variant="outline"
                                  className="h-5 border-danger/30 bg-danger/10 px-1.5 text-[10px] text-danger"
                                >
                                  未揭露
                                </Badge>
                              )}
                            </span>
                          </TableCell>
                          <TableCell
                            className={cn("text-right font-mono tabular-nums", !ind.disclosed && "text-muted-foreground")}
                          >
                            {ind.value}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{ind.unit}</TableCell>
                          <TableCell className="text-center">
                            <span className="inline-flex justify-center">
                              <TrendIcon trend={ind.trend} />
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            {ind.sourcePage ? (
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                              >
                                <FileText className="size-3" aria-hidden="true" />P.{ind.sourcePage}
                              </button>
                            ) : (
                              <span className="text-xs text-muted-foreground">無對應頁碼</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/*                                    Page                                    */
/* -------------------------------------------------------------------------- */

export default function Page() {
  return (
    <div className="min-h-screen bg-background">
      {/* App bar */}
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </div>
            <div className="leading-tight">
              <span className="block text-sm font-semibold tracking-tight">ESG RiskLens</span>
              <span className="block text-xs text-muted-foreground">企業永續風險評分平台</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="hidden font-normal sm:inline-flex">
              評估方法論 v3.2
            </Badge>
            <Badge variant="secondary" className="font-normal">
              機構投資人版
            </Badge>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
        <div className="flex flex-col gap-6">
          <ScorecardHeader company={company} />

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-2" aria-label="評分概覽">
            <EsgRadarChart />
            <WarningList />
          </section>

          <IndicatorDetails />
        </div>

        <footer className="mt-10 border-t pt-5 text-xs leading-relaxed text-muted-foreground">
          <p className="text-pretty">
            本評分卡資料來源為企業永續報告書、公開新聞與監管揭露，僅供內部決策參考，不構成投資建議。標示「未揭露」之指標表示企業於最新報告書中未提供對應數據。
          </p>
        </footer>
      </main>
    </div>
  )
}
