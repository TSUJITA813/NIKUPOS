// レシートのロゴマークの設定（画像を選ぶ・濃さ・見本・消す）


import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../core/logo.dart';
import '../core/receipt.dart';
import 'common.dart';
import 'register.dart' show ReceiptView;

class LogoSettings extends StatefulWidget {
  const LogoSettings({super.key});
  @override
  State<LogoSettings> createState() => _LogoSettingsState();
}

class _LogoSettingsState extends State<LogoSettings> {
  bool busy = false;

  Future<void> pick() async {
    final s = AppScope.read(context);
    final XFile? file;
    try {
      file = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1600, maxHeight: 1600);
    } catch (e) {
      if (mounted) toast(context, '画像を開けませんでした');
      return;
    }
    if (file == null || !mounted) return;
    setState(() => busy = true);
    final bytes = await file.readAsBytes();
    if (!mounted) return;
    setState(() => busy = false);
    final logo = await logoDialog(context, bytes);
    if (logo == null) return;
    s.settings['logo'] = logo;
    await s.saveSettings();
    s.log('settings', 'レシートのロゴマークを変更');
    if (mounted) toast(context, 'ロゴマークを保存しました');
  }

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final logo = logoOf(s.settings);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const Text('レシートの一番上に印字します。白黒（2色）に変えて、レシートの幅に合わせて小さくします。お店のマークや看板の画像がおすすめです。', style: TextStyle(color: muted)),
      const SizedBox(height: 8),
      if (logo == null)
        Container(
          height: 80,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(10), border: Border.all(color: line)),
          child: const Text('ロゴマークはありません', style: TextStyle(color: muted)),
        )
      else ...[
        const Text('レシートの見本（大きさは縦長・横長に合わせて自動で整えます）', style: TextStyle(color: muted, fontSize: 13)),
        const SizedBox(height: 4),
        Center(
          child: Container(
            key: const ValueKey('logoPreview'),
            width: 300,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: Colors.white, border: Border.all(color: line), boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 6)]),
            child: ReceiptView(lines: [
              ...storeHeader(s.settings),
              const RLine('領収書', center: true),
              const RLine.hr(),
              const RLine('（商品）', right: '¥000'),
            ]),
          ),
        ),
        const SizedBox(height: 8),
        const Text('ロゴの大きさ', style: TextStyle(color: muted, fontSize: 13)),
        ChoiceBar<String>(
          height: 42,
          options: logoSizeLabels,
          value: logoSizes.containsKey(s.settings['logoSize']) ? s.settings['logoSize'] as String : 'normal',
          onChanged: (v) async {
            s.settings['logoSize'] = v;
            await s.saveSettings();
          },
        ),
      ],
      const SizedBox(height: 8),
      Wrap(spacing: 8, runSpacing: 8, children: [
        FilledButton.icon(
          key: const ValueKey('logoPick'),
          onPressed: busy ? null : pick,
          icon: const Icon(Icons.image_outlined),
          label: Text(logo == null ? '画像を選ぶ' : '別の画像にする'),
        ),
        if (logo != null)
          OutlinedButton.icon(
            key: const ValueKey('logoDelete'),
            style: OutlinedButton.styleFrom(foregroundColor: danger),
            onPressed: () async {
              if (!await confirmDialog(context, 'ロゴマークを消しますか？', ok: '消す', dangerous: true)) return;
              s.settings['logo'] = '';
              await s.saveSettings();
              s.log('settings', 'レシートのロゴマークを削除');
            },
            icon: const Icon(Icons.delete_outline),
            label: const Text('消す'),
          ),
      ]),
    ]);
  }
}

/// 選んだ画像の見本を見ながら濃さを決める。OK なら白黒の画像（base64）を返す
Future<String?> logoDialog(BuildContext context, Uint8List bytes) async {
  var darkness = 'normal';
  final cache = <String, String?>{};
  Future<String?> make(String d) async => cache[d] ??= await compute(makeLogo, (bytes: bytes, darkness: d));
  var current = make(darkness);
  return showDialog<String>(
    context: context,
    builder: (c) => StatefulBuilder(builder: (c, set) => AlertDialog(
          title: const Text('ロゴマークの見本'),
          content: SizedBox(
            width: 380,
            child: FutureBuilder<String?>(
              future: current,
              builder: (c, snap) {
                final done = snap.connectionState == ConnectionState.done;
                return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Container(
                    height: 150,
                    alignment: Alignment.center,
                    color: Colors.white,
                    child: !done
                        ? const CircularProgressIndicator()
                        : snap.data == null
                            ? const Text('この画像は読み込めませんでした。PNG か JPEG の画像を選んでください。', style: TextStyle(color: danger))
                            : Image.memory(logoBytesOf(snap.data!), gaplessPlayback: true),
                  ),
                  const SizedBox(height: 8),
                  const Text('濃さ（うすい色が消えるときは「こい」に）', style: TextStyle(color: muted, fontSize: 13)),
                  ChoiceBar<String>(
                    height: 40,
                    options: const [('light', 'うすい'), ('normal', 'ふつう'), ('dark', 'こい')],
                    value: darkness,
                    onChanged: (v) => set(() {
                      darkness = v;
                      current = make(v);
                    }),
                  ),
                ]);
              },
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c), child: const Text('キャンセル')),
            FilledButton(
              key: const ValueKey('logoOk'),
              onPressed: () async {
                final v = await current;
                if (v != null && c.mounted) Navigator.pop(c, v);
              },
              child: const Text('これにする'),
            ),
          ],
        )),
  );
}
