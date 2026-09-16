import type { Blog, ImageItem, StorageFile, StorageFolder, StorageUsage } from './api'

export type CloudSnapshot = {
  images: ImageItem[]
  files: StorageFile[]
  folders: StorageFolder[]
  usage: StorageUsage | null
  blogs: Blog[]
  syncedAt: number
}

const emptySnapshot = (): CloudSnapshot => ({ images: [], files: [], folders: [], usage: null, blogs: [], syncedAt: 0 })

function cacheKey(server: string, user: string) {
  return `radish-phone-cache:${server}:${user}`
}

export function readCache(server: string, user: string): CloudSnapshot {
  try {
    const value = JSON.parse(localStorage.getItem(cacheKey(server, user)) || 'null') as CloudSnapshot | null
    return value ? { ...emptySnapshot(), ...value } : emptySnapshot()
  } catch {
    return emptySnapshot()
  }
}

export function writeCache(server: string, user: string, snapshot: CloudSnapshot) {
  localStorage.setItem(cacheKey(server, user), JSON.stringify(snapshot))
}

export function clearCache(server: string, user: string) {
  localStorage.removeItem(cacheKey(server, user))
}
