// All API calls are mocked. No live invoices or payments are created.
async (page) => {
const rows=Array.from({length:56},(_,index)=>{
 const grade=6+index%7;
 return Array.from({length:index%3===0?2:1},(_,group)=>({
  studentId:`s${index}`,studentName:`Học viên ${index}`,gradeLevel:grade,
  classId:`c${grade}-${group}`,className:`Lớp học ${grade}-${group}`,primaryParent:null,
  totalSessions:8,ratePerSession:100000,discountAmount:0,baseAmount:800000,finalAmount:800000,tuitionRecord:null
 }));
}).flat();
const results=[];
for(const width of [320,390,768,820,1440]){
const ctx=await page.context().browser().newContext({viewport:{width,height:844},hasTouch:width<1024,isMobile:width<768});const p=await ctx.newPage();
await p.route('**/api/**',r=>r.fulfill({json:r.request().url().includes('schedule-summary')?rows:[]}));
await p.addInitScript(()=>localStorage.setItem('user',JSON.stringify({userId:'test',role:'ADMIN',fullName:'Test'})));
await p.goto('http://127.0.0.1:5173/tuition');await p.locator('tbody tr').first().waitFor();
if(width<768)await p.getByRole('button',{name:/Bộ lọc/}).tap();
for(const grade of [7,11,8,10,6,12,9]){
if(width<768)await p.getByLabel('Lọc học phí theo khối',{exact:true}).selectOption(String(grade));else await p.getByRole('button',{name:'Lớp '+grade,exact:true}).click();
const expected=rows.filter(r=>r.gradeLevel===grade);let count=await p.locator('tbody tr').count();if(count!==expected.length)throw Error('grade '+grade+':'+count+' expected '+expected.length);
for(const classId of [...new Set(expected.map(r=>r.classId))]){
const name=expected.find(r=>r.classId===classId).className;if(width<768)await p.getByLabel('Lọc học phí theo lớp',{exact:true}).selectOption(classId);else await p.getByRole('button',{name,exact:true}).click();
count=await p.locator('tbody tr').count();const n=expected.filter(r=>r.classId===classId).length;if(count!==n)throw Error('class '+name+':'+count+' expected '+n);
if(width<768)await p.getByLabel('Lọc học phí theo lớp',{exact:true}).selectOption('');else await p.getByRole('button',{name,exact:true}).click();
}
}
if(width<768){await p.getByRole('button',{name:'Xóa bộ lọc',exact:true}).click();if(await p.locator('tbody tr').count()!==rows.length)throw Error('reset');await p.getByLabel('Lọc học phí theo khối',{exact:true}).selectOption('7');await p.getByRole('button',{name:/Xem .* khoản học phí/}).click();if(await p.getByRole('button',{name:/Bộ lọc/}).getAttribute('aria-expanded')!=='false')throw Error('collapse');}
results.push({width,pass:true,grades:7,rows:rows.length});await ctx.close();
}return results;
}