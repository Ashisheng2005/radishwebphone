import { test, expect, type Page } from '@playwright/test'

async function setup(page: Page, loggedIn = true) {
  await page.addInitScript(({ loggedIn }) => {
    localStorage.setItem('radish-phone-development-server', 'http://127.0.0.1:8002')
    localStorage.setItem('radish-phone-server', 'http://127.0.0.1:8002')
    if (loggedIn) localStorage.setItem('radish-phone-session', JSON.stringify({ access_token: 'test-token', user_name: 'tester', email: 'test@example.com' }))
  }, { loggedIn })
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    const data = path === '/api/login/' ? { access_token: 'test-token', user_name: 'tester', email: 'test@example.com' }
      : path === '/api/storage/folders' ? { folders: [{ id: 7, project_name: '旅行照片', file_count: 1 }] }
      : path === '/api/storage/list' ? { files: [{ file_uuid: 'doc', original_filename: '路线.txt', size: 5, mime_type: 'text/plain', folder_id: 7 }], pagination: { has_next: false } }
      : path === '/api/storage/disk-usage' ? { used: 5, max_storage: 1000, file_count: 1 }
      : { images: [], pagination: { has_next: false } }
    await route.fulfill({ json: data })
  })
}

test('login opens the app without waiting for data, only syncs the current tab once', async ({ page }) => {
  await setup(page, false)
  let imageRequests = 0
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/api/')) requests.push(request.url()) })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/image-bed/list', async route => {
    imageRequests++
    await gate
    await route.fulfill({ json: { images: [], pagination: { has_next: false } } })
  })
  await page.goto('/')
  await page.getByPlaceholder('输入用户名').fill('tester')
  await page.getByPlaceholder('输入密码').fill('password')
  await page.getByRole('button', { name: '登录并同步' }).click()
  await expect(page.getByRole('heading', { name: '相册', exact: true })).toBeVisible()
  await expect.poll(() => imageRequests).toBe(1)
  expect(requests.some(url => /timeliness|storage|explore/.test(url))).toBe(false)
  release()
})

test('publishes first page while later pages are pending', async ({ page }) => {
  await setup(page)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/image-bed/list', async route => {
    if (route.request().postData()?.includes('\r\n2\r\n')) await gate
    await route.fulfill({ json: { images: [{ uuid: route.request().postData()?.includes('\r\n2\r\n') ? 'second' : 'first', filename: 'first.png', thumbnail_url: '/first.png', size: 10, timestamp: '2026-10-07' }], pagination: { has_next: !route.request().postData()?.includes('\r\n2\r\n') } } })
  })
  await page.goto('/')
  await expect(page.getByRole('img', { name: 'first.png' })).toBeVisible()
  release()
})

test('folder names and upload destination match backend contract; image MIME and progress work', async ({ page }) => {
  await setup(page)
  await page.goto('/')
  await page.locator('.bottom-nav').getByRole('button', { name: '文件' }).click()
  await expect(page.locator('.folder-strip')).toContainText('旅行照片')
  await page.locator('.folder-strip button').click()
  await expect(page.locator('.file-copy')).toContainText('路线.txt')
  let folderBody = ''
  await page.route('**/api/storage/upload', async route => {
    folderBody = route.request().postData() || ''
    await route.fulfill({ json: { success: true } })
  })
  await page.locator('input[type=file]').setInputFiles({ name: 'test.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  await expect(page.getByText('上传完成', { exact: true })).toBeVisible()
  expect(folderBody).toContain('name="folder_id"\r\n\r\n7')
  await page.locator('.bottom-nav').getByRole('button', { name: '相册' }).click()
  let imageBody = ''
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/image-bed/upload', async route => {
    imageBody = route.request().postData() || ''
    await gate
    await route.fulfill({ status: 400, json: { detail: '文件内容与类型不匹配' } })
  })
  await page.locator('input[type=file]').setInputFiles({ name: 'phone.png', mimeType: '', buffer: Buffer.from('fixture') })
  await expect(page.getByRole('status')).toContainText('phone.png')
  await expect.poll(() => imageBody).toContain('Content-Type: image/png')
  expect(imageBody).toContain('Content-Type: image/png')
  release()
  await expect(page.getByText('文件内容与类型不匹配')).toBeVisible()
  await expect(page.getByRole('status')).toHaveCount(0)
})

test('cached content is visible immediately on restart, expired authentication returns to login', async ({ page }) => {
  await setup(page)
  await page.addInitScript(() => {
    localStorage.setItem('radish-phone-cache:http://127.0.0.1:8002:tester', JSON.stringify({ images: [{ uuid: 'cached', filename: 'cached.png', thumbnail_url: '/cached.png', size: 10, timestamp: '2026-10-07' }], syncedAt: Date.now() }))
  })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/image-bed/list', async route => {
    await gate
    await route.fulfill({ status: 401, json: { detail: 'expired' } })
  })
  await page.goto('/')
  await expect(page.getByRole('img', { name: 'cached.png' })).toBeVisible()
  release()
  await expect(page.getByPlaceholder('输入用户名')).toBeVisible()
  await expect(page.getByText('登录状态已过期，请重新登录')).toBeVisible()
})

test('real HTTP upload reports transferred bytes and processing before success', async ({ page }) => {
  const { createServer } = await import('node:http')
  let bytes = 0
  let authorization = ''
  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    if (request.method === 'OPTIONS') { response.end(); return }
    authorization = request.headers.authorization || ''
    request.on('data', chunk => { bytes += chunk.length })
    request.on('end', () => {
      setTimeout(() => {
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ ok: true }))
      }, 100)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await setup(page)
    await page.goto('/')
    const address = server.address() as { port: number }
    const result = await page.evaluate(async port => {
      // Load the same API implementation used by the app through Vite.
      const modulePath = '/src/api.ts'
      const { Api } = await import(modulePath)
      const events: { loaded: number; total: number; phase: string }[] = []
      const form = new FormData()
      form.append('file', new File([new Uint8Array(1024 * 1024)], 'transfer.bin'))
      const response = await new Api(`http://127.0.0.1:${port}`, 'test-token').upload('/upload-test', form, (event: { loaded: number; total: number; phase: string }) => events.push(event))
      return { events, response }
    }, address.port)
    expect(bytes).toBeGreaterThan(1024 * 1024)
    expect(authorization).toBe('Bearer test-token')
    expect(result.events.some(event => event.total > 0 && event.loaded === event.total)).toBe(true)
    expect(result.events.at(-1)?.phase).toBe('processing')
    expect(result.response).toEqual({ ok: true })
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
