"""Regression for stale tuition rows after grade/class filtering.

Install: pip install playwright && playwright install chromium
Run with local servers: python test/tuition-filter-ui.py
Optional: PLAYWRIGHT_CHROME_PATH=/path/to/chrome python test/tuition-filter-ui.py URL
All API responses are mocked; no real financial data is changed.
"""
import sys,json,os
from playwright.sync_api import sync_playwright,expect
base=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:5173'
def row(sid,name,cid,cls,grade):
    return dict(studentId=sid,studentName=name,classId=cid,className=cls,gradeLevel=grade,primaryParent=None,totalSessions=8,ratePerSession=150000,discountAmount=0,baseAmount=1200000,finalAmount=1200000,tuitionRecord=None)
rows=[row('s7a','Bảo Nam','private','Học riêng',7),row('s7a','Bảo Nam','c7','Toán 7 - CQT01',7),row('s7b','Bảo Trân','c7','Toán 7 - CQT01',7),row('s7c','Chu Hà Anh','c7','Toán 7 - CQT01',7),row('s11','Trần Minh Hiếu','c11','Toán 11 - CQT02',11),row('s11','Trần Minh Hiếu','c11','Toán 11 - CQT02',11)]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, **({'executable_path':os.environ['PLAYWRIGHT_CHROME_PATH']} if os.environ.get('PLAYWRIGHT_CHROME_PATH') else {}))
    page=browser.new_page(viewport={'width':1440,'height':1080})
    page.add_init_script('localStorage.setItem("user",'+json.dumps(json.dumps({'id':'test','fullName':'Admin','role':'ADMIN'}))+');')
    warnings=[]
    page.on('console',lambda msg:warnings.append(msg.text) if 'same key' in msg.text else None)
    page.route('**/api/**',lambda route:route.fulfill(json=rows if '/schedule-summary?' in route.request.url else []))
    page.goto(base+'/tuition');page.wait_for_load_state('networkidle')
    table=page.get_by_role('table',name='Danh sách học phí')
    expect(table.locator('tbody tr')).to_have_count(6)
    page.get_by_role('button',name='Lớp 7',exact=True).click()
    # Expect no stale grade-11 rows, including rows lost during duplicate-key reconciliation.
    expect(table.locator('tbody tr')).to_have_count(4)
    assert 'Khối 11' not in table.inner_text()
    def validate():
        groups=table.locator('tbody').evaluate_all('''bodies=>bodies.map(body=>{
          const occupied=[];
          return Array.from(body.rows).map(row=>{
            let column=0;
            for(const cell of row.cells){
              while(occupied[column]>0)column++;
              for(let offset=0;offset<cell.colSpan;offset++)occupied[column+offset]=cell.rowSpan;
              column+=cell.colSpan;
            }
            const width=Math.max(column,occupied.length);
            for(let i=0;i<occupied.length;i++)occupied[i]=Math.max(0,(occupied[i]||0)-1);
            return width;
          });
        })''')
        assert all(width==8 for group in groups for width in group),groups
        for group in table.locator('tbody').all():
            for cell in group.locator('td[rowspan]').all():assert int(cell.get_attribute('rowspan'))<=group.locator('tr').count()
    validate()
    for _ in range(4):
        page.get_by_role('button',name='Toán 7 - CQT01',exact=True).click()
        expect(table.locator('tbody tr')).to_have_count(3);validate()
        page.get_by_role('button',name='Học riêng',exact=True).click()
        expect(table.locator('tbody tr')).to_have_count(1);validate()
        page.get_by_role('button',name='Lớp 11',exact=True).click()
        expect(table.locator('tbody tr')).to_have_count(2);validate()
        page.get_by_role('button',name='Lớp 7',exact=True).click()
        expect(table.locator('tbody tr')).to_have_count(4);validate()
    assert not warnings,warnings
    assert table.locator('tfoot').get_by_text('4.800.000đ',exact=True).count()==1
    page.screenshot(path='/private/tmp/qlhv-filter-fixed.png',full_page=True)
    print('PASS: duplicate source rows retained, no duplicate React keys, repeated grade/class filtering keeps all eight columns and correct totals')
    page.route('**/api/**',lambda route:route.fulfill(json=[]))
    page.reload();page.wait_for_load_state('networkidle')
    expect(table.get_by_role('columnheader')).to_have_count(8)
    expect(table.locator('tbody td')).to_have_attribute('colspan','8')
    assert not table.locator('td[rowspan]').count()
    print('PASS: empty table keeps eight columns without stale merged cells')
    browser.close()
