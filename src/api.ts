import { fetch as nativeFetch } from '@tauri-apps/plugin-http'
import { isTauri } from '@tauri-apps/api/core'

export type Session = { access_token: string; user_name: string; email: string; avatar?: string | null }
export type ImageItem = { uuid: string; filename: string; thumbnail_url: string; size: number; timestamp: string }
export type StorageFile = { file_uuid: string; original_filename: string; size: number; mime_type: string; folder_name?: string }
export type Blog = { file_uuid: string; title: string; summary: string; user_name: string; category: string; tags?: string[] }

const sessionKey = 'radish-phone-session'
export const loadSession = (): Session | null => {
  try { return JSON.parse(localStorage.getItem(sessionKey) || 'null') as Session | null }
  catch { return null }
}
export const saveSession = (session: Session | null) => {
  if (session) localStorage.setItem(sessionKey, JSON.stringify(session))
  else localStorage.removeItem(sessionKey)
}

export function normalizeServer(value: string): string {
  const url = new URL(value.trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('服务地址必须以 http:// 或 https:// 开头')
  return url.origin + url.pathname.replace(/\/$/, '')
}

export class Api {
  readonly base: string
  readonly token?: string
  constructor(base: string, token?: string) { this.base = base; this.token = token }
  url(path: string) { return this.base + path }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`)
    const response = await (isTauri() ? nativeFetch : fetch)(this.url(path), { ...init, headers })
    if (!response.ok) {
      let detail = `HTTP ${response.status}`
      try { detail = (await response.json()).detail || detail } catch { /* non-JSON error */ }
      throw new Error(String(detail))
    }
    const type = response.headers.get('content-type') || ''
    return (type.includes('application/json') ? response.json() : response.text()) as Promise<T>
  }

  login(username: string, password: string) {
    const form = new FormData()
    form.append('username', username)
    form.append('password', password)
    return this.request<Session>('/api/login/?encode_mode=0', { method: 'POST', body: form })
  }
  validate() { return this.request<{ detail: string }>('/api/login/timeliness/', { method: 'POST' }) }
  imageList(page = 1) {
    const form = new FormData()
    form.append('pages', String(page))
    form.append('page_size', '24')
    return this.request<{ images: ImageItem[]; pagination: { has_next: boolean } }>('/api/image-bed/list', { method: 'POST', body: form })
  }
  uploadImage(file: File) {
    const form = new FormData()
    form.append('file', file)
    return this.request('/api/image-bed/upload', { method: 'POST', body: form })
  }
  storageList(page = 1) {
    return this.request<{ files: StorageFile[]; pagination?: { has_next: boolean } }>(`/api/storage/list?page=${page}&page_size=20`)
  }
  storageUsage() { return this.request<{ used: number; max_storage: number; file_count: number }>('/api/storage/disk-usage') }
  uploadStorage(file: File) {
    const form = new FormData()
    form.append('file', file)
    return this.request('/api/storage/upload', { method: 'POST', body: form })
  }
  exploreBlogs(page = 1) {
    return this.request<{ blogs: Blog[]; pagination: { has_next: boolean } }>(`/api/blog/explore/?page=${page}&page_size=10`)
  }
  blogContent(uuid: string) {
    return this.request<string>(`/api/blog/content/${encodeURIComponent(uuid.replace(/\.md$/, ''))}.md`, { method: 'POST' })
  }
  uploadBlog(file: File) {
    const form = new FormData()
    form.append('file', file)
    form.append('public_status', '1')
    return this.request<{ status: string; message: string }>('/api/blog/upload', { method: 'POST', body: form })
  }
}
