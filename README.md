# Auto Clicker Userscript

A movable and minimizable multi-point auto clicker userscript for web pages, including canvas-based apps such as Unity WebGL.

日本語の説明は下にあります。

## Features

- Register multiple click positions.
- Configure the cycle interval for returning to the same point.
- Keeps canvas points relative to the canvas, so registered positions can follow canvas resizing.
- Sends PointerEvent and MouseEvent sequences for better compatibility with canvas apps.
- Movable and minimizable control panel.
- Saves positions, interval, panel position, and minimized state per site.
- English and Japanese UI.
- Default language is Japanese when the browser environment is Japanese; otherwise English.
- Language can be changed from the userscript manager menu:
  - `Language: English`
  - `言語: 日本語`

## Installation

Install a userscript manager such as Tampermonkey, Violentmonkey, Greasemonkey, or another compatible userscript manager, then install `autoclicker.user.js`.

The script currently matches all HTTP/HTTPS pages (`*://*/*`). If you only need it on specific sites, narrow the `@match` rules before publishing or installing it.

## Usage

1. Open a page where you want to use the auto clicker.
2. Press **Add position** and tap/click the target position.
3. Repeat for additional positions if needed.
4. Enter a cycle interval of at least 50 ms.
5. Press **Start**.
6. Press **Stop** to stop the click loop.

When multiple positions are registered, the configured interval is the target time before returning to the same position. To reduce overlapping input, the interval between adjacent positions is kept at a minimum of 16 ms.

## Language

The first-run language is selected from the browser environment:

- Japanese locale (`ja`, `ja-JP`, etc.) -> Japanese
- Any other locale -> English

The selected language is stored by the userscript manager and can be changed at any time from its script menu.

## Notes

- The script runs only in the top-level page, not inside iframes.
- While the auto clicker is running, the script places an input shield over the page to avoid accidental real taps/clicks. The control panel remains usable so you can stop it.
- Some websites or games may ignore synthetic events or prohibit automation in their terms of service. Use the script only where you are allowed to do so.

## Development

Main userscript: [`autoclicker.user.js`](./autoclicker.user.js)

Before publishing a new version, increment `@version` in the userscript metadata block.

## License

MIT License. See [LICENSE](./LICENSE).

---

# オートクリッカー Userscript

Webページ上で複数位置を自動クリックできるUserscriptです。Unity WebGLなどのCanvasベースのページも考慮しています。

## 機能

- 複数のクリック位置を登録
- 同じ地点へ戻るまでの一周間隔を設定
- Canvas上の位置はCanvas相対座標で保存し、リサイズ時にも追従
- Canvas系アプリとの互換性を高めるためPointerEventとMouseEventを送信
- 操作パネルを移動・最小化可能
- 位置、間隔、パネル位置、最小化状態をサイトごとに保存
- 日本語・英語UI
- ブラウザ環境が日本語なら初期言語は日本語、それ以外は英語
- Userscriptマネージャーのメニューから言語切替可能
  - `Language: English`
  - `言語: 日本語`

## インストール

Tampermonkey、Violentmonkey、GreasemonkeyなどのUserscriptマネージャーを導入し、`autoclicker.user.js`をインストールしてください。

現在はすべてのHTTP/HTTPSページ（`*://*/*`）で実行されます。特定サイトだけで使う場合は、公開前またはインストール前に`@match`を絞ることをおすすめします。

## 使い方

1. オートクリッカーを使いたいページを開きます。
2. **位置を追加**を押して、クリックしたい位置をタップ/クリックします。
3. 必要であれば複数位置を追加します。
4. 50ms以上の一周間隔を入力します。
5. **開始**を押します。
6. 止める場合は**停止**を押します。

複数地点を登録した場合、設定値は「同じ地点に戻ってくるまでの目標周期」です。入力が重なりにくいよう、隣り合う地点の実行間隔は最低16msに保たれます。

## 言語設定

初回はブラウザ環境から自動判定します。

- 日本語ロケール（`ja`, `ja-JP`など）: 日本語
- それ以外: 英語

選択した言語はUserscriptマネージャー側に保存され、いつでもスクリプトメニューから変更できます。

## 注意事項

- iframe内では実行せず、トップレベルページのみで動作します。
- 実行中は誤操作防止のためページ上の実タップ/クリックを遮断します。操作パネルは使用できるため停止可能です。
- サイトやゲームによっては合成イベントを受け付けない場合があります。また、自動化を利用規約で禁止しているサービスもあります。利用可能な範囲で使用してください。

## ライセンス

MIT Licenseです。詳細は[LICENSE](./LICENSE)を参照してください。
