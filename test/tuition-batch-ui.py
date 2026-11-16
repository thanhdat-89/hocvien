"""Batch concurrency/timeout regression. All APIs are mocked; no invoices/payments are created.
Install: pip install playwright && playwright install chromium
Run: python test/tuition-batch-ui.py [URL]
Optional: PLAYWRIGHT_CHROME_PATH=/path/to/chrome
"""
import json,os,sys
from playwright.sync_api import sync_playwright,expect
base=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:5173'
rows=[dict(studentId=f's{i}',studentName=f'Học viên {i}',classId='c1',className='Toán 7 - CQT01',gradeLevel=7,primaryParent=None,totalSessions=8,ratePerSession=150000,discountAmount=0,baseAmount=1200000,finalAmount=1200000,tuitionRecord=None) for i in range(7)]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,**({'executable_path':os.environ['PLAYWRIGHT_CHROME_PATH']} if os.environ.get('PLAYWRIGHT_CHROME_PATH') else {}))
    page=browser.new_page(viewport={'width':1440,'height':1080})
    page.add_init_script('localStorage.setItem("user",'+json.dumps(json.dumps({'id':'test','fullName':'Admin','role':'ADMIN'}))+');')
    # Accelerate native XHR deadlines, while asserting that the app configures real limits.
    page.add_init_script('''window.__requestTimeouts=[];
      const timeout=Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype,'timeout');
      Object.defineProperty(XMLHttpRequest.prototype,'timeout',{get(){return timeout.get.call(this)},set(value){
        window.__requestTimeouts.push(value);timeout.set.call(this,value===70000?5000:value===10000?200:value);
      }});''')
    posted=[];lookups=[];held={};outstanding=set();peak=[0];summary_requests=[]
    def saved(sid,status='DRAFT_CREATED'):
        i=int(sid[1:]);record=dict(id='fee-'+sid,finalAmount=1200000,status='PAID',paidAmount=1200000,remainingAmount=0)
        rows[i]['tuitionRecord']=record
        return dict(recordId=record['id'],paid=True,finalStatus=dict(finalAmount=1200000,totalPaid=1200000,remaining=0),invoiceDraft=dict(status=status,refId='ref-'+sid))
    def reply(route,sid):
        outstanding.discard(sid)
        if sid=='s2':route.fulfill(status=400,json={'message':'Dữ liệu chưa hợp lệ.'})
        elif sid=='s3':saved(sid);route.fulfill(status=500,json={'message':'Mất phản hồi'})
        elif sid=='s4':route.fulfill(status=500,json={'message':'Mất kết nối'})
        else:route.fulfill(json=saved(sid))
    def fixture(route):
        url=route.request.url
        if '/schedule-summary?' in url:summary_requests.append(url);route.fulfill(json=rows)
        elif '/toggle-paid' in url:
            body=route.request.post_data_json;sid=body['studentId'];posted.append(body);outstanding.add(sid);peak[0]=max(peak[0],len(outstanding))
            if sid in ['s0','s1']:held[sid]=route
            else:reply(route,sid)
        elif '/workflow-result?' in url:
            from urllib.parse import urlparse,parse_qs
            sid=parse_qs(urlparse(url).query)['studentId'][0];lookups.append(sid);outstanding.discard(sid)
            if sid=='s4':held['lookup-s4']=route # Native GET timeout must also settle.
            else:route.fulfill(json=saved(sid,'OUTCOME_UNKNOWN' if sid=='s3' else 'DRAFT_CREATED'))
        else:route.fulfill(json=[])
    page.route('**/api/**',fixture)
    page.goto(base+'/tuition');page.wait_for_load_state('networkidle')
    for button in page.get_by_role('button',name='Thanh toán học phí',exact=False).all():button.click()
    apply=page.get_by_role('button',name='Áp dụng thay đổi',exact=False)
    apply.evaluate('(el)=>{el.click();el.click()}')
    dialog=page.get_by_role('dialog')
    expect(dialog.get_by_text('Chờ đến lượt',exact=True)).to_have_count(5)
    page.wait_for_timeout(200)
    assert len(posted)==2 and peak[0]==2
    assert all(body['paid'] is True for body in posted)
    reply(held.pop('s1'),'s1')
    expect(dialog.get_by_role('button',name='Đóng',exact=True)).to_have_attribute('aria-disabled','false',timeout=12000)
    assert len(posted)==7 and len({body['studentId'] for body in posted})==7,'no payment POST may be replayed'
    assert peak[0]<=2,peak
    assert set(lookups)=={'s0','s3','s4'}
    expect(dialog.get_by_text('Đã nhận phản hồi 7/7 phiếu',exact=True)).to_be_visible()
    assert dialog.get_by_text('Cần kiểm tra trạng thái',exact=True).count()==1
    assert dialog.get_by_text('Chưa nhận được kết quả',exact=True).count()==2
    assert 70000 in page.evaluate('window.__requestTimeouts') and 10000 in page.evaluate('window.__requestTimeouts')
    page.screenshot(path='/private/tmp/qlhv-batch-results.png',full_page=True)
    dialog.get_by_role('button',name='Đóng',exact=True).click()
    expect(page.get_by_text('Đang có 1 thay đổi chưa lưu',exact=True)).to_be_visible()
    page.get_by_role('button',name='Hủy',exact=True).click()
    page.wait_for_timeout(1800)
    assert any('force=true' in url for url in summary_requests)
    assert len(posted)==7
    print('PASS: queue limit 2, double-submit guard, progress 7/7, stalled POST/GET settle, read-only recovery, unknown outcomes never replay, confirmed failure remains retryable')
    for route in held.values():
        try:route.abort()
        except:pass
    browser.close()
