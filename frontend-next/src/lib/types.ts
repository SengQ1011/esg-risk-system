export interface CompanyLatestScore {
  total_score: number | null
  grade: string | null
  grade_label: string | null
  e_score: number | null
  s_score: number | null
  g_score: number | null
  report_year: number | null
}

export interface CompanySummary {
  name: string
  ticker: string
  industry: string
  latest_score: CompanyLatestScore | null
}

export interface CompaniesResponse {
  status: string
  data: CompanySummary[]
}

export interface IndicatorBreakdownItem {
  key: string
  raw_value: number | boolean | null
  unit: string | null
  source_page: number | null
  pdf_page: number | null      // PyMuPDF 確認的物理頁碼（react-pdf 1-based），優先用此跳頁
  bbox: [number, number, number, number][] | null  // list of [x0,y0,x1,y1]，支援多個 highlight
  confidence: number
  normalized: number | null
  weight: number
  contribution: number
  missing: boolean
}

export interface ScoreBreakdown {
  E: IndicatorBreakdownItem[]
  S: IndicatorBreakdownItem[]
  G: IndicatorBreakdownItem[]
}

export interface Warning {
  type: string
  level: "high" | "medium" | "low"
  message: string
}

export interface NewsEvent {
  title: string
  date: string
  url: string
  source: string
  severity: "critical" | "high" | "medium" | "low" | "positive"
  category: string
  summary?: string
}

export interface GreenwashDetail {
  description: string
  claim_quote: string
  source_page: number | null
}

export interface DecisionLight {
  level: string
  color: "green" | "yellow" | "red"
}

export interface DecisionLights {
  credit: DecisionLight
  investment: DecisionLight
  underwriting: DecisionLight
}

export interface CompanyDetail {
  company: {
    name: string
    ticker: string
    industry: string
  }
  page_offset: number
  score: {
    total_score: number
    grade: string
    grade_label: string
    e_score: number
    s_score: number
    g_score: number
    news_event_score: number
    greenwash_flag: boolean
    report_year: number | null
    timestamp: string | null
  }
  breakdown: ScoreBreakdown
  warnings: Warning[]
  reasoning: string | null
  decision: DecisionLights
  news_events: NewsEvent[]
  greenwash_details: GreenwashDetail[]
}

export interface CompanyDetailResponse {
  status: string
  data: CompanyDetail
}

export interface DashboardCompany {
  name: string
  ticker: string
  industry: string
  total_score: number
  grade: string
  e_score: number
  s_score: number
  g_score: number
  greenwash_flag: boolean
  news_event_score: number
}

export interface RadarDataPoint {
  subject: string
  [companyName: string]: string | number
}

export interface DashboardData {
  companies: DashboardCompany[]
  radar_data: RadarDataPoint[]
}

export interface DashboardResponse {
  status: string
  data: DashboardData
}

export interface HistoryEntry {
  score_id: number
  total_score: number
  grade: string
  e_score: number
  s_score: number
  g_score: number
  report_year: number | null
  timestamp: string | null
}

export interface HistoryResponse {
  status: string
  data: HistoryEntry[]
}

export interface JobStatus {
  job_id: string
  company_name: string
  step: string
  progress: number  // 0-100
  done: boolean
  error: string | null
}

export interface AnalyzeResponse {
  job_id: string
  company_name: string
}
