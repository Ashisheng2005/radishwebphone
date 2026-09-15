import { useEffect, useState } from 'react'
import { Api, loadSession, normalizeServer, saveSession, type Blog, type ImageItem, type Session, type StorageFile } from './api'
import './App.css'

type Tab = 'images' | 'storage' | 'blogs' | 'chat'
const serverKey = 'radish-phone-server'
const size = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`

function App() {
  const [input, setInput] = useState(localStorage.getItem(serverKey) || '')
  const [server, setServer] = useState(localStorage.getItem(serverKey) || '')
  const [session, setSession] = useState<Session | null>(loadSession)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [tab, setTab] = useState<Tab>('blogs')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [images, setImages] = useState<ImageItem[]>([])
  const [files, setFiles] = useState<StorageFile[]>([])
  const [usage, setUsage] = useState('')
  const [blogs, setBlogs] = useState<Blog[]>([])
  const [article, setArticle] = useState<{title:string; content:string} | null>(null)
  const api = server ? new Api(server, session?.access_token) : null
  async function run(action: () => Promise<void>) {
    setBusy(true); setStatus('')
    try { await action() } catch (e) { setStatus(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  useEffect(() => {
    if (!server || !session) return
    new Api(server, session.access_token).validate().then(result => {
      if (result.detail !== 'yes') { saveSession(null); setSession(null); setStatus('登录已过期，请重新登录') }
    }).catch(() => setStatus('暂时无法验证登录状态，请检查网络'))
  }, [server, session])
  useEffect(() => {
    if (!server) return
    const client = new Api(server, session?.access_token)
    const report = (e: unknown) => setStatus(e instanceof Error ? e.message : String(e))
    if (tab === 'blogs') void client.exploreBlogs().then(data => setBlogs(data.blogs)).catch(report)
    if (tab === 'images' && session) void client.imageList().then(data => setImages(data.images)).catch(report)
    if (tab === 'storage' && session) void Promise.all([client.storageList(), client.storageUsage()]).then(([list, disk]) => {
      setFiles(list.files); setUsage(`${size(disk.used)} / ${size(disk.max_storage)} · ${disk.file_count} 个文件`)
    }).catch(report)
  }, [tab, server, session])
  function upload(kind: Tab, file?: File) {
    if (!file || !api) return
    const client = api
    void run(async () => {
      if (kind === 'images') { await client.uploadImage(file); setImages((await client.imageList()).images); setStatus('图片上传成功') }
      if (kind === 'storage') { await client.uploadStorage(file); setFiles((await client.storageList()).files); setStatus('文件上传成功') }
      if (kind === 'blogs') { const result = await client.uploadBlog(file); setStatus(result.message || '博客已提交审核') }
    })
  }
  return <div className="app">
    <header><div><h1>Radish Phone</h1><small>RadishWeb 移动端</small></div><span>{session?.user_name || '访客'}</span></header>
    <section className="panel"><label>服务地址</label><div className="row"><input type="url" placeholder="https://your-server.example" value={input} onChange={e => setInput(e.target.value)} /><button disabled={busy} onClick={() => void run(async () => { const value = normalizeServer(input); localStorage.setItem(serverKey, value); setServer(value) })}>连接</button></div>{server && <small>{server}</small>}</section>
    {!session ? <section className="panel"><h2>登录</h2><div className="row"><input aria-label="用户名" placeholder="用户名" value={username} onChange={e => setUsername(e.target.value)} /><input aria-label="密码" type="password" placeholder="密码" value={password} onChange={e => setPassword(e.target.value)} /></div><button disabled={!api || busy} onClick={() => void run(async () => { const result = await api!.login(username, password); saveSession(result); setSession(result); setPassword(''); setStatus(`已登录：${result.user_name}`) })}>登录账号</button><small>博客可直接浏览；图床和云盘需要登录。</small></section> : <section className="account"><span>{session.email}</span><button className="quiet" onClick={() => { saveSession(null); setSession(null); setImages([]); setFiles([]) }}>退出</button></section>}
    {status && <p role="status" className="status">{status}</p>}
    <main>
      {tab === 'images' && <section><div className="title"><h2>图床</h2><label className="upload">上传图片<input type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml" disabled={!session || busy} onChange={e => { upload(tab, e.target.files?.[0]); e.target.value = '' }} /></label></div>{!session ? <p>登录后查看图片。</p> : <div className="grid">{images.map(item => <article key={item.uuid}><img src={api?.url(item.thumbnail_url)} alt={item.filename} /><strong>{item.filename}</strong><small>{size(item.size)}</small><button className="quiet" onClick={() => void navigator.clipboard.writeText(api!.url(`/api/image-bed/image/${item.uuid}`)).then(() => setStatus('链接已复制'))}>复制链接</button></article>)}</div>}</section>}
      {tab === 'storage' && <section><div className="title"><h2>云盘</h2><label className="upload">上传文件<input type="file" disabled={!session || busy} onChange={e => { upload(tab, e.target.files?.[0]); e.target.value = '' }} /></label></div>{!session ? <p>登录后查看文件。</p> : <><p>{usage}</p><div className="list">{files.map(file => <article key={file.file_uuid}><div><strong>{file.original_filename}</strong><small>{file.folder_name || '根目录'} · {size(file.size)}</small></div></article>)}</div></>}</section>}
      {tab === 'blogs' && <section><div className="title"><h2>博客广场</h2><label className="upload">上传 Markdown<input type="file" accept=".md,text/markdown" disabled={!session || busy} onChange={e => { upload(tab, e.target.files?.[0]); e.target.value = '' }} /></label></div>{article ? <article className="article"><button className="quiet" onClick={() => setArticle(null)}>← 返回</button><h2>{article.title}</h2><pre>{article.content}</pre></article> : <div className="list">{blogs.map(blog => <button className="blog" key={blog.file_uuid} onClick={() => api && void run(async () => setArticle({ title: blog.title, content: await api.blogContent(blog.file_uuid) }))}><strong>{blog.title}</strong><span>{blog.summary}</span><small>{blog.user_name} · {blog.category}</small></button>)}</div>}</section>}
      {tab === 'chat' && <section><h2>模型对话</h2><p>当前 RadishWeb 后端尚无已启用的模型对话接口。接口上线后可在此接入会话与消息。</p></section>}
    </main>
    <nav>{([['images','图床'],['storage','云盘'],['blogs','博客'],['chat','对话']] as const).map(([key,label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => { setArticle(null); setTab(key) }}>{label}</button>)}</nav>
  </div>
}
export default App
