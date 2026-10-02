# 例文ノート

単語帳の写真から例文と日本語訳を抽出し、元写真との照合と英文チェックを行い、8列のCSVに保存する教員向けのツールです。ブラウザー内で動く静的サイトなので、GitHub Pagesで公開できます。ライブラリーのインストールや独自のサーバーは不要です。

## できること

- JPG・PNG・WebPを複数追加。順番に抽出し、写真ごとにチェックします。
- 罫線・余白で区切られたまとまりをブロックとして認識し、①②などを例文番号として記録。番号がない例文の番号は空欄です。
- 名詞句・動詞句などの短い語句を、完全な英文に書き換えず抽出します。
- 抽出後、別のリクエストで元写真を読み直し、誤字・英文と訳の対応・文法・番号・抽出漏れをチェックします。
- 疑問点を「要確認」とし、日本語の理由と修正候補を表示。候補は自動適用しません。
- 写真の拡大表示、抽出前の90度回転、ページ番号の指定、各行の編集・削除・追加、手動確認。
- 検索・状態の絞り込み、50行単位の表示、CSV保存、作業JSONによる中断・再開。
- 429や一時的なサーバーエラーに最大2回再試行。停止ボタンで通信を中断。完了した抽出結果は保持し、失敗した処理を再開できます。
- APIキー不要の15行のサンプル。利用者提供写真の469ページから手動で転記したデモで、Geminiの出力ではありません。元写真は配布ファイルに含みません。

## 最短でGitHub Pagesに公開

1. ZIPを展開し、GitHubで空のリポジトリを作成します。
2. このフォルダーの中身をリポジトリのルートに追加し、`main`ブランチにpushします。`public`と`package.json`がルートに並ぶ形です。`.github/workflows/pages.yml`も含めてください。
3. GitHubのリポジトリで **Settings → Pages → Build and deployment → Source → GitHub Actions** を選びます。
4. **Actions → Deploy to GitHub Pages → Run workflow** を実行します。以降、`main`へのpushで更新されます。
5. 完了後、**Settings → Pages** に表示されるURLを開きます。`https://ユーザー名.github.io/リポジトリ名/`で動きます。すべて相対パスなので設定変更は不要です。

コマンドで追加する例（リポジトリURLは自分のものに置き換えます）:

```bash
git init
git add .
git commit -m "Add example transcription tool"
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

**GitHubのWeb画面だけで公開する方法:** 展開した`public`フォルダーの**中身**（`index.html`、`style.css`、`favicon.svg`、`sample.json`、`js`フォルダー）をリポジトリのルートにアップロードします。次に **Settings → Pages → Source: Deploy from a branch → main / (root)** を選びます。この方法ではActionsやNode.jsは不要です。ZIPそのものをアップロードするだけでは公開されません。

## Google Cloudの設定

サイト右上の「API設定」に、**プロジェクトID**（名前や番号ではありません）と**APIキー**を入力します。キーはコード、GitHub、ActionsのSecretsに入れません。サイトを利用する人が自身のキーを毎回入力する方式です。

### A. Vertex AI / Google Cloud APIキー

ご指定のGoogle Cloudキーを使う方式です。

1. Google Cloudで、利用するプロジェクトの課金とVertex AI API（`aiplatform.googleapis.com`）を有効にします。現在の公式画面ではGemini Enterprise Agent Platformの名称で案内される場合があります。
2. Googleの公式手順に従い、**サービスアカウントに紐付いたAPIキー**を作成します。Express modeを利用している場合は、そのモードで作成されたキーを使えます。通常のAPIキーを作るだけではVertex AIの認証・権限を満たせないことがあります。組織のポリシーや権限で作成できない場合は管理者に確認するか、Bの方式を使います。
3. サイトの「Vertex AI / Google Cloud APIキー」を選び、キーを入力します。
4. 「接続をテスト」で、抽出モデルとチェックモデルが両方使えるか確かめ、「設定を適用」します。テストにも少量のAPI利用が発生します。

**プロジェクトIDの扱い:** GoogleのAPIキー専用エンドポイントは、URLにproject IDを指定しません。この実装では、入力IDを形式検証して作業JSONに記録します。通信先のプロジェクト・課金・割り当てはAPIキーに紐付いたものです。入力IDとキーの所有プロジェクトの一致をこのツールから検証・切替することはできません。プロジェクトを変える場合は、そのプロジェクトで作成した対応キーを使ってください。

呼び出すエンドポイント:

```text
https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:generateContent
```

### B. Gemini API / Google AI Studioキー

Google AI Studioで発行したキー、またはGemini APIを利用できる対応キーを使用する場合は、この方式を選びます。必要なAPIはGenerative Language API（`generativelanguage.googleapis.com`）です。Vertex AI専用のキーを流用できるとは限りません。

```text
https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
```

両方式ともキーを`x-goog-api-key`ヘッダーで渡します。URLにキーを含めません。

### モデル

- 抽出の初期値: `gemini-2.5-flash`
- チェックの初期値: `gemini-2.5-pro`

コストや速度を優先する場合は、両方を`gemini-2.5-flash`に変更できます。自動チェックを切って抽出のみ行い、後でまとめてチェックすることもできます。

Googleの公式ドキュメントでは、Gemini 2.5シリーズの利用が過去の利用状況などで制限される場合が案内されています。新しいプロジェクトで2.5を利用できない場合、キーを入れても動きません。Google側の利用可能モデルを確認してください。設定欄はモデルIDを直接変更できるようにしていますが、**指定外のモデルへ自動的には切り替えません**。Gemini 2.5以外に変更する場合、そのモデルが画像入力と構造化JSON出力に対応していることを確認してください。

### キー・データの取り扱い

- APIキーはタブのメモリ内だけに保持します。ブラウザーのlocalStorage・sessionStorage・Cookieに保存しません。
- 写真と結果は自動保存しません。写真の追加だけではGoogleに送信せず、抽出・チェックを始めたときに送信します。
- 独自サーバー、広告、アクセス解析、外部フォントへの通信はありません。公開サイトのファイルはGitHub Pages、処理データは選択したGoogle APIに接続します。
- ブラウザーからGoogle APIへ直接通信するため、キーは利用者自身の端末・開発者ツールから確認できます。運営者の共通キーを埋め込んで多数の利用者に使わせる用途には対応していません。
- キーのAPI制限・参照元制限は、利用するAPIと公開URLに合わせて設定してください。参照元制限の可否はキーの種類とGoogle側の仕様によって異なります。機密情報の送信は所属先の方針とGoogle側の利用条件に従ってください。

## 使い方とCSV

1. API設定を適用します。
2. 写真を追加します。必要なら写真をクリックして回転し、ページ番号を指定します。写真は長辺最大3600pxのJPEGにして送信し、EXIFなどの付随情報は送信画像に引き継ぎません。HEIC・PDFは未対応です。
3. 「抽出を開始」を押します。通常は写真1枚につき抽出1回・チェック1回。40行を超える写真ではチェックを分割します。
4. 「要確認」を絞り込み、行を選んで元写真・疑問点・候補を確認します。修正をすると状態が「要確認」に戻ります。最後に「手動確認済みにする」を押します。
5. 「CSVを保存」で**絞り込みに関係なく全行**を保存します。英文が空の追加行があると保存できません。

CSVの列は固定です。

| 列 | 内容 |
| --- | --- |
| 英文 | 原文の例文・語句。改行は空白でつなぐ |
| 日本語訳 | 印刷されている対応訳。補足訳も含む |
| 写真名 | 選択した画像の元ファイル名 |
| ページ番号 | 印刷されたページ番号。読めない場合は空欄 |
| ブロック番号 | ページごとに上から連番（1始まり） |
| 例文番号 | ①②などの印刷番号。番号がなければ空欄 |
| 状態 | 抽出済み / AI確認済み / 要確認 / 手動確認済み |
| 確認理由 | OCR・英文・訳・番号などの疑問点。写真全体の疑問点はその写真の最初の行に付記 |

Excel向けにUTF-8 BOMとCRLF改行を使い、すべてのセルを引用符で囲みます。カンマ・引用符・改行を正しくエスケープします。初期設定では、数式と解釈され得る`= + - @`で始まるセルに先頭の`'`を付けます。原文を完全にそのまま書き出したい場合は、API設定で数式保護をオフにできます。

**チェックの限界:** AI確認済みは「AIが問題を検出しなかった」という意味です。正しさの保証ではありません。不自然な原文を自然な英文に勝手に修正せず、判読不能は`[判読不能]`などで明示させます。抽出漏れ・罫線認識・番号の読み取りにも誤りが残ることがあります。

## 作業の保存と再開

「作業JSONを保存」で、元の抽出文・修正候補・状態・メモも保存します。**写真とAPIキーは含みません**。写真は自分で保管してください。

JSONを読み込んだ後、同じ名前の写真を追加すると行に再接続できます。写真がないまま「AIで再チェック」を実行した場合、英文・訳の内容だけを確認し、写真との一致や抽出漏れは未確認という理由を付けます。CSVやJSONは自分の端末にダウンロードされます。

## ローカルで動かす

Node.js 20以降があれば、依存パッケージなしで実行できます。

```bash
npm test
npm run dev
```

`http://localhost:8080/`を開きます。`index.html`をダブルクリックする`file://`方式では、JavaScriptモジュールとサンプル読取が制限されるためHTTPサーバーを使用してください。

`npm run build`で配信用ファイルを`dist/`にコピーします。GitHub Actionsはテスト→ビルド→公開を自動実行します。

## 検証と構成

`tests/core.test.mjs`は、8列CSVの形式、引用符・改行、数式保護、短い語句・アクセント保持、不明箇所、行IDの欠落・重複、原文の保持、編集後の状態変更、JSON復元、APIリクエスト、エラー時のキー非表示、途中終了したAI応答の拒否を検証します。

この配布版は実際のAPIキーを持たない環境で作成し、Geminiの応答を模擬したテストで通信と処理を検証しています。Googleへの実接続やGeminiによる添付写真のOCR精度は未検証です。ブラウザーの画面操作による確認も実行環境の制限で完了していません。利用開始時に「接続をテスト」と少数の写真で確認してください。

```text
public/index.html       画面
public/style.css        デザイン・スマホ対応
public/js/app.js        写真・編集・チェック・保存
public/js/api.js        Google API・抽出/校閲プロンプト
public/js/core.js       検証・状態・CSV
public/sample.json      15行の手動転記サンプル
tests/core.test.mjs     自動テスト
.github/workflows/      GitHub Pagesの公開処理
```

## 参考にした公式ドキュメント

- [Google Cloud APIキーを取得する](https://cloud.google.com/vertex-ai/generative-ai/docs/start/api-keys?usertype=standard)
- [Google CloudでGeminiを呼び出すクイックスタート](https://cloud.google.com/vertex-ai/generative-ai/docs/start/quickstart?usertype=apikey)
- [Express modeのエンドポイント](https://cloud.google.com/vertex-ai/generative-ai/docs/start/express-mode/overview)
- [Google Cloudの画像入力](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-understanding)
- [Google Cloudの構造化出力](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/control-generated-output)
- [Gemini APIのモデル・利用可否](https://ai.google.dev/gemini-api/docs/models)
- [Gemini APIキー](https://ai.google.dev/gemini-api/docs/api-key)
- [GitHub Pagesのカスタムワークフロー](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
