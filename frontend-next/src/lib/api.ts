import type {
  CompaniesResponse,
  CompanyDetailResponse,
  DashboardResponse,
  HistoryResponse,
  AnalyzeResponse,
} from "./types"

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { cache: "no-store" })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(body.detail ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function fetchCompanies(): Promise<CompaniesResponse> {
  return apiFetch<CompaniesResponse>("/api/companies")
}

export async function fetchCompanyDetail(name: string): Promise<CompanyDetailResponse> {
  return apiFetch<CompanyDetailResponse>(`/api/company/${encodeURIComponent(name)}`)
}

export async function fetchDashboard(): Promise<DashboardResponse> {
  return apiFetch<DashboardResponse>("/api/dashboard")
}

export async function fetchHistory(name: string): Promise<HistoryResponse> {
  return apiFetch<HistoryResponse>(`/api/company/${encodeURIComponent(name)}/history`)
}

/** POST /api/company/analyze — multipart/form-data */
export async function analyzeCompany(
  companyName: string,
  file?: File,
): Promise<AnalyzeResponse> {
  const form = new FormData()
  if (companyName) form.append("company_name", companyName)
  form.append("year", "2023")
  if (file) form.append("pdf_file", file)

  const res = await fetch(`${BASE_URL}/api/company/analyze`, {
    method: "POST",
    body: form,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(body.detail ?? `HTTP ${res.status}`)
  }
  const json = await res.json()
  return json.data as AnalyzeResponse
}

/** GET /api/job/{jobId} — polling fallback */
export async function fetchJobStatus(jobId: string) {
  const res = await fetch(`${BASE_URL}/api/job/${jobId}`, { cache: "no-store" })
  if (!res.ok) return null
  const json = await res.json()
  return json.data as {
    job_id: string
    company_name: string
    status: string       // pending | running | done | error
    current_step: string
    progress: number
    error_message: string | null
  }
}

/** WebSocket URL：http → ws，https → wss */
export function getWsUrl(path: string): string {
  return `${BASE_URL.replace(/^http/, "ws")}${path}`
}
