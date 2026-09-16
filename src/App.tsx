import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowLeft, Bot, ChevronDown, ChevronRight, CircleUserRound, Clock3, File, FileArchive,
  FileImage, FileText, Folder, Grid2X2, HardDrive, Images, LayoutList, LoaderCircle,
  LogOut, MessageCircle, MoreHorizontal, Plus, RefreshCw, Search, Server, Settings2,
  SlidersHorizontal, Sparkles, WifiOff, X,
} from 'lucide-react'
import {
  Api, loadSession, normalizeServer, saveSession,
  type Blog, type ImageItem, type Session, type StorageFile, type StorageFolder, type StorageUsage,
} from './api'
import { readCache, writeCache, type CloudSnapshot } from './cache'
import './App.css'

type Tab = 'images' | 'storage' | 'blogs' | 'chat'
type Screen = 'login' | 'sync' | 'app'
type IconType = typeof Images
const markdownComponents: Components = {
  a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a>,
  img: ({ alt, ...props }) => <img {...props} alt={alt || ''} loading="lazy" />,
}
const serverKey = 'radish-phone-server'
const productionServer = 'https://radishtools.fun'
const developmentServer = 'http://127.0.0.1:8002'
const defaultServer = import.meta.env.DEV ? developmentServer : productionServer
const developmentServerKey = 'radish-phone-development-server'
if (import.meta.env.DEV && localStorage.getItem(developmentServerKey) !== developmentServer) {
  localStorage.setItem(serverKey, developmentServer)
  localStorage.setItem(developmentServerKey, developmentServer)
  saveSession(null)
}
const initialServer = localStorage.getItem(serverKey) || defaultServer
const blankSnapshot = (): CloudSnapshot => ({ images: [], files: [], folders: [], usage: null, blogs: [], syncedAt: 0 })

const formatSize = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
const formatDate = (value?: string) => {
  if (!value) return '最近更新'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date)
}
const formatSyncTime = (value: number) => {
  if (!value) return '尚未同步'
  const seconds = Math.floor((Date.now() - value) / 1000)
  if (seconds < 60) return '刚刚同步'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前同步`
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(value)
}
const errorMessage = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  if (normalized.includes('not found') || normalized.includes('http 404')) return fallback
  if (normalized.includes('failed to fetch') || normalized.includes('network')) return '无法连接服务器，请检查网络后重试'
  return message
}
const fileIcon = (mime = ''): IconType => {
  if (mime.startsWith('image/')) return FileImage
  if (mime.includes('zip') || mime.includes('rar')) return FileArchive
  if (mime.includes('text') || mime.includes('pdf') || mime.includes('document')) return FileText
  return File
}
const avatarUrl = (server: string, avatar?: string | null) => {
  if (!avatar) return ''
  if (/^(https?:|data:|blob:)/.test(avatar)) return avatar
  return `${server}${avatar.startsWith('/') ? '' : '/'}${avatar}`
}

async function loadAllImages(client: Api) {
  const items: ImageItem[] = []
  for (let page = 1; page <= 100; page += 1) {
    const result = await client.imageList(page)
    items.push(...(result.images || []))
    if (!result.pagination?.has_next) break
  }
  return items
}
async function loadAllFiles(client: Api) {
  const items: StorageFile[] = []
  for (let page = 1; page <= 100; page += 1) {
    const result = await client.storageList(page)
    items.push(...(result.files || []))
    if (!result.pagination?.has_next) break
  }
  return items
}
async function loadAllBlogs(client: Api) {
  const items: Blog[] = []
  for (let page = 1; page <= 100; page += 1) {
    const result = await client.exploreBlogs(page)
    items.push(...(result.blogs || []))
    if (!result.pagination?.has_next) break
  }
  return items
}

function IconButton({ label, children, onClick }: { label: string; children: ReactNode; onClick?: () => void }) {
  return <button type="button" className="icon-button" aria-label={label} onClick={onClick}>{children}</button>
}
function EmptyState({ icon: Icon, title, text, action }: { icon: IconType; title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={25} /></div><h3>{title}</h3><p>{text}</p>{action}</div>
}
function UserAvatar({ src, name }: { src: string; name: string }) {
  return <span className="user-avatar"><span>{name.slice(0, 1).toUpperCase() || 'U'}</span>{src && <img src={src} alt={name} onError={event => { event.currentTarget.style.display = 'none' }} />}</span>
}

function App() {
  const [screen, setScreen] = useState<Screen>(() => initialServer && loadSession() ? 'sync' : 'login')
  const [serverInput, setServerInput] = useState(initialServer)
  const [server, setServer] = useState(initialServer)
  const [session, setSession] = useState<Session | null>(loadSession)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showServer, setShowServer] = useState(!initialServer)
  const [tab, setTab] = useState<Tab>('images')
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [selectedImage, setSelectedImage] = useState<ImageItem | null>(null)
  const [selectedArticle, setSelectedArticle] = useState<{ blog: Blog; content: string } | null>(null)
  const [fileView, setFileView] = useState<'list' | 'grid'>('list')
  const [activeFolder, setActiveFolder] = useState<StorageFolder | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<CloudSnapshot>(() => session && initialServer ? readCache(initialServer, session.user_name) : blankSnapshot())
  const api = useMemo(() => server ? new Api(server, session?.access_token) : null, [server, session])

  const syncCloud = useCallback(async (background = false, target?: Tab) => {
    if (!server || !session) return false
    if (background) setRefreshing(true)
    else setBusy(true)
    setMessage('')
    const client = new Api(server, session.access_token)
    try {
      const validity = await client.validate()
      if (validity.detail !== 'yes') throw new Error('登录已过期，请重新登录')
      if (target === 'chat') {
        setMessage('模型对话服务尚未接入，当前没有可同步的数据')
        return true
      }
      const updates: Partial<CloudSnapshot> = {}
      if (!target) {
        const [images, storage, blogs] = await Promise.all([
          loadAllImages(client),
          Promise.all([loadAllFiles(client), client.storageFolders(), client.storageUsage()]),
          loadAllBlogs(client),
        ])
        updates.images = images; updates.files = storage[0]; updates.folders = storage[1].folders || []; updates.usage = storage[2]; updates.blogs = blogs
      } else if (target === 'images') updates.images = await loadAllImages(client)
      else if (target === 'storage') {
        const [files, folders, usage] = await Promise.all([loadAllFiles(client), client.storageFolders(), client.storageUsage()])
        updates.files = files; updates.folders = folders.folders || []; updates.usage = usage
      }
      else if (target === 'blogs') updates.blogs = await loadAllBlogs(client)
      setSnapshot(current => {
        const next = { ...current, ...updates, syncedAt: Date.now() }
        writeCache(server, session.user_name, next)
        return next
      })
      return true
    } catch (error) {
      const cached = readCache(server, session.user_name)
      if (cached.syncedAt) {
        setSnapshot(cached)
        setMessage(`当前显示本地记录 · ${errorMessage(error, '部分云端服务暂不可用')}`)
        return true
      }
      setMessage(errorMessage(error, '部分云端服务暂不可用'))
      return false
    } finally { setBusy(false); setRefreshing(false) }
  }, [server, session])

  useEffect(() => {
    if (screen !== 'sync') return
    let active = true
    // The sync screen owns this one-time network synchronization lifecycle.
    // eslint-disable-next-line react/set-state-in-effect
    void syncCloud().then(ok => {
      if (!active) return
      if (ok) window.setTimeout(() => active && setScreen('app'), 300)
      else setScreen('login')
    })
    return () => { active = false }
  }, [screen, syncCloud])

  async function login() {
    setBusy(true); setMessage('')
    try {
      const nextServer = normalizeServer(serverInput)
      const result = await new Api(nextServer).login(username.trim(), password)
      localStorage.setItem(serverKey, nextServer); saveSession(result)
      setServer(nextServer); setSession(result); setPassword(''); setScreen('sync')
    } catch (error) { setMessage(errorMessage(error, '无法连接登录服务，请检查服务地址')) }
    finally { setBusy(false) }
  }
  function logout() {
    saveSession(null); setSession(null); setSnapshot(blankSnapshot()); setScreen('login'); setShowServer(false); setMessage('')
  }
  function changeServer(value: string) {
    try {
      const nextServer = normalizeServer(value)
      localStorage.setItem(serverKey, nextServer); saveSession(null)
      setServerInput(nextServer); setServer(nextServer); setSession(null); setSnapshot(blankSnapshot())
      setSettingsOpen(false); setShowServer(false); setMessage('服务器已修改，请重新登录'); setScreen('login')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
  }
  async function upload(kind: 'images' | 'storage' | 'blogs', file?: File) {
    if (!file || !api) return
    setBusy(true); setMessage('')
    try {
      if (kind === 'images') await api.uploadImage(file)
      if (kind === 'storage') await api.uploadStorage(file)
      if (kind === 'blogs') await api.uploadBlog(file)
      setMessage(kind === 'blogs' ? '文章已提交，审核通过后会出现在“发现”中' : '上传完成')
      await syncCloud(true, kind)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  async function openArticle(blog: Blog) {
    if (!api) return
    setBusy(true); setMessage('')
    try { setSelectedArticle({ blog, content: await api.blogContent(blog.file_uuid) }) }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }

  if (screen === 'login') return <LoginScreen serverInput={serverInput} setServerInput={setServerInput} username={username} setUsername={setUsername} password={password} setPassword={setPassword} showServer={showServer} setShowServer={setShowServer} busy={busy} message={message} onLogin={() => void login()} />
  if (screen === 'sync') return <SyncScreen user={session?.user_name || ''} failed={message} />

  return <div className="phone-shell"><div className="app-frame">
    <AppHeader tab={tab} user={session?.user_name || ''} avatar={avatarUrl(server, session?.avatar)} syncedAt={snapshot.syncedAt} refreshing={refreshing} onRefresh={() => void syncCloud(true, tab)} onSettings={() => setSettingsOpen(true)} onLogout={logout} />
    {message && <div className="notice"><WifiOff size={15} /><span>{message}</span><button onClick={() => setMessage('')}>关闭</button></div>}
    <main className="app-content">
      {tab === 'images' && <GalleryPage items={snapshot.images} api={api!} search={search} setSearch={setSearch} busy={busy} onUpload={file => void upload('images', file)} onSelect={setSelectedImage} />}
      {tab === 'storage' && <StoragePage files={snapshot.files} folders={snapshot.folders} usage={snapshot.usage} activeFolder={activeFolder} setActiveFolder={setActiveFolder} view={fileView} setView={setFileView} busy={busy} onUpload={file => void upload('storage', file)} />}
      {tab === 'blogs' && <BlogPage blogs={snapshot.blogs} search={search} setSearch={setSearch} busy={busy} onOpen={blog => void openArticle(blog)} onUpload={file => void upload('blogs', file)} />}
      {tab === 'chat' && <ChatPage />}
    </main>
    <BottomNav tab={tab} setTab={next => { setTab(next); setSearch(''); setSelectedArticle(null); setActiveFolder(null) }} />
  </div>
  {selectedImage && <ImageViewer image={selectedImage} api={api!} onClose={() => setSelectedImage(null)} onMessage={setMessage} />}
  {selectedArticle && <ArticleViewer article={selectedArticle} server={server} onClose={() => setSelectedArticle(null)} />}
  {settingsOpen && <SettingsPage server={server} user={session?.user_name || ''} avatar={avatarUrl(server, session?.avatar)} onClose={() => setSettingsOpen(false)} onSave={changeServer} onLogout={logout} />}
  </div>
}

type LoginProps = { serverInput: string; setServerInput: (v: string) => void; username: string; setUsername: (v: string) => void; password: string; setPassword: (v: string) => void; showServer: boolean; setShowServer: (v: boolean) => void; busy: boolean; message: string; onLogin: () => void }
function LoginScreen(p: LoginProps) {
  return <div className="auth-screen">
    <div className="auth-top"><div className="brand-mark"><img src="/mascot-app-icon.png" alt="" /></div><span>RADISH</span></div>
    <div className="auth-visual" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="visual-card card-one"><Images size={19} /><span>照片</span></div><div className="visual-card card-two"><Folder size={19} /><span>文件</span></div><div className="visual-card card-three"><FileText size={19} /><span>文章</span></div><div className="visual-center"><img src="/mascot-app-icon.png" alt="" /></div></div>
    <section className="auth-panel"><p className="eyebrow">RADISH PHONE</p><h1>欢迎回来</h1><p className="auth-copy">登录后同步你的照片、文件和文章。</p>
      <form onSubmit={e => { e.preventDefault(); p.onLogin() }}>
        {p.showServer && <label className="field"><span>服务器地址</span><div><Server size={18} /><input type="url" placeholder="https://example.com" value={p.serverInput} onChange={e => p.setServerInput(e.target.value)} /></div></label>}
        <label className="field"><span>用户名</span><div><CircleUserRound size={18} /><input autoComplete="username" placeholder="输入用户名" value={p.username} onChange={e => p.setUsername(e.target.value)} /></div></label>
        <label className="field"><span>密码</span><div><b className="password-dot">••</b><input type="password" autoComplete="current-password" placeholder="输入密码" value={p.password} onChange={e => p.setPassword(e.target.value)} /></div></label>
        {p.message && <p className="form-error">{p.message}</p>}
        <button className="primary-button" disabled={p.busy || !p.serverInput || !p.username || !p.password}>{p.busy && <LoaderCircle className="spin" size={19} />}{p.busy ? '正在登录…' : '登录并同步'}</button>
      </form>
      <button className="server-toggle" onClick={() => p.setShowServer(!p.showServer)}><Settings2 size={15} />{p.showServer ? '收起服务设置' : `当前服务 · ${p.serverInput.replace(/^https?:\/\//, '') || '未设置'}`}</button>
    </section>
  </div>
}
function SyncScreen({ user, failed }: { user: string; failed: string }) {
  return <div className="sync-screen"><div className="sync-graphic"><img src="/mascot-app-icon.png" alt="radishtools" /><span /></div><p className="eyebrow">RADISH CLOUD</p><h1>{failed ? '正在打开本地记录' : '正在准备你的空间'}</h1><p>{failed ? '网络暂时不可用，正在读取上次同步的内容。' : `${user ? `${user}，` : ''}照片、文件和文章正在从云端同步。`}</p><div className="sync-line"><span /></div></div>
}

const titles: Record<Tab, [string, string]> = { images: ['LIBRARY', '相册'], storage: ['CLOUD DRIVE', '文件'], blogs: ['DISCOVER', '发现'], chat: ['RADISH AI', '对话'] }
function AppHeader({ tab, user, avatar, syncedAt, refreshing, onRefresh, onSettings, onLogout }: { tab: Tab; user: string; avatar: string; syncedAt: number; refreshing: boolean; onRefresh: () => void; onSettings: () => void; onLogout: () => void }) {
  const [menu, setMenu] = useState(false)
  return <header className="app-header"><div><p>{titles[tab][0]} <span className="sync-time">· {formatSyncTime(syncedAt)}</span></p><h1>{titles[tab][1]}</h1></div><div className="header-actions"><IconButton label={`刷新${titles[tab][1]}`} onClick={onRefresh}><RefreshCw size={20} className={refreshing ? 'spin' : ''} /></IconButton><button className="avatar-button" onClick={() => setMenu(!menu)}><UserAvatar src={avatar} name={user} /></button></div>{menu && <div className="account-menu"><div className="account-summary"><UserAvatar src={avatar} name={user} /><div><strong>{user}</strong><span>已连接 RadishWeb</span></div></div><button onClick={() => { setMenu(false); onSettings() }}><Settings2 size={16} />设置</button><button onClick={onLogout}><LogOut size={16} />退出登录</button></div>}</header>
}
function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <label className="search-bar"><Search size={18} /><input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} /></label>
}
function UploadButton({ accept, disabled, label, onFile }: { accept?: string; disabled: boolean; label: string; onFile: (f?: File) => void }) {
  return <label className={`upload-button ${disabled ? 'disabled' : ''}`}><Plus size={22} /><span>{label}</span><input type="file" accept={accept} disabled={disabled} onChange={e => { onFile(e.target.files?.[0]); e.target.value = '' }} /></label>
}

function GalleryPage({ items, api, search, setSearch, busy, onUpload, onSelect }: { items: ImageItem[]; api: Api; search: string; setSearch: (v: string) => void; busy: boolean; onUpload: (f?: File) => void; onSelect: (i: ImageItem) => void }) {
  const [filterOpen, setFilterOpen] = useState(false)
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [format, setFormat] = useState<'all' | 'jpg' | 'png' | 'gif' | 'webp'>('all')
  const [sizeFilter, setSizeFilter] = useState<'all' | 'small' | 'medium' | 'large'>('all')
  const [period, setPeriod] = useState<'all' | '7' | '30'>('all')
  const [filterReferenceTime] = useState(() => Date.now())
  const activeFilters = Number(format !== 'all') + Number(sizeFilter !== 'all') + Number(period !== 'all')
  const filtered = items.filter(item => {
    if (!item.filename.toLowerCase().includes(search.toLowerCase())) return false
    const extension = item.filename.split('.').pop()?.toLowerCase() || ''
    if (format === 'jpg' && !['jpg', 'jpeg'].includes(extension)) return false
    if (format !== 'all' && format !== 'jpg' && extension !== format) return false
    if (sizeFilter === 'small' && item.size >= 1024 ** 2) return false
    if (sizeFilter === 'medium' && (item.size < 1024 ** 2 || item.size >= 10 * 1024 ** 2)) return false
    if (sizeFilter === 'large' && item.size < 10 * 1024 ** 2) return false
    if (period !== 'all') {
      const timestamp = new Date(item.timestamp).getTime()
      if (Number.isFinite(timestamp) && filterReferenceTime - timestamp > Number(period) * 86400000) return false
    }
    return true
  }).sort((a, b) => {
    const delta = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    return sort === 'newest' ? delta : -delta
  })
  const resetFilters = () => { setSort('newest'); setFormat('all'); setSizeFilter('all'); setPeriod('all') }
  return <section className="page gallery-page"><div className="toolbar"><SearchBar value={search} onChange={setSearch} placeholder="搜索照片" /><button className={`filter-button ${activeFilters ? 'has-filter' : ''}`} aria-label="筛选照片" onClick={() => setFilterOpen(true)}><SlidersHorizontal size={18} />{activeFilters > 0 && <span>{activeFilters}</span>}</button></div><div className="section-heading"><div><h2>全部照片</h2><span>{filtered.length} 项</span></div><button onClick={() => setSort(sort === 'newest' ? 'oldest' : 'newest')}><Grid2X2 size={17} />{sort === 'newest' ? '最新优先' : '最早优先'}</button></div>
    {filtered.length ? <div className="photo-grid">{filtered.map(i => <button className="photo-tile" key={i.uuid} onClick={() => onSelect(i)}><img src={api.url(i.thumbnail_url)} alt={i.filename} /><span>{formatDate(i.timestamp)}</span></button>)}</div> : <EmptyState icon={Images} title={search ? '没有匹配的照片' : '还没有照片'} text={search ? '换一个关键词试试。' : '上传第一张照片，随时获取可分享的链接。'} action={!search && <UploadButton accept="image/*" disabled={busy} label="上传照片" onFile={onUpload} />} />}
    {filtered.length > 0 && <UploadButton accept="image/*" disabled={busy} label="上传" onFile={onUpload} />}
    {filterOpen && <div className="filter-layer" role="dialog" aria-modal="true" aria-label="照片筛选"><button className="filter-backdrop" aria-label="关闭筛选" onClick={() => setFilterOpen(false)} /><div className="filter-sheet"><div className="sheet-handle" /><header><div><h2>筛选照片</h2><span>{activeFilters ? `已启用 ${activeFilters} 项条件` : '显示全部照片'}</span></div><IconButton label="关闭" onClick={() => setFilterOpen(false)}><X size={20} /></IconButton></header>
      <FilterGroup title="排序" value={sort} options={[['newest', '最新优先'], ['oldest', '最早优先']]} onChange={value => setSort(value as 'newest' | 'oldest')} />
      <FilterGroup title="格式" value={format} options={[['all', '全部'], ['jpg', 'JPG'], ['png', 'PNG'], ['gif', 'GIF'], ['webp', 'WebP']]} onChange={value => setFormat(value as typeof format)} />
      <FilterGroup title="文件大小" value={sizeFilter} options={[['all', '全部'], ['small', '小于 1 MB'], ['medium', '1–10 MB'], ['large', '大于 10 MB']]} onChange={value => setSizeFilter(value as typeof sizeFilter)} />
      <FilterGroup title="上传时间" value={period} options={[['all', '全部'], ['7', '最近 7 天'], ['30', '最近 30 天']]} onChange={value => setPeriod(value as typeof period)} />
      <div className="filter-actions"><button className="secondary-button" onClick={resetFilters}>清除筛选</button><button className="primary-button" onClick={() => setFilterOpen(false)}>查看 {filtered.length} 张照片</button></div>
    </div></div>}
  </section>
}
function FilterGroup({ title, value, options, onChange }: { title: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  return <section className="filter-group"><h3>{title}</h3><div>{options.map(([key, label]) => <button key={key} className={value === key ? 'active' : ''} onClick={() => onChange(key)}>{label}</button>)}</div></section>
}
function StoragePage({ files, folders, usage, activeFolder, setActiveFolder, view, setView, busy, onUpload }: { files: StorageFile[]; folders: StorageFolder[]; usage: StorageUsage | null; activeFolder: StorageFolder | null; setActiveFolder: (f: StorageFolder | null) => void; view: 'list' | 'grid'; setView: (v: 'list' | 'grid') => void; busy: boolean; onUpload: (f?: File) => void }) {
  const visible = activeFolder ? files.filter(f => f.folder_id === activeFolder.id || f.folder_name === activeFolder.folder_name) : files
  const percent = Math.min(100, usage?.usage_percent ?? (usage?.max_storage ? usage.used / usage.max_storage * 100 : 0))
  return <section className="page drive-page"><div className="storage-card"><div className="storage-icon"><HardDrive size={23} /></div><div className="storage-copy"><div><strong>{formatSize(usage?.used)}</strong><span> / {formatSize(usage?.max_storage)}</span></div><div className="storage-track"><span style={{ width: `${percent}%` }} /></div><small>{usage?.file_count || 0} 个文件 · 已使用 {percent.toFixed(0)}%</small></div></div>
    <div className="drive-path"><button onClick={() => setActiveFolder(null)} className={!activeFolder ? 'current' : ''}>我的云盘</button>{activeFolder && <><ChevronRight size={15} /><button className="current">{activeFolder.folder_name}</button></>}</div>
    {!activeFolder && folders.length > 0 && <><div className="section-heading"><div><h2>文件夹</h2><span>{folders.length} 项</span></div></div><div className="folder-strip">{folders.map(f => <button key={f.id} onClick={() => setActiveFolder(f)}><Folder size={23} fill="currentColor" /><strong>{f.folder_name}</strong><span>{f.file_count ?? '—'} 个文件</span></button>)}</div></>}
    <div className="section-heading file-heading"><div><h2>{activeFolder ? activeFolder.folder_name : '最近文件'}</h2><span>{visible.length} 项</span></div><div className="view-switch"><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><LayoutList size={17} /></button><button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}><Grid2X2 size={16} /></button></div></div>
    {visible.length ? <div className={`file-${view}`}>{visible.map(f => <FileItem key={f.file_uuid} file={f} grid={view === 'grid'} />)}</div> : <EmptyState icon={Folder} title="这里还没有文件" text="上传文件，开始整理你的云端空间。" />}
    <UploadButton disabled={busy} label="上传" onFile={onUpload} />
  </section>
}
function FileItem({ file, grid }: { file: StorageFile; grid: boolean }) {
  const Icon = fileIcon(file.mime_type)
  return <button className="file-item"><span className="file-icon">{createElement(Icon, { size: grid ? 29 : 22 })}</span><span className="file-copy"><strong>{file.original_filename}</strong><small>{formatSize(file.size)}{file.created_at ? ` · ${formatDate(file.created_at)}` : ''}</small></span>{!grid && <MoreHorizontal size={19} />}</button>
}
function BlogPage({ blogs, search, setSearch, busy, onOpen, onUpload }: { blogs: Blog[]; search: string; setSearch: (v: string) => void; busy: boolean; onOpen: (b: Blog) => void; onUpload: (f?: File) => void }) {
  const [activeCategory, setActiveCategory] = useState('')
  const query = search.trim().toLowerCase()
  const categories = useMemo(() => [...new Set(blogs.map(b => b.category?.trim()).filter(category => category && category !== '全部'))] as string[], [blogs])
  const selectedCategory = categories.includes(activeCategory) ? activeCategory : ''
  const filtered = blogs.filter(b => {
    const matchesCategory = !selectedCategory || b.category?.trim() === selectedCategory
    const matchesSearch = !query || `${b.title} ${b.summary} ${b.user_name} ${b.category} ${b.tags?.join(' ')}`.toLowerCase().includes(query)
    return matchesCategory && matchesSearch
  })
  return <section className="page blog-page"><SearchBar value={search} onChange={setSearch} placeholder="搜索文章、作者或标签" /><CategoryFilter categories={categories} value={selectedCategory} onChange={setActiveCategory} />
    {filtered.length ? <div className="feed">{filtered.map((b, index) => <button className="post-card" key={b.file_uuid} onClick={() => onOpen(b)}><div className="post-author"><span className="mini-avatar">{b.user_name.slice(0, 1).toUpperCase()}</span><div><strong>{b.user_name}</strong><span>{formatDate(b.upload_time)}</span></div><MoreHorizontal size={18} /></div><h2>{b.title}</h2><p>{b.summary || '打开文章查看完整内容。'}</p>{index % 3 === 0 && <div className="post-cover"><span>{b.category || 'RADISH'}</span><FileText size={38} /></div>}<div className="post-meta"><span>{b.category || '未分类'}</span>{b.tags?.slice(0, 2).map(t => <span key={t}>#{t}</span>)}<span className="read-more">阅读 <ChevronRight size={14} /></span></div></button>)}</div> : <EmptyState icon={FileText} title="暂时没有文章" text={search || selectedCategory ? '当前筛选条件没有匹配结果。' : '新的内容会出现在这里。'} />}
    <UploadButton accept=".md,text/markdown" disabled={busy} label="投稿" onFile={onUpload} />
  </section>
}
function CategoryFilter({ categories, value, onChange }: { categories: string[]; value: string; onChange: (category: string) => void }) {
  const rowRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDetailsElement>(null)
  const [visibleCount, setVisibleCount] = useState(categories.length)

  useLayoutEffect(() => {
    const row = rowRef.current
    const measure = measureRef.current
    if (!row || !measure) return
    const calculate = () => {
      const buttons = [...measure.querySelectorAll<HTMLButtonElement>('button')]
      const allWidth = buttons[0]?.offsetWidth || 0
      const moreWidth = buttons[buttons.length - 1]?.offsetWidth || 0
      const categoryWidths = buttons.slice(1, -1).map(button => button.offsetWidth)
      const gap = 7
      const fullWidth = allWidth + categoryWidths.reduce((total, width) => total + gap + width, 0)
      if (fullWidth <= row.clientWidth) {
        setVisibleCount(categories.length)
        return
      }
      let used = allWidth + gap + moreWidth
      let count = 0
      for (const width of categoryWidths) {
        if (used + gap + width > row.clientWidth) break
        used += gap + width
        count += 1
      }
      setVisibleCount(count)
    }
    calculate()
    const observer = new ResizeObserver(calculate)
    observer.observe(row)
    return () => observer.disconnect()
  }, [categories])

  const visible = categories.slice(0, visibleCount)
  const overflow = categories.slice(visibleCount)
  const select = (category: string) => {
    onChange(category)
    if (menuRef.current) menuRef.current.open = false
  }
  return <div className="category-filter">
    <div className="topic-row" ref={rowRef}>
      <button className={!value ? 'active' : ''} onClick={() => select('')}>全部</button>
      {visible.map(category => <button className={value === category ? 'active' : ''} key={category} onClick={() => select(category)}>{category}</button>)}
      {overflow.length > 0 && <details className={`category-more ${overflow.includes(value) ? 'active' : ''}`} ref={menuRef}>
        <summary>更多<ChevronDown size={13} /></summary>
        <div className="category-menu">{overflow.map(category => <button className={value === category ? 'active' : ''} key={category} onClick={() => select(category)}>{category}</button>)}</div>
      </details>}
    </div>
    <div className="topic-measure" ref={measureRef} aria-hidden="true"><button>全部</button>{categories.map(category => <button key={category}>{category}</button>)}<button>更多<ChevronDown size={13} /></button></div>
  </div>
}
function ChatPage() {
  return <section className="page chat-page"><div className="assistant-card"><div className="assistant-mark"><Sparkles size={24} /></div><div><p>RADISH ASSISTANT</p><h2>随时开始新的思考</h2><span>模型服务接入后，会话将在这里同步。</span></div></div><div className="section-heading"><div><h2>会话</h2><span>0 条记录</span></div></div><EmptyState icon={MessageCircle} title="开始新的对话" text="模型服务接入后，可以在这里继续所有会话。" action={<button className="secondary-button" disabled><Bot size={17} />等待服务接入</button>} /></section>
}
function BottomNav({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const items: { key: Tab; label: string; icon: IconType }[] = [{ key: 'images', label: '相册', icon: Images }, { key: 'storage', label: '文件', icon: Folder }, { key: 'blogs', label: '发现', icon: FileText }, { key: 'chat', label: '对话', icon: MessageCircle }]
  return <nav className="bottom-nav">{items.map(({ key, label, icon: Icon }) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><span><Icon size={21} /></span><small>{label}</small></button>)}</nav>
}
function ImageViewer({ image, api, onClose, onMessage }: { image: ImageItem; api: Api; onClose: () => void; onMessage: (v: string) => void }) {
  return <div className="detail-overlay image-viewer"><header><IconButton label="返回" onClick={onClose}><ArrowLeft size={22} /></IconButton><strong>照片详情</strong><IconButton label="更多"><MoreHorizontal size={22} /></IconButton></header><div className="image-stage"><img src={api.url(`/api/image-bed/image/${image.uuid}`)} alt={image.filename} /></div><div className="image-info"><div><strong>{image.filename}</strong><span>{formatSize(image.size)} · {formatDate(image.timestamp)}</span></div><button className="primary-button" onClick={() => void navigator.clipboard.writeText(api.url(`/api/image-bed/image/${image.uuid}`)).then(() => onMessage('图片链接已复制'))}>复制链接</button></div></div>
}
function ArticleViewer({ article, server, onClose }: { article: { blog: Blog; content: string }; server: string; onClose: () => void }) {
  const content = typeof article.content === 'string'
    ? article.content
    : String((article.content as unknown as { data?: { content?: unknown } })?.data?.content || '')
  const lines = content.split(/\r?\n/)
  const firstHeading = lines[0]?.match(/^#\s+(.+)$/)?.[1]?.trim()
  const markdown = firstHeading === article.blog.title.trim() ? lines.slice(1).join('\n').trimStart() : content
  return <div className="detail-overlay article-viewer"><header><IconButton label="返回" onClick={onClose}><ArrowLeft size={22} /></IconButton><span>文章</span><IconButton label="更多"><MoreHorizontal size={22} /></IconButton></header><article><p className="article-category">{article.blog.category}</p><h1>{article.blog.title}</h1><div className="article-byline"><span className="mini-avatar">{article.blog.user_name.slice(0, 1).toUpperCase()}</span><div><strong>{article.blog.user_name}</strong><span><Clock3 size={13} />{formatDate(article.blog.upload_time)}</span></div></div><div className="article-body"><ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents} urlTransform={url => url.startsWith('/') ? `${server}${url}` : url}>{markdown}</ReactMarkdown></div></article></div>
}
function SettingsPage({ server, user, avatar, onClose, onSave, onLogout }: { server: string; user: string; avatar: string; onClose: () => void; onSave: (server: string) => void; onLogout: () => void }) {
  const [value, setValue] = useState(server)
  return <div className="detail-overlay settings-page"><header><IconButton label="返回" onClick={onClose}><ArrowLeft size={22} /></IconButton><strong>设置</strong><span className="header-spacer" /></header><div className="settings-content">
    <section className="settings-profile"><UserAvatar src={avatar} name={user} /><div><strong>{user}</strong><span>radishtools 账号</span></div></section>
    <p className="settings-label">连接</p><section className="settings-group"><label><span><Server size={18} />服务器地址</span><input type="url" value={value} onChange={e => setValue(e.target.value)} /></label><p>修改服务器后需要重新登录，已有服务器的本地记录会继续保留。</p><button className="primary-button" disabled={value.trim() === server} onClick={() => onSave(value)}>保存并重新登录</button></section>
    <p className="settings-label">应用</p><section className="settings-group info-rows"><div><span>界面</span><strong>跟随系统</strong></div><div><span>本地缓存</span><strong>已启用</strong></div><div><span>版本</span><strong>0.0.1</strong></div></section>
    <button className="logout-button" onClick={onLogout}><LogOut size={17} />退出当前账号</button>
  </div></div>
}

export default App
