"use client"

import { cn } from "@/lib/utils"

interface SnakeSpinnerProps {
  size?: number        // px，外圓直徑
  thickness?: number   // px，光弧厚度
  color?: string       // CSS color，預設使用 primary
  speed?: string       // CSS animation-duration，預設 1.4s
  className?: string
  innerClassName?: string  // 內圓遮罩的 bg class，需與底色一致
}

/**
 * 彗星拖尾旋轉動畫：
 * conic-gradient 畫出一段從透明漸變到亮色再消失的弧線，
 * 整體旋轉製造出「光點帶著尾巴繞圈」的視覺效果。
 */
// 橙色系，直接用 hex 避免 CSS var 格式問題
const DEFAULT_COLOR = "#f97316"  // orange-500

export function SnakeSpinner({
  size = 40,
  thickness = 3,
  color,
  speed = "1.4s",
  className,
  innerClassName,
}: SnakeSpinnerProps) {
  const c     = color ?? DEFAULT_COLOR
  // 用 hex alpha 產生半透明尾巴色
  const cMid  = `${c}80`   // ~50% opacity
  const cTail = `${c}26`   // ~15% opacity

  return (
    <div
      className={cn("relative shrink-0 rounded-full", className)}
      style={{
        width: size,
        height: size,
        background: `conic-gradient(
          from 0deg,
          transparent  0%,
          transparent  55%,
          ${cTail}     65%,
          ${cMid}      80%,
          ${c}         100%
        )`,
        animation: `snake-spin ${speed} linear infinite`,
      }}
    >
      <div
        className={cn("absolute rounded-full", innerClassName ?? "bg-background")}
        style={{ inset: thickness }}
      />
    </div>
  )
}
