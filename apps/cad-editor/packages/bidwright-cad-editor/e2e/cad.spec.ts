import { test, expect } from '@playwright/test';
const BASE='http://127.0.0.1:4854';
const drawing='0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1027\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLINE\n5\n10\n100\nAcDbEntity\n8\n0\n100\nAcDbLine\n10\n0\n20\n0\n30\n0\n11\n100\n21\n100\n31\n0\n0\nENDSEC\n0\nEOF\n';
async function open(page: import('@playwright/test').Page,theme='light'){
  await page.addInitScript(()=>{(window as unknown as {cadMessages:unknown[]}).cadMessages=[];window.addEventListener('message',event=>{if(event.data?.source==='bidwright-cad-editor')(window as unknown as {cadMessages:unknown[]}).cadMessages.push(event.data);});});
  await page.route('**/fixture.dxf',route=>route.fulfill({body:drawing,contentType:'application/dxf'}));
  await page.goto(BASE+'/?embedded=1&bidwright=1&fileName=fixture.dxf&url='+encodeURIComponent(BASE+'/fixture.dxf')+'&theme='+theme);
  await page.waitForFunction(()=>(window as unknown as {cadMessages:Array<{type:string}>}).cadMessages.some(m=>m.type==='bidwright:cad-loaded'));
}
test('2D CAD opens native MLightCAD with no piping workspace and follows theme changes',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await open(page);
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(page.getByRole('button',{name:'Piping isometric',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--bidwright-cad-view-background').trim())).toBe('#f8fafc');
  await page.evaluate(()=>window.postMessage({source:'bidwright-cad-host',type:'bidwright:cad-theme',theme:'dark'},'*'));
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--bidwright-cad-view-background').trim())).toBe('#0b0f14');
  await page.evaluate(()=>window.postMessage({source:'bidwright-cad-host',type:'bidwright:cad-theme',theme:'light'},'*'));
  await expect(page.locator('html')).toHaveClass(/light/);
  expect(errors).toEqual([]);
});
test('native CAD edits are captured for host autosave',async({page})=>{
  await open(page);
  await page.evaluate(()=>window.postMessage({source:'bidwright-cad-host',type:'bidwright:cad-command',command:'line\n10,20\n70,20\n'},'*'));
  await page.waitForFunction(()=>{const detail:{capture?:()=>{dxfContent:string}}={};window.dispatchEvent(new CustomEvent('bidwright:cad-document-capture',{detail}));return (detail.capture?.().dxfContent.match(/\nLINE\n/g)||[]).length===2;});
  await page.evaluate(()=>window.postMessage({source:'bidwright-cad-host',type:'bidwright:cad-save'},'*'));
  await page.waitForFunction(()=>(window as unknown as {cadMessages:Array<{type:string;dxfContent?:string}>}).cadMessages.some(m=>m.type==='bidwright:cad-save'&&(m.dxfContent?.match(/\nLINE\n/g)||[]).length===2));
});
