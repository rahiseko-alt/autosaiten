/**
 * 練習の判断（フォームの項目の並び、資料の本文、フォームを作るかの判断、名簿の整理）。
 * Apps Script の API には依存しない。本番の受付（reception/）とは別のプロジェクトなので、名簿の整理だけ同じ振る舞いで写してある。
 */

function prText_(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

/**
 * 練習フォームの項目の並び。本番に揃え、氏名欄とクラス欄を先頭に置く。
 * テスト形式にせず、配点も付けない。1人1回制限・メール収集もしないので、ログインなしで何度でも送れる。
 * @param {string[]} classes 名簿から取ったクラス（出てきた順）
 */
function practiceFormSpec(classes) {
  var choices = (classes || []).map(prText_).filter(function (c) { return c !== ''; });
  if (choices.length === 0) throw new Error('名簿にクラスがありません。名簿シートを確認してください');
  return {
    title: '練習フォーム',
    description: 'これは練習です。成績には入りません。何度でも送信できます。',
    isQuiz: false,
    limitOneResponse: false,
    collectEmail: false,
    allowResponseEdits: false,
    nameItem: { title: '氏名（Name）', required: true },
    classItem: { title: 'クラス', required: true, choices: choices },
    items: [
      { kind: 'INFO', title: '資料を読んで答える', help_text: '受付ページで受け取った資料を読み、下の欄に答えを書きます。' },
      { kind: 'INFO', title: 'ただし書き', help_text: 'この練習は手順の確認のためのものです。採点はされません。' },
      { kind: 'TEXT', title: 'タグ名', required: true, help_text: '自分で決めたタグの名前を入力します。' },
      { kind: 'PARAGRAPH', title: '答え', required: true, help_text: '資料を読んだ答えを書きます。' },
    ],
  };
}

/** 練習の資料。全員同じ1種類。 */
function practiceMaterial() {
  return [
    '【練習の資料】',
    'ある店で、1個120円のパンを3個と、1本150円の牛乳を2本買います。',
    '合計はいくらですか。計算の途中も書いてください。',
  ].join('\n');
}

/**
 * フォームを新しく作るか、保存済みのものを使うか。
 * 準備用の関数は外から呼ばれうるので、保存済みのフォームがあれば作らない。
 * @param {{formId?: string}} saved スクリプトプロパティに保存した値
 */
function planFormSetup(saved) {
  var formId = saved && prText_(saved.formId);
  if (formId) return { action: 'reuse', formId: formId };
  return { action: 'create' };
}

/** 名簿の行を、クラスごとに名簿の順のまま分ける。クラスか氏名が空の行は使わない。reception/Reception.js と同じ振る舞い。 */
function rosterByClass(rows) {
  var classes = [];
  var byName = {};
  rows.forEach(function (r) {
    var cls = prText_(r.クラス);
    var name = prText_(r.氏名);
    if (cls === '' || name === '') return;
    if (!byName[cls]) {
      byName[cls] = { name: cls, students: [] };
      classes.push(byName[cls]);
    }
    byName[cls].students.push(name);
  });
  return classes;
}

if (typeof module !== 'undefined') module.exports = {
  practiceFormSpec: practiceFormSpec,
  practiceMaterial: practiceMaterial,
  planFormSetup: planFormSetup,
  rosterByClass: rosterByClass,
};
