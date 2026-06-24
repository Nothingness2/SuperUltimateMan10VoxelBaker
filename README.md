[README.md](https://github.com/user-attachments/files/29288493/README.md)
# SuperUltimateMan10VoxelBaker

Blockbench プラグイン。インポートした Mesh（OBJ 等）を voxel 化して、Minecraft 互換の Cube 群＋自動生成アトラスに変換します。

## 必要環境

- Blockbench 4.0 以上（デスクトップ版）
- 対応プロジェクトフォーマット: **Java Block** または **Generic Model (bbmodel)**

## 導入手順

### 1. プラグインファイルを取得

このリポジトリの [super_ultimate_man10_voxel_baker.js](super_ultimate_man10_voxel_baker.js) をローカルに保存してください（リポジトリをクローンしているならそのままパスを使えます）。

### 2. Blockbench にロード

1. Blockbench を起動
2. メニューから `ファイル > プラグイン...` を開く
3. ダイアログ右上の `…` メニューから **「プラグインを開く」** を選択
4. 保存した `super_ultimate_man10_voxel_baker.js` を選択

ロードに成功するとプラグイン一覧に **SuperUltimateMan10VoxelBaker** が現れます。

### 3. 動作確認

1. **Java Block** または **Generic Model (bbmodel)** の新規プロジェクトを作成
2. 右サイドバーに **SuperUltimateVoxelBaker** パネルが表示されることを確認
3. パネル上部に `Format: java_block`（または `free`）と現在のフォーマットが出ていれば OK

パネルが見えない場合は右ペインの折りたたみを展開、または右ペイン余白を右クリックして `SuperUltimateVoxelBaker` を選択してください。

## 基本的な使い方

1. OBJ を `ファイル > インポート > OBJ` で読み込む（マテリアル・テクスチャも一緒に）
2. 右パネルでパラメータを調整
3. **「適用 (voxel化)」** ボタンを押す
4. 元 Mesh は自動的に hide され、`Voxelized_HHMMSS` グループに Cube 群が生成される

パラメータの詳細・内部パイプライン・補足はプラグイン詳細画面（`ファイル > プラグイン...` で本プラグインをクリック）の About を参照してください。

## トラブルシュート

問題が起きたら DevTools (`ヘルプ > 開発者ツール`) のコンソールを開いて、`[Voxelizer]` 接頭辞のログを確認してください。三角形数・テクスチャ読み込み状態・アトラス利用率などが出力されます。

## クレジット

- 作者: UltimateTanaka
- アルゴリズム改善: masu1208
- 同上: AsPulse
- 同上: JToTl
- プラグイン命名: **forest611**
