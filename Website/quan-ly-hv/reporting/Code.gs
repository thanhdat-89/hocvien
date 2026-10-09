/* Paste into Google Apps Script. Set Script Properties as described in README. */
function setupReports() {
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('REPORTS_API_URL') || !p.getProperty('REPORTS_SECRET')) throw new Error('Configure REPORTS_API_URL and REPORTS_SECRET first');
  const folder = DriveApp.getFolderById('1QdxyRceswELZAHUUCWgqbi3ORwTOsEB5');
  folder.getName();
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'runScheduledReports').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('runScheduledReports').timeBased().everyDays(1).atHour(23).nearMinute(30).inTimezone('Asia/Ho_Chi_Minh').create();
}
function runScheduledReports() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const day = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
    const date = new Date(day + 'T12:00:00+07:00');
    const tomorrow = new Date(date.getTime() + 86400000);
    const kinds = [];
    if (date.getUTCDay() === 0) kinds.push('week');
    if (Utilities.formatDate(tomorrow, 'Asia/Ho_Chi_Minh', 'MM') !== day.slice(5, 7)) kinds.push('month');
    kinds.forEach(kind => writeReport_(kind, day));
  } finally { lock.releaseLock(); }
}
function previewWeekReport() { writeReport_('week', Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd'), true); }
function previewMonthReport() { writeReport_('month', Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd'), true); }
function writeReport_(kind, day, preview) {
  const props = PropertiesService.getScriptProperties();
  const key = 'REPORT_' + kind + '_' + day;
  if (!preview && props.getProperty(key)) return;
  const response = UrlFetchApp.fetch(props.getProperty('REPORTS_API_URL') + '?kind=' + kind, {
    headers: {Authorization: 'Bearer ' + props.getProperty('REPORTS_SECRET')}, muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error('Reports API failed: HTTP ' + response.getResponseCode());
  const r = JSON.parse(response.getContentText());
  if (r.endDate !== day || r.kind !== kind) throw new Error('Report date/kind mismatch');
  const name = (preview ? 'THỬ NGHIỆM - ' : '') + 'QLHV - Báo cáo ' + (kind === 'month' ? 'tháng' : 'tuần') + ' ' + r.startDate + ' đến ' + r.endDate;
  const folder = DriveApp.getFolderById('1QdxyRceswELZAHUUCWgqbi3ORwTOsEB5');
  const matches = folder.getFilesByName(name);
  const book = matches.hasNext() ? SpreadsheetApp.openById(matches.next().getId()) : SpreadsheetApp.create(name);
  DriveApp.getFileById(book.getId()).moveTo(folder);
  const summary = [['Chỉ tiêu','Giá trị'],['Kỳ báo cáo',r.startDate + ' – ' + r.endDate],['Thời điểm chốt',r.generatedAt],['Tổng số học viên',r.totalStudents],['Học viên đang học',r.activeStudents],['Học viên mới',r.newStudentCount],['Học viên học riêng/chưa đăng ký lớp',r.privateStudentCount]];
  if (kind === 'month') summary.push(['Học phí phải thu (VND)',r.tuitionDue],['Số bản ghi học phí',r.tuitionRecordCount]);
  writeTab_(book,'Tổng quan',summary);
  writeTab_(book,'Theo lớp',[['STT','Mã lớp','Lớp học','Khối lớp','Trạng thái','Số học viên'],...r.classes.map((c,i)=>[i+1,c.id,c.name,c.grade,c.status,c.studentCount])]);
  writeTab_(book,'Học viên mới',[['STT','Mã học viên','Học viên','Khối lớp','Ngày nhập học'],...r.newStudents.map((s,i)=>[i+1,s.id,s.name,s.grade,s.enrollmentDate])]);
  writeTab_(book,'Ghi chú',[['Định nghĩa chỉ tiêu'],...r.notes.map(n=>[n]),['Số liệu chốt trước khi kết thúc ngày; thay đổi sau giờ chạy chưa được tính.']]);
  const unused = book.getSheetByName('Sheet1'); if (unused && book.getSheets().length>1) book.deleteSheet(unused);
  SpreadsheetApp.flush();
  if (!preview) props.setProperty(key, book.getId());
  console.log(book.getUrl());
}
function writeTab_(book,name,rows) {
  const sheet = book.getSheetByName(name) || book.insertSheet(name);
  sheet.clear();
  // Text-only strings prevent names/notes beginning with '=' from becoming formulas.
  const safe = rows.map(row=>row.map(v=>typeof v==='string' && /^[=+@-]/.test(v) ? "'"+v : v));
  sheet.getRange(1,1,safe.length,safe[0].length).setValues(safe);
  sheet.getRange(1,1,1,safe[0].length).setBackground('#1649da').setFontColor('#ffffff').setFontWeight('bold');
  sheet.setFrozenRows(1); sheet.autoResizeColumns(1,safe[0].length);
  if (name==='Tổng quan' && rows.length>7) sheet.getRange(8,2).setNumberFormat('#,##0');
}
