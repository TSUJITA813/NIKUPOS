// 予約・取り置き（電話・FAX・店頭）

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../core/app_state.dart';
import '../core/calc.dart';
import '../core/fax_pdf.dart';
import '../core/profit.dart' show ymd, parseYmd;
import '../core/reservation.dart';
import '../core/sound.dart';
import 'common.dart';
import 'register.dart' show numberDialog, priceLabel;

const _week = '月火水木金土日';
String dayLabel(String d) {
  final x = parseYmd(d);
  return '${x.month}月${x.day}日（${_week[x.weekday - 1]}）';
}

IconData channelIcon(String? c) => switch (c) {
      'phone' => Icons.phone,
      'fax' => Icons.fax,
      'store' => Icons.storefront,
      _ => Icons.more_horiz,
    };

pw.Font? _pdfFont;
Future<pw.Font> pdfFont() async => _pdfFont ??= pw.Font.ttf(await rootBundle.load('assets/fonts/ipag.ttf'));

/// PDF を印刷（FAX機能つきの複合機・PDFとして保存など）または共有（FAXアプリ・メール・LINEなど）
Future<void> outputPdf(BuildContext context, String title, Future<List<int>> Function() build) async {
  final act = await showDialog<String>(
    context: context,
    builder: (c) => SimpleDialog(title: Text(title), children: [
      SimpleDialogOption(
        onPressed: () => Navigator.pop(c, 'print'),
        child: const ListTile(leading: Icon(Icons.print), title: Text('印刷する'), subtitle: Text('プリンター・FAX機能つきの複合機へ。「PDFとして保存」もできます')),
      ),
      SimpleDialogOption(
        onPressed: () => Navigator.pop(c, 'share'),
        child: const ListTile(leading: Icon(Icons.share), title: Text('共有する'), subtitle: Text('FAX送信アプリ・メール・LINEなどで送る')),
      ),
    ]),
  );
  if (act == null) return;
  final bytes = await build();
  final data = Uint8List.fromList(bytes);
  if (act == 'print') {
    await Printing.layoutPdf(onLayout: (_) async => data, name: title);
  } else {
    await Printing.sharePdf(bytes: data, filename: '$title.pdf');
  }
}

class ReservationsPage extends StatefulWidget {
  const ReservationsPage({super.key});
  @override
  State<ReservationsPage> createState() => _ReservationsPageState();
}

class _ReservationsPageState extends State<ReservationsPage> {
  String date = ymd(DateTime.now());
  String scope = 'day'; // day：この日 / upcoming：今日以降すべて
  String q = '';

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final today = ymd(DateTime.now());
    final key = searchKey(q);
    final list = s.reservations.where((r) {
      if (scope == 'day' ? r['date'] != date : ((r['date'] as String).compareTo(today) < 0 || !isActiveReservation(r))) return false;
      if (key.isEmpty) return true;
      final digits = normPhone(q);
      return searchKey('${r['name']}').contains(key) ||
          (digits.length >= 3 && (normPhone(r['phone'] as String?).contains(digits) || normPhone(r['fax'] as String?).contains(digits)));
    }).toList()
      ..sort((a, b) {
        final c = (a['date'] as String).compareTo(b['date'] as String);
        if (c != 0) return c;
        final ac = isActiveReservation(a) ? 0 : 1, bc = isActiveReservation(b) ? 0 : 1;
        if (ac != bc) return ac.compareTo(bc);
        return ((a['time'] ?? '99') as String).compareTo((b['time'] ?? '99') as String);
      });
    final active = list.where(isActiveReservation).length;

    return ListView(padding: const EdgeInsets.all(12), children: [
      // 受付のボタン（電話・FAXを受けながらすぐ入力できるように）
      Wrap(spacing: 8, runSpacing: 8, children: [
        FilledButton.icon(key: const ValueKey('newPhone'), onPressed: () => openReservationForm(context, null, channel: 'phone', date: scope == 'day' ? date : null), icon: const Icon(Icons.phone), label: const Text('電話で受付')),
        FilledButton.tonalIcon(key: const ValueKey('newFax'), onPressed: () => openReservationForm(context, null, channel: 'fax', date: scope == 'day' ? date : null), icon: const Icon(Icons.fax), label: const Text('FAXで受付')),
        OutlinedButton.icon(onPressed: () => openReservationForm(context, null, channel: 'store', date: scope == 'day' ? date : null), icon: const Icon(Icons.storefront), label: const Text('店頭で受付')),
      ]),
      const SizedBox(height: 10),
      Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
        IconButton.outlined(onPressed: () => setState(() { date = addDaysYmd(date, -1); scope = 'day'; }), icon: const Icon(Icons.chevron_left)),
        TextButton(
          onPressed: () async {
            final p = await showDatePicker(context: context, initialDate: parseYmd(date), firstDate: DateTime(2020), lastDate: DateTime.now().add(const Duration(days: 730)));
            if (p != null) setState(() { date = ymd(p); scope = 'day'; });
          },
          child: Text(dayLabel(date), key: const ValueKey('resvDate'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
        ),
        IconButton.outlined(onPressed: () => setState(() { date = addDaysYmd(date, 1); scope = 'day'; }), icon: const Icon(Icons.chevron_right)),
        OutlinedButton(onPressed: () => setState(() { date = today; scope = 'day'; }), child: const Text('今日')),
        ChoiceChip(label: const Text('この日'), selected: scope == 'day', onSelected: (_) => setState(() => scope = 'day')),
        ChoiceChip(key: const ValueKey('scopeUpcoming'), label: const Text('今日以降すべて'), selected: scope == 'upcoming', onSelected: (_) => setState(() => scope = 'upcoming')),
      ]),
      const SizedBox(height: 8),
      Row(children: [
        Expanded(
          child: TextField(
            key: const ValueKey('resvSearch'),
            decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: '名前・電話番号・FAX番号で検索', isDense: true, border: OutlineInputBorder()),
            onChanged: (v) => setState(() => q = v.trim()),
          ),
        ),
        const SizedBox(width: 8),
        OutlinedButton(onPressed: () => prepDialog(context, date), child: const Text('仕込み集計')),
        const SizedBox(width: 6),
        OutlinedButton(
          key: const ValueKey('faxForm'),
          onPressed: () => outputPdf(context, 'FAX注文用紙', () async => faxOrderFormPdf(s.settings, s.products, s.categories, await pdfFont())),
          child: const Text('FAX注文用紙'),
        ),
      ]),
      const SizedBox(height: 10),
      Text(scope == 'day' ? '${dayLabel(date)} の受取：$active件' : '今日以降の予約：$active件', style: const TextStyle(color: muted)),
      if (list.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Center(child: Text('予約はありません。', style: TextStyle(color: muted)))),
      for (final r in list) ReservationCard(r: r, showDate: scope != 'day'),
    ]);
  }
}

String addDaysYmd(String d, int n) {
  final x = parseYmd(d);
  return ymd(DateTime(x.year, x.month, x.day + n));
}

class ReservationCard extends StatelessWidget {
  final Json r;
  final bool showDate;
  const ReservationCard({super.key, required this.r, this.showDate = false});

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final status = r['status'] as String;
    final active = isActiveReservation(r);
    final items = (r['items'] as List).cast<Json>();
    final dep = ((r['deposit'] ?? 0) as num).toInt();
    final statusColor = {'reserved': accent, 'ready': okColor, 'done': muted, 'cancelled': danger}[status]!;
    return Opacity(
      opacity: active ? 1 : 0.55,
      child: Card(
        key: ValueKey('resv-${r['id']}'),
        elevation: 0,
        color: Colors.white,
        margin: const EdgeInsets.only(bottom: 8),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: status == 'ready' ? okColor : line, width: status == 'ready' ? 2 : 1)),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Text('${showDate ? '${dayLabel(r['date'] as String)} ' : ''}${(r['time'] ?? '').toString().isEmpty ? '--:--' : r['time']}',
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
              const SizedBox(width: 10),
              Expanded(child: Text('${r['name']} 様', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800), overflow: TextOverflow.ellipsis)),
            ]),
            Wrap(spacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
              Chip(
                visualDensity: VisualDensity.compact,
                avatar: Icon(channelIcon(r['channel'] as String?), size: 16),
                label: Text(channelLabels[r['channel']] ?? ''),
              ),
              Chip(visualDensity: VisualDensity.compact, label: Text(statusLabels[status]!, style: TextStyle(color: statusColor, fontWeight: FontWeight.w700))),
              Text('No.${r['noLabel']}'
                  '${(r['phone'] ?? '').toString().isNotEmpty ? '　☎ ${r['phone']}' : ''}'
                  '${(r['fax'] ?? '').toString().isNotEmpty ? '　FAX ${r['fax']}' : ''}', style: const TextStyle(color: muted)),
            ]),
            const SizedBox(height: 4),
            Text(items.map((it) => '${it['name']} ${itemQtyLabel(it)}').join('、')),
            Text('概算 ${yen(reservationEstimate(r, s.rounding))}${dep > 0 ? '・前受金 ${yen(dep)}（${r['depositMethod'] == 'cashless' ? 'キャッシュレス' : '現金'}）${r['depositRefundDate'] != null ? '・返金済' : ''}' : ''}',
                style: const TextStyle(color: muted)),
            if ((r['note'] ?? '').toString().isNotEmpty) Text('メモ：${r['note']}', style: const TextStyle(color: ink)),
            if (active) ...[
              const SizedBox(height: 8),
              Wrap(spacing: 6, runSpacing: 6, children: [
                FilledButton.icon(
                  key: ValueKey('checkout-${r['id']}'),
                  onPressed: () async {
                    await s.loadReservation(r);
                    s.tab.value = 0;
                    if (context.mounted && s.lines.any((l) => l['estimated'] == true)) toast(context, 'グラム売りの商品をタップして、実際の重さを入力してください');
                  },
                  icon: const Icon(Icons.point_of_sale),
                  label: const Text('レジへ'),
                ),
                OutlinedButton(key: ValueKey('ready-${r['id']}'), onPressed: () => s.toggleReady(r), child: Text(status == 'ready' ? '準備済を戻す' : '準備済にする')),
                OutlinedButton(onPressed: () => openReservationForm(context, r), child: const Text('変更')),
                OutlinedButton.icon(
                  key: ValueKey('faxconf-${r['id']}'),
                  onPressed: () => outputPdf(context, 'ご予約確認書 No.${r['noLabel']}', () async => reservationConfirmationPdf(r, s.settings, s.rounding, await pdfFont())),
                  icon: const Icon(Icons.fax, size: 18),
                  label: const Text('確認書（FAX）'),
                ),
                TextButton(style: TextButton.styleFrom(foregroundColor: danger), onPressed: () => cancelDialog(context, r), child: const Text('取消')),
              ]),
            ],
          ]),
        ),
      ),
    );
  }
}

Future<void> cancelDialog(BuildContext context, Json r) async {
  final s = AppScope.read(context);
  final dep = ((r['deposit'] ?? 0) as num).toInt();
  final hasDep = dep > 0 && r['depositRefundDate'] == null;
  final act = await showDialog<String>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text('予約 No.${r['noLabel']} を取り消しますか？'),
      content: Text('${r['name']} 様・${dayLabel(r['date'] as String)} ${r['time'] ?? ''}${hasDep ? '\n前受金 ${yen(dep)} を受け取っています。' : ''}'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c), child: const Text('戻る')),
        if (hasDep) TextButton(onPressed: () => Navigator.pop(c, 'keep'), child: const Text('返金せずに取消')),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: danger), onPressed: () => Navigator.pop(c, hasDep ? 'refund' : 'keep'), child: Text(hasDep ? '前受金を返金して取消' : '取り消す')),
      ],
    ),
  );
  if (act == null) return;
  await s.cancelReservation(r, refund: act == 'refund');
  Sound.play(Sfx.remove);
  if (context.mounted) toast(context, '予約を取り消しました');
}

Future<void> prepDialog(BuildContext context, String date) async {
  final s = AppScope.read(context);
  final p = prepSummary(s.reservations, date);
  await showDialog<void>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text('仕込み集計　${dayLabel(date)}'),
      content: SizedBox(
        width: 400,
        child: p.items.isEmpty
            ? const Text('この日に受け取りの予約はありません。')
            : Column(mainAxisSize: MainAxisSize.min, children: [
                Text('予約 ${p.count}件（取消・受渡済を除く）', style: const TextStyle(color: muted)),
                for (final it in p.items)
                  ListTile(
                    dense: true,
                    title: Text(it.name, style: const TextStyle(fontSize: 16)),
                    trailing: Text(it.unit == 'g' ? (it.qty >= 1000 ? '${(it.qty / 100).round() / 10}kg' : '${it.qty}g') : it.unit == 'open' ? '${it.qty}件' : '${it.qty}個',
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                    subtitle: Text('予約 ${it.reservations}件'),
                  ),
              ]),
      ),
      actions: [FilledButton(onPressed: () => Navigator.pop(c), child: const Text('閉じる'))],
    ),
  );
}

// ---------------- 予約の登録・変更 ----------------

Future<void> openReservationForm(BuildContext context, Json? r, {String channel = 'phone', String? date}) async {
  final s = AppScope.read(context);
  final tablet = useTabletLayout(context, s);
  final saved = await showDialog<Json>(
    context: context,
    barrierDismissible: false,
    builder: (c) => tablet
        ? Dialog(child: SizedBox(width: 640, height: MediaQuery.sizeOf(c).height * 0.9, child: ReservationForm(r: r, channel: channel, date: date)))
        : Dialog.fullscreen(child: ReservationForm(r: r, channel: channel, date: date)),
  );
  if (saved == null || !context.mounted) return;
  toast(context, '予約 No.${saved['noLabel']} を保存しました');
  // FAXで受けた予約は、確認書を送り返せるように
  if (saved['channel'] == 'fax' && r == null) {
    final send = await confirmDialog(context, 'FAXで受けた予約です。ご予約確認書を印刷・共有して、お客様にFAXで送りますか？', ok: '確認書を出す');
    if (send && context.mounted) {
      await outputPdf(context, 'ご予約確認書 No.${saved['noLabel']}', () async => reservationConfirmationPdf(saved, s.settings, s.rounding, await pdfFont()));
    }
  }
}

class ReservationForm extends StatefulWidget {
  final Json? r;
  final String channel;
  final String? date;
  const ReservationForm({super.key, this.r, this.channel = 'phone', this.date});
  @override
  State<ReservationForm> createState() => _ReservationFormState();
}

class _ReservationFormState extends State<ReservationForm> {
  late Json d;
  late final TextEditingController name, phone, fax, note;
  late bool depositLocked;
  String msg = '';

  @override
  void initState() {
    super.initState();
    final r = widget.r;
    d = r == null
        ? {'channel': widget.channel, 'date': widget.date ?? ymd(DateTime.now()), 'time': '', 'items': <Json>[], 'deposit': 0, 'depositMethod': 'cash', 'status': 'reserved'}
        : {...r, 'items': [for (final it in (r['items'] as List)) Map<String, dynamic>.from(it as Map)]};
    name = TextEditingController(text: (d['name'] ?? '') as String);
    phone = TextEditingController(text: (d['phone'] ?? '') as String);
    fax = TextEditingController(text: (d['fax'] ?? '') as String);
    note = TextEditingController(text: (d['note'] ?? '') as String);
    depositLocked = r != null && ((r['deposit'] ?? 0) as num) > 0;
  }

  @override
  void dispose() {
    for (final c in [name, phone, fax, note]) {
      c.dispose();
    }
    super.dispose();
  }

  List<Json> get items => (d['items'] as List).cast<Json>();

  Future<void> addItem() async {
    final s = AppScope.read(context);
    final p = await productPicker(context, s);
    if (p == null || !mounted) return;
    if (p['unit'] == 'g') {
      final g = await numberDialog(context, title: p['name'] as String, label: '予定の重さ', unit: 'g', note: priceLabel(p), price: (p['price'] as num).toInt());
      if (g != null && g > 0) setState(() => items.add({'productId': p['id'], 'name': p['name'], 'unit': 'g', 'price': p['price'], 'qty': g, 'taxRate': p['taxRate']}));
    } else if (p['unit'] == 'pc') {
      final n = await numberDialog(context, title: p['name'] as String, label: '個数', unit: '個');
      if (n != null && n > 0) setState(() => items.add({'productId': p['id'], 'name': p['name'], 'unit': 'pc', 'price': p['price'], 'qty': n, 'taxRate': p['taxRate']}));
    } else {
      final y = await numberDialog(context, title: p['name'] as String, label: '金額', unit: '円');
      if (y != null && y > 0) setState(() => items.add({'productId': p['id'], 'name': p['name'], 'unit': 'open', 'price': y, 'qty': 1, 'taxRate': p['taxRate']}));
    }
  }

  Future<void> editItem(int i) async {
    final it = items[i];
    final v = await numberDialog(context,
        title: it['name'] as String,
        label: it['unit'] == 'g' ? '予定の重さ' : it['unit'] == 'pc' ? '個数' : '金額',
        unit: it['unit'] == 'g' ? 'g' : it['unit'] == 'pc' ? '個' : '円',
        initial: ((it['unit'] == 'open' ? it['price'] : it['qty']) as num).toInt());
    if (v == null || v <= 0) return;
    setState(() => it[it['unit'] == 'open' ? 'price' : 'qty'] = v);
  }

  /// 前回と同じ内容（商品・数量）にする
  void copyFrom(Json past) {
    setState(() {
      name.text = (past['name'] ?? '') as String;
      if (fax.text.isEmpty) fax.text = (past['fax'] ?? '') as String;
      if (phone.text.isEmpty) phone.text = (past['phone'] ?? '') as String;
    });
  }

  Future<void> save() async {
    final s = AppScope.read(context);
    if (name.text.trim().isEmpty) return setState(() => msg = 'お名前を入力してください');
    if (items.isEmpty) return setState(() => msg = '商品を1つ以上追加してください');
    if (d['channel'] == 'fax' && normPhone(fax.text).isEmpty && normPhone(phone.text).isEmpty) {
      return setState(() => msg = 'FAXで受けた予約は、FAX番号か電話番号を入れてください（確認書を送るため）');
    }
    d['name'] = name.text.trim();
    d['phone'] = phone.text.trim();
    d['fax'] = fax.text.trim();
    d['note'] = note.text.trim();
    if (!depositLocked) {
      if (((d['deposit'] ?? 0) as num) > 0) {
        d['depositDate'] = ymd(DateTime.now());
        d['depositDev'] = s.settings['deviceCode'] ?? '';
      } else {
        d['deposit'] = 0;
      }
    }
    final saved = await s.saveReservation(widget.r == null ? d : (widget.r!..addAll(d)));
    Sound.play(Sfx.add);
    if (mounted) Navigator.pop(context, saved);
  }

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final past = widget.r == null ? findCustomer(s.reservations, phone.text.isNotEmpty ? phone.text : fax.text) : const <Json>[];
    final ch = d['channel'] as String;
    final est = reservationEstimate(d, s.rounding);
    final dep = ((d['deposit'] ?? 0) as num).toInt();
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        title: Text(widget.r == null ? '予約の受付' : '予約の変更 No.${widget.r!['noLabel']}'),
        automaticallyImplyLeading: false,
        actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('キャンセル'))],
      ),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        SegmentedButton<String>(
          segments: [for (final e in channelLabels.entries) ButtonSegment(value: e.key, label: Text(e.value), icon: Icon(channelIcon(e.key), size: 18))],
          selected: {ch},
          onSelectionChanged: (v) => setState(() => d['channel'] = v.first),
        ),
        const SizedBox(height: 8),
        TextField(
          key: const ValueKey('rPhone'),
          controller: phone,
          keyboardType: TextInputType.phone,
          decoration: InputDecoration(labelText: '電話番号', prefixIcon: const Icon(Icons.phone), helperText: widget.r == null ? '入れると、前にご予約いただいたお客様を探します' : null),
          onChanged: (_) => setState(() {}),
        ),
        if (ch == 'fax' || fax.text.isNotEmpty)
          TextField(
            key: const ValueKey('rFax'),
            controller: fax,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(labelText: 'FAX番号（確認書の送り先）', prefixIcon: Icon(Icons.fax)),
            onChanged: (_) => setState(() {}),
          ),
        // 電話番号から、これまでのお客様を呼び出す
        if (past.isNotEmpty)
          Card(
            key: const ValueKey('pastCustomer'),
            color: const Color(0xFFF7E3DC),
            elevation: 0,
            margin: const EdgeInsets.only(top: 8),
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('前にご予約のお客様：${past.first['name']} 様（${past.length}回）', style: const TextStyle(fontWeight: FontWeight.w700)),
                Text('前回 ${dayLabel(past.first['date'] as String)}：${(past.first['items'] as List).map((it) => '${it['name']} ${itemQtyLabel(it as Json)}').join('、')}',
                    style: const TextStyle(color: muted, fontSize: 13)),
                Wrap(spacing: 6, children: [
                  TextButton(key: const ValueKey('useName'), onPressed: () => copyFrom(past.first), child: const Text('この方（名前を入れる）')),
                  TextButton(
                    key: const ValueKey('sameAsLast'),
                    onPressed: () {
                      copyFrom(past.first);
                      setState(() {
                        items
                          ..clear()
                          ..addAll([
                            for (final it in (past.first['items'] as List).cast<Json>())
                              () {
                                // 価格は今の価格にする
                                final pr = s.products.where((p) => p['id'] == it['productId']);
                                return <String, dynamic>{...it, if (pr.isNotEmpty && it['unit'] != 'open') 'price': pr.first['price']};
                              }()
                          ]);
                      });
                    },
                    child: const Text('前回と同じ内容にする'),
                  ),
                ]),
              ]),
            ),
          ),
        TextField(key: const ValueKey('rName'), controller: name, decoration: const InputDecoration(labelText: 'お名前', prefixIcon: Icon(Icons.person))),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(
            child: OutlinedButton.icon(
              key: const ValueKey('rDate'),
              icon: const Icon(Icons.event),
              onPressed: () async {
                final p = await showDatePicker(context: context, initialDate: parseYmd(d['date'] as String), firstDate: DateTime.now().subtract(const Duration(days: 1)), lastDate: DateTime.now().add(const Duration(days: 730)));
                if (p != null) setState(() => d['date'] = ymd(p));
              },
              label: Text('受取 ${dayLabel(d['date'] as String)}'),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: OutlinedButton.icon(
              key: const ValueKey('rTime'),
              icon: const Icon(Icons.schedule),
              onPressed: () async {
                final cur = (d['time'] ?? '') as String;
                final init = cur.isEmpty ? const TimeOfDay(hour: 16, minute: 0) : TimeOfDay(hour: int.parse(cur.substring(0, 2)), minute: int.parse(cur.substring(3)));
                final t = await showTimePicker(context: context, initialTime: init);
                if (t != null) setState(() => d['time'] = '${pad2(t.hour)}:${pad2(t.minute)}');
              },
              label: Text((d['time'] ?? '').toString().isEmpty ? '時刻（指定なし）' : '${d['time']} ごろ'),
            ),
          ),
        ]),
        const SizedBox(height: 12),
        Row(children: [
          const Text('ご注文の商品', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          const Spacer(),
          FilledButton.tonalIcon(key: const ValueKey('rAddItem'), onPressed: addItem, icon: const Icon(Icons.add), label: const Text('商品を追加')),
        ]),
        for (var i = 0; i < items.length; i++)
          ListTile(
            key: ValueKey('rItem-$i'),
            contentPadding: EdgeInsets.zero,
            title: Text(items[i]['name'] as String),
            subtitle: Text('${itemQtyLabel(items[i])}${items[i]['unit'] == 'g' ? '（予定）' : ''}　概算 ${yen(lineAmount(items[i], s.rounding))}'),
            onTap: () => editItem(i),
            trailing: IconButton(icon: const Icon(Icons.close), onPressed: () => setState(() => items.removeAt(i))),
          ),
        if (items.isEmpty) const Padding(padding: EdgeInsets.all(8), child: Text('「商品を追加」から選んでください', style: TextStyle(color: muted))),
        const Divider(),
        Row(children: [
          const Text('概算（税込）'),
          const Spacer(),
          Text(yen(est), key: const ValueKey('rEst'), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
        ]),
        if (items.any((it) => it['unit'] == 'g')) const Text('グラム売りは、お受取時に実際の重さで精算します。', style: TextStyle(color: muted, fontSize: 12)),
        const SizedBox(height: 8),
        Row(children: [
          const Text('前受金'),
          const SizedBox(width: 8),
          if (depositLocked)
            Text('${yen(dep)}（${d['depositMethod'] == 'cashless' ? 'キャッシュレス' : '現金'}・受取済）', style: const TextStyle(color: muted))
          else ...[
            OutlinedButton(
              onPressed: () async {
                final v = await numberDialog(context, title: '前受金', label: '前受金', unit: '円', initial: dep > 0 ? dep : null);
                if (v != null) setState(() => d['deposit'] = v);
              },
              child: Text(dep > 0 ? yen(dep) : 'なし'),
            ),
            const SizedBox(width: 8),
            if (dep > 0)
              SegmentedButton<String>(
                segments: const [ButtonSegment(value: 'cash', label: Text('現金')), ButtonSegment(value: 'cashless', label: Text('キャッシュレス'))],
                selected: {d['depositMethod'] as String},
                onSelectionChanged: (v) => setState(() => d['depositMethod'] = v.first),
              ),
          ],
        ]),
        TextField(controller: note, maxLines: 2, decoration: const InputDecoration(labelText: 'メモ（ご要望・切り方など）')),
        if (msg.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(msg, key: const ValueKey('rMsg'), style: const TextStyle(color: danger))),
      ]),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: SizedBox(height: 56, child: FilledButton(key: const ValueKey('rSave'), onPressed: save, child: const Text('予約を保存', style: TextStyle(fontSize: 18)))),
        ),
      ),
    );
  }
}

/// 商品を選ぶ（検索つき）
Future<Json?> productPicker(BuildContext context, AppState s) {
  var q = '';
  return showDialog<Json>(
    context: context,
    builder: (c) => StatefulBuilder(builder: (c, set) {
      final list = s.products.where((p) => matchProduct(p, q)).toList()..sort((a, b) => ((a['order'] ?? 0) as num).compareTo((b['order'] ?? 0) as num));
      return AlertDialog(
        title: const Text('商品を選ぶ'),
        content: SizedBox(
          width: 420,
          height: 460,
          child: Column(children: [
            TextField(key: const ValueKey('pickSearch'), autofocus: false, decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: '商品を検索'), onChanged: (v) => set(() => q = v)),
            Expanded(
              child: ListView(children: [
                for (final p in list)
                  ListTile(
                    key: ValueKey('pick-${p['id']}'),
                    leading: CircleAvatar(radius: 8, backgroundColor: colorFrom(p['color'] as String?)),
                    title: Text(p['name'] as String),
                    subtitle: Text(priceLabel(p)),
                    onTap: () => Navigator.pop(c, p),
                  ),
              ]),
            ),
          ]),
        ),
        actions: [TextButton(onPressed: () => Navigator.pop(c), child: const Text('キャンセル'))],
      );
    }),
  );
}
