// 売上（日別の売上・取引一覧・取消）

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/calc.dart';
import '../core/receipt.dart';
import 'closing.dart';
import 'common.dart';
import 'register.dart';

class SalesPage extends StatefulWidget {
  const SalesPage({super.key});
  @override
  State<SalesPage> createState() => _SalesPageState();
}

class _SalesPageState extends State<SalesPage> {
  DateTime date = DateTime.now();

  /// 表示：sales 売上 / cash 入出金 / close レジ締め
  String view = 'sales';

  String payLabel(Json x) {
    final p = salePayments(x);
    final ct = ((x['cashlessType'] ?? '') as String).isNotEmpty ? x['cashlessType'] as String : 'キャッシュレス';
    if (x['kind'] == 'return') return '返品（${p.cashless != 0 ? ct : '現金'}）';
    final parts = <String>[
      if (p.deposit != 0) '前受金',
      if (p.cash > 0) '現金',
      if (p.cashless != 0) ct,
    ];
    return parts.isEmpty ? '現金' : parts.join('＋');
  }

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final d = localDate(date);
    final sum = summarizeDay(s.store.sales, d);
    final list = sum.sales.toList()..sort((a, b) => (b['at'] as String).compareTo(a['at'] as String));
    final items = sum.items.values.toList()..sort((a, b) => b.amount.compareTo(a.amount));
    // 予約の前受金（その日に受け取った・返金した分）
    var depCash = 0, depCashless = 0, depRefund = 0;
    for (final r in s.reservations) {
      final dep = ((r['deposit'] ?? 0) as num).toInt();
      if (dep == 0) continue;
      if (r['depositDate'] == d) {
        if (r['depositMethod'] == 'cashless') { depCashless += dep; } else { depCash += dep; }
      }
      if (r['depositRefundDate'] == d) depRefund += dep;
    }
    return ListView(padding: const EdgeInsets.all(12), children: [
      Row(children: [
        IconButton.outlined(onPressed: () => setState(() => date = date.subtract(const Duration(days: 1))), icon: const Icon(Icons.chevron_left)),
        Expanded(
          child: TextButton(
            onPressed: () async {
              final p = await showDatePicker(context: context, initialDate: date, firstDate: DateTime(2020), lastDate: DateTime.now().add(const Duration(days: 1)));
              if (p != null) setState(() => date = p);
            },
            child: Text('${date.year}年${date.month}月${date.day}日（${'月火水木金土日'[date.weekday - 1]}）', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          ),
        ),
        IconButton.outlined(onPressed: () => setState(() => date = date.add(const Duration(days: 1))), icon: const Icon(Icons.chevron_right)),
      ]),
      if (!kIsWeb) ...[
        const SizedBox(height: 6),
        ChoiceBar<String>(
          options: const [('sales', '売上'), ('cash', '入出金'), ('close', 'レジ締め')],
          icons: const {'sales': Icons.bar_chart, 'cash': Icons.swap_vert, 'close': Icons.lock_clock_outlined},
          value: view,
          onChanged: (v) => setState(() => view = v),
        ),
      ],
      const SizedBox(height: 8),
      if (view == 'cash') CashMovesView(date: d),
      if (view == 'close') ClosingView(key: ValueKey('close-$d'), date: d),
      if (view == 'sales') ..._salesBody(context, s, d, sum, list, items, depCash, depCashless, depRefund),
    ]);
  }

  List<Widget> _salesBody(BuildContext context, AppState s, String d, DaySummary sum, List<Json> list, List items, int depCash, int depCashless, int depRefund) {
    return [
      CardGrid(children: [
        StatCard('売上合計', Text(yen(sum.total))),
        StatCard('客数', Text('${sum.count}件')),
        StatCard('客単価', Text(yen(sum.count != 0 ? (sum.total / sum.count).round() : 0))),
        StatCard('現金', Text(yen(sum.cash))),
        StatCard('キャッシュレス', Text(yen(sum.cashless)), sub: sum.cashlessBy.isEmpty ? null : Text(sum.cashlessBy.entries.map((e) => '${e.key} ${yen(e.value)}').join('・'))),
        StatCard('値引き・取消', Text(yen(sum.discount)), sub: Text('取消 ${sum.voids}件${sum.returnsCount != 0 ? '・返品 ${sum.returnsCount}件' : ''}')),
        if (depCash + depCashless + depRefund + sum.depositUsed > 0)
          StatCard('予約の前受金', Text(yen(depCash + depCashless)),
              sub: Text('受取 現金 ${yen(depCash)}・キャッシュレス ${yen(depCashless)}${depRefund > 0 ? '・返金 ${yen(depRefund)}' : ''}${sum.depositUsed > 0 ? '・会計で充当 ${yen(sum.depositUsed)}' : ''}')),
      ]),
      const SizedBox(height: 16),
      const Text('商品別', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
      if (items.isEmpty) const Padding(padding: EdgeInsets.all(8), child: Text('この日の売上はありません。', style: TextStyle(color: muted))),
      for (final it in items)
        ListTile(
          dense: true,
          title: Text(it.name),
          trailing: Text(yen(it.amount), style: const TextStyle(fontWeight: FontWeight.w700)),
          subtitle: Text(it.unit == 'g' ? '${numStr(it.qty)}g' : it.unit == 'open' ? '${it.qty}回' : '${numStr(it.qty)}個'),
        ),
      const SizedBox(height: 16),
      const Text('取引一覧', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
      for (final x in list)
        Card(
          elevation: 0,
          color: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: const BorderSide(color: line)),
          child: ListTile(
            key: ValueKey('sale-${x['id']}'),
            title: Text('${timeStr(DateTime.parse(x['at'] as String).toLocal())}　No.${noOf(x)}　${payLabel(x)}',
                style: TextStyle(decoration: x['void'] == true ? TextDecoration.lineThrough : null)),
            subtitle: Text((x['lines'] as List).map((l) => l['name']).join('、'), maxLines: 1, overflow: TextOverflow.ellipsis),
            trailing: Text(x['void'] == true ? '取消' : yen((x['totals'] as Map)['total'] as num),
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: x['void'] == true ? danger : ink)),
            onTap: () => saleDetail(context, x),
          ),
        ),
    ];
  }

  Future<void> saleDetail(BuildContext context, Json x) async {
    final s = AppScope.read(context);
    await showDialog<void>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text('取引No.${noOf(x)}'),
        content: SizedBox(width: 360, child: SingleChildScrollView(child: ReceiptView(lines: receiptLines(x, s.settings)))),
        actions: [
          if (x['void'] != true && x['kind'] != 'return')
            TextButton(
              style: TextButton.styleFrom(foregroundColor: danger),
              onPressed: () async {
                if (!await confirmDialog(c, 'この取引を取り消しますか？（売上から除かれます）', ok: '取り消す', dangerous: true)) return;
                await s.voidSale(x);
                if (c.mounted) Navigator.pop(c);
              },
              child: const Text('取引を取消'),
            ),
          TextButton(onPressed: () => receiptDialog(c, x, reprint: true), child: const Text('再発行の表示')),
          FilledButton(onPressed: () => Navigator.pop(c), child: const Text('閉じる')),
        ],
      ),
    );
  }
}
