// 画面で共通に使う部品

import 'dart:async';

import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/sound.dart';

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

/// 「元に戻す」ボタン付きの知らせ（4秒）。知らせの外は触っても下の画面が使える
void undoToast(BuildContext context, String msg, VoidCallback onUndo) {
  final overlay = Overlay.maybeOf(context, rootOverlay: true);
  if (overlay == null) return;
  _toastTimer?.cancel();
  _toastEntry?.remove();
  late final OverlayEntry entry;
  void close() {
    if (_toastEntry == entry) {
      entry.remove();
      _toastEntry = null;
    }
  }
  entry = OverlayEntry(
    builder: (c) => Positioned(
      left: 16,
      right: 16,
      top: MediaQuery.paddingOf(c).top + 64,
      child: Center(
        child: Material(
          key: const ValueKey('undoToast'),
          color: const Color(0xEE2B2522),
          borderRadius: BorderRadius.circular(10),
          child: Padding(
            padding: const EdgeInsets.only(left: 16, right: 4),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Flexible(child: Text(msg, style: const TextStyle(color: Colors.white, fontSize: 15))),
              TextButton(
                key: const ValueKey('undoBtn'),
                onPressed: () {
                  _toastTimer?.cancel();
                  close();
                  onUndo();
                },
                child: const Text('元に戻す', style: TextStyle(color: Color(0xFFFFD27A), fontWeight: FontWeight.w800)),
              ),
            ]),
          ),
        ),
      ),
    ),
  );
  _toastEntry = entry;
  overlay.insert(entry);
  _toastTimer = Timer(const Duration(seconds: 4), close);
}

/// キー入力を数字の文字列に反映（Web版の applyKey と同じ）
String applyKey(String val, String key, int maxLen) {
  if (key == 'BS') return val.isEmpty ? '' : val.substring(0, val.length - 1);
  if (key == 'C') return '';
  final next = ((val == '0' ? '' : val) + key).replaceFirst(RegExp(r'^0+(?=\d)'), '');
  return next.length > maxLen ? val : next;
}

/// テンキー
///  7 8 9 | ⌫（1字消す）
///  4 5 6 |
///  1 2 3 | C（全部消す）
///  0   00|
class Keypad extends StatelessWidget {
  final void Function(String key) onKey;
  const Keypad({super.key, required this.onKey});

  Widget _btn(BuildContext context, String k, {Widget? child, Color? bgColor, Color? fg}) => OutlinedButton(
        key: ValueKey('key-$k'),
        style: OutlinedButton.styleFrom(
          backgroundColor: bgColor ?? const Color(0xFFF8F6F4),
          foregroundColor: fg ?? ink,
          side: const BorderSide(color: line),
          padding: EdgeInsets.zero,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          textStyle: Theme.of(context).textTheme.headlineSmall?.copyWith(fontSize: 24, fontWeight: FontWeight.w700),
        ),
        onPressed: () {
          Sound.play(Sfx.key);
          onKey(k);
        },
        child: child ?? Text(k),
      );

  @override
  Widget build(BuildContext context) {
    const gap = 8.0;
    return LayoutBuilder(builder: (c, box) {
      final colW = (box.maxWidth - gap * 3) / 4;
      final keyH = (colW / 1.6).clamp(44.0, 64.0);
      Widget cell(String k, {int flex = 1}) => Expanded(flex: flex, child: SizedBox(height: keyH, child: _btn(context, k)));
      Widget row(List<Widget> keys) => Row(children: [for (var i = 0; i < keys.length; i++) ...[if (i > 0) const SizedBox(width: gap), keys[i]]]);
      final digits = Column(children: [
        row([cell('7'), cell('8'), cell('9')]),
        const SizedBox(height: gap),
        row([cell('4'), cell('5'), cell('6')]),
        const SizedBox(height: gap),
        row([cell('1'), cell('2'), cell('3')]),
        const SizedBox(height: gap),
        row([cell('0', flex: 2), cell('00')]),
      ]);
      Widget side(String k, IconData icon, String label, Color bgColor, Color fg) => SizedBox(
            height: keyH * 2 + gap,
            child: _btn(context, k,
                bgColor: bgColor,
                fg: fg,
                child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Icon(icon, size: 26),
                  const SizedBox(height: 2),
                  FittedBox(child: Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700))),
                ])),
          );
      return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(flex: 3, child: digits),
        const SizedBox(width: gap),
        Expanded(
          child: Column(children: [
            side('BS', Icons.backspace_outlined, '1字消す', const Color(0xFFF1ECE8), ink),
            const SizedBox(height: gap),
            side('C', Icons.clear, '全部消す', const Color(0xFFF7E3DC), danger),
          ]),
        ),
      ]);
    });
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

/// 選択ボタン（現金／キャッシュレス／併用 など）。
/// どの画面でも同じ見た目で、文字は必ず1行（入らないときは文字を少し小さくする）。
class ChoiceBar<T> extends StatelessWidget {
  final List<(T, String)> options;
  final T value;
  final ValueChanged<T> onChanged;
  final Map<T, IconData>? icons;
  final double height;
  const ChoiceBar({super.key, required this.options, required this.value, required this.onChanged, this.icons, this.height = 46});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (c, box) {
      // ボタンの幅が狭いときは絵（アイコン）を省き、文字を大きく見せる
      final w = (box.maxWidth - 6 * (options.length - 1)) / options.length;
      final showIcons = w >= 140;
      return Row(children: [
        for (var i = 0; i < options.length; i++) ...[
          if (i > 0) const SizedBox(width: 6),
          Expanded(child: _option(options[i], showIcons)),
        ],
      ]);
    });
  }

  Widget _option((T, String) o, bool showIcons) {
    final on = o.$1 == value;
    final IconData? icon = showIcons ? (icons == null ? null : icons![o.$1]) : null;
    return Material(
      color: on ? const Color(0xFFF7E3DC) : Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: BorderSide(color: on ? accent : line, width: on ? 2 : 1)),
      child: InkWell(
        key: ValueKey('choice-${o.$1}'),
        borderRadius: BorderRadius.circular(10),
        onTap: () => onChanged(o.$1),
        child: SizedBox(
          height: height,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 6),
            child: Center(
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  if (icon != null) ...[Icon(icon, size: 18, color: on ? accent : ink), const SizedBox(width: 4)],
                  Text(o.$2, maxLines: 1, softWrap: false, style: TextStyle(fontSize: 15, fontWeight: on ? FontWeight.w800 : FontWeight.w500, color: on ? accent : ink)),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
