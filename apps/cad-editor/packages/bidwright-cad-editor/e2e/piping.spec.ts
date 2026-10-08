import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
const BASE = 'http://127.0.0.1:4854'
const blank =
  '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1027\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n'
async function open(page: Page, data: string | Buffer, name = 'fixture.dxf') {
  await page.unroute('**/fixture-data')
  await page.route('**/fixture-data', route =>
    route.fulfill({ body: data, contentType: 'application/octet-stream' })
  )
  await page.goto(
    BASE +
      '/?embedded=1&bidwright=1&url=' +
      encodeURIComponent(BASE + '/fixture-data') +
      '&fileName=' +
      name +
      '&projectId=test&documentId=fixture&sourceKind=file_node&mode=preview&theme=light'
  )
  await page
    .getByRole('button', { name: 'Piping isometric', exact: true })
    .click()
  await expect(page.locator('[data-direction="x+"]')).toBeEnabled()
}
async function elbow(page: Page) {
  await page.locator('[name="nps"]').selectOption('2')
  await page.locator('[name="length"]').fill('1000')
  await page.locator('[data-direction="x+"]').click()
  await page.locator('[data-direction="y+"]').click()
}
async function capture(page: Page) {
  return page.evaluate(() => {
    const detail: { capture?: () => { dxfContent: string } } = {}
    window.dispatchEvent(
      new CustomEvent('bidwright:cad-document-capture', { detail })
    )
    return detail.capture!().dxfContent
  })
}
test('measured routing, grid, native undo and DXF reopen preserve fabrication data', async ({
  page
}) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await open(page, blank)
  await elbow(page)
  await page.locator('[name="gridSpacing"]').fill('25')
  await page.locator('[name="gridSpacing"]').dispatchEvent('change')
  await expect(page.locator('[data-isometric-grid]')).toBeVisible()
  await page.locator('[name="gridVisible"]').uncheck()
  await expect(page.locator('[data-isometric-grid]')).toHaveCount(0)
  await page.locator('[name="gridVisible"]').check()
  await page
    .locator('line[data-owner][stroke-width="3"]')
    .first()
    .dispatchEvent('click')
  await expect(page.locator('[name="toPrep"]')).toBeAttached()
  await page
    .locator('summary')
    .filter({ hasText: /^End connection$/ })
    .click()
  await page.locator('[name="toPrep"]').selectOption('THD')
  await page.getByRole('button', { name: 'Apply pipe', exact: true }).click()
  await page
    .getByRole('button', { name: 'Materials & cuts', exact: true })
    .click()
  await expect(page.locator('.bw-piping')).toContainText('923.8')
  await page.getByRole('button', { name: 'Draw', exact: true }).click()
  const snapshot = await capture(page)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await open(page, snapshot)
  await expect(page.locator('[name="gridSpacing"]')).toHaveValue('25')
  await page
    .getByRole('button', { name: 'Materials & cuts', exact: true })
    .click()
  await expect(page.locator('.bw-piping')).toContainText('920.8')
  await expect(page.locator('.bw-piping')).toContainText(
    'All pipe lengths and component connections are valid'
  )
  expect(errors).toEqual([])
})
test('PDF includes cut schedules and native DWG reopens the semantic piping model', async ({
  page
}) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await open(page, blank)
  await elbow(page)
  let pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'PDF package', exact: true }).click()
  const pdfDownload = await pending
  if (process.env.PIPING_PDF_PREVIEW)
    await pdfDownload.saveAs(process.env.PIPING_PDF_PREVIEW)
  const pdf = await PDFDocument.load(
    await readFile((await pdfDownload.path())!)
  )
  expect(pdf.getPageCount()).toBe(4)
  expect(pdf.getPage(0).getWidth()).toBe(1224)
  pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'DWG', exact: true }).click()
  const dwg = await readFile((await (await pending).path())!)
  expect(dwg.subarray(0, 6).toString()).toBe('AC1015')
  await open(page, dwg, 'fixture.dwg')
  await page
    .getByRole('button', { name: 'Materials & cuts', exact: true })
    .click()
  await expect(page.locator('.bw-piping')).toContainText('920.8')
  await expect(page.locator('.bw-piping')).toContainText(
    'All pipe lengths and component connections are valid'
  )
  await page.getByRole('button', { name: '3D review', exact: true }).click()
  await expect(page.locator('.bw-iso-3d canvas')).toBeVisible()
  expect(errors).toEqual([])
})
