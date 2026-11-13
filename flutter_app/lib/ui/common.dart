// 画面で共通に使う部品

import 'dart:async';

import 'package:flutter/material.dart';

import '../core/app_state.dart';

const accent = Color(0xFFB8452A);
const ink = Color(0xFF2B2522);
const muted = Color(0xFF7A706A);
const line = Color(0xFFE4DDD6);
const bg = Color(0xFFF6F3EF);
const okColor = Color(0xFF2E8B57);
const danger = Color(0xFFC0392B);
const displayBg = Color(0xFF2B2522);
const costColor = Color(0xFF4A78B0);

/// アプリの状態を、画面のどこからでも使えるようにする
class AppScope extends InheritedNotifier<AppState> {
  const AppScope({super.key, required AppState state, required super.child}) : super(notifier: state);
  static AppState of(BuildContext c) => c.dependOnInheritedWidgetOfExactType<AppScope>()!.notifier!;
  static AppState read(BuildContext c) => c.getInheritedWidgetOfExactType<AppScope>()!.notifier!;
}

/// タブレット向けの画面にするか（設定で「スマートフォン向け」「タブレット向け」「自動」を選べる）
bool useTabletLayout(BuildContext context, AppState s) => switch (s.layoutMode) {
      LayoutMode.phone => false,
      LayoutMode.tablet => true,
      LayoutMode.auto => MediaQuery.sizeOf(context).shortestSide >= 600,
    };

Color colorFrom(String? hex, [Color fallback = const Color(0xFF8FA3B8)]) {
  if (hex == null || !hex.startsWith('#') || hex.length != 7) return fallback;
  return Color(int.parse('FF${hex.substring(1)}', radix: 16));
}

OverlayEntry? _toastEntry;
Timer? _toastTimer;

/// 短い知らせ。画面の上に出し、触っても下のボタンが押せる（会計ボタンなどを隠さない）
void toast(BuildContext context, String msg) {
  final overlay = Overlay.maybeOf(context, rootOverlay: true);
  if (overlay == null) return;
  _toastTimer?.cancel();
  _toastEntry?.remove();
  final entry = OverlayEntry(
    builder: (c) => Positioned(
      left: 16,
      right: 16,
      top: MediaQuery.paddingOf(c).top + 64,
      child: IgnorePointer(
        child: Center(
          child: Material(
            key: const ValueKey('toast'),
            color: const Color(0xEE2B2522),
            borderRadius: BorderRadius.circular(10),
            child: Padding(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10), child: Text(msg, style: const TextStyle(color: Colors.white, fontSize: 15))),
          ),
        ),
      ),
    ),
  );
  _toastEntry = entry;
  overlay.insert(entry);
  _toastTimer = Timer(const Duration(milliseconds: 2200), () {
    if (_toastEntry == entry) {
      entry.remove();
      _toastEntry = null;
    }
  });
}

Future<bool> confirmDialog(BuildContext context, String msg, {String ok = 'OK', bool dangerous = false}) async {
  final r = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      content: Text(msg),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('キャンセル')),
        FilledButton(
          style: dangerous ? FilledButton.styleFrom(backgroundColor: danger) : null,
          onPressed: () => Navigator.pop(c, true),
          child: Text(ok),
        ),
      ],
    ),
  );
  return r == true;
}

/// キー入力を数字の文字列に反映（Web版の applyKey と同じ）
String applyKey(String val, String key, int maxLen) {
  if (key == 'BS') return val.isEmpty ? '' : val.substring(0, val.length - 1);
  if (key == 'C') return '';
  final next = ((val == '0' ? '' : val) + key).replaceFirst(RegExp(r'^0+(?=\d)'), '');
  return next.length > maxLen ? val : next;
}

/// テンキー
class Keypad extends StatelessWidget {
  final void Function(String key) onKey;
  const Keypad({super.key, required this.onKey});
  @override
  Widget build(BuildContext context) {
    const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', 'BS'];
    return GridView.count(
      crossAxisCount: 3,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 8,
      crossAxisSpacing: 8,
      childAspectRatio: 2.1,
      children: [
        for (final k in keys)
          OutlinedButton(
            key: ValueKey('key-$k'),
            style: OutlinedButton.styleFrom(
              backgroundColor: const Color(0xFFF8F6F4),
              foregroundColor: ink,
              side: const BorderSide(color: line),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              textStyle: Theme.of(context).textTheme.headlineSmall?.copyWith(fontSize: 24, fontWeight: FontWeight.w700),
            ),
            onPressed: () => onKey(k),
            child: k == 'BS' ? const Icon(Icons.backspace_outlined) : Text(k),
          ),
      ],
    );
  }
}

/// 大きな金額の表示（黒地）
class AmountDisplay extends StatelessWidget {
  final String label, value;
  final bool light, highlight;
  final Color? valueColor;
  final VoidCallback? onTap;
  const AmountDisplay(this.label, this.value, {super.key, this.light = false, this.highlight = false, this.valueColor, this.onTap});
  @override
  Widget build(BuildContext context) {
    final box = Container(
      margin: const EdgeInsets.symmetric(vertical: 3),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
      decoration: BoxDecoration(
        color: light ? const Color(0xFFF7E3DC) : displayBg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: highlight ? accent : Colors.transparent, width: 2),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(label, style: TextStyle(color: light ? muted : const Color(0xFFCBBFB8), fontSize: 14)),
          const Spacer(),
          Flexible(
            child: FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerRight,
              child: Text(value,
                  style: TextStyle(
                      fontSize: light ? 22 : 28,
                      fontWeight: FontWeight.w800,
                      color: valueColor ?? (light ? ink : Colors.white),
                      fontFeatures: const [FontFeature.tabularFigures()])),
            ),
          ),
        ],
      ),
    );
    return onTap == null ? box : InkWell(onTap: onTap, borderRadius: BorderRadius.circular(12), child: box);
  }
}

/// 数字のカード（売上・客数など）
class StatCard extends StatelessWidget {
  final String label;
  final Widget value;
  final Widget? sub;
  const StatCard(this.label, this.value, {super.key, this.sub});
  @override
  Widget build(BuildContext context) => Card(
        elevation: 0,
        color: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: line)),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text(label, style: const TextStyle(color: muted, fontSize: 13)),
            const SizedBox(height: 4),
            DefaultTextStyle.merge(style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: ink), child: value),
            if (sub != null) ...[const SizedBox(height: 4), DefaultTextStyle.merge(style: const TextStyle(fontSize: 12, color: muted), child: sub!)],
          ]),
        ),
      );
}

/// 幅に合わせてカードを並べる
class CardGrid extends StatelessWidget {
  final List<Widget> children;
  final double minWidth;
  const CardGrid({super.key, required this.children, this.minWidth = 160});
  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (c, box) {
        final n = (box.maxWidth / minWidth).floor().clamp(1, children.length);
        final w = (box.maxWidth - (n - 1) * 8) / n;
        return Wrap(spacing: 8, runSpacing: 8, children: [for (final ch in children) SizedBox(width: w, child: ch)]);
      });
}
