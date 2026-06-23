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

/**
 * Mock: POST /api/company/analyze
 * In production this would send multipart/form-data to the backend.
 * Returns a mock job_id so the frontend flow can be demonstrated.
 */
export async function analyzeCompany(
  companyName: string,
  _file?: File,
): Promise<AnalyzeResponse> {
  // Simulate brief network delay
  await new Promise((resolve) => setTimeout(resolve, 300))
  return {
    job_id: `mock-${Date.now()}`,
    company_name: companyName || "新公司",
  }
}
