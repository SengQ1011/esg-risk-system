"use client"

import { useState, useCallback } from "react"
import dynamic from "next/dynamic"
import { MapPin, TrendingDown, TrendingUp, ToggleRight } from "lucide-react"
import type { IndicatorBreakdownItem } from "@/lib/types"

// pdfjs-dist references DOMMatrix at module scope — must be browser-only
const PdfViewerModal = dynamic(
  () => import("./pdf-viewer-modal").then((m) => m.PdfViewerModal),
  { ssr: false },
)

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

const INDICATOR_LABELS: Record<string, string> = {
  ghg_scope1: "溫室氣體 Scope 1",
  ghg_scope2: "溫室氣體 Scope 2",
  ghg_scope3: "溫室氣體 Scope 3",
  carbon_intensity: "碳排放強度",
  electricity: "用電量",
  renewable_ratio: "再生能源佔比",
  water: "用水量",
  waste: "廢棄物產生量",
  injury_rate: "職災率 (TRIR)",
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
  ghg_scope1: "lower",
  ghg_scope2: "lower",
  ghg_scope3: "lower",
  carbon_intensity: "lower",
  electricity: "lower",
  renewable_ratio: "higher",
  water: "lower",
  waste: "lower",
  injury_rate: "lower",
  turnover: "lower",
  female_ratio: "higher",
  female_mgmt_ratio: "higher",
  training_hours: "higher",
  independent_director_ratio: "higher",
  female_director_ratio: "higher",
  has_sustainability_officer: "boolean",
  assurance: "boolean",
  violations: "lower",
}

// 正規化基準值（對應 config/weights.yaml normalization）
const INDICATOR_MAX_REF: Record<string, number> = {
  ghg_scope1: 20_000_000,
  ghg_scope2: 1_500_000,
  ghg_scope3: 15_000_000,
  carbon_intensity: 500,
  electricity: 5_000_000_000,
  renewable_ratio: 100,
  water: 50_000_000,
  waste: 750_000,
  injury_rate: 5.0,
  turnover: 30.0,
  female_ratio: 100,
  female_mgmt_ratio: 100,
  training_hours: 40,
  independent_director_ratio: 100,
  female_director_ratio: 100,
  violations: 10,
}

const INDICATOR_UNITS: Record<string, string> = {
  ghg_scope1: "公噸CO2e",
  ghg_scope2: "公噸CO2e",
  ghg_scope3: "公噸CO2e",
  carbon_intensity: "公噸CO2e/百萬元",
  electricity: "kWh",
  renewable_ratio: "%",
  water: "立方公尺",
  waste: "公噸",
  injury_rate: "",
  turnover: "%",
  female_ratio: "%",
  female_mgmt_ratio: "%",
  training_hours: "小時",
  independent_director_ratio: "%",
  female_director_ratio: "%",
  violations: "次",
}

function DirectionBadge({ dir }: { dir: Direction }) {
  if (dir === "lower")
    return (
      <span className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1 py-0.5 text-[9px] font-medium text-blue-600">
        <TrendingDown className="size-2.5" />
        越低越好
      </span>
    )
  if (dir === "higher")
    return (
      <span className="inline-flex items-center gap-0.5 rounded bg-green-50 px-1 py-0.5 text-[9px] font-medium text-green-600">
        <TrendingUp className="size-2.5" />
        越高越好
      </span>
    )
  return (
    <span className="inline-flex items-center gap-0.5 rounded bg-purple-50 px-1 py-0.5 text-[9px] font-medium text-purple-600">
      <ToggleRight className="size-2.5" />
      布林值
    </span>
  )
}

function buildFormulaText(key: string, rawValue: number | boolean | null): string {
  const dir = INDICATOR_DIRECTION[key]
  const maxRef = INDICATOR_MAX_REF[key]
  const unit = INDICATOR_UNITS[key] ?? ""

  if (dir === "boolean") {
    return `布林值：有設立 → 1.0，無 → 0.0`
  }
  if (rawValue == null || maxRef == null) {
    return "資料缺失，不計入評分"
  }

  const val = rawValue as number
  const maxStr = maxRef >= 1_000_000
    ? `${(maxRef / 1_000_000).toLocaleString()}M`
    : maxRef >= 1_000
    ? `${(maxRef / 1_000).toLocaleString()}K`
    : String(maxRef)

  if (dir === "lower") {
    const norm = Math.max(0, 1 - val / maxRef)
    return `公式（越低越好）：1 - (${val.toLocaleString()} / ${maxRef.toLocaleString()}) = ${(norm * 100).toFixed(1)}%\n基準最差值：${maxRef.toLocaleString()} ${unit}`
  }
  const norm = Math.min(1, val / maxRef)
  return `公式（越高越好）：${val.toLocaleString()} / ${maxRef.toLocaleString()} = ${(norm * 100).toFixed(1)}%\n基準最佳值：${maxRef.toLocaleString()} ${unit}`
}

interface TooltipState {
  text: string
  x: number
  y: number
}

interface ModalState {
  isOpen: boolean
  page: number
  bbox: [number, number, number, number][] | null
  label: string
  rawValue: string | null
  unit: string | null
}

const CLOSED_MODAL: ModalState = {
  isOpen: false,
  page: 1,
  bbox: null,
  label: "",
  rawValue: null,
  unit: null,
}

interface BreakdownTableClientProps {
  items: IndicatorBreakdownItem[]
  companyName: string
}

export function BreakdownTableClient({ items, companyName }: BreakdownTableClientProps) {
  const [modal, setModal] = useState<ModalState>(CLOSED_MODAL)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const showTooltip = useCallback((e: React.MouseEvent, text: string) => {
    setTooltip({ text, x: e.clientX, y: e.clientY })
  }, [])
  const hideTooltip = useCallback(() => setTooltip(null), [])

  const pdfUrl = `${BASE_URL}/api/pdf/${encodeURIComponent(companyName)}`

  const openModal = (item: IndicatorBreakdownItem) => {
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
    {/* Fixed-position formula tooltip — renders above DOM stacking issues */}
    {tooltip && (
      <div
        className="pointer-events-none fixed z-[9999] max-w-[240px] rounded-md bg-gray-900 px-3 py-2 text-xs leading-relaxed text-white shadow-xl whitespace-pre-line"
        style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
      >
        {tooltip.text}
      </div>
    )}
    <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-gray-500">
            <th className="pb-2 pr-3 font-medium">指標</th>
            <th className="pb-2 pr-3 text-right font-medium">原始值</th>
            <th className="pb-2 pr-3 text-right font-medium">正規化</th>
            <th className="pb-2 text-right font-medium">貢獻分</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const label = INDICATOR_LABELS[item.key] ?? item.key
            const dir = INDICATOR_DIRECTION[item.key]
            // false = 「沒有設立」，沒有頁面可指向；null/0 照正常邏輯
            const isBooleanFalse = item.raw_value === false
            const clickable = !!item.pdf_page && !item.missing && !isBooleanFalse
            const formulaText = buildFormulaText(item.key, item.raw_value as number | boolean | null)

            return (
              <tr
                key={item.key}
                onClick={() => openModal(item)}
                className={[
                  "border-b last:border-0 transition-colors",
                  clickable
                    ? "cursor-pointer hover:bg-yellow-50"
                    : "cursor-default",
                ].join(" ")}
              >
                {/* 指標名稱 + 方向標籤 */}
                <td className="py-2 pr-3 text-gray-700">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      {label}
                      {item.missing && (
                        <span className="text-[10px] text-orange-500">(缺失)</span>
                      )}
                      {clickable && (
                        <MapPin className="size-3 shrink-0 text-yellow-500" />
                      )}
                    </div>
                    {dir && <DirectionBadge dir={dir} />}
                  </div>
                </td>

                {/* 原始值 */}
                <td className="py-2 pr-3 text-right text-gray-500">
                  {item.raw_value != null
                    ? `${item.raw_value}${item.unit ? ` ${item.unit}` : ""}`
                    : "—"}
                </td>

                {/* 正規化 + 進度條 + 公式 tooltip */}
                <td className="py-2 pr-3">
                  <div
                    className="flex flex-col items-end gap-1 cursor-help"
                    onMouseEnter={(e) => showTooltip(e, formulaText)}
                    onMouseLeave={hideTooltip}
                  >
                    <span className="text-gray-700 font-medium">
                      {item.normalized != null
                        ? `${(item.normalized * 100).toFixed(1)}%`
                        : "—"}
                    </span>
                    {item.normalized != null && (
                      <div className="h-1 w-16 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className={[
                            "h-full rounded-full transition-all",
                            item.normalized >= 0.7
                              ? "bg-green-400"
                              : item.normalized >= 0.4
                              ? "bg-yellow-400"
                              : "bg-red-400",
                          ].join(" ")}
                          style={{ width: `${(item.normalized * 100).toFixed(1)}%` }}
                        />
                      </div>
                    )}
                  </div>
                </td>

                {/* 貢獻分 */}
                <td className="py-2 text-right font-medium text-gray-800">
                  {(item.contribution * 100).toFixed(2)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <PdfViewerModal
        isOpen={modal.isOpen}
        onClose={() => setModal(CLOSED_MODAL)}
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
