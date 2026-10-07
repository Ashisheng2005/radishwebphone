import { fetch as nativeFetch } from '@tauri-apps/plugin-http'
import { isTauri } from '@tauri-apps/api/core'

export type Session = { access_token: string; user_name: string; email: string; avatar?: string | null }
export type UploadProgress = { loaded: number; total: number; phase: 'uploading' | 'processing' }
export type ProgressHandler = (progress: UploadProgress) => void
export type LoginInfo = { username: string; password: string }
export type ImageItem = { uuid: string; filename: string; thumbnail_url: string; size: number; timestamp: string }
export type StorageFile = { file_uuid: string; original_filename: string; size: number; mime_type: string; folder_name?: string; folder_id?: number | null; created_at?: string }
export type StorageFolder = { id: number; folder_name: string; file_count?: number; created_at?: string }
export type StorageUsage = { used: number; max_storage: number; file_count: number; max_files?: number; usage_percent?: number }
export type Blog = { file_uuid: string; title: string; summary: string; user_name: string; category: string; tags?: string[]; upload_time?: string; update_time?: string }
export type Pagination = { current_page?: number; total_pages?: number; total_count?: number; has_next: boolean; has_prev?: boolean }

export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const sessionKey = 'radish-phone-session'
const loginInfoKey = 'radish-phone-login-info'
export const loadSession = (): Session | null => {
  try { return JSON.parse(localStorage.getItem(sessionKey) || 'null') as Session | null }
  catch { return null }
}
export const saveSession = (session: Session | null) => {
  if (session) localStorage.setItem(sessionKey, JSON.stringify(session))
  else localStorage.removeItem(sessionKey)
}
export const loadLoginInfo = (): LoginInfo | null => {
  try {
    const value = JSON.parse(localStorage.getItem(loginInfoKey) || 'null') as Partial<LoginInfo> | null
    return value?.username && typeof value.password === 'string' ? { username: value.username, password: value.password } : null
  } catch { return null }
}
export const saveLoginInfo = (info: LoginInfo) => localStorage.setItem(loginInfoKey, JSON.stringify(info))

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
    const response = await (isTauri() ? nativeFetch : fetch)(this.url(path), { ...init, headers, signal: init.signal ?? AbortSignal.timeout(20000) })
    if (!response.ok) {
      let detail = `HTTP ${response.status}`
      try { detail = (await response.json()).detail || detail } catch { /* non-JSON error */ }
      throw new ApiError(String(detail), response.status)
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
    form.append('page_size', '48')
    return this.request<{ images: ImageItem[]; pagination: Pagination }>('/api/image-bed/list', { method: 'POST', body: form })
  }
  upload<T = unknown>(path: string, form: FormData, onProgress?: ProgressHandler): Promise<T> {
    // Send File objects directly: nativeFetch buffers multipart data into a JS number array.
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', this.url(path))
      if (this.token) xhr.setRequestHeader('Authorization', `Bearer ${this.token}`)
      xhr.timeout = 30 * 60 * 1000
      xhr.upload.onprogress = event => onProgress?.({ loaded: event.loaded, total: event.lengthComputable ? event.total : 0, phase: 'uploading' })
      xhr.upload.onload = () => onProgress?.({ loaded: 0, total: 0, phase: 'processing' })
      xhr.onerror = () => reject(new Error('上传连接失败，请检查网络及服务器跨域设置'))
      xhr.ontimeout = () => reject(new Error('上传超时，请重试'))
      xhr.onabort = () => reject(new Error('上传已取消'))
      xhr.onload = () => {
        let result
        try { result = JSON.parse(xhr.responseText) } catch { result = xhr.responseText }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new ApiError(typeof result?.detail === 'string' ? result.detail : `上传失败 (HTTP ${xhr.status})`, xhr.status))
        } else resolve(result as T)
      }
      onProgress?.({ loaded: 0, total: 0, phase: 'uploading' })
      xhr.send(form)
    })
  }
  uploadImage(file: File, onProgress?: ProgressHandler) {
    const types: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }
    const mime = types[file.name.split('.').pop()?.toLowerCase() || '']
    if (!mime) throw new Error('支持 JPG、PNG、GIF、WebP 和 SVG 图片，请先转换图片格式')
    if (file.size > 10 * 1024 * 1024) throw new Error('图片大小不能超过 10 MB')
    const form = new FormData()
    form.append('file', file.type.startsWith('image/') ? file : file.slice(0, file.size, mime), file.name)
    return this.upload('/api/image-bed/upload', form, onProgress)
  }
  storageList(page = 1, folderId?: number) {
    const folder = folderId === undefined ? '' : `&folder_id=${folderId}`
    return this.request<{ files: StorageFile[]; pagination?: Pagination }>(`/api/storage/list?page=${page}&page_size=50${folder}`)
  }
  storageUsage() { return this.request<StorageUsage>('/api/storage/disk-usage') }
  async storageFolders() {
    const result = await this.request<{ folders: (StorageFolder & { project_name?: string })[] }>('/api/storage/folders')
    return { folders: (result.folders || []).map(folder => ({ ...folder, id: Number(folder.id), folder_name: folder.project_name || folder.folder_name || '未命名分组' })) }
  }
  uploadStorage(file: File, onProgress?: ProgressHandler, folderId?: number) {
    const form = new FormData()
    form.append('file', file)
    if (folderId !== undefined) form.append('folder_id', String(folderId))
    return this.upload('/api/storage/upload', form, onProgress)
  }
  exploreBlogs(page = 1) {
    return this.request<{ blogs: Blog[]; pagination: Pagination }>(`/api/blog/explore/?page=${page}&page_size=30`)
  }
  async blogContent(uuid: string) {
    const result = await this.request<string | { success?: boolean; data?: { content?: unknown }; content?: unknown; detail?: unknown }>(`/api/blog/content/${encodeURIComponent(uuid.replace(/\.md$/, ''))}.md`, { method: 'POST' })
    if (typeof result === 'string') return result
    const content = result?.data?.content ?? result?.content
    if (typeof result?.detail === 'string') throw new Error(result.detail)
    if (typeof content !== 'string') throw new Error('文章内容格式不正确')
    return content
  }
  uploadBlog(file: File, onProgress?: ProgressHandler) {
    const form = new FormData()
    form.append('file', file)
    form.append('public_status', '1')
    return this.upload<{ status: string; message: string }>('/api/blog/upload', form, onProgress)
  }
}
