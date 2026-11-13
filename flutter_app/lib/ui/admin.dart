// 管理（ID・パスワードでログイン）：ダッシュボード・商品・設定

import 'dart:async';

import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/auth.dart';
import '../core/calc.dart';
import '../core/profit.dart';
import '../core/sound.dart';
import 'common.dart';
import 'sync_settings.dart';

class AdminPage extends StatelessWidget {
  const AdminPage({super.key});
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    if (s.admins.isEmpty) return const AuthView(register: true);
    if (!s.isAdmin) return const AuthView(register: false);
    return const AdminHome();
  }
}

// ---------------- 登録・ログイン ----------------

class AuthView extends StatefulWidget {
  final bool register;
  const AuthView({super.key, required this.register});
  @override
  State<AuthView> createState() => _AuthViewState();
}

class _AuthViewState extends State<AuthView> {
  final id = TextEditingController(), pw = TextEditingController(), pw2 = TextEditingController();
  String msg = '';
  bool busy = false;

  @override
  void dispose() {
    id.dispose();
    pw.dispose();
    pw2.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    final s = AppScope.read(context);
    if (widget.register) {
      if (!validId(id.text)) return setState(() => msg = '管理者IDは半角英数字で3文字以上にしてください。');
      if (pw.text.length < 8) return setState(() => msg = 'パスワードは8文字以上にしてください。');
      if (pw.text != pw2.text) return setState(() => msg = '確認のパスワードが一致しません。');
      setState(() { busy = true; msg = '登録しています…'; });
      final code = await s.registerAdmin(id.text, pw.text);
      if (mounted) await showRecoveryCode(context, code);
    } else {
      setState(() { busy = true; msg = '確認しています…'; });
      final err = await s.login(id.text, pw.text);
      if (!mounted) return;
      setState(() { busy = false; msg = err ?? ''; });
      if (err != null) pw.clear();
    }
  }

  @override
  Widget build(BuildContext context) {
    final reg = widget.register;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Card(
            elevation: 0,
            color: Colors.white,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: const BorderSide(color: line)),
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: AutofillGroup(
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Text(reg ? '🔒 管理者の登録' : '🔒 管理画面にログイン', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 6),
                  Text(
                      reg
                          ? 'はじめに、管理画面に入るための管理者IDとパスワードを決めてください（店主の方が登録してください）。'
                          : '売上・利益のダッシュボード、商品と価格、設定は、管理者のID・パスワードが必要です。',
                      style: const TextStyle(color: muted)),
                  const SizedBox(height: 12),
                  TextField(
                    key: const ValueKey('authId'),
                    controller: id,
                    autofillHints: const [AutofillHints.username],
                    autocorrect: false,
                    decoration: InputDecoration(labelText: reg ? '管理者ID（半角英数字 3文字以上）' : '管理者ID'),
                  ),
                  TextField(
                    key: const ValueKey('authPw'),
                    controller: pw,
                    obscureText: true,
                    autofillHints: [reg ? AutofillHints.newPassword : AutofillHints.password],
                    decoration: InputDecoration(labelText: reg ? 'パスワード（8文字以上）' : 'パスワード'),
                    onSubmitted: reg ? null : (_) => submit(),
                  ),
                  if (reg)
                    TextField(
                      key: const ValueKey('authPw2'),
                      controller: pw2,
                      obscureText: true,
                      autofillHints: const [AutofillHints.newPassword],
                      decoration: const InputDecoration(labelText: 'パスワード（確認）'),
                    ),
                  const SizedBox(height: 8),
                  Text(msg, key: const ValueKey('authMsg'), style: TextStyle(color: msg.endsWith('…') ? muted : danger)),
                  const SizedBox(height: 8),
                  FilledButton(key: const ValueKey('authSubmit'), onPressed: busy ? null : submit, child: Text(reg ? '登録する' : 'ログイン')),
                  if (!reg) TextButton(onPressed: () => forgotDialog(context), child: const Text('パスワードを忘れたとき')),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// 回復用コード（このときだけ表示）
Future<void> showRecoveryCode(BuildContext context, String code) => showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (c) => AlertDialog(
        title: const Text('回復用コード（大切に保管）'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          const Text('パスワードを忘れたときに、このコードで新しいパスワードを設定できます。この画面にしか表示されません。紙に書いて、レジから離れた安全な場所に保管してください。'),
          Container(
            margin: const EdgeInsets.only(top: 12),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: const Color(0xFFF7E3DC), border: Border.all(color: accent, width: 2), borderRadius: BorderRadius.circular(10)),
            child: SelectableText(code, key: const ValueKey('recoveryCode'), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800, letterSpacing: 2, fontFamily: 'monospace')),
          ),
        ]),
        actions: [FilledButton(key: const ValueKey('recoveryOk'), onPressed: () => Navigator.pop(c), child: const Text('保管しました'))],
      ),
    );

Future<void> forgotDialog(BuildContext context) async {
  final s = AppScope.read(context);
  final code = TextEditingController(), id = TextEditingController(text: s.admins.isNotEmpty ? s.admins.first['id'] as String : ''),
      pw = TextEditingController(), pw2 = TextEditingController();
  var msg = '';
  var busy = false;
  final newCode = await showDialog<String>(
    context: context,
    builder: (c) => StatefulBuilder(builder: (c, set) {
      return AlertDialog(
        title: const Text('パスワードを忘れたとき'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Text('管理者を登録したときに表示された「回復用コード」を入れると、新しいパスワードを設定できます。', style: TextStyle(color: muted)),
            TextField(key: const ValueKey('fgCode'), controller: code, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: '回復用コード', hintText: 'XXXX-XXXX-XXXX')),
            TextField(controller: id, decoration: const InputDecoration(labelText: '管理者ID')),
            TextField(key: const ValueKey('fgPw'), controller: pw, obscureText: true, decoration: const InputDecoration(labelText: '新しいパスワード（8文字以上）')),
            TextField(key: const ValueKey('fgPw2'), controller: pw2, obscureText: true, decoration: const InputDecoration(labelText: '新しいパスワード（確認）')),
            const SizedBox(height: 8),
            Text(msg, style: const TextStyle(color: danger)),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: const Text('キャンセル')),
          FilledButton(
            key: const ValueKey('fgOk'),
            onPressed: busy
                ? null
                : () async {
                    if (pw.text.length < 8) return set(() => msg = 'パスワードは8文字以上にしてください。');
                    if (pw.text != pw2.text) return set(() => msg = '確認のパスワードが一致しません。');
                    set(() { busy = true; msg = ''; });
                    try {
                      final nc = await s.resetWithCode(code.text, id.text, pw.text);
                      if (c.mounted) Navigator.pop(c, nc);
                    } catch (e) {
                      set(() { busy = false; msg = '$e'; });
                    }
                  },
            child: const Text('パスワードを設定'),
          ),
        ],
      );
    }),
  );
  if (newCode != null && context.mounted) await showRecoveryCode(context, newCode);
}

// ---------------- 管理のホーム ----------------

class AdminHome extends StatelessWidget {
  const AdminHome({super.key});
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    return DefaultTabController(
      length: 3,
      child: Column(children: [
        Material(
          color: const Color(0xFF3A2F2A),
          child: Row(children: [
            const Expanded(
              child: TabBar(
                isScrollable: true,
                tabAlignment: TabAlignment.start,
                labelColor: Colors.white,
                unselectedLabelColor: Color(0xFFCBBFB8),
                indicatorColor: Colors.white,
                tabs: [Tab(text: 'ダッシュボード'), Tab(text: '商品・価格'), Tab(text: '設定')],
              ),
            ),
            Text(' ${s.adminId} ', style: const TextStyle(color: Color(0xFFCBBFB8), fontSize: 12)),
            TextButton(
              key: const ValueKey('logout'),
              onPressed: () {
                s.logout();
                toast(context, '管理画面からログアウトしました');
              },
              child: const Text('ログアウト', style: TextStyle(color: Colors.white)),
            ),
          ]),
        ),
        const Expanded(child: TabBarView(children: [Dashboard(), ProductsAdmin(), SettingsAdmin()])),
      ]),
    );
  }
}

// ---------------- ダッシュボード ----------------

class Dashboard extends StatefulWidget {
  const Dashboard({super.key});
  @override
  State<Dashboard> createState() => _DashboardState();
}

class _DashboardState extends State<Dashboard> {
  String kind = 'day';
  int offset = 0;
  Timer? timer;
  int? selected;

  @override
  void initState() {
    super.initState();
    // 今の期間を見ている間は30秒ごとに新しくする
    timer = Timer.periodic(const Duration(seconds: 30), (_) { if (mounted && offset == 0) setState(() {}); });
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  String pct(double? r) => r == null ? '—' : '${(r * 1000).round() / 10}%';
  String sy(int n) => (n < 0 ? '-' : '') + yen(n.abs());

  Widget delta(int cur, int prev, String label, [String Function(int)? fmt]) {
    fmt ??= sy;
    if (prev == 0) return Text('$label：${fmt(prev)}');
    final r = (cur - prev) / prev.abs();
    return Text.rich(TextSpan(children: [
      TextSpan(text: '${r >= 0 ? '▲ +' : '▼ '}${(r * 1000).round() / 10}%', style: TextStyle(color: r < 0 ? danger : okColor, fontWeight: FontWeight.w700)),
      TextSpan(text: '（$label ${fmt(prev)}）'),
    ]));
  }

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final now = DateTime.now();
    final today = ymd(now);
    final p = period(kind, today, offset);
    final current = today.compareTo(p.from) >= 0 && today.compareTo(p.to) <= 0;
    final fixed = ((s.settings['fixedCosts'] as List?) ?? const []).cast<Json>();
    final r = computeProfit(sales: s.store.sales, cashmoves: s.store.all('cashmoves'), products: s.products, fixedCosts: fixed, p: p, fixedUntil: current ? today : null);
    final pv = previousPeriod(p, now);
    final b = computeProfit(sales: s.store.sales, cashmoves: s.store.all('cashmoves'), products: s.products, fixedCosts: fixed, p: pv.period, until: pv.until, fixedUntil: pv.fixedUntil);
    const short = {'day': '先週同曜日', 'week': '先週', 'month': '先月', 'year': '昨年'};
    final cmp = short[kind]!;
    final avg = r.count != 0 ? (r.sales / r.count).round() : 0;

    return ListView(padding: const EdgeInsets.all(12), children: [
      Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
        for (final k in const [['day', '今日'], ['week', '今週'], ['month', '今月'], ['year', '今年']])
          ChoiceChip(key: ValueKey('period-${k[0]}'), label: Text(k[1]), selected: kind == k[0] && offset == 0, onSelected: (_) => setState(() { kind = k[0]; offset = 0; selected = null; })),
        IconButton.outlined(onPressed: () => setState(() { offset--; selected = null; }), icon: const Icon(Icons.chevron_left)),
        Text(p.label, key: const ValueKey('periodLabel'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
        IconButton.outlined(onPressed: current ? null : () => setState(() { offset++; selected = null; }), icon: const Icon(Icons.chevron_right)),
        if (current)
          Row(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.circle, size: 10, color: okColor),
            Text(' リアルタイム・${timeStr(now)} 更新', style: const TextStyle(color: muted, fontSize: 13)),
          ]),
        OutlinedButton(onPressed: () => fixedCostsDialog(context), child: const Text('固定費の設定')),
      ]),
      const SizedBox(height: 10),
      CardGrid(minWidth: 200, children: [
        StatCard('売上（税込）', Text(yen(r.sales), key: const ValueKey('dashSales')), sub: delta(r.sales, b.sales, cmp)),
        StatCard('客数', Text('${r.count}件  客単価 ${yen(avg)}'), sub: delta(r.count, b.count, cmp, (n) => '$n件')),
        StatCard('粗利（率）', Text('${sy(r.gross)}  ${pct(r.grossRate)}', key: const ValueKey('dashGross')), sub: delta(r.gross, b.gross, cmp)),
        StatCard('利益の目安', Text(sy(r.profit), key: const ValueKey('dashProfit'), style: TextStyle(color: r.profit < 0 ? danger : ink)), sub: delta(r.profit, b.profit, cmp)),
      ]),
      Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Text('比べている期間：${pv.label}（${pv.period.label}）', style: const TextStyle(color: muted, fontSize: 12))),
      _chart(r, p),
      const SizedBox(height: 12),
      _pl(r, p, current),
      const SizedBox(height: 12),
      _items(r),
    ]);
  }

  /// 積み上げ縦棒（原価が下、粗利が上、原価未登録の売上は灰色）
  Widget _chart(ProfitResult r, Period p) {
    var keys = bucketKeys(p);
    if (p.bucket == 'hour') {
      var lo = 9, hi = 19;
      for (final k in keys) {
        final x = r.buckets[k]!;
        if (x.excl != 0 || x.count != 0) { lo = (k as int) < lo ? k : lo; hi = k > hi ? k : hi; }
      }
      keys = keys.where((k) => (k as int) >= lo && k <= hi).toList();
    }
    String label(Object k) => p.bucket == 'hour' ? '$k' : p.bucket == 'month' ? '$k' : '${int.parse((k as String).substring(8))}';
    String full(Object k) => p.bucket == 'hour' ? '$k時台' : p.bucket == 'month' ? '$k月' : '${int.parse((k as String).substring(5, 7))}/${int.parse(k.substring(8))}';
    final vals = [for (final k in keys) r.buckets[k]!];
    final mx = vals.fold<double>(0, (m, x) => [m, x.cost + (x.gross > 0 ? x.gross : 0) + (x.uncovered > 0 ? x.uncovered : 0), x.excl].reduce((a, b) => a > b ? a : b));
    final sel = selected != null && selected! < keys.length ? selected : null;
    final readout = sel == null
        ? '棒をタップすると値を表示'
        : () {
            final x = vals[sel];
            return '${full(keys[sel])}：売上（税抜）${yen(jsRound(x.excl))}・原価 ${yen(jsRound(x.cost))}・粗利 ${sy(x.gross)}'
                '${x.uncovered != 0 ? '・原価未登録 ${yen(jsRound(x.uncovered))}' : ''}・${x.count}件';
          }();
    return Card(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: line)),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('売上（税抜）の内訳：原価と粗利（${{'hour': '時間帯別', 'day': '日別', 'month': '月別'}[p.bucket]}）', style: const TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Wrap(spacing: 14, children: [
            _legend(accent, '粗利'),
            _legend(costColor, '原価'),
            if (r.uncovered != 0) _legend(const Color(0xFFC9C2BC), '原価が未登録の売上'),
          ]),
          Text(readout, style: const TextStyle(color: muted, fontSize: 12)),
          const SizedBox(height: 6),
          SizedBox(
            height: 180,
            child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
              for (var i = 0; i < keys.length; i++)
                Expanded(
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: () => setState(() => selected = i),
                    child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
                      Expanded(
                        child: Align(
                          alignment: Alignment.bottomCenter,
                          child: FractionallySizedBox(
                            heightFactor: mx > 0 ? ((vals[i].cost + (vals[i].gross > 0 ? vals[i].gross : 0) + (vals[i].uncovered > 0 ? vals[i].uncovered : 0)) / mx).clamp(0.0, 1.0) : 0,
                            child: Container(
                              constraints: const BoxConstraints(maxWidth: 24),
                              decoration: BoxDecoration(
                                border: sel == i ? Border.all(color: ink, width: 1.5) : null,
                                borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
                              ),
                              child: ClipRRect(
                                borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
                                child: Column(children: [
                                  if (vals[i].uncovered > 0) Expanded(flex: (vals[i].uncovered * 100).round().clamp(1, 1 << 30), child: Container(color: const Color(0xFFC9C2BC))),
                                  if (vals[i].gross > 0) Expanded(flex: (vals[i].gross * 100).round().clamp(1, 1 << 30), child: Container(color: accent)),
                                  if (vals[i].cost > 0) Expanded(flex: (vals[i].cost * 100).round().clamp(1, 1 << 30), child: Container(color: costColor)),
                                ]),
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(label(keys[i]), style: const TextStyle(fontSize: 10, color: muted), maxLines: 1),
                    ]),
                  ),
                ),
            ]),
          ),
        ]),
      ),
    );
  }

  Widget _legend(Color c, String t) => Row(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 12, height: 12, decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(3))),
        const SizedBox(width: 4),
        Text(t, style: const TextStyle(fontSize: 12)),
      ]);

  Widget _pl(ProfitResult r, Period p, bool current) {
    final rows = <(String, String, String, String)>[
      ('売上（税込）', yen(r.sales), '', ''),
      ('　消費税', '-${yen(r.tax)}', '', ''),
      ('売上（税抜）', yen(jsRound(r.excl)), 'b', ''),
      ('原価', '-${yen(jsRound(r.cost))}', '', r.uncovered != 0 ? '原価が登録された商品の分' : ''),
      ('粗利', sy(r.gross), 'b', '粗利率 ${pct(r.grossRate)}'),
      if (r.uncovered != 0) ('　原価が未登録の売上の粗利（見込み）', sy(r.grossEst - r.gross), 's', '同じ粗利率で計算'),
      ('経費（レジの出金）', '-${yen(r.expenses)}', '', ''),
      for (final e in r.expenseBy.entries) ('　${e.key}', yen(e.value), 's', ''),
      ('固定費（月額の日割り${current ? '・今日まで' : ''}）', '-${yen(r.fixed)}', '', ''),
      for (final e in r.fixedBy.entries) ('　${e.key}', yen(e.value), 's', ''),
      ('利益の目安', sy(r.profit), 't', ''),
    ];
    return Card(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: line)),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('損益のまとめ（${p.label}）', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          for (final x in rows)
            Container(
              padding: const EdgeInsets.symmetric(vertical: 5),
              decoration: BoxDecoration(border: Border(top: BorderSide(color: x.$3 == 't' ? ink : line, width: x.$3 == 't' ? 2 : 1))),
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(x.$1, style: TextStyle(fontWeight: x.$3 == 'b' || x.$3 == 't' ? FontWeight.w700 : FontWeight.w400, color: x.$3 == 's' ? muted : ink, fontSize: x.$3 == 's' ? 13 : 15)),
                    if (x.$4.isNotEmpty) Text(x.$4, style: const TextStyle(color: muted, fontSize: 12)),
                  ]),
                ),
                Text(x.$2, style: TextStyle(fontWeight: x.$3 == 'b' || x.$3 == 't' ? FontWeight.w800 : FontWeight.w400, fontSize: x.$3 == 't' ? 18 : 15, color: x.$3 == 's' ? muted : ink)),
              ]),
            ),
          if (r.noCost.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text('原価が登録されている売上は ${pct(r.coverage)} です。原価が未登録の商品：${r.noCost.take(8).join('、')}${r.noCost.length > 8 ? ' ほか' : ''}。「商品・価格」で原価を入れると、利益が正確になります。',
                  style: const TextStyle(color: muted, fontSize: 12)),
            ),
          const Padding(
            padding: EdgeInsets.only(top: 6),
            child: Text('利益の目安は、粗利から経費と固定費を引いたものです。正式な決算は会計ソフトで行ってください。', style: TextStyle(color: muted, fontSize: 12)),
          ),
        ]),
      ),
    );
  }

  Widget _items(ProfitResult r) {
    final items = r.itemList.where((it) => it.excl != 0 || it.cost != 0).take(20).toList();
    return Card(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: line)),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('商品別の粗利', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          if (items.isEmpty) const Padding(padding: EdgeInsets.all(8), child: Text('この期間の売上はありません。', style: TextStyle(color: muted))),
          for (final it in items)
            ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              title: Text(it.name),
              subtitle: Text('売上（税抜）${yen(jsRound(it.excl))}${it.hasCost ? '・原価 ${yen(jsRound(it.cost))}' : ''}'),
              trailing: Text(it.hasCost ? '${sy(it.gross!)}  ${pct(it.rate)}' : '原価が未登録',
                  style: TextStyle(fontWeight: FontWeight.w700, color: it.hasCost ? ((it.gross ?? 0) < 0 ? danger : ink) : muted)),
            ),
        ]),
      ),
    );
  }
}

Future<void> fixedCostsDialog(BuildContext context) async {
  final s = AppScope.read(context);
  final list = [
    for (final f in ((s.settings['fixedCosts'] as List?) ?? const []).cast<Json>())
      (TextEditingController(text: f['name'] as String? ?? ''), TextEditingController(text: '${f['amount'] ?? ''}'))
  ];
  if (list.isEmpty) {
    for (final n in ['家賃', '人件費', '水道光熱費']) {
      list.add((TextEditingController(text: n), TextEditingController()));
    }
  }
  final ok = await showDialog<bool>(
    context: context,
    builder: (c) => StatefulBuilder(builder: (c, set) => AlertDialog(
          title: const Text('固定費の設定（月額）'),
          content: SizedBox(
            width: 420,
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                const Text('家賃・人件費・水道光熱費など、毎月かかるお金を月額で入れてください。日割りにして利益の目安から差し引きます。レジの出金で払ったものは入れないでください。', style: TextStyle(color: muted)),
                for (var i = 0; i < list.length; i++)
                  Row(children: [
                    Expanded(flex: 3, child: TextField(controller: list[i].$1, decoration: const InputDecoration(labelText: '名前'))),
                    const SizedBox(width: 8),
                    Expanded(flex: 2, child: TextField(key: ValueKey('fc-$i'), controller: list[i].$2, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: '月額（円）'))),
                    IconButton(onPressed: () => set(() => list.removeAt(i)), icon: const Icon(Icons.close)),
                  ]),
                TextButton(onPressed: () => set(() => list.add((TextEditingController(), TextEditingController()))), child: const Text('＋ 行を追加')),
              ]),
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('キャンセル')),
            FilledButton(key: const ValueKey('fcSave'), onPressed: () => Navigator.pop(c, true), child: const Text('保存')),
          ],
        )),
  );
  if (ok == true) {
    s.settings['fixedCosts'] = [
      for (final x in list)
        if (x.$1.text.trim().isNotEmpty || (int.tryParse(x.$2.text) ?? 0) > 0) {'name': x.$1.text.trim(), 'amount': int.tryParse(x.$2.text) ?? 0}
    ];
    await s.saveSettings();
    if (context.mounted) toast(context, '固定費を保存しました');
  }
}

// ---------------- 商品・価格 ----------------

class ProductsAdmin extends StatelessWidget {
  const ProductsAdmin({super.key});
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final cats = s.categories;
    final list = s.products.toList()
      ..sort((a, b) {
        final ca = cats.indexOf(a['category'] as String), cb = cats.indexOf(b['category'] as String);
        return ca != cb ? ca.compareTo(cb) : ((a['order'] ?? 0) as num).compareTo((b['order'] ?? 0) as num);
      });
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(
        key: const ValueKey('addProduct'),
        onPressed: () => productDialog(context, null),
        icon: const Icon(Icons.add),
        label: const Text('商品を追加'),
      ),
      body: ListView.separated(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 90),
        itemCount: list.length,
        separatorBuilder: (_, _) => const SizedBox(height: 6),
        itemBuilder: (c, i) {
          final p = list[i];
          final unit = p['unit'] == 'g' ? '/100g' : '';
          final costUnit = p['unit'] == 'g' ? '/kg' : '/個';
          return Material(
            color: Colors.white,
            borderRadius: BorderRadius.circular(10),
            child: ListTile(
              key: ValueKey('padmin-${p['id']}'),
              leading: CircleAvatar(backgroundColor: colorFrom(p['color'] as String?), radius: 10),
              title: Text('${p['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text('${p['category']}・${p['unit'] == 'open' ? '金額入力' : '${yen(p['price'] as num)}$unit'}'
                  '${p['cost'] != null && p['cost'] != 0 ? '・原価 ${yen(p['cost'] as num)}$costUnit' : '・原価 未登録'}${p['taxRate'] == 10 ? '・10%' : ''}'),
              trailing: const Icon(Icons.edit),
              onTap: () => productDialog(context, p),
            ),
          );
        },
      ),
    );
  }
}

const productColors = ['#e8846b', '#f1a98f', '#f4c1ad', '#c96a5a', '#a8564a', '#d9a441', '#b8743a', '#e9d27a', '#7fb07a', '#6fa8c9', '#8fa3b8', '#9aa3ab', '#7f8c8d'];

Future<void> productDialog(BuildContext context, Json? p) async {
  final s = AppScope.read(context);
  final isNew = p == null;
  final d = <String, dynamic>{
    ...(p ?? {'name': '', 'category': s.categories.first, 'unit': 'g', 'price': 0, 'taxRate': 8, 'color': productColors.first}),
  };
  final name = TextEditingController(text: d['name'] as String);
  final kana = TextEditingController(text: (d['kana'] ?? '') as String);
  final code = TextEditingController(text: (d['code'] ?? '') as String);
  final price = TextEditingController(text: d['unit'] == 'open' ? '' : '${d['price']}');
  final cost = TextEditingController(text: d['cost'] == null || d['cost'] == 0 ? '' : '${d['cost']}');
  var msg = '';
  final res = await showDialog<String>(
    context: context,
    builder: (c) => StatefulBuilder(builder: (c, set) {
      final g = d['unit'] == 'g', open = d['unit'] == 'open';
      return AlertDialog(
        title: Text(isNew ? '商品を追加' : '商品を編集'),
        content: SizedBox(
          width: 460,
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              TextField(key: const ValueKey('pName'), controller: name, decoration: const InputDecoration(labelText: '商品名')),
              Row(children: [
                Expanded(flex: 2, child: TextField(controller: kana, decoration: const InputDecoration(labelText: 'よみ（検索用・なくても可）'))),
                const SizedBox(width: 8),
                Expanded(child: TextField(controller: code, decoration: const InputDecoration(labelText: '商品コード'))),
              ]),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                initialValue: s.categories.contains(d['category']) ? d['category'] as String : s.categories.first,
                decoration: const InputDecoration(labelText: 'カテゴリ'),
                items: [for (final c in s.categories) DropdownMenuItem(value: c, child: Text(c))],
                onChanged: (v) => d['category'] = v,
              ),
              const SizedBox(height: 10),
              const Text('売り方', style: TextStyle(color: muted)),
              SegmentedButton<String>(
                segments: const [ButtonSegment(value: 'g', label: Text('グラム売り')), ButtonSegment(value: 'pc', label: Text('個数売り')), ButtonSegment(value: 'open', label: Text('金額入力'))],
                selected: {d['unit'] as String},
                onSelectionChanged: (v) => set(() => d['unit'] = v.first),
              ),
              if (!open) ...[
                TextField(key: const ValueKey('pPrice'), controller: price, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: g ? '単価（100gあたり・税込・円）' : '単価（1個あたり・税込・円）')),
                TextField(key: const ValueKey('pCost'), controller: cost, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: '原価（${g ? '1kg' : '1個'}あたり・税抜・円）', hintText: '空欄なら粗利を計算しません')),
              ],
              const SizedBox(height: 10),
              const Text('税率', style: TextStyle(color: muted)),
              SegmentedButton<int>(
                segments: const [ButtonSegment(value: 8, label: Text('8%（食品）')), ButtonSegment(value: 10, label: Text('10%（レジ袋など）'))],
                selected: {(d['taxRate'] as num).toInt()},
                onSelectionChanged: (v) => set(() => d['taxRate'] = v.first),
              ),
              const SizedBox(height: 10),
              const Text('ボタンの色', style: TextStyle(color: muted)),
              Wrap(spacing: 6, runSpacing: 6, children: [
                for (final col in productColors)
                  InkWell(
                    onTap: () => set(() => d['color'] = col),
                    child: Container(
                      width: 34,
                      height: 34,
                      decoration: BoxDecoration(color: colorFrom(col), borderRadius: BorderRadius.circular(8), border: Border.all(color: d['color'] == col ? ink : Colors.transparent, width: 3)),
                    ),
                  ),
              ]),
              if (msg.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(msg, style: const TextStyle(color: danger))),
            ]),
          ),
        ),
        actions: [
          if (!isNew) TextButton(style: TextButton.styleFrom(foregroundColor: danger), onPressed: () => Navigator.pop(c, 'del'), child: const Text('削除')),
          TextButton(onPressed: () => Navigator.pop(c), child: const Text('キャンセル')),
          FilledButton(
            key: const ValueKey('pSave'),
            onPressed: () {
              final pr = int.tryParse(price.text.trim()) ?? 0;
              if (name.text.trim().isEmpty) return set(() => msg = '商品名を入力してください');
              if (d['unit'] != 'open' && pr <= 0) return set(() => msg = '単価を入力してください');
              Navigator.pop(c, 'save');
            },
            child: const Text('保存'),
          ),
        ],
      );
    }),
  );
  if (!context.mounted) return;
  if (res == 'del') {
    if (await confirmDialog(context, '「${d['name']}」を削除しますか？（過去の売上データは残ります）', ok: '削除', dangerous: true)) await s.deleteProduct(d['id'] as String);
  } else if (res == 'save') {
    d['name'] = name.text.trim();
    d['kana'] = kana.text.trim();
    d['code'] = code.text.trim();
    d['price'] = d['unit'] == 'open' ? 0 : int.tryParse(price.text.trim()) ?? 0;
    d['cost'] = d['unit'] == 'open' ? 0 : int.tryParse(cost.text.trim()) ?? 0;
    await s.saveProduct(d);
    if (context.mounted) toast(context, '「${d['name']}」を保存しました');
  }
}

// ---------------- 設定 ----------------

class SettingsAdmin extends StatefulWidget {
  const SettingsAdmin({super.key});
  @override
  State<SettingsAdmin> createState() => _SettingsAdminState();
}

class _SettingsAdminState extends State<SettingsAdmin> {
  late final Map<String, TextEditingController> f;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final st = AppScope.read(context).settings;
    String sv(String k) => (st[k] ?? '').toString();
    f = {
      for (final k in ['storeName', 'address', 'tel', 'fax', 'invoiceNo', 'footer', 'deviceCode']) k: TextEditingController(text: sv(k)),
      'categories': TextEditingController(text: ((st['categories'] as List?) ?? const []).join(',')),
      'cashlessTypes': TextEditingController(text: ((st['cashlessTypes'] as List?) ?? const []).join(',')),
    };
  }

  @override
  void dispose() {
    for (final c in f.values) {
      c.dispose();
    }
    super.dispose();
  }

  List<String> split(String v) => v.split(RegExp(r'[,、，]')).map((x) => x.trim()).where((x) => x.isNotEmpty).toList();

  Future<void> save() async {
    final s = AppScope.read(context);
    for (final k in ['storeName', 'address', 'tel', 'fax', 'invoiceNo', 'footer', 'deviceCode']) {
      s.settings[k] = f[k]!.text.trim();
    }
    final cats = split(f['categories']!.text);
    s.settings['categories'] = cats.isEmpty ? ['その他'] : cats;
    s.settings['cashlessTypes'] = split(f['cashlessTypes']!.text);
    await s.saveSettings();
    s.log('settings', '店舗・レシート設定を保存');
    if (mounted) toast(context, '設定を保存しました');
  }

  Widget field(String k, String label, {int lines = 1, String? hint}) => TextField(
        key: ValueKey('set-$k'),
        controller: f[k],
        maxLines: lines,
        decoration: InputDecoration(labelText: label, hintText: hint),
      );

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    Widget h2(String t) => Padding(padding: const EdgeInsets.only(top: 20, bottom: 4), child: Text(t, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)));
    return ListView(padding: const EdgeInsets.all(16), children: [
      Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 620),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            h2('画面のレイアウト（この端末）'),
            const Text('スマートフォン向けとタブレット向けの画面を切り替えられます。「自動」は画面の大きさで選びます。', style: TextStyle(color: muted)),
            RadioGroup<LayoutMode>(
              groupValue: s.layoutMode,
              onChanged: (v) => s.setLayoutMode(v!),
              child: Column(children: [
                for (final m in LayoutMode.values)
                  RadioListTile<LayoutMode>(
                    key: ValueKey('layout-${m.name}'),
                    value: m,
                    title: Text(layoutModeLabel(m)),
                    subtitle: m == LayoutMode.auto ? Text('今の画面：${MediaQuery.sizeOf(context).shortestSide >= 600 ? 'タブレット向け' : 'スマートフォン向け'}') : null,
                  ),
              ]),
            ),
            h2('操作音（この端末）'),
            SwitchListTile(
              key: const ValueKey('soundOn'),
              title: const Text('操作音を鳴らす'),
              subtitle: const Text('テンキー・商品の追加・取消・保留・会計完了・エラーで音が鳴ります。上の 🔊 ボタンでもすぐ切り替えられます。'),
              value: s.soundOn,
              onChanged: (v) => s.setSound(on: v),
            ),
            Row(children: [
              const SizedBox(width: 16),
              const Text('音量'),
              Expanded(
                child: Slider(
                  key: const ValueKey('soundVol'),
                  value: s.soundVolume,
                  divisions: 10,
                  label: '${(s.soundVolume * 100).round()}%',
                  onChanged: s.soundOn ? (v) => s.setSound(volume: v) : null,
                ),
              ),
              OutlinedButton(
                onPressed: s.soundOn
                    ? () async {
                        for (final x in [Sfx.key, Sfx.add, Sfx.done]) {
                          Sound.play(x);
                          await Future<void>.delayed(const Duration(milliseconds: 450));
                        }
                      }
                    : null,
                child: const Text('試しに鳴らす'),
              ),
            ]),
            h2('店舗・レシート'),
            field('storeName', '店名'),
            field('address', '住所'),
            field('tel', '電話番号'),
            field('fax', 'FAX番号（FAX注文用紙・予約確認書に載せます）'),
            field('invoiceNo', 'インボイス登録番号', hint: 'T1234567890123'),
            field('footer', 'レシート末尾メッセージ', lines: 2),
            field('categories', '商品カテゴリ（カンマ区切り）'),
            field('cashlessTypes', 'キャッシュレスの種類（カンマ区切り）', hint: 'クレジット,電子マネー,QR決済'),
            field('deviceCode', 'この端末の記号（複数端末で使うとき。例：A）'),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              initialValue: s.rounding,
              decoration: const InputDecoration(labelText: 'グラム売りの端数処理'),
              items: const [
                DropdownMenuItem(value: 'floor', child: Text('切り捨て')),
                DropdownMenuItem(value: 'round', child: Text('四捨五入')),
                DropdownMenuItem(value: 'ceil', child: Text('切り上げ')),
              ],
              onChanged: (v) => s.settings['rounding'] = v,
            ),
            const SizedBox(height: 12),
            FilledButton(key: const ValueKey('settingsSave'), onPressed: save, child: const Text('保存')),
            h2('クラウド同期（全端末・管理画面で共有）'),
            const SyncSettings(),
            h2('管理者（ID・パスワード）'),
            Text('ログイン中：${s.adminId}　操作がないと ${s.adminTimeoutMin}分で自動ログアウトします。', style: const TextStyle(color: muted)),
            Wrap(spacing: 8, children: [
              OutlinedButton(onPressed: () => changePasswordDialog(context), child: const Text('パスワードを変更')),
              OutlinedButton(
                onPressed: () async {
                  final v = await showDialog<int>(
                    context: context,
                    builder: (c) => SimpleDialog(title: const Text('自動ログアウトまで'), children: [
                      for (final m in [5, 15, 30, 60, 120]) SimpleDialogOption(onPressed: () => Navigator.pop(c, m), child: Text('$m分')),
                    ]),
                  );
                  if (v != null) await s.setAdminTimeout(v);
                },
                child: const Text('自動ログアウトの時間'),
              ),
            ]),
            h2('このアプリについて'),
            const Text('NIKUPOS（Flutter版・開発中）。データはこの端末の中に保存されます。', style: TextStyle(color: muted)),
          ]),
        ),
      ),
    ]);
  }
}

Future<void> changePasswordDialog(BuildContext context) async {
  final s = AppScope.read(context);
  final cur = TextEditingController(), pw = TextEditingController(), pw2 = TextEditingController();
  var msg = '';
  var busy = false;
  await showDialog<void>(
    context: context,
    builder: (c) => StatefulBuilder(builder: (c, set) => AlertDialog(
          title: const Text('パスワードの変更'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: cur, obscureText: true, decoration: const InputDecoration(labelText: '今のパスワード')),
            TextField(controller: pw, obscureText: true, decoration: const InputDecoration(labelText: '新しいパスワード（8文字以上）')),
            TextField(controller: pw2, obscureText: true, decoration: const InputDecoration(labelText: '確認')),
            Text(msg, style: const TextStyle(color: danger)),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c), child: const Text('キャンセル')),
            FilledButton(
              onPressed: busy
                  ? null
                  : () async {
                      if (pw.text.length < 8) return set(() => msg = 'パスワードは8文字以上にしてください。');
                      if (pw.text != pw2.text) return set(() => msg = '確認のパスワードが一致しません。');
                      set(() => busy = true);
                      final err = await s.changePassword(cur.text, pw.text);
                      if (err != null) return set(() { busy = false; msg = err; });
                      if (c.mounted) Navigator.pop(c);
                      if (context.mounted) toast(context, 'パスワードを変更しました');
                    },
              child: const Text('変更'),
            ),
          ],
        )),
  );
}
