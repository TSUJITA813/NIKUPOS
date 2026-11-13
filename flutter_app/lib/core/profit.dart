// 売上と利益（粗利・利益の目安）の集計。Web版 js/profit.js と同じ計算。
//  粗利 ＝ 原価が登録された商品の売上（税抜）− 原価
//  利益の目安 ＝ 粗利（原価が未登録の売上にも同じ粗利率を当てはめた見込み）− 経費 − 固定費（日割り）

import 'dart:math';

import 'calc.dart';

const notExpense = ['仕入高', '事業主貸', '普通預金'];

String ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
DateTime parseYmd(String s) {
  final a = s.split('-').map(int.parse).toList();
  return DateTime(a[0], a[1], a[2]);
}

String addDays(String s, int n) {
  final d = parseYmd(s);
  return ymd(DateTime(d.year, d.month, d.day + n));
}

int daysInMonth(String s) {
  final d = parseYmd(s);
  return DateTime(d.year, d.month + 1, 0).day;
}

const _week = '日月火水木金土';

class Period {
  final String kind, from, to, label, bucket; // bucket: hour | day | month
  const Period(this.kind, this.from, this.to, this.label, this.bucket);
}

/// kind: day | week（月曜はじまり）| month | year、offset: 0 が今、-1 が1つ前
Period period(String kind, String base, [int offset = 0]) {
  final d = parseYmd(base);
  if (kind == 'day') {
    final x = DateTime(d.year, d.month, d.day + offset);
    return Period(kind, ymd(x), ymd(x), '${x.month}月${x.day}日（${_week[x.weekday % 7]}）', 'hour');
  }
  if (kind == 'week') {
    final mon = DateTime(d.year, d.month, d.day - ((d.weekday + 6) % 7) + offset * 7);
    final sun = DateTime(mon.year, mon.month, mon.day + 6);
    return Period(kind, ymd(mon), ymd(sun), '${mon.month}/${mon.day}〜${sun.month}/${sun.day}', 'day');
  }
  if (kind == 'month') {
    final m = DateTime(d.year, d.month + offset, 1);
    return Period(kind, ymd(m), ymd(DateTime(m.year, m.month + 1, 0)), '${m.year}年${m.month}月', 'day');
  }
  final y = d.year + offset;
  return Period(kind, '$y-01-01', '$y-12-31', '$y年', 'month');
}

int? lineCost(Json l, Map<String, Json> products) {
  final unit = l['unit'];
  if (unit != 'g' && unit != 'pc') return null;
  final c = (l['cost'] ?? products[l['productId']]?['cost']) as num?;
  if (c == null || c == 0) return null;
  final qty = (l['qty'] as num);
  return unit == 'g' ? jsRound(c * qty / 1000) : (c * qty).toInt();
}

class Bucket {
  int sales = 0, count = 0;
  double excl = 0, cost = 0, covered = 0, uncovered = 0;
  int get gross => jsRound(covered) - jsRound(cost);
}

class ItemProfit {
  final String name, unit;
  num qty = 0;
  double excl = 0, cost = 0, covered = 0;
  bool hasCost = true;
  ItemProfit(this.name, this.unit);
  int? get gross => hasCost ? jsRound(covered) - jsRound(cost) : null;
  double? get rate => hasCost && covered != 0 ? (jsRound(covered) - jsRound(cost)) / jsRound(covered) : null;
}

class ProfitResult {
  final Period period;
  int sales = 0, tax = 0, count = 0, expenses = 0, fixed = 0;
  double excl = 0, cost = 0, covered = 0, uncovered = 0;
  final Map<String, int> expenseBy = {}, fixedBy = {};
  final Map<Object, Bucket> buckets = {};
  final Map<String, ItemProfit> items = {};
  final Set<String> noCost = {};
  ProfitResult(this.period);

  int get gross => jsRound(covered) - jsRound(cost);
  double? get grossRate => jsRound(covered) != 0 ? gross / jsRound(covered) : null;
  int get grossEst => gross + (grossRate != null ? jsRound(jsRound(uncovered) * grossRate!) : 0);
  int get profit => grossEst - expenses - fixed;
  double get coverage => (covered + uncovered) != 0 ? covered / (covered + uncovered) : 1;
  List<ItemProfit> get itemList => items.values.toList()
    ..sort((a, b) {
      final ga = a.gross ?? -1 << 52, gb = b.gross ?? -1 << 52;
      return gb != ga ? gb.compareTo(ga) : b.excl.compareTo(a.excl);
    });
}

List<Object> bucketKeys(Period p) {
  if (p.bucket == 'hour') return List.generate(24, (h) => h);
  if (p.bucket == 'month') return List.generate(12, (m) => m + 1);
  final out = <Object>[];
  for (var d = p.from; d.compareTo(p.to) <= 0; d = addDays(d, 1)) {
    out.add(d);
  }
  return out;
}

Object _bucketKey(String bucket, String date, String? at) {
  if (bucket == 'hour') return at != null ? DateTime.parse(at).toLocal().hour : 0;
  if (bucket == 'month') return int.parse(date.substring(5, 7));
  return date;
}

/// 集計。until：これより後の取引は数えない（「今の時刻まで」の比較）。fixedUntil：固定費を数える最後の日
ProfitResult computeProfit({
  required List<Json> sales,
  required List<Json> cashmoves,
  required List<Json> products,
  required List<Json> fixedCosts,
  required Period p,
  DateTime? until,
  String? fixedUntil,
}) {
  final r = ProfitResult(p);
  final prods = {for (final x in products) x['id'] as String: x};
  for (final k in bucketKeys(p)) {
    r.buckets[k] = Bucket();
  }
  bool inRange(String date, String? at) {
    if (date.compareTo(p.from) < 0 || date.compareTo(p.to) > 0) return false;
    if (until != null && at != null && DateTime.parse(at).isAfter(until)) return false;
    return true;
  }

  for (final s in sales) {
    if (s['void'] == true || !inRange(s['date'] as String, s['at'] as String?)) continue;
    final t = s['totals'] as Map;
    final total = (t['total'] as num).toInt();
    final tax = (t['byRate'] as List).fold<int>(0, (a, x) => a + (x['tax'] as num).toInt());
    final b = r.buckets.putIfAbsent(_bucketKey(p.bucket, s['date'] as String, s['at'] as String?), Bucket.new);
    r.sales += total;
    r.excl += total - tax;
    r.tax += tax;
    b.sales += total;
    b.excl += total - tax;
    if (s['kind'] != 'return') {
      r.count++;
      b.count++;
    }
    final lines = (s['lines'] as List).cast<Json>();
    final lineSum = lines.fold<num>(0, (a, l) => a + ((l['amount'] ?? 0) as num));
    final ratio = lineSum != 0 ? total / lineSum : 0;
    for (final l in lines) {
      final amt = ((l['amount'] ?? 0) as num) * ratio * 100 / (100 + ((l['taxRate'] ?? 8) as num));
      final c = lineCost(l, prods);
      final key = (l['productId'] ?? l['name']) as String;
      final it = r.items.putIfAbsent(key, () => ItemProfit(l['name'] as String, l['unit'] as String));
      if (l['unit'] != 'open') it.qty += l['qty'] as num;
      it.excl += amt;
      if (c == null) {
        r.uncovered += amt;
        b.uncovered += amt;
        it.hasCost = false;
        if (l['unit'] != 'open' && amt.abs() > 0) r.noCost.add(l['name'] as String);
      } else {
        r.covered += amt;
        b.covered += amt;
        it.covered += amt;
        r.cost += c;
        b.cost += c;
        it.cost += c;
      }
    }
  }
  for (final m in cashmoves) {
    if (m['kind'] != 'out' || !inRange(m['date'] as String, m['at'] as String?)) continue;
    if (notExpense.contains(m['account'])) continue;
    final amount = (m['amount'] as num).toInt();
    final rate = ((m['taxRate'] ?? 0) as num).toInt();
    final ex = amount - (amount * rate / (100 + rate)).floor();
    final k = (m['account'] as String?)?.isNotEmpty == true ? m['account'] as String : 'その他';
    r.expenses += ex;
    r.expenseBy[k] = (r.expenseBy[k] ?? 0) + ex;
  }
  final fixedTo = fixedUntil != null && fixedUntil.compareTo(p.to) < 0 ? fixedUntil : p.to;
  for (final f in fixedCosts) {
    final amt = ((f['amount'] ?? 0) as num).toDouble();
    if (amt == 0) continue;
    var sum = 0.0;
    for (var d = p.from; d.compareTo(fixedTo) <= 0; d = addDays(d, 1)) {
      sum += amt / daysInMonth(d);
    }
    final name = (f['name'] as String?)?.isNotEmpty == true ? f['name'] as String : '固定費';
    r.fixed += jsRound(sum);
    r.fixedBy[name] = (r.fixedBy[name] ?? 0) + jsRound(sum);
  }
  return r;
}

/// 比べる相手（今の期間なら「同じところまで」。今日は先週の同じ曜日）
({Period period, DateTime? until, String? fixedUntil, String label}) previousPeriod(Period p, DateTime now) {
  final today = ymd(now);
  final current = today.compareTo(p.from) >= 0 && today.compareTo(p.to) <= 0;
  final prev = p.kind == 'day' ? period('day', p.from, -7) : period(p.kind, p.from, -1);
  const labels = {'day': '先週の同じ曜日の同じ時刻まで', 'week': '先週の同じ曜日・時刻まで', 'month': '先月の同じ日・時刻まで', 'year': '昨年の同じ日・時刻まで'};
  if (!current) return (period: prev, until: null, fixedUntil: null, label: p.kind == 'day' ? '先週の同じ曜日' : '前の期間');
  final elapsed = parseYmd(today).difference(parseYmd(p.from)).inDays;
  final ud = parseYmd(addDays(prev.from, elapsed));
  var until = DateTime(ud.year, ud.month, ud.day, now.hour, now.minute, now.second);
  final prevEnd = parseYmd(prev.to);
  final limit = DateTime(prevEnd.year, prevEnd.month, prevEnd.day, 23, 59, 59);
  if (until.isAfter(limit)) until = limit;
  return (period: prev, until: until, fixedUntil: ymd(until), label: labels[p.kind]!);
}

int maxOf(Iterable<int> xs) => xs.fold(0, max);
