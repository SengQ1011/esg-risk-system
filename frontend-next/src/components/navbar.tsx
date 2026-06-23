import Link from "next/link"
import { BarChart3 } from "lucide-react"

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-bold text-gray-900">
          <BarChart3 className="size-5 text-green-600" />
          ESG 風險評分系統
        </Link>
        <nav className="flex items-center gap-6 text-sm font-medium text-gray-600">
          <Link href="/" className="hover:text-gray-900">公司列表</Link>
          <Link href="/compare" className="hover:text-gray-900">三家比較</Link>
        </nav>
      </div>
    </header>
  )
}
