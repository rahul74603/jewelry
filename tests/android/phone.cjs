// Runs only on an installed demo APK on a disposable Android emulator. WebView
// automation operates normal controls; Back is always adb KEYCODE_BACK, never JS.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {mkdirSync,writeFileSync}=require('node:fs');
const {_android}=require('playwright');
const {expect}=require('@playwright/test');
const pkg='com.aurum.jewellery.preview',activity=pkg+'/com.aurum.jewellery.MainActivity',out='test-results/phone';
const shell=(...args)=>execFileSync('adb',['shell',...args],{encoding:'utf8',timeout:12000});
const pause=ms=>new Promise(ok=>setTimeout(ok,ms));
const key=()=>shell('input','keyevent','4');
const focus=()=>shell('dumpsys','window').split('\n').filter(s=>s.includes('mCurrentFocus')).join(' ');
let device,page;
const vis=s=>page.locator(s).first();
const btn=name=>page.getByRole('button',{name,exact:true});
const route=path=>expect.poll(()=>page.evaluate(()=>location.hash.substring(1)||'/')).toBe(path);
async function go(path){await page.locator(`.sidebar a[href="#${path}"]`).first().evaluate(a=>a.click());await route(path);}
async function home(){await page.locator('.sidebar .brand-link').evaluate(a=>a.click());await expect(vis('[data-shop-home]')).toBeVisible();}
const foreground=async()=>expect.poll(focus,{timeout:7000}).toContain(pkg);
before(async()=>{assert.equal(shell('getprop','ro.kernel.qemu').trim(),'1','Use a disposable emulator only');mkdirSync(out,{recursive:true});shell('am','start','-W','-n',activity);[device]=await _android.devices({omitDriverInstall:true});assert.ok(device);const web=await device.webView({pkg},{timeout:30000});page=await web.page();page.setDefaultTimeout(8000);await expect(vis('[data-shop-home]')).toBeVisible({timeout:25000});console.log('WebView:',await page.evaluate(()=>navigator.userAgent));});
after(async()=>{if(device)await device.close();});
// Run each annotated scenario from an explicit route. Native focus is checked
// at the end, so a backgrounded activity cannot pass by leaving a stale DOM.
for(const [name,path,prior] of [['Billing','/billing','/'],['Inventory','/inventory','/billing'],['Settings','/settings','/inventory'],['Reports','/reports','/settings']])test(name+' → prior screen (activity still foreground)',async()=>{await home();if(prior!=='/')await go(prior);await go(path);key();await route(prior);await foreground();});
for(const [path,title] of [['/inventory','Product details'],['/customers','Customer profile']])test(title+' → corresponding list',async()=>{await go(path);await page.locator('tbody tr').first().click();await expect(page.getByRole('dialog',{name:title})).toBeVisible();key();await expect(page.getByRole('dialog')).toBeHidden();await route(path);await foreground();});
test('Topmost modal before drawer, drawer before route',async()=>{await home();await btn('Open navigation').click();await page.locator('.shop-switch').click();await expect(page.getByRole('dialog')).toBeVisible();key();await expect(page.getByRole('dialog')).toBeHidden();await expect(vis('.drawer-backdrop')).toBeVisible();key();await expect(vis('.drawer-backdrop')).toBeHidden();await route('/');await foreground();});
test('Unsaved bill survives Back / Continue Editing; explicit discard leaves safely',async()=>{await go('/billing');await page.getByRole('link',{name:'New invoice',exact:true}).click();await btn('Add product to bill').click();await page.getByRole('button',{name:/Heritage gold bangle/}).click();key();await btn('Continue Editing').click();await expect(page.locator('.bill-line')).toContainText('Heritage gold bangle');key();await btn('Discard Changes').click();await route('/billing');await foreground();});
test('Native first Dashboard Back shows the nonblocking hint',async()=>{await home();key();await expect(page.getByRole('status')).toHaveText(/Press back again to exit/);await route('/');await foreground();});
test('Dashboard timeout resets the exit window',async()=>{await go('/rates');await home();key();await expect(page.getByRole('status')).toContainText('Press back');await expect(page.getByRole('status')).toBeHidden({timeout:5000});key();await expect(page.getByRole('status')).toContainText('Press back');await foreground();});
test('No minimize on nested invoice preview → billing → inventory',async()=>{await go('/inventory');await go('/billing');await page.locator('tbody tr').first().click();await expect(vis('.receipt')).toBeVisible();key();await route('/billing');key();await route('/inventory');await foreground();});
for(const format of ['A4','A5','80mm','58mm'])test(`${format}: actual Android PrintManager dialog and system Back to receipt`,async()=>{
 await go('/settings');await btn('Billing & print').click();await page.getByRole('combobox',{name:'Paper format'}).selectOption(format);await btn('Save settings').click();await expect(page.getByRole('status')).toContainText('saved');await go('/billing');await page.getByRole('link',{name:'New invoice',exact:true}).click();await btn('Add product to bill').click();await page.getByRole('button',{name:/Heritage gold bangle/}).click();await page.getByRole('combobox',{name:'Payment',exact:true}).selectOption('full');await btn('Finalize invoice').click();await btn('Confirm & save').click();await expect(vis('.receipt')).toHaveAttribute('data-format',format);await btn('Print / PDF').click();await expect.poll(focus,{timeout:18000}).toMatch(/printspooler/);
 const dump=()=>{shell('uiautomator','dump','/sdcard/window.xml');return shell('cat','/sdcard/window.xml');};let xml=dump();const nodes=xml.match(/<node\b[^>]*>/g)||[];const handle=nodes.find(n=>/(?:expand_collapse_handle|content-desc="Expand)/i.test(n));if(handle){const box=handle.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);if(box){shell('input','tap',String((+box[1]+ +box[3])>>1),String((+box[2]+ +box[4])>>1));await pause(450);xml=dump();}}
 writeFileSync(`${out}/print-${format}.xml`,xml);writeFileSync(`${out}/print-${format}.png`,execFileSync('adb',['exec-out','screencap','-p']));console.log('Android dialog',format,[...xml.matchAll(/text="([^"<>]+)"/g)].map(m=>m[1]).join(' | '));assert.match(xml,/Save as PDF/i);if(format==='A4'||format==='A5')assert.match(xml,new RegExp(`\\b${format}\\b`,'i'),'Requested ISO size should be selected, not Letter');
 for(let i=0;i<3&&focus().includes('printspooler');i++){key();await pause(450);}await foreground();await expect(vis('.receipt')).toBeVisible();await expect(vis('.receipt')).toHaveAttribute('data-format',format);
});
test('Only a second Back inside two seconds finishes the Dashboard activity',async()=>{await home();key();await expect(page.getByRole('status')).toContainText('Press back');key();await expect.poll(focus,{timeout:7000}).not.toContain(pkg);assert.doesNotMatch(shell('dumpsys','activity','activities'),new RegExp('Hist #[^\\n]*'+pkg.replaceAll('.','\\.')),'Activity was finished, not merely minimized');});
