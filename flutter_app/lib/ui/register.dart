// レジ画面（商品の選択・カート・保留・会計）

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/app_state.dart';
import '../core/calc.dart';
import '../core/receipt.dart';
import '../core/receipt_pdf.dart';
import '../core/sound.dart';
import 'common.dart';
import 'reservations.dart' show outputPdf, pdfFont;

String priceLabel(Json p) {
  if (p['unit'] == 'g') return '${yen(p['price'] as num)}/100g';
  if (p['unit'] == 'open') return '金額入力';
  return yen(p['price'] as num);
}

class RegisterPage extends StatefulWidget {
  const RegisterPage({super.key});
  @override
  State<RegisterPage> createState() => _RegisterPageState();
}

class _RegisterPageState extends State<RegisterPage> {
  String cat = '__all';
  final search = TextEditingController();
  String q = '';

  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  Future<void> tapProduct(AppState s, Json p) async {
    HapticFeedback.selectionClick();
    if (p['unit'] == 'pc') {
      // 追加の知らせは出さない（商品の個数の印と合計で分かる。知らせが会計ボタンを隠さないように）
      s.addToCart(p);
    } else if (p['unit'] == 'g') {
      final g = await numberDialog(context, title: p['name'] as String, label: '重さ', unit: 'g', note: '${priceLabel(p)}・はかりの値を入力', price: (p['price'] as num).toInt());
      if (g != null && g > 0) s.addToCart(p, qty: g);
    } else {
      final yenVal = await numberDialog(context, title: p['name'] as String, label: '金額（税込）', unit: '円');
      if (yenVal != null && yenVal > 0) s.addToCart(p, price: yenVal);
    }
  }

  int _serial = 0;

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    // 新しい取引になったら、検索とカテゴリを最初に戻す
    if (_serial != s.txnSerial) {
      _serial = s.txnSerial;
      search.clear();
      q = '';
      cat = '__all';
    }
    // 「次のお客様」を押すと、新しい取引の画面が右から入ってくる（前の取引は左へ出ていく）
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 380),
      switchInCurve: Curves.easeOutCubic,
      switchOutCurve: Curves.easeInCubic,
      transitionBuilder: (child, anim) {
        final incoming = child.key == ValueKey('txn-${s.txnSerial}');
        final slide = Tween<Offset>(begin: incoming ? const Offset(1, 0) : const Offset(-1, 0), end: Offset.zero).animate(anim);
        return ClipRect(child: SlideTransition(position: slide, child: FadeTransition(opacity: anim, child: child)));
      },
      child: KeyedSubtree(key: ValueKey('txn-${s.txnSerial}'), child: _NewTxnScope(onBuild: () => _body(context, s))),
    );
  }

  Widget _body(BuildContext context, AppState s) {
    final tablet = useTabletLayout(context, s);
    final catalog = _catalog(s, tablet);
    if (tablet) {
      // カートの幅は画面に合わせる（狭い画面でタブレット向けを選んでも商品が並ぶように）
      return LayoutBuilder(builder: (c, box) {
        final cartW = (box.maxWidth >= 1000 ? 400.0 : 340.0).clamp(0.0, box.maxWidth * 0.5);
        return Row(children: [
          Expanded(child: catalog),
          const VerticalDivider(width: 1, color: line),
          SizedBox(width: cartW, child: const CartPanel()),
        ]);
      });
    }
    return Column(children: [Expanded(child: catalog), const MiniCartBar()]);
  }

  Widget _catalog(AppState s, bool tablet) {
    final cats = s.categories;
    if (cat != '__all' && !cats.contains(cat)) cat = '__all';
    final list = s.products.where((p) => q.isNotEmpty ? matchProduct(p, q) : (cat == '__all' || p['category'] == cat)).toList()
      ..sort((a, b) => ((a['order'] ?? 0) as num).compareTo((b['order'] ?? 0) as num));
    final counts = <Object?, num>{};
    for (final l in s.lines) {
      counts[l['productId']] = (counts[l['productId']] ?? 0) + (l['unit'] == 'pc' ? l['qty'] as num : 1);
    }
    final searchField = SizedBox(
      width: tablet ? 220 : double.infinity,
      height: 44,
      child: TextField(
        key: const ValueKey('prodSearch'),
        controller: search,
        textInputAction: TextInputAction.search,
        decoration: InputDecoration(
          hintText: '商品を検索',
          prefixIcon: const Icon(Icons.search),
          suffixIcon: q.isEmpty ? null : IconButton(icon: const Icon(Icons.close), onPressed: () => setState(() { search.clear(); q = ''; })),
          contentPadding: EdgeInsets.zero,
          filled: true,
          fillColor: Colors.white,
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: const BorderSide(color: line)),
        ),
        onChanged: (v) => setState(() => q = v.trim()),
        onSubmitted: (v) {
          final hits = s.products.where((p) => matchProduct(p, v)).toList();
          final exact = s.products.where((p) => (p['code'] ?? '') != '' && p['code'] == v.trim()).toList();
          final one = exact.length == 1 ? exact.first : hits.length == 1 ? hits.first : null;
          if (one != null) {
            setState(() { search.clear(); q = ''; });
            tapProduct(s, one);
          }
        },
      ),
    );
    final chips = SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(children: [
        for (final c in ['__all', ...cats])
          Padding(
            padding: const EdgeInsets.only(right: 6),
            child: ChoiceChip(
              label: Text(c == '__all' ? 'すべて' : c),
              selected: q.isEmpty && cat == c,
              onSelected: (_) => setState(() { cat = c; search.clear(); q = ''; }),
            ),
          ),
      ]),
    );
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
        // 横に十分な幅があれば検索とカテゴリを1行に、狭ければ2行に
        child: LayoutBuilder(
          builder: (c, box) => tablet && box.maxWidth >= 520
              ? Row(children: [searchField, const SizedBox(width: 8), Expanded(child: chips)])
              : Column(children: [SizedBox(width: double.infinity, child: searchField), const SizedBox(height: 8), Align(alignment: Alignment.centerLeft, child: chips)]),
        ),
      ),
      Expanded(
        child: list.isEmpty
            ? Center(child: Text(q.isNotEmpty ? '「$q」に合う商品はありません。' : '商品がありません。「管理」→「商品」から登録してください。', style: const TextStyle(color: muted)))
            : GridView.builder(
                padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
                gridDelegate: SliverGridDelegateWithMaxCrossAxisExtent(maxCrossAxisExtent: tablet ? 180 : 150, mainAxisSpacing: 10, crossAxisSpacing: 10, childAspectRatio: 1.25),
                itemCount: list.length,
                itemBuilder: (c, i) => ProductTile(p: list[i], count: counts[list[i]['id']] ?? 0, onTap: () => tapProduct(s, list[i])),
              ),
      ),
    ]);
  }
}

/// 取引ごとに作り直す部分（検索の文字やスクロールの位置も新しい取引で最初に戻る）
class _NewTxnScope extends StatelessWidget {
  final Widget Function() onBuild;
  const _NewTxnScope({required this.onBuild});
  @override
  Widget build(BuildContext context) => onBuild();
}

class ProductTile extends StatelessWidget {
  final Json p;
  final num count;
  final VoidCallback onTap;
  const ProductTile({super.key, required this.p, required this.count, required this.onTap});
  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(12),
      elevation: 1,
      child: InkWell(
        key: ValueKey('product-${p['id']}'),
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Stack(children: [
          Container(
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(12), border: Border(top: BorderSide(color: colorFrom(p['color'] as String?), width: 6))),
            padding: const EdgeInsets.fromLTRB(10, 10, 10, 8),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(p['name'] as String, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: ink)),
              const Spacer(),
              Text(priceLabel(p) + (p['taxRate'] == 10 ? '（10%）' : ''), style: const TextStyle(color: muted, fontSize: 14)),
            ]),
          ),
          if (count > 0)
            Positioned(
              right: 6,
              top: 10,
              child: CircleAvatar(radius: 12, backgroundColor: accent, child: Text(numStr(count), style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700))),
            ),
        ]),
      ),
    );
  }
}

/// スマートフォン向け：画面の下の合計とボタン
class MiniCartBar extends StatelessWidget {
  const MiniCartBar({super.key});
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final t = s.cartTotals;
    final n = s.holds.length;
    return Material(
      elevation: 8,
      color: Colors.white,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
          child: Row(children: [
            Expanded(
              child: InkWell(
                key: const ValueKey('openCart'),
                onTap: () => openCartSheet(context),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                  Row(children: [
                    Text('No.${s.nextNoLabel}　${t.count}点', style: const TextStyle(color: muted)),
                    if (n > 0) Text('　保留$n件', style: const TextStyle(color: accent, fontWeight: FontWeight.w700)),
                    const Spacer(),
                    Text(yen(s.cartDeposit > 0 ? (t.total - s.cartDeposit).clamp(0, 1 << 31) : t.total), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
                  ]),
                  const Text('カートを見る ▲', style: TextStyle(color: accent, fontSize: 13)),
                ]),
              ),
            ),
            const SizedBox(width: 10),
            SizedBox(
              height: 52,
              child: FilledButton(
                key: const ValueKey('payMini'),
                onPressed: s.cartEmpty ? null : () => openPayDialog(context),
                child: const Text('会計', style: TextStyle(fontSize: 18)),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}

Future<void> openCartSheet(BuildContext context) => showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (c) => FractionallySizedBox(heightFactor: 0.88, child: const CartPanel(inSheet: true)),
    );

/// カート（タブレットは右側、スマートフォンは下から出す）
class CartPanel extends StatelessWidget {
  final bool inSheet;
  const CartPanel({super.key, this.inSheet = false});

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final t = s.cartTotals;
    final nh = s.holds.length;
    return Material(
      color: Colors.white,
      child: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 8, 4),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              const Text('お会計', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
              Text('　No.${s.nextNoLabel}', key: const ValueKey('cartNo'), style: const TextStyle(color: muted, fontSize: 13)),
              if (!s.cartEmpty) const Flexible(child: Text('　横にスライドで取消', style: TextStyle(color: muted, fontSize: 12), overflow: TextOverflow.ellipsis)),
              const Spacer(),
              if (inSheet) TextButton(onPressed: () => Navigator.pop(context), child: const Text('閉じる ▼')),
            ]),
            if (s.cart['reservationId'] != null)
              Chip(
                key: const ValueKey('cartResv'),
                visualDensity: VisualDensity.compact,
                avatar: const Icon(Icons.event_note, size: 16),
                label: Text('予約No.${s.cart['reservationNo']} ${s.cart['customer']} 様', overflow: TextOverflow.ellipsis),
              ),
          ]),
        ),
        Expanded(
          child: s.cartEmpty
              ? Center(
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    const Icon(Icons.receipt_long, size: 40, color: Color(0xFFCBBFB8)),
                    const SizedBox(height: 6),
                    Text('新しいお会計　取引No.${s.nextNoLabel}', key: const ValueKey('newTxn'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: ink)),
                    const SizedBox(height: 4),
                    const Text('商品ボタンをタップして追加', style: TextStyle(color: muted)),
                  ]),
                )
              : ListView.separated(
                  itemCount: s.lines.length,
                  separatorBuilder: (_, _) => const Divider(height: 1, color: line),
                  itemBuilder: (c, i) => _lineTile(context, s, s.lines[i]),
                ),
        ),
        const Divider(height: 1, color: line),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: Column(children: [
            _sumRow('小計（${t.count}点）', yen(t.subtotal)),
            if (t.discount != 0) _sumRow('小計値引 ${discLabel(s.cart['discount'] as Json?)}', '-${numStr(t.discount)}', color: danger),
            for (final r in t.byRate) _sumRow('${r.rate}%対象 ${yen(r.amount)}', '内税 ${yen(r.tax)}', small: true),
            Row(children: [
              const Text('合計', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
              const Spacer(),
              Text(yen(t.total), key: const ValueKey('cartTotal'), style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w800)),
            ]),
            if (s.cartDeposit > 0) ...[
              _sumRow('前受金', '-${numStr(s.cartDeposit)}', color: okColor),
              _sumRow('お支払い残額', yen((t.total - s.cartDeposit).clamp(0, 1 << 31))),
            ],
          ]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
          child: Column(children: [
            Row(children: [
              Expanded(child: OutlinedButton(onPressed: s.cartEmpty ? null : () => txDiscountDialog(context), child: const FittedBox(child: Text('小計値引き')))),
              const SizedBox(width: 6),
              Expanded(
                child: OutlinedButton(
                  key: const ValueKey('holdBtn'),
                  style: nh > 0 ? OutlinedButton.styleFrom(foregroundColor: accent, side: const BorderSide(color: accent)) : null,
                  onPressed: s.cartEmpty && nh == 0 ? null : () => holdDialog(context),
                  child: FittedBox(child: Text(nh > 0 ? '保留 ($nh)' : '保留')),
                ),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(foregroundColor: danger),
                  onPressed: s.cartEmpty
                      ? null
                      : () async {
                          if (await confirmDialog(context, 'カートの商品をすべて取り消しますか？', ok: '取り消す', dangerous: true)) s.clearCart();
                        },
                  child: const FittedBox(child: Text('全取消')),
                ),
              ),
            ]),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              height: 60,
              child: FilledButton(
                key: const ValueKey('payBtn'),
                onPressed: s.cartEmpty
                    ? null
                    : () {
                        if (inSheet) Navigator.pop(context);
                        openPayDialog(context);
                      },
                child: const Text('会計', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
              ),
            ),
          ]),
        ),
      ]),
    );
  }

  Widget _sumRow(String a, String b, {Color? color, bool small = false}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 1),
        child: Row(children: [
          Text(a, style: TextStyle(color: color ?? muted, fontSize: small ? 12 : 14)),
          const Spacer(),
          Text(b, style: TextStyle(color: color ?? muted, fontSize: small ? 12 : 14)),
        ]),
      );

  Widget _lineTile(BuildContext context, AppState s, Json l) {
    final detail = l['unit'] == 'open'
        ? (l['taxRate'] == 10 ? '10%' : '')
        : l['unit'] == 'g'
            ? '${yen(l['price'] as num)}/100g × ${numStr(l['qty'] as num)}g'
            : '${yen(l['price'] as num)} × ${l['qty']}';
    final disc = lineDiscount(l, s.rounding);
    Widget bgBox(Alignment a) => Container(
          color: danger,
          alignment: a,
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: const Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(Icons.delete_outline, color: Colors.white),
            SizedBox(width: 6),
            Text('取り消す', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
          ]),
        );
    // 左右どちらに横スライドしても、カートから取り消せる（すぐに「元に戻す」もできる）
    return Dismissible(
      key: ValueKey('line-${l['key']}'),
      background: bgBox(Alignment.centerLeft),
      secondaryBackground: bgBox(Alignment.centerRight),
      onDismissed: (_) {
        final r = s.removeLine(l['key'] as String);
        if (r != null) undoToast(context, '${l['name']} を取り消しました', () => s.restoreLine(r.line, r.index));
      },
      child: ListTile(
        dense: true,
        title: Text(l['name'] as String, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
        subtitle: Text.rich(TextSpan(children: [
          TextSpan(text: detail + (disc != 0 ? '　${discLabel(l['discount'] as Json?)} -${numStr(disc)}' : '')),
          if (l['estimated'] == true) const TextSpan(text: '　予定重量・要計量', style: TextStyle(color: danger, fontWeight: FontWeight.w700)),
        ])),
        trailing: Text(yen(lineAmount(l, s.rounding)), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
        onTap: () async {
          if (l['estimated'] == true) {
            // 予約の予定重量 → すぐに実際の重さを入れる
            final g = await numberDialog(context, title: l['name'] as String, label: '実際の重さ', unit: 'g', note: '予定 ${numStr(l['qty'] as num)}g・はかりの値を入力', price: (l['price'] as num).toInt());
            if (g != null && g > 0) s.updateLine(l['key'] as String, qty: g);
          } else if (context.mounted) {
            lineDialog(context, l);
          }
        },
      ),
    );
  }
}

// ---------------- 入力の画面 ----------------

/// テンキー入力（外付けキーボード・キーボード入力型のはかりにも対応）
Future<int?> numberDialog(BuildContext context, {required String title, required String label, required String unit, String? note, int? initial, int? price}) {
  var val = initial?.toString() ?? '';
  var fresh = initial != null;
  return showDialog<int>(
    context: context,
    builder: (c) => StatefulBuilder(builder: (c, set) {
      void key(String k) => set(() {
            if (fresh && k != 'BS') val = '';
            fresh = false;
            val = applyKey(val, k, 7);
          });
      final n = int.tryParse(val) ?? 0;
      return KeyInput(
        onKey: key,
        onEnter: () { if (n > 0) Navigator.pop(c, n); },
        child: AlertDialog(
          title: Text(title),
          content: SizedBox(
            width: 360,
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                if (note != null) Align(alignment: Alignment.centerLeft, child: Text(note, style: const TextStyle(color: muted))),
                AmountDisplay(label, val.isEmpty ? '0 $unit' : '${numStr(n)} $unit'),
                if (price != null && n > 0) AmountDisplay('金額', yen(roundBy(price * n / 100, AppScope.read(context).rounding)), light: true),
                const SizedBox(height: 8),
                Keypad(onKey: key),
              ]),
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c), child: const Text('キャンセル')),
            FilledButton(key: const ValueKey('numOk'), onPressed: n > 0 ? () => Navigator.pop(c, n) : null, child: const Text('OK')),
          ],
        ),
      );
    }),
  );
}

/// 物理キーボード（数字・Backspace・Enter）を受け取る
class KeyInput extends StatelessWidget {
  final void Function(String key) onKey;
  final VoidCallback onEnter;
  final Widget child;
  const KeyInput({super.key, required this.onKey, required this.onEnter, required this.child});
  @override
  Widget build(BuildContext context) => Focus(
        autofocus: true,
        onKeyEvent: (node, e) {
          if (e is! KeyDownEvent) return KeyEventResult.ignored;
          final ch = e.character;
          if (ch != null && RegExp(r'^[0-9]$').hasMatch(ch)) { onKey(ch); return KeyEventResult.handled; }
          if (e.logicalKey == LogicalKeyboardKey.backspace) { onKey('BS'); return KeyEventResult.handled; }
          if (e.logicalKey == LogicalKeyboardKey.delete) { onKey('C'); return KeyEventResult.handled; }
          if (e.logicalKey == LogicalKeyboardKey.enter || e.logicalKey == LogicalKeyboardKey.numpadEnter) { onEnter(); return KeyEventResult.handled; }
          return KeyEventResult.ignored;
        },
        child: child,
      );
}

/// 値引きの選択（行・小計で共通）。null はキャンセル、{} は値引きなし
Future<Json?> discountPicker(BuildContext context, String title, Json? current) async {
  return showDialog<Json>(
    context: context,
    builder: (c) => SimpleDialog(title: Text(title), children: [
      for (final v in [10, 20, 30, 50])
        SimpleDialogOption(onPressed: () => Navigator.pop(c, {'type': 'pct', 'value': v}), child: Text(v == 50 ? '半額' : '$v%引き', style: const TextStyle(fontSize: 18))),
      SimpleDialogOption(
        onPressed: () async {
          final y = await numberDialog(context, title: '値引き（円）', label: '値引き', unit: '円');
          if (c.mounted) Navigator.pop(c, y == null ? null : {'type': 'yen', 'value': y});
        },
        child: const Text('金額で値引き…', style: TextStyle(fontSize: 18)),
      ),
      if (current != null && (current['value'] ?? 0) != 0)
        SimpleDialogOption(onPressed: () => Navigator.pop(c, <String, dynamic>{}), child: const Text('値引きをやめる', style: TextStyle(fontSize: 18, color: danger))),
    ]),
  );
}

Future<void> txDiscountDialog(BuildContext context) async {
  final s = AppScope.read(context);
  final d = await discountPicker(context, '小計値引き', s.cart['discount'] as Json?);
  if (d == null) return;
  s.setTxDiscount(d.isEmpty ? null : d);
}

Future<void> lineDialog(BuildContext context, Json l) async {
  final s = AppScope.read(context);
  final act = await showDialog<String>(
    context: context,
    builder: (c) => SimpleDialog(title: Text(l['name'] as String), children: [
      if (l['unit'] == 'pc') ...[
        SimpleDialogOption(onPressed: () => Navigator.pop(c, 'plus'), child: const Text('＋1', style: TextStyle(fontSize: 18))),
        SimpleDialogOption(onPressed: () => Navigator.pop(c, 'minus'), child: const Text('−1', style: TextStyle(fontSize: 18))),
        SimpleDialogOption(onPressed: () => Navigator.pop(c, 'qty'), child: const Text('個数を入力…', style: TextStyle(fontSize: 18))),
      ],
      if (l['unit'] == 'g') SimpleDialogOption(onPressed: () => Navigator.pop(c, 'qty'), child: const Text('重さを直す…', style: TextStyle(fontSize: 18))),
      if (l['unit'] == 'open') SimpleDialogOption(onPressed: () => Navigator.pop(c, 'price'), child: const Text('金額を直す…', style: TextStyle(fontSize: 18))),
      SimpleDialogOption(onPressed: () => Navigator.pop(c, 'disc'), child: const Text('値引き…', style: TextStyle(fontSize: 18))),
      SimpleDialogOption(onPressed: () => Navigator.pop(c, 'del'), child: const Text('この商品を取り消す', style: TextStyle(fontSize: 18, color: danger))),
    ]),
  );
  if (act == null || !context.mounted) return;
  final key = l['key'] as String;
  switch (act) {
    case 'plus':
      s.updateLine(key, qty: (l['qty'] as num) + 1);
    case 'minus':
      if ((l['qty'] as num) <= 1) {
        s.removeLine(key);
      } else {
        s.updateLine(key, qty: (l['qty'] as num) - 1);
      }
    case 'qty':
      final v = await numberDialog(context, title: l['name'] as String, label: l['unit'] == 'g' ? '重さ' : '個数', unit: l['unit'] == 'g' ? 'g' : '個', initial: (l['qty'] as num).toInt(), price: l['unit'] == 'g' ? (l['price'] as num).toInt() : null);
      if (v != null && v > 0) s.updateLine(key, qty: v);
    case 'price':
      final v = await numberDialog(context, title: l['name'] as String, label: '金額', unit: '円', initial: (l['price'] as num).toInt());
      if (v != null && v > 0) s.updateLine(key, price: v);
    case 'disc':
      final d = await discountPicker(context, '${l['name']} の値引き', l['discount'] as Json?);
      if (d != null) d.isEmpty ? s.updateLine(key, clearDiscount: true) : s.updateLine(key, discount: d);
    case 'del':
      s.removeLine(key);
  }
}

// ---------------- 保留 ----------------

Future<void> holdDialog(BuildContext context) async {
  final s = AppScope.read(context);
  final memo = TextEditingController();
  await showDialog<void>(
    context: context,
    builder: (c) => StatefulBuilder(builder: (c, set) {
      final has = !s.cartEmpty;
      Future<void> doHold() async {
        await s.holdCurrent(memo.text.trim());
        if (c.mounted) Navigator.pop(c);
        if (context.mounted) toast(context, '保留しました。次のお客様の会計に進めます');
      }

      return AlertDialog(
        title: const Text('会計の保留'),
        content: SizedBox(
          width: 420,
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (has) ...[
                Text('今の会計（${yen(s.cartTotals.total)}）を保留して、次のお客様の会計に進めます。', style: const TextStyle(color: muted)),
                TextField(key: const ValueKey('holdMemo'), controller: memo, decoration: const InputDecoration(labelText: '目印のメモ（なくても可）', hintText: '例：赤い服の方'), onSubmitted: (_) => doHold()),
              ],
              if (s.holds.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text('保留中 ${s.holds.length}件', style: const TextStyle(fontWeight: FontWeight.w700)),
                for (var i = 0; i < s.holds.length; i++) _holdTile(c, context, s, s.holds[i], i, has, set),
              ],
            ]),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: const Text('戻る')),
          if (has) FilledButton(key: const ValueKey('holdOk'), onPressed: doHold, child: const Text('保留する')),
        ],
      );
    }),
  );
  // memo は閉じる動きの間も使われるので、ここでは破棄しない（不要になれば自動で片付く）
}

Widget _holdTile(BuildContext c, BuildContext context, AppState s, Json h, int i, bool has, StateSetter set) {
  final cart = h['cart'] as Json;
  final lines = (cart['lines'] as List).cast<Json>();
  final t = totals(lines, cart['discount'] as Json?, s.rounding);
  final at = DateTime.parse(h['at'] as String).toLocal();
  final memo = (h['memo'] ?? '') as String;
  return ListTile(
    contentPadding: EdgeInsets.zero,
    title: Text('${memo.isNotEmpty ? memo : '保留 ${i + 1}'}　${yen(t.total)}', style: const TextStyle(fontWeight: FontWeight.w700)),
    subtitle: Text('${timeStr(at)} 保留・${lines.map((l) => l['name']).take(3).join('、')}${lines.length > 3 ? ' ほか' : ''}'),
    trailing: Wrap(spacing: 4, children: [
      FilledButton(
        key: ValueKey('recall-$i'),
        onPressed: () async {
          await s.recallHold(h['id'] as String);
          if (c.mounted) Navigator.pop(c);
          if (context.mounted) toast(context, has ? '今の会計を保留して、呼び出しました' : '保留していた会計を呼び出しました');
        },
        child: Text(has ? '入れ替え' : '呼び出す'),
      ),
      IconButton(
        tooltip: '削除',
        icon: const Icon(Icons.delete_outline, color: danger),
        onPressed: () async {
          if (await confirmDialog(c, '保留中の会計（${yen(t.total)}）を削除しますか？', ok: '削除', dangerous: true)) {
            await s.deleteHold(h['id'] as String);
            set(() {});
          }
        },
      ),
    ]),
  );
}

// ---------------- 会計 ----------------

Future<void> openPayDialog(BuildContext context) async {
  final s = AppScope.read(context);
  if (s.cartEmpty) return;
  // 予約が別の端末などで会計・取消されていたら、予約とのつながり（前受金）を外す
  if (s.unlinkStaleReservation()) {
    Sound.play(Sfx.error);
    await showDialog<void>(context: context, builder: (c) => AlertDialog(
      content: const Text('この予約は、すでに会計または取消されています。予約とは別の、ふつうの会計として扱います（前受金は差し引きません）。'),
      actions: [FilledButton(onPressed: () => Navigator.pop(c), child: const Text('OK'))],
    ));
    return;
  }
  if (s.lines.any((l) => l['estimated'] == true) && context.mounted &&
      !await confirmDialog(context, '予約の予定重量のままの商品があります。このまま会計しますか？\n（実際の重さに直すには、カートの商品をタップ）', ok: 'このまま会計')) {
    return;
  }
  if (!context.mounted) return;
  final total = s.cartTotals.total;
  final tablet = useTabletLayout(context, s);
  final sale = await showDialog<Json>(
    context: context,
    barrierDismissible: false,
    builder: (c) => tablet
        ? Dialog(child: SizedBox(width: 520, child: PayPanel(total: total)))
        : Dialog.fullscreen(child: PayPanel(total: total)),
  );
  if (sale != null && context.mounted) {
    await doneDialog(context, sale);
    // 次のお客様：画面をめくるように新しい取引に切り替える
    s.startNewTransaction();
    if (context.mounted) toast(context, '次のお客様の会計です（取引No.${s.nextNoLabel}）');
  }
}

class PayPanel extends StatefulWidget {
  final int total;
  const PayPanel({super.key, required this.total});
  @override
  State<PayPanel> createState() => _PayPanelState();
}

class _PayPanelState extends State<PayPanel> {
  String method = 'cash';
  late String ctype;
  String val = '', clVal = '';
  String target = 'cl';
  bool saving = false;
  int deposit = 0; // 予約の前受金

  bool _inited = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // 会計中に同期などで画面が描き直されても、選んだキャッシュレスの種類を戻さない
    if (_inited) return;
    _inited = true;
    final s = AppScope.read(context);
    ctype = s.cashlessTypes.first;
    deposit = s.cartDeposit;
  }

  Payment get pay => payments(widget.total, deposit, method, int.tryParse(val) ?? 0, int.tryParse(clVal) ?? 0);
  bool get settledByDeposit => widget.total - deposit <= 0;

  void key(String k) => setState(() {
        if (method == 'split' && target == 'cl') {
          clVal = applyKey(clVal, k, 7);
        } else {
          val = applyKey(val, k, 7);
        }
      });

  bool get canPay {
    if (settledByDeposit) return true;
    final p = pay;
    if (p.change < 0) return false;
    if (method == 'split' && p.cashless == 0) return false;
    return true;
  }

  Future<void> confirm() async {
    if (!canPay || saving) return;
    setState(() => saving = true);
    final s = AppScope.read(context);
    final sale = await s.completeSale(pay, ctype); // 保存が終わってから閉じる
    if (mounted) Navigator.pop(context, sale);
  }

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final p = pay;
    final split = method == 'split';
    final cashNeeded = !split || p.cash > 0;
    final quickBase = split ? p.cash : p.due;
    final bills = [1000, 2000, 5000, 10000].where((b) => b > quickBase || b == 10000).take(3);
    return KeyInput(
      onKey: key,
      onEnter: confirm,
      child: Scaffold(
        backgroundColor: Colors.white,
        appBar: AppBar(title: const Text('お会計'), automaticallyImplyLeading: false, actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('戻る')),
        ]),
        body: SafeArea(
          child: settledByDeposit
              ? ListView(padding: const EdgeInsets.all(16), children: [
                  const Text('前受金で精算', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 8),
                  AmountDisplay('合計', yen(widget.total)),
                  AmountDisplay('前受金', yen(deposit), light: true),
                  AmountDisplay('ご返金（現金）', yen(p.refund), valueColor: const Color(0xFFFFD27A)),
                ])
              : ListView(padding: const EdgeInsets.all(16), children: [
            ChoiceBar<String>(
              options: const [('cash', '現金'), ('cashless', 'キャッシュレス'), ('split', '併用')],
              icons: const {'cash': Icons.payments_outlined, 'cashless': Icons.credit_card, 'split': Icons.call_split},
              value: method,
              onChanged: (v) => setState(() {
                method = v;
                if (method == 'split') { target = 'cl'; val = ''; }
              }),
            ),
            if (method == 'split') const Padding(padding: EdgeInsets.only(top: 4), child: Text('併用：キャッシュレスと現金を組み合わせて支払う', style: TextStyle(color: muted, fontSize: 12))),
            if (method != 'cash') ...[
              const SizedBox(height: 8),
              ChoiceBar<String>(options: [for (final t in s.cashlessTypes) (t, t)], value: ctype, height: 40, onChanged: (v) => setState(() => ctype = v)),
            ],
            const SizedBox(height: 8),
            if (deposit > 0) ...[
              AmountDisplay('合計 ${yen(widget.total)}／前受金', '-${numStr(deposit)}', light: true),
              AmountDisplay('お支払い残額', yen(p.due)),
            ] else
              AmountDisplay('合計', yen(widget.total)),
            if (split) ...[
              AmountDisplay('$ctypeで', clVal.isEmpty ? '金額を入力' : yen(p.cashless), light: true, highlight: target == 'cl', onTap: () => setState(() => target = 'cl')),
              AmountDisplay('残りを現金で', yen(p.cash), light: true),
            ],
            if (method != 'cashless') ...[
              AmountDisplay('お預かり', cashNeeded ? yen(p.received) : '—', light: true, highlight: split && target == 'cash', onTap: split ? () => setState(() => target = 'cash') : null),
              AmountDisplay('おつり', !cashNeeded ? '—' : p.change >= 0 ? yen(p.change) : '不足 ${yen(-p.change)}', valueColor: const Color(0xFFFFD27A)),
              if (split) Text(target == 'cl' ? 'キャッシュレスで払う額を入れて、「お預かり」をタップ' : '現金のお預かりを入れてください', style: const TextStyle(color: muted)),
              const SizedBox(height: 8),
              if (!split || target == 'cash')
                Row(children: [
                  for (final b in [quickBase, ...bills])
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: OutlinedButton(
                          style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 6)),
                          key: ValueKey(b == quickBase ? 'quick-exact' : 'quick-$b'),
                          onPressed: () => setState(() => val = '$b'),
                          child: FittedBox(child: Text(b == quickBase ? 'ちょうど' : '${numStr(b)}円')),
                        ),
                      ),
                    ),
                ]),
              const SizedBox(height: 8),
              Keypad(onKey: key),
            ],
          ]),
        ),
        // 会計確定はいつも画面の下に見えるように
        bottomNavigationBar: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: SizedBox(
              height: 60,
              child: FilledButton(
                key: const ValueKey('payOk'),
                onPressed: canPay && !saving ? confirm : null,
                child: Text(saving ? '保存中…' : '会計確定', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

Future<void> doneDialog(BuildContext context, Json sale) async {
  final pm = salePayments(sale);
  final change = (sale['change'] ?? 0) as num;
  final big = pm.cashless > 0 && pm.cash <= 0 ? ('キャッシュレス', yen(pm.cashless)) : ('おつり', yen(change));
  final t = (sale['totals'] as Map)['total'] as num;
  await showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (c) => AlertDialog(
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.check_circle, color: okColor, size: 56),
        Text(big.$1, style: const TextStyle(color: muted)),
        Text(big.$2, key: const ValueKey('doneBig'), style: const TextStyle(fontSize: 44, fontWeight: FontWeight.w800)),
        Text('取引No.${noOf(sale)}　合計 ${yen(t)}'
            '${pm.cashless > 0 && pm.cash > 0 ? '　${sale['cashlessType']} ${yen(pm.cashless)}' : ''}'
            '${pm.cash > 0 ? '　お預かり ${yen(sale['received'] as num)}' : ''}', textAlign: TextAlign.center, style: const TextStyle(color: muted)),
      ]),
      actions: [
        TextButton(onPressed: () => receiptDialog(c, sale), child: const Text('レシートを見る')),
        FilledButton(key: const ValueKey('nextCustomer'), onPressed: () => Navigator.pop(c), child: const Text('次のお客様')),
      ],
    ),
  );
}

Future<void> receiptDialog(BuildContext context, Json sale, {bool reprint = false}) {
  final lines = receiptLines(sale, AppScope.read(context).settings, reprint: reprint);
  return showDialog<void>(
    context: context,
    builder: (c) => AlertDialog(
      contentPadding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
      content: SizedBox(width: 340, child: SingleChildScrollView(child: ReceiptView(lines: lines))),
      actions: [
        TextButton.icon(
          icon: const Icon(Icons.print_outlined),
          onPressed: () => outputPdf(c, 'レシート No.${noOf(sale)}', () async => receiptPdf(lines, await pdfFont(), title: 'レシート')),
          label: const Text('印刷・共有'),
        ),
        TextButton(onPressed: () => Navigator.pop(c), child: const Text('閉じる')),
      ],
    ),
  );
}

class ReceiptView extends StatelessWidget {
  final List<RLine> lines;
  const ReceiptView({super.key, required this.lines});
  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      for (final l in lines)
        if (l.image != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 200, maxHeight: 120), child: Image.memory(l.image!, gaplessPlayback: true))),
          )
        else if (l.hr)
          const Padding(padding: EdgeInsets.symmetric(vertical: 4), child: Divider(height: 1, color: ink))
        else if (l.center)
          Text(l.left, textAlign: TextAlign.center, style: TextStyle(fontSize: l.big ? 20 : 14, fontWeight: l.bold ? FontWeight.w800 : FontWeight.w400))
        else
          Padding(
            padding: EdgeInsets.only(left: l.indent ? 14 : 0),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(child: Text(l.left, style: TextStyle(fontSize: l.big ? 20 : 14, fontWeight: l.bold ? FontWeight.w800 : FontWeight.w400))),
              Text(l.right, style: TextStyle(fontSize: l.big ? 20 : 14, fontWeight: l.bold ? FontWeight.w800 : FontWeight.w400)),
            ]),
          ),
    ]);
  }
}
