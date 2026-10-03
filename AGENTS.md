# ScreenShooter — 変更時の注意

- 起動はソース直実行（ショートカットが `node_modules/electron/dist/electron.exe` にこのフォルダを渡す）。ビルド不要。exe 化はしない（このPCは Smart App Control がオン）。
- IMPORTANT: **自動起動はアプリで面倒を見ない**（2026-09-13 ユーザー決定）。スタートアップ フォルダの `ScreenShooter.lnk`（旧名の `スクショ.lnk` のままでも動く）はユーザーが手で置く。**アプリから作る・消すコードを足さない**（設定のチェック1つで、置いたショートカットを消してしまう事故があったため）。設定画面にも項目を作らない。
- 自動起動をレジストリの `Run` で実現しない。デスクトップ（explorer）より先に走るので、**トレイ常駐のこのアプリは出てこないことがある**（実際に再起動で起動しなかった）。スタートアップ フォルダの `.lnk` だけを使う。
- ショートカットに渡すフォルダ名には**空白が入る**（`Claude Code`）。`args` は自分で二重引用符で囲む。囲まないと `C:\Users\<ユーザー名>\Claude` を渡したことになって空ウィンドウが出る。
- **単一インスタンス**。直したらトレイの「終了」で終わらせてから起動し直す。起動中のプロセスには反映されず、2つ目を起動しても撮影が始まるだけ。入れ替わったかは `electron.exe` の起動時刻（`Win32_Process` の `CreationDate`）で確かめる。
- IMPORTANT: 編集画面の `close` は図形を書き出すため `preventDefault()` する。**終了の途中で止めると `app.quit()` ごと取り消される**ので、`closed` で `app.isQuitting` なら `app.quit()` をやり直している。消すと「終了」を押しても常駐が残る。
- IMPORTANT: **窓の読み込みは必ず `loadGuarded()` を通す**（`win.loadFile()` を直に呼ばない）。Smart App Control が無署名の `electron.exe` の子プロセスをときどき弾き、**枠だけの真っ白な窓**が残るため。3回まで黙ってやり直し、駄目なら案内を出す。
- IMPORTANT: 画面への初期データは **`loadGuarded()` の `onReady` で渡す**。`once('did-finish-load')` だと読み込み直した2回目に届かず、**立ち直っても中身が空のまま**になる。
- `dialog.showMessageBoxSync` は使わない。押されるまで本体が丸ごと止まり、トレイもホットキーも効かなくなる。
- 「アプリを起動し直す」は `app.relaunch()` + `app.exit(0)`。`spawn` で自前に立て直すと、古い方が終わる前に2つ目が起動して `second-instance` で撮影が始まる（`relaunch` なら競合しないことを実測ずみ）。
- HTML に `style="..."` を書かない。各画面の CSP（`style-src 'self'`）で無効になり、色や太さが消える。CSS 側に `[data-color="..."]` などで持たせる。
- 座標は3種類ある。**CSS px**（オーバーレイ・編集画面の入力）、**画像の実ピクセル**（保存されるもの）、**DIP**（ウィンドウの位置・大きさ）。オーバーレイの換算は `scaleFactor` を使わず「画像サイズ ÷ ウィンドウ幅」の実測比で出す（画面ごとに拡大率が違っても合うため）。
- `desktopCapturer` の `thumbnailSize` は全ソース共通。解像度の違う画面が混ざると片方が引き伸ばされるので、実ピクセル数ごとに分けて呼ぶ（`grabAllDisplays`）。
- 編集画面の図形はすべて画像座標で持ち、描画時に `setTransform` でまとめて拡大する。図形側に倍率を掛けない。
- 例外は影（`shadowBlur` / `shadowOffset`）。**canvas の変換が効かない**ので、`drawText` だけは `getTransform().a` を自分で掛ける。掛けないと拡大表示のときだけ影の大きさが合わない。
- 文字の飾りの一覧は `editor.js` の `DECOS` と `main.js` の `TEXT_DECOS` の2か所にある。増やすなら両方（片方だけだと設定に保存されず、次に開いたとき戻る）。
- `pointerdown` は**先頭で「置いたものの上か」を見て掴む**（切り抜きだけ素通し）。道具ごとの分岐に描き始めを足しても、図形の上ではそこへ届かない。文字の中身を直すのは `dblclick`。
- 枠のある文字（`box: true`）は、入力中は textarea が、確定後は `wrapLine()` が折り返す。**`#textEdit.box` に余白・縁を付けない**（幅が変わって、入力中と確定後で改行位置がずれる）。
- 描く・書き出す範囲は `state.crop` ではなく **`view()`**（切り抜き範囲＋はみ出した図形の外接）。`state.crop` は「ユーザーが切り抜いた範囲」だけを持つ。書き出し・座標変換で crop を直に使うと、はみ出した文字がまた切れる。
- ドラッグと文字入力のあいだは `freezeView()` で画角を止める。止めないと描いている最中に絵が伸び縮みして、入力欄の位置もずれる。
- 切り抜きのときは、範囲の外に丸ごと出た図形を消す。残すと `view()` がそのぶん広がって**切り抜けない**。
- 増えた余白は塗らない（透明）。Screenpresso と同じ見え方にするため、編集画面ではチェック柄が透ける。そのため絵と「絵に属するもの」（ぼかし・スポットの膜・拡大鏡の中身）は `state.crop` で clip して描く。clip しないと、広がった所に切り抜いて捨てた絵が出る（ぼかしの `paintBounds` も crop との重なりだけ）。
- IMPORTANT: **原寸の絵は保存先フォルダの1個だけ。** 撮った瞬間に `addToLibrary()` がそこへ書き、履歴（`library\<id>\`）はサムネイルと `meta.json` しか持たない。履歴に `original.png` / `flat.png` を作り直すと「同じ絵が2箇所にある」に戻る（ユーザーがいちばん嫌がっていた状態）。
- 図形は**画像に焼き込まない**。焼くのは `exportPNG()`（コピーと `_書き込み.png` の書き出し）だけ。元の絵を上書きすると「あとから編集し直せる」が壊れるので、**書き込み版は必ず別名**（`editedPathFor()`）。
- 元の絵のありかを決めるのは `originalPath(meta)` だけ（`meta.file` → 古い履歴の `original.png` の順）。読むのも、履歴からドラッグで渡すのも必ずここを通す。**ユーザーが保存先のファイルを消すと履歴は開けない**。これは承知のうえの仕様なので、保険のコピーを足さない。
- 「名前を付けて保存」は、出す絵が原本と同じとき（書き込みも仕上げも無い＝`needsExport()` が偽）は**コピーではなく `moveFile()` で移動**する。`isEdited()` で判断すると、仕上げだけの絵で原本が動いて仕上げが消える。コピーにするとファイルが増える。別ドライブへは `renameSync` が通らないので、コピー＋削除に落ちる形は残す。
- 履歴の削除（`deleteEntry` / `prune`）で保存先のファイルは消さない。メニューのラベルにも「ファイルは残る」と書いてある。
- Google ドキュメント／スライドは貼った画像の**面積 2,500万ピクセル²が上限**で、超えると縮められる。長辺基準で縮むので、縦長の絵は横方向まで潰れる。スクロール撮影の絵はここに引っかかるので「分割保存」で逃がす（`DOC_MAX_AREA` / `DOC_MAX_ASPECT`）。
- 画面録画は `session.setDisplayMediaRequestHandler` を登録しないと**要求が全部断られる**（`init()` で登録）。録る画面はこちらで決めるので選択ダイアログは出さない。
- 音は `audio: 'loopback'`（パソコンで鳴っている音）。`request.audioRequested` のときだけ付ける。取り込めない環境もあるので、画面側は失敗したら音なしでやり直す。
- 音を入れるときは MIME も音つきのもの（`mp4a` / `opus` 入り）を選ぶ。映像だけの MIME を渡すと音のトラックが黙って捨てられる。
- MP4(H.264) は**縦横が偶数**でないと録れない。切り抜きの大きさは偶数に丸める（`record.js` の `outW`/`outH`）。
- 録画に使う `<video>` と `<canvas>` を `display:none` にしない。映像が流れなくなる。画面の外（`#work`）に置いて隠す。
- 録画の操作バーは `setContentProtection(true)` で録画から外す。撮る範囲の外に置いたうえでの二段構え。外すと操作バー自身が写る。
- GIF の LZW は「コードを出してから桁を増やす」順番でないと、読む側と足並みが崩れて壊れる（`lib/gif.js` の `lzw()`）。
- 減色の中央値分割は、**1色が画素の半分より多いと真ん中が見つからず片方が空の箱になる**（白い背景の画面はまさにこれ）。空の箱は分けられないので色が増えず、パレットが黒のまま残って絵が崩れる。`splitBox()` で必ず両方に1色は入れる。
- GIF の減色のテストは、**1色が半分以上を占める絵**で確かめる。色が散らばった絵だけだと上の壊れ方をすり抜ける。
- GIF の色の組（パレット）は**コマ間で使い回す**。1コマごとに選び直すと、動いていない所まで別の色に振り替わって画面全体がチラチラする（実測でちらつき 1.71 → 0.02）。合わなくなったときだけ組み直す（`REBUILD_ERR`）。
- 色の組を組み直したコマは**絵ぜんぶを書き直す**。変わった所だけだと、古い色のままの所と混ざって継ぎはぎになる。
- 網掛け（ディザ）は**画面の位置で決まる並び（`BAYER`）**を使う。誤差拡散にすると、少し動いただけで網目が全面的にずれて派手にチラつく。
- GIF の画質は**画素ごとの差では測れない**。網掛けは画素単位では悪化して見えるので、ぼかしてから比べる／コマ間のちらつきを測る、の2つで判断する。
- IMPORTANT: GIF の「色が薄い」を**彩度を足して直そうとしない**。色みのある所を重く数える／書き出す色を数%濃くする、の2つを実測付きで入れたが、**見た目はかえって悪くなり、ファイルも増えた**ので戻した（2026-09-10 ユーザー判断）。数値（彩度の比・赤みの落ち）は良くなるのに見た目は悪くなる。判断は必ず実物を見てもらう。
- 録画の確認画面は**出た瞬間に1回だけ**最前面へ上げて、`RECORD_FRONT_MS` 後に外す。Windows は裏で動いているアプリからの `focus()` を無視するので、いったん `alwaysOnTop` にしないと前に出ない。最前面のままにするとじゃまになるので必ず外す。`setSkipTaskbar(false)` は外さない（後ろに回ったときの戻り道）。
- `gifMaxWidth` は **0 が「縮めない」**。`settings.gifMaxWidth || 800` のように書くと 0 が既定値に化けて、勝手に縮む。
- 録画も止めた瞬間に保存先へ `meta.videoFile` / `meta.gifFile` として書く。動画と GIF は**同じ名前で拡張子だけ違う**（1回の録画だと分かるようにするため）。`recordingFile()` は古い履歴の `movie.*` にも落ちる。
- 履歴は `meta.kind === 'video'` が録画、無ければ画像。開き方・右クリックメニュー・サムネイルの見た目がここで分かれる。
- 設定画面は、チェックや選択を触った時点で `current` に取り込む（`LIVE`）。キーの欄を押すと `render()` が走って、取り込んでいない入力は元に戻る。
- 連番マーカーは番号を持たず、`stepNumber()` が並び順から毎回数える。番号をデータに持たせると、1つ消したときの振り直しが要る。
- 画面の見た目を測るテストは、実物と同じ `frame: false` でウィンドウを作る。枠付きだとタイトルバーのぶん中身が狭く測れて、通るはずのものが落ちる。窓の位置・大きさは `getBounds()` で測る（画面側の `outerWidth` / `screenX` は見えない縁の左右 7px 込みで合わない）。
- IMPORTANT: 履歴パネルは作った直後に **`fitBounds()`** で指定どおりに合わせ直す。拡大率 150% の画面では作った窓が数px 大きくなり、それを覚えると**開くたびに育つ**（実測 +4px／回）。
- 履歴からのコピー（Ctrl+C・右クリック）は `copyFromLibrary()` だけを通す。書き込み・切り抜きのある絵と、仕上げが「そのまま」以外のときは、見えない編集画面（`exportOnly`）に `exportPNG()` させる。描き方を main 側に真似て書かない。
- 履歴フォルダの削除は `lib/store.js` の `remove()` だけを通す。**ID の形（`20260910-014233-a7f3`）に一致し、かつ `meta.json` を持つフォルダ**しか消さない。ここを緩めると、ユーザーが library に置いた別のフォルダを巻き添えにする。
- 外の画像の取り込みは `importImage()` だけを通す。保存先へコピーしてから履歴に入れ、`meta.source` に取り込み元を残す（同じ絵を何度渡しても増やさないため）。保存先の中にある絵はコピーしない。
- 「送る」は `%APPDATA%\Microsoft\Windows\SendTo\ScreenShooterで開く.lnk` 1個で実現する（レジストリは使わない）。`args` は `"<ROOT>"` だけで、選んだファイルのパスはシェルが後ろに足す。`imagePathsFrom()` が拾う。
- 落とされたファイルの実パスは preload の `filePath()`（`webUtils.getPathForFile`）で取る。Electron 32 で `File.path` が無くなったので、`file.path` は空になる。
- IMPORTANT: 集中モード（枠なし・絵だけ）は**ウィンドウを作り直して**切り替える。Windows は開いたあとのウィンドウから枠だけを外せない。図形・切り抜き・道具は画面側が `carry` に入れて渡す（`editor:focus`）。undo の履歴だけは引き継がない。
- 集中モードの窓は `setAspectRatio()` → `setContentSize()` の順に呼ぶ。逆だと比の補正で中身が 1px 削られ、絵との間に隙間が出る。
- 集中モードの `#canvasWrap` は `overflow: hidden`。スクロールバーが出ると、その幅のぶん狭く測って絵が縮み、縮んだあとは測り直さないので戻らない。
- 集中モードで道具を出すかどうかは、本体の `watchFocusCursor()` がカーソルの実位置で決める。`mouseleave` は `-webkit-app-region: drag`（窓をつかむ所）の上を通ると来ない。
- 編集画面は `page-title-updated` を止めてから `setEditorTitle()` でファイル名をタイトルにする。止めないと `editor.html` の `<title>` に戻され、何枚も並べたときに見分けが付かなくなる。
- 履歴パネルはサムネイルを `file://` で読むので、`library.html` の CSP は `img-src 'self' data: file:` が必要。
- 履歴パネルから外へのドラッグは、画面側で `dragstart` を止めて本体の `startDrag()` でやり直す。止めないと `<img>` の元（小さい `thumb.png`）が渡る。`icon` が空だと Windows で例外になるので、サムネイルが読めないときはドラッグしない。
- IMPORTANT: `library:drag` / `library:menu` が渡すのは**選んでいる ID の配列**（1件でも配列）。片方だけ単体 ID に戻すと、複数選択のドラッグ・メニューが黙って1件になる。
- 履歴パネルの選択は `click` ではなく `mousedown` で決める。ドラッグは押した時点で始まるので、`click` を待つと複数まとめてドラッグできない。すでに選んである札を押したときだけ `heldId` で `mouseup` まで待つ（押した瞬間に1枚へ絞ると、まとめて掴めなくなる）。
- IMPORTANT: 履歴パネルの自動引っ込めは**カーソルの実位置**で決める（`cursorOverLibrary`）。`mouseleave` 頼みだと、カーソルが乗ったまま窓を隠したとき通知が来ず「乗っている」で固まり、二度と引っ込まない。
- ドラッグのあいだはカーソルがパネルの外に出るので `libraryDragUntil` で先送りする。先送りは時間切れで必ず元に戻す（出しっぱなしを防ぐため）。
- 履歴パネルを開くのは**トレイからだけ**。撮影後に出すと編集画面と二重になる（`captureDone` / `addRecordingToLibrary`）。
- 履歴パネルの下のボタン列から撮るときは、先に `hideLibraryForCapture()` でパネルを隠す。出したままだと撮る画面に写り込む。
- SVG 要素は `el.hidden = true` が効かない（HTMLElement のプロパティのため）。`toggleAttribute('hidden', …)` で切り替える。
- メニューの `accelerator` は **ASCII しか通らない**。日本語を渡すとログに出るだけで表示は空になるので、「未設定」などはラベル側に書く（`trayItem`）。
- スクロール撮影のあいだだけ `win-rects.ps1 -Serve` を常駐させる（1回目 0.22 秒・2回目以降 4ms）。毎回起動すると十数回ぶんの待ちが積み上がる。終わったら必ず `stopHelper()`。
- スクロール撮影中は `globalShortcut` を全部外して Esc だけ登録し、終わったら `applyHotkeys()` で戻す。戻し忘れるとホットキーが死ぬ。
- ホイールは「カーソルの下の窓」に届く（Windows の "非アクティブ ウィンドウをスクロールする" が既定でオン）。この設定がオフの環境では手前の窓しかスクロールしない。
- IMPORTANT: ホイールを送る前に **`mouse_event` で実際の移動を1つ流し込む**（`MoveCursor`）。`SetCursorPos` だけだと「カーソルの下の窓」の判定が更新されず、**暗幕を閉じた直後は消えた窓を指したままになってホイールがどこにも届かない**。実測で、カーソルが動いていない状態では必ず失敗した。
- スクロールの歩幅は **1目盛りから始めて実測してから広げる**。いきなり大きく送ると重なりが消えて継ぎ目を見失う。見失ったら同じだけ戻して半分の歩幅で再挑戦する。
- 撮る前に `captureStable()` で画面が止まるのを待つ。なめらかスクロールの途中で撮ると、ずれを小さく誤検出し、そのあと歩幅が過大になって破綻する。
- スクロール撮影の経過は `%APPDATA%\ScreenShooter\scroll-log.txt` に残る（毎回上書き）。失敗の原因が「送りすぎ」か「動かない」かはここを見る。
- つなぎ目の検出（`lib/stitch.js`）は、画面の**上下の端を使わない**帯で比べる。上に貼り付いたヘッダー・下に貼り付いたボタンは動かないので、そこを使うと必ず「動いていない」と誤判定する。
- 手がかりが無い（真っ白など）ときは繋がずに止める。当てずっぽうで繋ぐと、ずれた絵が黙って出来上がる。
- 進行状況の窓は撮る範囲に重ならない場所に出す。重なると写り込む。置けないときは出さない。
- ウィンドウ吸い付きは `tools/win-rects.ps1` に聞く。**PowerShell 側を DPI aware にしないと座標が縮んで返る**（`MakeDpiAware`）。スクリーンショットは実ピクセルなので、ここを外すと枠が全部ずれる。
- 吸い付き用のスキャンは自分のプロセスIDのウィンドウを除いている（撮影用の暗幕を掴まないため）。副作用として、このアプリの編集画面・履歴パネル・浮かせた絵には吸い付かない。
- モニタと Electron の画面の対応が取れないとき（大きさが合わない・数が違う）は、`lib/snap.js` が `null` を返して吸い付きを諦める。**推測で対応させない**（違う場所に枠が出るくらいなら機能を切るほうがまし）。
- `settings.json` は **BOM 無し** UTF-8 で書く。BOM が付くと `JSON.parse` が失敗し、黙って既定値に戻る（＝ホットキーが既定に戻って他アプリと衝突する）。
- IMPORTANT: `package.json` の `productName` を変えると userData（`%APPDATA%\<名前>`）も変わり、**設定と履歴が消えたように見える**。旧名「スクショ」からの引っ越しは `lib/migrate.js` が `requestSingleInstanceLock()` より前に1回だけ行う（済んだ印は settings.json の `renamedFrom`。消すと保存先の絵をまた動かす）。また名前を変えるなら、ここも合わせて直す。
- 動作確認の起動は `--user-data-dir` に使い捨てフォルダを渡す（本番の設定を書き換えないため）。
- 検証用の Electron スクリプトでは `app.on('window-all-closed', () => {})` を必ず入れる。入れないと1つ目のウィンドウを閉じた時点でアプリが終了し、次の `loadFile` が `ERR_FAILED` になる。
- `npm install` で Electron 本体が落ちてこないことがある（`node_modules/electron/dist` が空）。そのときは `node node_modules\electron\install.js`。
- 日本語を含む `.ps1` は **BOM 付き UTF-8** で保存する。Windows PowerShell 5.1 は BOM が無いと ANSI として読むため、文字列が壊れて構文エラーになる。
- 手順書（`docs/manual.md`）の GIF を撮る・撮り直すときは `manual-shots` スキルを読む。

### 編集の道具（丸・蛍光ペン・スポット・拡大鏡）
- IMPORTANT: 絵と図形を描くのは `paintScene()` だけ（画面・コピー・保存・サムネイル・分割保存が全部通る）。個別の所に描き方を足すと、どれか1つだけ重なり順が違う絵になる。蛍光ペンなど下の段の図形は `UNDER_TYPES` に入れる。
- `pen` と `marker` は同じ `points` の持ち方。`type === 'pen'` で分けている所を足すときは `marker` も含める（漏れると拡大縮小で線だけ置いていかれる）。
- 蛍光ペンの混ぜ方（`blend`）は描いた時点で測って図形に保存する（開くたびに測るとぶれる）。色は共通の `color` と別の `markerColor`（既定は黄）で持ち、色の欄は `colorKey()` を通す。
- スポットの暗くする膜は `paintSpots()` が別 canvas で作り、スポットの四角と蛍光ペンの線を型抜きしてから重ねる（抜かないと乗算の蛍光ペンが暗さを受け継いで沈む）。スポットの `paintBounds()` は null なので、切り抜きの消す判定は `norm()` で見る。
- 拡大鏡ののぞき窓は `drawZoom()` の小さな canvas（絵＋ぼかし、crop で clip）から取る。`state.img` から直に拡大すると、ぼかした文字が読めてしまう。
- 拡大鏡の `cx`/`cy`/`r` は `x1..y2` と別に持つ。動かす処理は `moveShape()`（丸ごと）か `moveDragged()`（片方だけ）を通す。
- `placeLens()` は `paintBounds` と同じ見積もり（丸＋フチの半分＋影）で収まるかを見て、収まらなければ半径を7割まで縮める。片方だけ変えると、端に置いたとき画角が数px広がる。
- 吹き出しは `type: 'text'` に `bubble: true` としっぽの先（`tx`/`ty`）を足したもの。`x1..y2` は**中の文字の範囲**で、枠は余白ぶん外に描く（入力欄と折り返しを文字と共通にするため）。座標を動かす・掛ける処理を足すときは `tx`/`ty` も含める（`moveShape` / `scaleShape`）。道具の名前が要る所は `type` ではなく `kindOf()` を使う。
- 図形を絵や切り抜きの端に合わせて自動で置くときは、線の太さの半分だけ内側に寄せる（`shapeBounds()` が `width/2` 外まで数えるため。`clipToCrop` / `addShapesFromMain`）。

### 編集画面の並び
- ツールバーは窓幅 1160px 以上で2段（97px。実測の境目は約 1130px）、それ未満は3段（135px）。道具を足したら境目を測り直す。`main.js` の `openEditor` は既定幅（`EDITOR_MIN_W`）と、この段数＋自作タイトルバーに合わせた `CHROME` で窓の高さを出す。`.tool` の幅（56px）や文字を大きくしたら段数を測り直して両方を直す（ずれると絵が下へずれる）。太さ・文字の欄（`#opts`）は同時に1種類だけ出す（`reserveOptsWidth()`）。
- 下の帯は最小幅（`main.js` の `EDITOR_MIN_W` 1230。仕上げ＋「見る」＋「サイズ 77.1%」で実測 1203）で1行。倍率はサイズ表示ではなく「サイズ」ボタンの中に出す（表示側に足すとはみ出す）。物を足したら最小幅で右端の倍率が見えるか測り直す。縮めてよいのは案内（`#stTip`）だけで、ボタンは `flex: 0 0 auto; white-space: nowrap`（縮めると「自..」と潰れる）。集中モードの帯だけは折り返す（窓が 140px まで細くなるため）。
- 編集画面の窓の大きさ（`openEditor`）は、絵の実ピクセルをそのまま CSS px として見積もる。拡大率で割ると 150% の画面で小さな絵まで縮む。集中モードの `focusSize` だけは拡大率で割る。
- `position: fixed; left: 50%; transform` で置いたお知らせは、幅が窓の半分までしか伸びない（`max-width: 92vw` が効かない）。細い窓では width を明示する（`#privNotice`）。トースト（z-index 16）は赤枠のお知らせ（15）より上。
- 編集画面のタイトルバーは自作（`#titlebar`）。Windows 標準のは文字を大きくできないため `titleBarStyle: 'hidden'` ＋ `titleBarOverlay` で隠し、最小化・最大化・閉じるだけ Windows に描かせている。高さは `EDITOR_TITLE_H` と CSS の2か所、右端 150px はそのボタン用に空ける。タイトル文字は `setEditorTitle()` が `editor:title` で送る。
- 仕上げの確認画面（`#finishPreviewBox`）の絵は absolute で置く。grid/flex の行に戻すと `max-height: 100%` が効かず、縦長の絵が下にはみ出す。
- 設定画面の `body` は `height: 100%` にしない（`min-height`）。固定すると最後の節が下の帯の裏に隠れる。

### お気に入り・仕上げ・並べて1枚に
- お気に入りの道具の一覧は `editor.js` と `main.js` の `PRESET_TOOLS` の2か所。当てる項目は `presetPatch()` で道具ごとに絞る（全部を `applyStyle` に渡すと関係ない太さまで変わる）。
- 仕上げ（黒い縁取り・影つき・背景つき）は `exportPNG()` の中の `wrapFinish()` だけで付ける（分割保存は継ぎ目が出るので付けない）。値の表は `editor.js` の `FINISHES` と `main.js` の `EXPORT_FINISHES` の2か所。
- `nativeImage.toBitmap()` の画素は BGRA で透明度が掛け済み。白い下地に重ねるときは各色に `255 - a` を足す（`pasteOnWhite`）。
- 並べて1枚に（`combineEntries`）は各絵を `renderEdited(img, meta, { finish: 'none' })` で作る（仕上げを外さないと影付きの札が並ぶ）。

### 同じ範囲・浮かせる・違いに赤枠
- 「前回と同じ範囲」は `regionDisplay()` で画面の番号・位置・拡大率・取り込んだ絵の大きさがすべて一致したときだけ使う。合わなければ範囲選択に落とす（推測で撮らない）。
- 撮り直し（`editor:retake`）は窓を隠してから `captureRegion()` を await し、終わってから戻す。await を外すと隠した窓が写り込む。
- IMPORTANT: 浮かせた絵（`openPin`）は**撮影・録画に写る**（2026-09-26 ユーザー決定。録画ソフトにも映す）。`setContentProtection` を付けない。スクロール撮影のあいだだけ `hidePinsForScroll()` で隠す（ホイールがピンに吸われるため）。
- 浮かせた絵の窓は `resizable: true` ＋ `will-resize` の `preventDefault()` で作り、大きさ・位置は `baseW/baseH × scale` から毎回出して `fitContentBounds()`（中身基準）で合わせる。`resizable: false` や `fitBounds()`（外枠基準）だと 150% の画面で中身が 1〜2 DIP 足りず絵が縮む。
- 暗幕（screen-saver 段）を壊すと、浮かせた絵（floating 段）が最前面から外れる。暗幕を閉じたら `raisePins()` で付け直す（`closeOverlays` とスクロール撮影の後片付け）。
- 浮かせた絵の縁のドラッグも Windows に任せず、`startPinResize()` で本体がカーソルを読んで `scale` を出す（任せると縦横比が崩れ、150% の画面で窓が育つ）。IMPORTANT: 外周（150% で左・上 約4 DIP、右・下 1px）は Windows が横取りして画面側に押した知らせが来ない。`will-resize` を合図に自前へ切り替え、`WM_EXITSIZEMOVE` で終える形を消すと、そこを掴んだとき何も起きなくなる。
- 浮かせた絵の移動に `-webkit-app-region: drag` を使わない（右クリック・ホイールが届かない）。押している間は本体が `getCursorScreenPoint` を読み、押した瞬間の中身の大きさごと `setContentBounds` で動かす（`setPosition` だけだと 150% の画面で呼ぶたびに窓が育つ）。
- 浮かせた絵をホイールで大きくした瞬間、広がった右・下が1コマ黒くなる（描画が追いつくまで GPU 側が黒で埋める）。`backgroundColor` では消えない。`transparent` は影が消えて 150% の画面で幅が 1 縮む、`disable-direct-composition` は透明な窓が映らなくなるので、どちらも採らない（2026-09-28 ユーザー判断：そのままにする）。
- 見えない編集画面の `editor:exported` は `{ dataUrl, x, y }`（画角の左上）を返す。文字列だけに戻すと、書き込み入りの絵を浮かせたとき位置がずれる。
- 違いの赤枠は `editor:addShapes`（または editor:init の `addShapes`）で編集画面に足させる。main で meta.shapes に直接書くと、開いている窓の次の書き戻しで消え、Ctrl+Z でも消せない。
- `lib/diff.js` で枠を減らすときは、距離を広げず `coarsen()` でマスを粗くする（縦長の絵で止まる）。カーソルとして捨てる大きさは縦（`caretW`/`caretH`）と横（`thin`/`thinLong`）で別（縦のカーソルは 150% の画面で 64px になる）。

### 個人情報の自動ぼかし
- IMPORTANT: `tools/ocr.ps1` は撮影ごとに1回起動して終わる。常駐させるなら win-rects の helper とは別にする（スクロール撮影の後片付けで一緒に止まる）。
- ocr.ps1 の変数は大文字小文字を区別しない（`$w` と `$W` が同じになる）。`GetFileFromPathAsync` は `/` 区切りを黙って受け付けないので、`GetFullPath` で直してから渡す。
- 検出（`lib/pii.js`）は日本語・英語エンジン × 1倍・2倍の結果を別々に調べて、位置でまとめる。片方だけだと `\` が `*` に化ける所などで見落とす。
- 登録語の `/…/`（正規表現）の読み方は `lib/pii.js` の `patternOf()` と `settings.js` の `showBadPatterns()` の2か所。片方だけ直すと「警告が出ないのに効かない」になる。
- 検出に Presidio（Python の PII 検出）を足さない（2026-09-28 ユーザー判断：日本語の名前・住所の精度が低く、重さと Smart App Control の手間に見合わない）。手順書にも見送りの理由を書いてある。
- ぼかしは画面側（`placePrivateBlurs`）が置く時点の `state.crop` で切り詰め、既存のぼかしで8割覆われた所は飛ばす。本体側で切り詰めると、読み取り中に切り抜いたとき画角が広がる。

### 省略（横の帯を抜く）
- IMPORTANT: 抜いた帯は `state.cuts`（`meta.cuts`）に**撮ったときの座標**で持ち、`state.img` は `useImage()` が「縮める → 帯を抜いてつなぎ目を描く」で毎回作る。図形・切り抜きは**抜いたあとの座標**（座標の換算は下のサイズ変更と共通の関数を通す）。
- つなぎ目の寸法（`seamDims`）は大きさに比例させている。大きさを変えたときの図形の縦の位置は、`resizeTo` が撮ったときの座標を通して出し直す（k 倍だけだと丸めの差で数 px ずれる）。
- 帯を抜いたあとにトーストを出さない。下の真ん中に出るトーストが、続けて帯を選ぶドラッグを横取りする。

### サイズ変更
- IMPORTANT: サイズを変えた絵は `state.img` が縮めた canvas で、**図形・切り抜き・`meta.shapes`/`meta.crop` はすべて今の大きさの座標**（`meta.scale` が倍率）。撮ったときの座標で来るもの（自動ぼかしの四角・違いの赤枠）は `origRectToCur()` を、撮ったときの座標で返すもの（浮かせる位置・`editor:exported` の x,y）は x を `state.scale` で割り y を `curToOrig(cutNow(), …)` で戻す。`* state.scale` だけで換算すると、省略したつなぎ目より下で位置がずれる。
- 縮めるのは `resample.js`（Lanczos）だけ。`drawImage` で縮めると文字がにじむ。毎回 `state.orig` から作り直すので、縮めた絵をさらに縮めない。
- 大きさと省略の帯は undo の snapshot に入っている（`restore()` が絵も差し替える）。図形だけ戻すと座標と絵の大きさが食い違う。

## コードに無い識別子

| 名前 | 値 |
|---|---|
| 設定ファイル | `%APPDATA%\ScreenShooter\settings.json` |
| 撮影履歴 | `%APPDATA%\ScreenShooter\library\<id>\`（`thumb.png` / `meta.json` のみ。原寸の絵は持たない） |
| 録画の履歴 | 同じ場所に `thumb.png` / `meta.json` のみ。動画と GIF は保存先フォルダ |
| 保存先（既定） | `%USERPROFILE%\Pictures\ScreenShooter`。撮った瞬間にここへ入る |
| 既定のホットキー | `Ctrl+Shift+S`（範囲選択） |
| 自動起動 | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ScreenShooter.lnk`（`shell:startup` で開ける。旧名の `スクショ.lnk` のままでもよい）。**ユーザーが手で置く。アプリは触らない** |
| 「送る」メニュー | `%APPDATA%\Microsoft\Windows\SendTo\ScreenShooterで開く.lnk`（`shell:sendto` で開ける。設定でオンにしたときだけ作る） |
| Windows がブロックした記録 | イベントログ `Microsoft-Windows-CodeIntegrity/Operational`（Id 3077 がブロック。ポリシー名 `VerifiedAndReputableDesktop` = Smart App Control） |
| スクロール撮影の記録 | `%APPDATA%\ScreenShooter\scroll-log.txt`（毎回上書き） |
| 失敗時に残る2枚 | `%APPDATA%\ScreenShooter\scroll-debug\`（1-スクロール前.png / 2-スクロール後.png） |
