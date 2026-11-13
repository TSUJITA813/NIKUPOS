// 入出金・レジ締め（売上の画面の中）

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/app_state.dart';
import '../core/calc.dart';
import '../core/receipt.dart';
import '../core/receipt_pdf.dart';
import 'common.dart';
import 'register.dart' show KeyInput, ReceiptView;
import 'reservations.dart' show outputPdf, pdfFont;

String devLabel(String d) => d.isEmpty ? 'この端末' : '端末 $d';

Widget _h2(String t, [String? note]) => Padding(
      padding: const EdgeInsets.only(top: 18, bottom: 6),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(t, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
        if (note != null) Text(note, style: const TextStyle(color: muted, fontSize: 13)),
      ]),
    );

Widget _box({required Widget child, Color? border}) => Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: border == null ? Colors.white : Color.alphaBlend(border.withValues(alpha: 0.08), Colors.white),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: border ?? line, width: border == null ? 1 : 2),
      ),
      child: child,
    );

/// 表の1行（左に名前、右に金額）
Widget _row(String label, String value, {bool bold = false, Widget? sub, Color? color}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: TextStyle(fontSize: 15, fontWeight: bold ? FontWeight.w800 : FontWeight.w400)),
            if (sub != null) DefaultTextStyle.merge(style: const TextStyle(fontSize: 12, color: muted), child: sub),
          ]),
        ),
        Text(value, style: TextStyle(fontSize: bold ? 18 : 15, fontWeight: bold ? FontWeight.w800 : FontWeight.w600, color: color, fontFeatures: const [FontFeature.tabularFigures()])),
      ]),
    );

// ======================= 入出金 =======================

class CashMovesView extends StatelessWidget {
  final String date;
  const CashMovesView({super.key, required this.date});

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final list = s.cashmoves.where((m) => m['date'] == date && (m['dev'] ?? '') == s.myDev).toList()
      ..sort((a, b) => (a['at'] as String).compareTo(b['at'] as String));
    var sumIn = 0, sumOut = 0;
    for (final m in list) {
      if (m['kind'] == 'in') sumIn += (m['amount'] as num).toInt();
      if (m['kind'] == 'out') sumOut += (m['amount'] as num).toInt();
    }
    final fl = s.floatOf(date);
    Widget btn(String kind, IconData icon, {bool primary = false}) {
      final child = FittedBox(child: Row(mainAxisSize: MainAxisSize.min, children: [Icon(icon, size: 20), const SizedBox(width: 6), Text(cashMoveKinds[kind]!)]));
      final style = ButtonStyle(minimumSize: WidgetStateProperty.all(const Size(0, 52)));
      void onTap() => cashMoveDialog(context, kind, date);
      return primary
          ? FilledButton(key: ValueKey('cm-$kind'), style: style, onPressed: onTap, child: child)
          : OutlinedButton(key: ValueKey('cm-$kind'), style: style, onPressed: onTap, child: child);
    }

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('${devLabel(s.myDev)}のレジ', style: const TextStyle(color: muted)),
      const SizedBox(height: 8),
      CardGrid(minWidth: 150, children: [
        btn('float', Icons.savings_outlined),
        btn('out', Icons.logout, primary: true),
        btn('in', Icons.login),
        btn('exchange', Icons.currency_exchange),
      ]),
      const SizedBox(height: 8),
      CardGrid(children: [
        StatCard('釣銭準備金', Text(yen(fl.amount)), sub: Text(fl.from)),
        StatCard('入金', Text(yen(sumIn))),
        StatCard('出金', Text(yen(sumOut))),
      ]),
      const SizedBox(height: 8),
      if (list.isEmpty) const Padding(padding: EdgeInsets.all(8), child: Text('この日の入出金はありません。', style: TextStyle(color: muted))),
      for (final m in list)
        Card(
          elevation: 0,
          color: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: const BorderSide(color: line)),
          child: ListTile(
            title: Text('${timeStr(DateTime.parse(m['at'] as String).toLocal())}　${cashMoveKinds[m['kind']] ?? m['kind']}　${yen(m['amount'] as num)}',
                style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text([
              m['account'] ?? '',
              if (((m['taxRate'] ?? 0) as num) != 0) '消費税${m['taxRate']}%',
              m['memo'] ?? '',
              m['staff'] ?? '',
            ].where((x) => '$x'.isNotEmpty).join('・')),
            trailing: IconButton(
              tooltip: '削除',
              icon: const Icon(Icons.delete_outline, color: danger),
              onPressed: () async {
                if (!await confirmDialog(context, '${cashMoveKinds[m['kind']]} ${yen(m['amount'] as num)} を削除しますか？', ok: '削除する', dangerous: true)) return;
                await s.deleteCashMove(m);
              },
            ),
          ),
        ),
      const SizedBox(height: 8),
      const Text('出金・入金は、レジ締めの「あるべき現金」に入ります。両替は記録だけです（レジの現金の合計は変わりません）。', style: TextStyle(color: muted)),
    ]);
  }
}

const _kindNote = {
  'float': '開店のときにレジに入れたおつり用のお金',
  'out': 'レジから出したお金（備品の購入・仕入の現金払いなど）',
  'in': 'レジに入れたお金（おつりの補充など）',
  'exchange': '両替した額（レジの現金の合計は変わりません）',
};

Future<void> cashMoveDialog(BuildContext context, String kind, String date) async {
  final s = AppScope.read(context);
  var val = kind == 'float' ? '${s.floatOf(date).amount}' : '';
  if (val == '0') val = '';
  var fresh = true;
  final accounts = kind == 'out' ? outAccounts : kind == 'in' ? inAccounts : const <String>[];
  var account = accounts.isEmpty ? '' : accounts.first;
  var taxRate = kind == 'out' ? 10 : 0;
  final memo = TextEditingController();
  await showDialog<void>(
    context: context,
    builder: (c) => StatefulBuilder(builder: (c, set) {
      void key(String k) => set(() {
            if (fresh && k != 'BS') val = '';
            fresh = false;
            val = applyKey(val, k, 7);
          });
      final n = int.tryParse(val) ?? 0;
      final canOk = n > 0 || kind == 'float';
      Future<void> ok() async {
        if (!canOk) return;
        await s.addCashMove(date, kind, n, account: account, taxRate: kind == 'out' ? taxRate : 0, memo: memo.text.trim());
        if (c.mounted) Navigator.pop(c);
        if (context.mounted) toast(context, '${cashMoveKinds[kind]} ${yen(n)} を記録しました');
      }

      return KeyInput(
        onKey: key,
        onEnter: ok,
        child: AlertDialog(
          title: Text(cashMoveKinds[kind]!),
          content: SizedBox(
            width: 380,
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text(_kindNote[kind]!, style: const TextStyle(color: muted)),
                AmountDisplay('金額', yen(n)),
                if (accounts.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    key: const ValueKey('cmAccount'),
                    initialValue: account,
                    isDense: true,
                    decoration: const InputDecoration(labelText: '科目（帳簿の分け方）', border: OutlineInputBorder(), isDense: true),
                    items: [for (final a in accounts) DropdownMenuItem(value: a, child: Text(a))],
                    onChanged: (v) => set(() => account = v ?? account),
                  ),
                ],
                if (kind == 'out') ...[
                  const SizedBox(height: 8),
                  const Text('消費税', style: TextStyle(color: muted, fontSize: 13)),
                  ChoiceBar<int>(height: 40, options: const [(10, '10%'), (8, '8%（軽減）'), (0, '対象外')], value: taxRate, onChanged: (v) => set(() => taxRate = v)),
                ],
                const SizedBox(height: 8),
                TextField(controller: memo, decoration: const InputDecoration(labelText: '内容（例：ラップ・トレー購入）', border: OutlineInputBorder(), isDense: true)),
                const SizedBox(height: 8),
                Keypad(onKey: key),
              ]),
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c), child: const Text('キャンセル')),
            FilledButton(key: const ValueKey('cmOk'), onPressed: canOk ? ok : null, child: const Text('記録する')),
          ],
        ),
      );
    }),
  );
}

// ======================= レジ締め =======================

class ClosingView extends StatefulWidget {
  final String date;
  const ClosingView({super.key, required this.date});
  @override
  State<ClosingView> createState() => _ClosingViewState();
}

class _ClosingViewState extends State<ClosingView> {
  final counts = {for (final d in denoms) d: TextEditingController()};
  final terminal = <String, TextEditingController>{};
  final keep = TextEditingController();
  bool _keepTouched = false;

  @override
  void dispose() {
    for (final c in counts.values) {
      c.dispose();
    }
    for (final c in terminal.values) {
      c.dispose();
    }
    keep.dispose();
    super.dispose();
  }

  Map<String, int> get _counts => {for (final e in counts.entries) '${e.key}': int.tryParse(e.value.text) ?? 0};
  Map<String, int> get _terminal => {
        for (final e in terminal.entries)
          if (e.value.text.trim().isNotEmpty) e.key: int.tryParse(e.value.text.trim()) ?? 0
      };

  Json _build(AppState s, DrawerSummary dr, int float) => buildClosing(
        dr: dr,
        float: float,
        counts: _counts,
        terminal: _terminal,
        keep: int.tryParse(keep.text) ?? 0,
        date: widget.date,
        dev: s.myDev,
        staff: s.adminId ?? '',
      );

  void _clear() {
    for (final c in counts.values) {
      c.clear();
    }
    for (final c in terminal.values) {
      c.clear();
    }
    _keepTouched = false;
  }

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final dr = s.drawerOf(widget.date);
    final sum = dr.sum;
    final fl = s.floatOf(widget.date);
    final float = dr.hasFloat ? dr.float : fl.amount;
    final expected = float + dr.drawerCash;
    final counted = countCash(_counts);
    final diff = counted - expected;
    if (!_keepTouched) keep.text = '$float';
    final done = s.closings.where((c) => c['date'] == widget.date && (c['dev'] ?? '') == s.myDev).toList()
      ..sort((a, b) => (a['at'] as String).compareTo(b['at'] as String));
    final history = s.closings.where((c) => (c['dev'] ?? '') == s.myDev).toList()
      ..sort((a, b) => (b['at'] as String).compareTo(a['at'] as String));
    for (final k in sum.cashlessBy.keys) {
      terminal.putIfAbsent(k, () => TextEditingController());
    }
    final holds = s.holds.length;

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('${devLabel(s.myDev)}のレジ', style: const TextStyle(color: muted)),
      const SizedBox(height: 8),
      if (holds > 0)
        _box(
          border: danger,
          child: Text('保留中の会計が $holds件 あります。まだ売上に入っていません。レジの「保留」から呼び出して会計するか、削除してからレジ締めをしてください。',
              style: const TextStyle(fontWeight: FontWeight.w700)),
        ),
      if (done.isNotEmpty)
        _box(
          border: okColor,
          child: Text('レジ締め済み（${timeStr(DateTime.parse(done.last['at'] as String).toLocal())}）　実際の現金 ${yen(done.last['counted'] as num)}・過不足 ${signedYen(done.last['diff'] as num)}',
              style: const TextStyle(fontWeight: FontWeight.w700)),
        ),
      CardGrid(children: [
        StatCard('売上（この端末）', Text(yen(sum.total)), sub: Text('${sum.count}件${sum.returnsCount > 0 ? '・返品 ${sum.returnsCount}件' : ''}')),
        StatCard('現金', Text(yen(sum.cash))),
        StatCard('キャッシュレス', Text(yen(sum.cashless))),
      ]),
      _h2('① あるべき現金', '計算の上で、いまレジにあるはずの額です'),
      _box(
        child: Column(children: [
          _row('釣銭準備金', yen(float), sub: dr.hasFloat ? null : Text('${fl.from}（入出金の画面で記録できます）')),
          _row('現金売上（返品の返金を含む）', yen(sum.cash)),
          if (dr.depositInCash != 0) _row('予約の前受金（現金）', yen(dr.depositInCash)),
          if (dr.depositRefundCash != 0) _row('前受金の返金', '-${yen(dr.depositRefundCash)}'),
          if (dr.wholesaleCash != 0) _row('卸の現金回収', yen(dr.wholesaleCash)),
          if (dr.cashIn != 0) _row('入金', yen(dr.cashIn)),
          if (dr.cashOut != 0) _row('出金', '-${yen(dr.cashOut)}'),
          const Divider(),
          _row('あるべき現金', yen(expected), bold: true),
        ]),
      ),
      _h2('② レジの現金を数える', 'お札・硬貨の枚数を入れてください'),
      CardGrid(minWidth: 250, children: [for (final d in denoms) _denomRow(d)]),
      const SizedBox(height: 8),
      AmountDisplay('実際の現金', yen(counted)),
      AmountDisplay('過不足', signedYen(diff), light: true, valueColor: diff == 0 ? okColor : danger),
      if (counted > 0 && diff != 0)
        Text(diff > 0 ? 'レジのお金が ${yen(diff)} 多いです。' : 'レジのお金が ${yen(-diff)} 足りません。', style: const TextStyle(color: danger, fontWeight: FontWeight.w700)),
      _h2('③ キャッシュレスの確認', '決済の機械で出した集計の額を入れて、見比べます'),
      if (sum.cashlessBy.isEmpty)
        const Text('キャッシュレスの売上はありません。', style: TextStyle(color: muted))
      else
        _box(
          child: Column(children: [
            for (final e in sum.cashlessBy.entries) _terminalRow(e.key, e.value),
          ]),
        ),
      _h2('④ 明日のおつり用に残す額'),
      Row(children: [
        SizedBox(
          width: 200,
          child: TextField(
            key: const ValueKey('keep'),
            controller: keep,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: const InputDecoration(prefixText: '¥ ', border: OutlineInputBorder(), isDense: true),
            onChanged: (_) => _keepTouched = true,
          ),
        ),
        const SizedBox(width: 10),
        const Expanded(child: Text('次の日の「釣銭準備金」になります。', style: TextStyle(color: muted))),
      ]),
      const SizedBox(height: 16),
      Wrap(spacing: 8, runSpacing: 8, children: [
        OutlinedButton.icon(
          key: const ValueKey('closeCheck'),
          style: OutlinedButton.styleFrom(minimumSize: const Size(0, 52)),
          icon: const Icon(Icons.fact_check_outlined),
          onPressed: () => closingReportDialog(context, _build(s, dr, float)),
          label: const Text('点検（途中の確認・記録しない）'),
        ),
        FilledButton.icon(
          key: const ValueKey('closeDo'),
          style: FilledButton.styleFrom(minimumSize: const Size(0, 52)),
          icon: const Icon(Icons.lock_clock_outlined),
          onPressed: () => _doClose(s, dr, float, done.isNotEmpty),
          label: const Text('レジ締めをする（記録する）'),
        ),
      ]),
      if (history.isNotEmpty) ...[
        _h2('レジ締めの記録'),
        for (final c in history.take(14))
          Card(
            elevation: 0,
            color: Colors.white,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: const BorderSide(color: line)),
            child: ListTile(
              key: ValueKey('closing-${c['id']}'),
              title: Text('${c['date']}　${timeStr(DateTime.parse(c['at'] as String).toLocal())}　売上 ${yen(((c['sales'] as Map)['total'] ?? 0) as num)}'),
              subtitle: Text('実際の現金 ${yen(c['counted'] as num)}・過不足 ${signedYen(c['diff'] as num)}${(c['staff'] ?? '') != '' ? '・${c['staff']}' : ''}'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => closingReportDialog(context, c, reprint: true),
            ),
          ),
      ],
    ]);
  }

  Widget _denomRow(int d) {
    final c = counts[d]!;
    final n = int.tryParse(c.text) ?? 0;
    void setN(int v) => setState(() => c.text = v <= 0 ? '' : '$v');
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(10), border: Border.all(color: line)),
      child: Row(children: [
        SizedBox(width: 74, child: Text('${numStr(d)}円', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700))),
        IconButton(onPressed: n > 0 ? () => setN(n - 1) : null, icon: const Icon(Icons.remove_circle_outline)),
        SizedBox(
          width: 56,
          child: TextField(
            key: ValueKey('den-$d'),
            controller: c,
            textAlign: TextAlign.center,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(4)],
            decoration: const InputDecoration(hintText: '0', isDense: true, border: OutlineInputBorder()),
            onChanged: (_) => setState(() {}),
          ),
        ),
        IconButton(onPressed: () => setN(n + 1), icon: const Icon(Icons.add_circle_outline)),
        Expanded(child: Text(n > 0 ? yen(d * n) : '', textAlign: TextAlign.right, style: const TextStyle(color: muted))),
      ]),
    );
  }

  Widget _terminalRow(String k, int recorded) {
    final c = terminal[k]!;
    final t = c.text.trim().isEmpty ? null : int.tryParse(c.text.trim());
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(k, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
            Text('レジの記録 ${yen(recorded)}', style: const TextStyle(color: muted)),
          ]),
        ),
        SizedBox(
          width: 120,
          child: TextField(
            key: ValueKey('term-$k'),
            controller: c,
            textAlign: TextAlign.right,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: const InputDecoration(labelText: '機械の集計', isDense: true, border: OutlineInputBorder()),
            onChanged: (_) => setState(() {}),
          ),
        ),
        SizedBox(
          width: 86,
          child: Text(t == null ? '—' : signedYen(t - recorded),
              textAlign: TextAlign.right, style: TextStyle(fontWeight: FontWeight.w700, color: t == null ? muted : t == recorded ? okColor : danger)),
        ),
      ]),
    );
  }

  Future<void> _doClose(AppState s, DrawerSummary dr, int float, bool already) async {
    final c = _build(s, dr, float);
    final counted = c['counted'] as int;
    final diff = c['diff'] as int;
    if (counted == 0 && !await confirmDialog(context, '実際の現金が0円です（枚数が入っていません）。このままレジ締めをしますか？', ok: 'レジ締めをする')) return;
    if (!mounted) return;
    if (already && !await confirmDialog(context, 'この日はすでにレジ締めをしています。もう一度しますか？', ok: 'もう一度する')) return;
    if (!mounted) return;
    if (diff != 0 && !await confirmDialog(context, '過不足が ${signedYen(diff)} あります。このままレジ締めをしますか？', ok: 'レジ締めをする')) return;
    final saved = await s.saveClosing(c);
    if (!mounted) return;
    setState(_clear);
    toast(context, 'レジ締めをしました');
    await closingReportDialog(context, saved);
  }
}

/// レジ締め（精算）・点検のレポートの中身
List<RLine> closingReport(Json c, Json settings, {bool reprint = false}) {
  final sales = (c['sales'] as Map?) ?? const {};
  final returns = (sales['returns'] as Map?) ?? const {};
  int n(Object? v) => v == null ? 0 : v is num ? v.toInt() : (num.tryParse('$v') ?? 0).toInt();
  final cashlessBy = ((c['cashlessBy'] as Map?) ?? const {}).cast<String, dynamic>();
  final term = ((c['terminal'] as Map?) ?? const {}).cast<String, dynamic>();
  final den = ((c['denoms'] as Map?) ?? const {}).cast<String, dynamic>();
  final at = DateTime.parse(c['at'] as String).toLocal();
  return [
    RLine(c['id'] != null ? 'レジ締めレポート（精算）' : '点検レポート（記録していません）', center: true, bold: true),
    RLine('${settings['storeName'] ?? ''}', center: true),
    if (reprint) const RLine('＊＊ 再印刷 ＊＊', center: true),
    RLine('${c['date']}　${devLabel((c['dev'] ?? '') as String)}', center: true),
    RLine('${dateTimeStr(at)}${(c['staff'] ?? '') != '' ? '　担当 ${c['staff']}' : ''}', center: true),
    const RLine.hr(),
    RLine('売上合計', right: yen(n(sales['total']))),
    RLine('客数', right: '${n(sales['count'])}件'),
    RLine('返品', right: '${yen(n(returns['amount']))}（${n(returns['count'])}件）'),
    RLine('取消', right: '${n(sales['voids'])}件'),
    RLine('値引き', right: yen(n(sales['discount']))),
    const RLine.hr(),
    RLine('現金売上', right: yen(n(sales['cash']))),
    RLine('キャッシュレス', right: yen(n(sales['cashless']))),
    for (final e in cashlessBy.entries) ...[
      RLine(e.key, right: yen(n(e.value)), indent: true),
      if (term[e.key] != null && '${term[e.key]}' != '')
        RLine('機械の集計 ${yen(n(term[e.key]))}', right: '差 ${signedYen(n(term[e.key]) - n(e.value))}', indent: true),
    ],
    const RLine.hr(),
    RLine('釣銭準備金', right: yen(n(c['float']))),
    RLine('現金売上', right: yen(n(sales['cash']))),
    if (n(c['depositIn']) != 0) RLine('前受金（現金）', right: yen(n(c['depositIn']))),
    if (n(c['depositRefund']) != 0) RLine('前受金の返金', right: '-${yen(n(c['depositRefund']))}'),
    if (n(c['wholesaleCash']) != 0) RLine('卸の現金回収', right: yen(n(c['wholesaleCash']))),
    if (n(c['cashIn']) != 0) RLine('入金', right: yen(n(c['cashIn']))),
    if (n(c['cashOut']) != 0) RLine('出金', right: '-${yen(n(c['cashOut']))}'),
    RLine('あるべき現金', right: yen(n(c['expected'])), bold: true),
    const RLine.hr(),
    for (final d in denoms)
      if (n(den['$d']) > 0) RLine('${numStr(d)}円 × ${n(den['$d'])}', right: yen(d * n(den['$d']))),
    RLine('実際の現金', right: yen(n(c['counted'])), bold: true),
    RLine('過不足', right: signedYen(n(c['diff'])), bold: true),
    if (c['keep'] != null) RLine('翌日の準備金', right: yen(n(c['keep']))),
  ];
}

Future<void> closingReportDialog(BuildContext context, Json c, {bool reprint = false}) {
  final lines = closingReport(c, AppScope.read(context).settings, reprint: reprint);
  final title = c['id'] != null ? 'レジ締めレポート ${c['date']}' : '点検レポート ${c['date']}';
  return showDialog<void>(
    context: context,
    builder: (d) => AlertDialog(
      contentPadding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
      content: SizedBox(width: 340, child: SingleChildScrollView(child: ReceiptView(lines: lines))),
      actions: [
        TextButton.icon(
          icon: const Icon(Icons.print_outlined),
          onPressed: () => outputPdf(d, title, () async => receiptPdf(lines, await pdfFont(), title: title)),
          label: const Text('印刷・共有'),
        ),
        FilledButton(key: const ValueKey('reportClose'), onPressed: () => Navigator.pop(d), child: const Text('閉じる')),
      ],
    ),
  );
}
