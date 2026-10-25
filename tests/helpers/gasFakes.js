/**
 * Apps Script の実行環境の代役（メモリ上のシート・フォーム）。
 * src/ のコードを、Google に接続せずに通しで動かすための検査用。実環境の代わりにはならない。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function colToNum(letters) {
  return letters.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}

function noop() {
  const p = new Proxy({}, { get: (t, prop) => (typeof prop === 'symbol' || prop === 'then' ? undefined : () => p) });
  return p;
}

class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; }
  getName() { return this.name; }
  cell(r, c) { return (this.rows[r - 1] && this.rows[r - 1][c - 1] !== undefined) ? this.rows[r - 1][c - 1] : ''; }
  put(r, c, v) {
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = v;
  }
  getLastRow() {
    let last = 0;
    this.rows.forEach((row, i) => { if (row.some((v) => v !== '' && v !== undefined)) last = i + 1; });
    return last;
  }
  getLastColumn() { return Math.max(1, ...this.rows.map((r) => r.length)); }
  appendRow(values) { const r = this.getLastRow() + 1; values.forEach((v, i) => this.put(r, i + 1, v)); }
  deleteRow(r) { this.rows.splice(r - 1, 1); }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), this.getLastColumn()); }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = a.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d*))?$/);
      const c1 = colToNum(m[1]); const r1 = Number(m[2]);
      const c2 = m[3] ? colToNum(m[3]) : c1;
      const r2 = m[3] ? (m[4] ? Number(m[4]) : Math.max(r1, this.getLastRow())) : r1;
      return new FakeRange(this, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
    }
    return new FakeRange(this, a, b, c || 1, d || 1);
  }
  getProtections() { return []; }
  hideSheet() { this.hidden = true; return this; }
  showSheet() { this.hidden = false; return this; }
  isSheetHidden() { return !!this.hidden; }
  setConditionalFormatRules(rules) { this.conditionalRules = rules; }
  getConditionalFormatRules() { return this.conditionalRules || []; }
  protect() { return noop(); }
  getActiveRange() { return this.getRange(1, 1); }
}
['setFrozenRows', 'setColumnWidth', 'setTabColor', 'setRowHeightsForced'].forEach((m) => { FakeSheet.prototype[m] = function () { return this; }; });

class FakeRange {
  constructor(sheet, row, col, nr, nc) { this.sheet = sheet; this.row = row; this.col = col; this.nr = nr; this.nc = nc; }
  getSheet() { return this.sheet; }
  getRow() { return this.row; }
  getNumRows() { return this.nr; }
  getA1Notation() {
    const letter = (n) => String.fromCharCode(64 + n);
    return this.nr === 1 && this.nc === 1 ? letter(this.col) + this.row : letter(this.col) + this.row + ':' + letter(this.col + this.nc - 1) + (this.row + this.nr - 1);
  }
  getValue() { return this.sheet.cell(this.row, this.col); }
  setFormula(f) { this.sheet.put(this.row, this.col, f); return this; }
  clearContent() { for (let r = 0; r < this.nr; r++) for (let c = 0; c < this.nc; c++) this.sheet.put(this.row + r, this.col + c, ''); return this; }
  setValue(v) { this.sheet.put(this.row, this.col, v); return this; }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) { const row = []; for (let c = 0; c < this.nc; c++) row.push(this.sheet.cell(this.row + r, this.col + c)); out.push(row); }
    return out;
  }
  setValues(values) {
    values.forEach((row, r) => row.forEach((v, c) => this.sheet.put(this.row + r, this.col + c, v)));
    return this;
  }
}
FakeRange.prototype.setBackground = function (c) { (this.sheet.backgrounds = this.sheet.backgrounds || {})[this.getA1Notation()] = c; return this; };
FakeRange.prototype.setNote = function (n) { (this.sheet.notes = this.sheet.notes || {})[this.getA1Notation()] = n; return this; };
['setDataValidation', 'setNumberFormat', 'setFontWeight', 'setFontSize', 'setWrap', 'setWrapStrategy', 'setVerticalAlignment'].forEach((m) => {
  FakeRange.prototype[m] = function () { return this; };
});

class FakeSpreadsheet {
  constructor() { this.sheets = [new FakeSheet('Sheet1')]; this.toasts = []; }
  getId() { return 'ss1'; }
  getSheets() { return this.sheets; }
  getSheetByName(n) { return this.sheets.filter((s) => s.name === n)[0] || null; }
  insertSheet(n, i) { const s = new FakeSheet(n); this.sheets.splice(i === undefined ? this.sheets.length : i, 0, s); return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
  toast(m) { this.toasts.push(m); }
  getActiveSheet() { return this.active || this.sheets[0]; }
  setActiveSheet(s) { this.active = s; return s; }
}

class FakeItem {
  constructor(form, kind, id) { this.form = form; this.kind = kind; this.id = id; this.points = 0; this.title = ''; this.choices = []; }
  getId() { return this.id; }
  setTitle(t) { this.title = t; return this; }
  setRequired() { return this; }
  setPoints(p) { if (!(p > 0)) throw new Error('フォームを更新するデータが無効です。'); this.points = p; return this; }
  setChoices(c) { this.choices = c; return this; }
  createChoice(value, correct) { return { value, correct, getValue() { return value; } }; }
  getChoices() { return this.choices.slice(); }
  asMultipleChoiceItem() { return this; }
  setFeedbackForCorrect(f) { this.feedbackForCorrect = f; return this; }
  setFeedbackForIncorrect(f) { this.feedbackForIncorrect = f; return this; }
}

class FakeResponse {
  constructor(form, id, answersByTitle) { this.form = form; this.id = id; this.answersByTitle = answersByTitle; this.grades = []; }
  getId() { return this.id; }
  getTimestamp() { return new Date('2026-10-20T10:00:00Z'); }
  getRespondentEmail() { return 'student@example.com'; }
  getItemResponses() {
    return this.form.items.filter((i) => this.answersByTitle[i.title] !== undefined)
      .map((i) => ({ getItem: () => i, getResponse: () => this.answersByTitle[i.title] }));
  }
  getGradableResponseForItem(item) {
    if (this.answersByTitle[item.title] === undefined) return null;
    const res = this;
    return {
      item, score: null, feedback: null, res, getItem() { return item; },
      setScore(s) { this.score = s; return this; }, setFeedback(f) { this.feedback = f; return this; }
    };
  }
  withItemGrade(ir) { this.grades.push({ item: ir.item, score: ir.score, feedback: ir.feedback && ir.feedback.text }); return this; }
}

class FakeForm {
  constructor(id, title) { this.id = id; this.title = title; this.items = []; this.responses = []; this.accepting = true; this.submitted = []; this.nextId = 100; }
  getId() { return this.id; }
  getPublishedUrl() { return 'https://forms.example/' + this.id; }
  getEditUrl() { return 'https://forms.example/edit/' + this.id; }
  getItems() { return this.items.slice(); }
  deleteItem(i) { this.items = this.items.filter((x) => x !== i); }
  getItemById(id) { return this.items.filter((i) => i.id === id)[0]; }
  getResponses() { return this.responses.slice(); }
  getResponse(id) { return this.responses.filter((r) => r.id === id)[0]; }
  setAcceptingResponses(v) { this.accepting = v; return this; }
  submitGrades(list) { this.submitted.push(list.map((r) => ({ id: r.id, grades: r.grades.slice() }))); }
  addItem(kind) { const it = new FakeItem(this, kind, this.nextId++); this.items.push(it); return it; }
  addSectionHeaderItem() { return this.addItem('SECTION'); }
  addTextItem() { return this.addItem('TEXT'); }
  addParagraphTextItem() { return this.addItem('PARAGRAPH'); }
  addMultipleChoiceItem() { return this.addItem('MULTIPLE_CHOICE'); }
  addCheckboxItem() { return this.addItem('CHECKBOX'); }
  addListItem() { return this.addItem('DROPDOWN'); }
  /** 検査用: 学生が送信したことにする。 */
  submit(answersByTitle) { const r = new FakeResponse(this, 'resp' + (this.responses.length + 1), answersByTitle); this.responses.push(r); return r; }
}
FakeForm.prototype.setLimitOneResponsePerUser = function (v) { this.limitOne = v; return this; };
FakeForm.prototype.setCollectEmail = function (v) { this.collectEmail = v; return this; };
FakeForm.prototype.setPublishingSummary = function (v) { this.publishingSummary = v; return this; };
['setTitle', 'setDescription', 'setIsQuiz', 'setAllowResponseEdits', 'setDestination'].forEach((m) => {
  FakeForm.prototype[m] = function () { return this; };
});

function createGasContext(options) {
  const ss = new FakeSpreadsheet();
  const forms = {};
  const props = { document: {}, script: Object.assign({}, options && options.scriptProperties) };
  const triggers = [];
  let formCount = 0;
  const propsApi = (store) => ({
    getProperty: (k) => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = String(v); },
    deleteProperty: (k) => { delete store[k]; }
  });
  const lock = { tryLock: () => true, releaseLock() {} };
  const triggerBuilder = (fn) => {
    const t = { fn, type: null, getHandlerFunction: () => fn };
    const b = {
      forSpreadsheet: () => b, onEdit: () => { t.type = 'edit'; return b; },
      timeBased: () => b, everyMinutes: () => { t.type = 'clock'; return b; },
      create: () => { triggers.push(t); return t; }
    };
    return b;
  };
  const sandbox = {
    console,
    SpreadsheetApp: {
      getActive: () => ss, getActiveSpreadsheet: () => ss, getActiveSheet: () => ss.getActiveSheet(),
      WrapStrategy: { CLIP: 'CLIP' }, newDataValidation: () => noop(), newConditionalFormatRule: () => noop(), ProtectionType: { SHEET: 'SHEET' },
      getUi: () => noop()
    },
    FormApp: {
      DestinationType: { SPREADSHEET: 'SPREADSHEET' },
      create: (title) => { const f = new FakeForm('form' + (++formCount), title); forms[f.id] = f; return f; },
      openById: (id) => { if (!forms[id]) throw new Error('not found'); return forms[id]; },
      createFeedback: () => ({ setText(t) { this.text = t; return this; }, build() { return { text: this.text, getText: () => this.text }; } })
    },
    PropertiesService: { getDocumentProperties: () => propsApi(props.document), getScriptProperties: () => propsApi(props.script) },
    LockService: { getDocumentLock: () => lock, getScriptLock: () => lock },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      newTrigger: (fn) => triggerBuilder(fn),
      deleteTrigger: (t) => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); }
    },
    Utilities: { getUuid: () => 'uuid-' + Math.random().toString(16).slice(2), sleep() {} },
    UrlFetchApp: { fetch: (url, opt) => (options && options.fetch ? options.fetch(url, opt) : { getResponseCode: () => 500, getContentText: () => '' }) }
  };
  const ctx = vm.createContext(sandbox);
  const srcDir = path.join(__dirname, '..', '..', 'src');
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.js')).sort()
    .concat(fs.readdirSync(path.join(srcDir, 'providers')).map((f) => 'providers/' + f));
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(srcDir, f), 'utf8'), ctx, { filename: f }));
  return { ctx, ss, forms, triggers, props };
}

module.exports = { createGasContext };
