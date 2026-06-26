"use client"

import { useState, useMemo, useCallback } from "react"
import dynamic from "next/dynamic"
import {
  AlertTriangle, FileText, Info,
  TrendingDown, TrendingUp, ToggleRight,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { IndicatorBreakdownItem, ScoreBreakdown } from "@/lib/types"

const PdfViewerModal = dynamic(
  () => import("./pdf-viewer-modal").then((m) => m.PdfViewerModal),
  { ssr: false },
)

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

const INDICATOR_LABELS: Record<string, string> = {
  ghg_scope1: "範疇一溫室氣體排放",
  ghg_scope2: "範疇二溫室氣體排放",
  ghg_scope3: "範疇三溫室氣體排放",
  carbon_intensity: "碳排放強度",
  electricity: "用電量",
  renewable_ratio: "再生能源佔比",
  water: "用水量",
  waste: "廢棄物產生量",
  injury_rate: "職災率（TRIR）",
  turnover: "員工離職率",
  female_ratio: "女性員工比例",
  female_mgmt_ratio: "女性管理層比例",
  training_hours: "年均培訓時數",
  independent_director_ratio: "獨立董事比例",
  female_director_ratio: "女性董事比例",
  has_sustainability_officer: "設有永續長",
  assurance: "第三方驗證",
  violations: "違規次數",
}

type Direction = "lower" | "higher" | "boolean"

const INDICATOR_DIRECTION: Record<string, Direction> = {
  ghg_scope1: "lower", ghg_scope2: "lower", ghg_scope3: "lower",
  carbon_intensity: "lower", electricity: "lower", water: "lower", waste: "lower",
  renewable_ratio: "higher",
  injury_rate: "lower", turnover: "lower", violations: "lower",
  female_ratio: "higher", female_mgmt_ratio: "higher", training_hours: "higher",
  independent_director_ratio: "higher", female_director_ratio: "higher",
  has_sustainability_officer: "boolean", assurance: "boolean",
}

const INDICATOR_MAX_REF: Record<string, number> = {
  ghg_scope1: 20_000_000, ghg_scope2: 1_500_000, ghg_scope3: 15_000_000,
  carbon_intensity: 500, electricity: 5_000_000_000,
  renewable_ratio: 100, water: 50_000_000, waste: 750_000,
  injury_rate: 5.0, turnover: 30.0, female_ratio: 100,
  female_mgmt_ratio: 100, training_hours: 40,
  independent_director_ratio: 100, female_director_ratio: 100, violations: 10,
}

const INDICATOR_UNIT_LABEL: Record<string, string> = {
  ghg_scope1: "公噸CO2e", ghg_scope2: "公噸CO2e", ghg_scope3: "公噸CO2e",
  carbon_intensity: "公噸CO2e/百萬元", electricity: "kWh",
  renewable_ratio: "%", water: "m³", waste: "公噸",
  injury_rate: "每百萬工時", turnover: "%", female_ratio: "%",
  female_mgmt_ratio: "%", training_hours: "小時",
  independent_director_ratio: "%", female_director_ratio: "%", violations: "次",
}

function buildFormula(key: string, rawValue: number | boolean | null | undefined): string {
  const dir = INDICATOR_DIRECTION[key]
  const maxRef = INDICATOR_MAX_REF[key]
  const unit = INDICATOR_UNIT_LABEL[key] ?? ""

  if (dir === "boolean") return "布林值：有設立 → 100%，無 → 0%"
  if (rawValue == null || maxRef == null) return "資料缺失，此指標不計入評分"

  const val = rawValue as number
  if (dir === "lower") {
    const norm = Math.max(0, 1 - val / maxRef)
    return `公式（越低越好）：\n1 − (${val.toLocaleString()} ÷ ${maxRef.toLocaleString()}) = ${(norm * 100).toFixed(1)}%\n\n基準最差值：${maxRef.toLocaleString()} ${unit}`
  }
  const norm = Math.min(1, val / maxRef)
  return `公式（越高越好）：\n${val.toLocaleString()} ÷ ${maxRef.toLocaleString()} = ${(norm * 100).toFixed(1)}%\n\n基準最佳值：${maxRef.toLocaleString()} ${unit}`
}

// Direction icon config
const DIR_CONFIG: Record<Direction, { Icon: React.ElementType; label: string; color: string }> = {
  lower:   { Icon: TrendingDown, label: "越低越好", color: "text-blue-500" },
  higher:  { Icon: TrendingUp,   label: "越高越好", color: "text-emerald-600" },
  boolean: { Icon: ToggleRight,  label: "布林值",   color: "text-purple-500" },
}

interface ScoreCellProps {
  score: number | null
  dir?: Direction
  onMouseEnter: (e: React.MouseEvent) => void
  onMouseLeave: () => void
}

function ScoreCell({ score, dir, onMouseEnter, onMouseLeave }: ScoreCellProps) {
  const dirCfg = dir ? DIR_CONFIG[dir] : null

  return (
    <div
      className="flex cursor-help flex-col items-center gap-1.5 select-none"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {score != null ? (
        <>
          {/* Direction icon + percentage on one line */}
          <div className="flex items-center gap-1">
            {dirCfg && (
              <dirCfg.Icon className={cn("size-3 shrink-0", dirCfg.color)} />
            )}
            <span className={cn(
              "text-sm font-semibold tabular-nums leading-none",
              score >= 0.7 ? "text-green-700" : score >= 0.4 ? "text-amber-600" : "text-red-600",
            )}>
              {(score * 100).toFixed(0)}%
            </span>
          </div>
          {/* Progress bar */}
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100">
            <div
              className={cn(
                "h-full rounded-full",
                score >= 0.7 ? "bg-green-500" : score >= 0.4 ? "bg-amber-400" : "bg-red-400",
              )}
              style={{ width: `${(score * 100).toFixed(1)}%` }}
            />
          </div>
          {/* Direction label */}
          {dirCfg && (
            <span className={cn("text-[10px] leading-none", dirCfg.color)}>
              {dirCfg.label}
            </span>
          )}
        </>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      )}
    </div>
  )
}

const DIM_CONFIG = {
  E: { label: "E", fullLabel: "環境 Environment", accent: "text-green-600",  dimBg: "bg-green-500" },
  S: { label: "S", fullLabel: "社會 Social",       accent: "text-blue-600",   dimBg: "bg-blue-500" },
  G: { label: "G", fullLabel: "治理 Governance",   accent: "text-purple-600", dimBg: "bg-purple-500" },
} as const

interface ModalState {
  isOpen: boolean; page: number
  bbox: [number, number, number, number][] | null
  label: string; rawValue: string | null; unit: string | null
}

const CLOSED: ModalState = { isOpen: false, page: 1, bbox: null, label: "", rawValue: null, unit: null }

function formatValue(item: IndicatorBreakdownItem): string {
  if (item.missing || item.raw_value == null) return "—"
  if (typeof item.raw_value === "boolean") return item.raw_value ? "是" : "否"
  if (item.raw_value === 0) return "0"
  return Number(item.raw_value).toLocaleString()
}

interface TooltipState { text: string; x: number; y: number }

interface Props { breakdown: ScoreBreakdown; companyName: string }

export function IndicatorDetailsClient({ breakdown, companyName }: Props) {
  const [modal, setModal]   = useState<ModalState>(CLOSED)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const showTooltip = useCallback((e: React.MouseEvent, text: string) => {
    setTooltip({ text, x: e.clientX, y: e.clientY })
  }, [])
  const hideTooltip = useCallback(() => setTooltip(null), [])

  const pdfUrl = `${BASE_URL}/api/pdf/${encodeURIComponent(companyName)}`

  const dims = useMemo(() =>
    (["E", "S", "G"] as const).map((dim) => {
      const items = breakdown[dim] ?? []
      const missing = items.filter((i) => i.missing).length
      return { dim, items, missing }
    }),
  [breakdown])

  function openModal(item: IndicatorBreakdownItem) {
    if (!item.pdf_page || item.missing || item.raw_value === false) return
    setModal({
      isOpen: true,
      page: item.pdf_page,
      bbox: item.bbox,
      label: INDICATOR_LABELS[item.key] ?? item.key,
      rawValue: item.raw_value != null ? String(item.raw_value) : null,
      unit: item.unit,
    })
  }

  return (
    <>
      {/* Fixed-position formula tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none fixed z-[9999] max-w-[260px] rounded-lg bg-gray-900 px-3 py-2.5 text-xs leading-relaxed text-white shadow-2xl whitespace-pre-line"
          style={{ left: tooltip.x + 16, top: tooltip.y - 12 }}
        >
          {tooltip.text}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ESG 指標明細</CardTitle>
          <CardDescription>
            各維度量化指標、數值與報告書來源頁碼，點擊頁碼可開啟 PDF；
            滑鼠移到評分欄查看正規化公式
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 pt-2">
          {/* @ts-expect-error shadcn Accordion type prop mismatch */}
          <Accordion type="multiple" defaultValue={["E", "S", "G"]} className="w-full">
            {dims.map(({ dim, items, missing }) => {
              const cfg = DIM_CONFIG[dim]
              const dimScore = items.reduce((s, i) => s + i.contribution, 0) * 100
              const available = items.filter((i) => !i.missing).length

              return (
                <AccordionItem key={dim} value={dim} className="border-b last:border-b-0">
                  <AccordionTrigger className="px-6 hover:no-underline hover:bg-muted/30 transition-colors">
                    <div className="flex flex-1 items-center justify-between gap-3 pr-2">
                      <div className="flex items-center gap-3">
                        {/* Colored dimension badge */}
                        <span className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white",
                          cfg.dimBg,
                        )}>
                          {cfg.label}
                        </span>
                        <div className="text-left">
                          <p className="text-sm font-semibold">{cfg.fullLabel}</p>
                          <p className="text-xs text-muted-foreground">
                            {available}/{items.length} 項已揭露
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {missing > 0 && (
                          <Badge variant="destructive" className="gap-1 text-xs">
                            <AlertTriangle className="size-3" />
                            {missing} 項未揭露
                          </Badge>
                        )}
                        <div className="text-right">
                          <span className="text-lg font-bold tabular-nums leading-none">
                            {dimScore.toFixed(1)}
                          </span>
                          <span className="text-xs text-muted-foreground">/100</span>
                        </div>
                      </div>
                    </div>
                  </AccordionTrigger>

                  <AccordionContent className="p-0">
                    <div className="border-t">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableHead className="w-[38%] pl-6 text-xs">指標名稱</TableHead>
                            <TableHead className="w-[28%] text-right text-xs">數值</TableHead>
                            <TableHead className="w-[24%] text-center text-xs">
                              <span className="inline-flex items-center gap-1">
                                正規化評分
                                <Info className="size-3 text-muted-foreground" />
                              </span>
                            </TableHead>
                            <TableHead className="w-[10%] pr-6 text-right text-xs">來源</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {items.map((item) => {
                            const label = INDICATOR_LABELS[item.key] ?? item.key
                            const dir   = INDICATOR_DIRECTION[item.key]
                            const canClick = !!item.pdf_page && !item.missing && item.raw_value !== false
                            const rawDisplay = formatValue(item)
                            const unitDisplay = (!item.missing && item.unit) ? item.unit : ""

                            return (
                              <TableRow
                                key={item.key}
                                className={cn(
                                  "transition-colors",
                                  item.missing ? "bg-red-50/40 hover:bg-red-50/60" : "hover:bg-muted/20",
                                )}
                              >
                                {/* 指標名稱 */}
                                <TableCell className="pl-6 py-3">
                                  <span className="flex items-center gap-2 text-sm font-medium">
                                    {label}
                                    {item.missing && (
                                      <Badge
                                        variant="outline"
                                        className="h-4 shrink-0 border-red-200 bg-red-50 px-1.5 text-[10px] font-normal text-red-600"
                                      >
                                        未揭露
                                      </Badge>
                                    )}
                                  </span>
                                </TableCell>

                                {/* 數值 + 單位 (merged) */}
                                <TableCell className="py-3 text-right">
                                  {item.missing ? (
                                    <span className="text-sm text-muted-foreground">—</span>
                                  ) : (
                                    <span className="text-sm tabular-nums">
                                      <span className="font-mono">{rawDisplay}</span>
                                      {unitDisplay && (
                                        <span className="ml-1 text-xs text-muted-foreground">
                                          {unitDisplay}
                                        </span>
                                      )}
                                    </span>
                                  )}
                                </TableCell>

                                {/* 正規化評分 */}
                                <TableCell className="py-3 text-center">
                                  <ScoreCell
                                    score={item.normalized}
                                    dir={dir}
                                    onMouseEnter={(e) =>
                                      showTooltip(e, buildFormula(item.key, item.raw_value as number | boolean | null))
                                    }
                                    onMouseLeave={hideTooltip}
                                  />
                                </TableCell>

                                {/* 來源頁碼 */}
                                <TableCell className="pr-6 py-3 text-right">
                                  {canClick ? (
                                    <button
                                      type="button"
                                      onClick={() => openModal(item)}
                                      className="inline-flex items-center gap-1 rounded border bg-card px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                                    >
                                      <FileText className="size-3" />
                                      {item.pdf_page}
                                    </button>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )
            })}
          </Accordion>
        </CardContent>
      </Card>

      <PdfViewerModal
        isOpen={modal.isOpen}
        onClose={() => setModal(CLOSED)}
        pdfUrl={pdfUrl}
        indicatorPage={modal.page}
        bbox={modal.bbox}
        indicatorLabel={modal.label}
        rawValue={modal.rawValue}
        unit={modal.unit}
      />
    </>
  )
}
