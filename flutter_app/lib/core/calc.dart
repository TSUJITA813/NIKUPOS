// 金額計算（画面に依存しない純粋関数）。Web版 js/calc.js と同じ計算をする。
// 価格はすべて税込（内税）の整数（円）。明細・売上は Web版と同じ形の Map で扱う。

import 'types.dart';
export 'types.dart';


int _i(Object? v) => v == null ? 0 : (v as num).toInt();
num _n(Object? v) => v == null ? 0 : v as num;

/// JavaScript の Math.round と同じ（.5 は大きい方へ）
int jsRound(num x) => (x + 0.5).floor();

/// 端数処理（浮動小数点の誤差を小数第6位でならしてから）
int roundBy(num value, String mode) {
  final v = jsRound(value * 1e6) / 1e6;
  if (mode == 'round') return jsRound(v);
  if (mode == 'ceil') return v.ceil();
  return v.floor();
}

/// 値引き前の行金額（グラム売りの単価は100gあたり）
int lineBase(Json line, String mode) {
  if (line['unit'] == 'g') return roundBy(_n(line['price']) * _n(line['qty']) / 100, mode);
  return (_n(line['price']) * _n(line['qty'])).toInt();
}

/// 行の値引き額（手動の値引き＋タイムセールなど）
int lineDiscount(Json line, String mode) {
  final base = lineBase(line, mode);
  final d = line['discount'] as Map?;
  var amount = 0;
  if (d != null && _n(d['value']) != 0) {
    amount = d['type'] == 'pct' ? roundBy(base * _n(d['value']) / 100, mode) : _i(d['value']);
  }
  amount += _i(line['promoDiscount']);
  if (amount > base) amount = base;
  return amount < 0 ? 0 : amount;
}

int lineAmount(Json line, String mode) => lineBase(line, mode) - lineDiscount(line, mode);

/// 内税額
int includedTax(int amount, int rate) => (amount * rate / (100 + rate)).floor();

class RateTotal {
  final int rate;
  final int amount;
  final int tax;
  const RateTotal(this.rate, this.amount, this.tax);
  Json toJson() => {'rate': rate, 'amount': amount, 'tax': tax};
}

class Totals {
  final int subtotal, lineDiscount, discount, total, count;
  final List<RateTotal> byRate;
  const Totals(this.subtotal, this.lineDiscount, this.discount, this.total, this.byRate, this.count);
  Json toJson() => {
        'subtotal': subtotal,
        'lineDiscount': lineDiscount,
        'discount': discount,
        'total': total,
        'byRate': byRate.map((r) => r.toJson()).toList(),
        'count': count,
      };
}

/// 合計（小計値引きは税率ごとに按分し、最大のグループで端数を吸収）
Totals totals(List<Json> lines, Json? discount, String mode) {
  final groups = <int, int>{};
  var subtotal = 0, lineDiscountTotal = 0;
  for (final l in lines) {
    final amt = lineAmount(l, mode);
    lineDiscountTotal += lineDiscount(l, mode);
    subtotal += amt;
    final r = _i(l['taxRate']);
    groups[r] = (groups[r] ?? 0) + amt;
  }
  var disc = 0;
  if (discount != null && _n(discount['value']) != 0) {
    disc = discount['type'] == 'pct' ? roundBy(subtotal * _n(discount['value']) / 100, mode) : _i(discount['value']);
    if (disc > subtotal) disc = subtotal;
    if (disc < 0) disc = 0;
  }
  final rates = groups.keys.toList()
    ..sort((a, b) {
      final c = groups[a]!.compareTo(groups[b]!);
      return c != 0 ? c : a.compareTo(b);
    });
  var allocated = 0;
  final byRate = <RateTotal>[];
  for (var i = 0; i < rates.length; i++) {
    final rate = rates[i];
    final alloc = i == rates.length - 1 ? disc - allocated : (subtotal != 0 ? (disc * groups[rate]! / subtotal).floor() : 0);
    allocated += alloc;
    final amount = groups[rate]! - alloc;
    byRate.add(RateTotal(rate, amount, includedTax(amount, rate)));
  }
  byRate.sort((a, b) => a.rate.compareTo(b.rate));
  return Totals(subtotal, lineDiscountTotal, disc, subtotal - disc, byRate, lines.length);
}

class Payment {
  final int due, deposit, cash, cashless, received, change, refund;
  const Payment(this.due, this.deposit, this.cash, this.cashless, this.received, this.change, this.refund);
}

/// 支払い内訳。method: 'cash' | 'cashless' | 'split'（キャッシュレス cashlessAmount 円＋残りを現金）
Payment payments(int total, int deposit, String method, int received, [int cashlessAmount = 0]) {
  if (deposit < 0) deposit = 0;
  final due = total - deposit;
  if (due <= 0) return Payment(due, deposit, due, 0, 0, 0, -due);
  if (method == 'cashless') return Payment(due, deposit, 0, due, due, 0, 0);
  if (method == 'split') {
    final cl = cashlessAmount.clamp(0, due);
    final cash = due - cl;
    if (cash == 0) return Payment(due, deposit, 0, cl, 0, 0, 0);
    return Payment(due, deposit, cash, cl, received, received - cash, 0);
  }
  return Payment(due, deposit, due, 0, received, received - due, 0);
}

/// 売上の支払い内訳（古い形式にも対応）
({int deposit, int cash, int cashless}) salePayments(Json sale) {
  final p = sale['payments'] as Map?;
  if (p != null) return (deposit: _i(p['deposit']), cash: _i(p['cash']), cashless: _i(p['cashless']));
  final t = _i((sale['totals'] as Map)['total']);
  final cash = sale['method'] == 'cash';
  return (deposit: 0, cash: cash ? t : 0, cashless: cash ? 0 : t);
}

/// 1日の集計（店頭）
class DaySummary {
  int count = 0, total = 0, cash = 0, cashless = 0, depositUsed = 0, discount = 0, voids = 0;
  int returnsCount = 0, returnsAmount = 0;
  final Map<String, int> cashlessBy = {};
  final Map<int, ({int amount, int tax})> rates = {};
  final Map<String, ({String name, String unit, num qty, int count, int amount})> items = {};
  List<Json> sales = [];
}

DaySummary summarizeDay(List<Json> sales, String date) {
  final sum = DaySummary();
  sum.sales = sales.where((s) => s['date'] == date).toList();
  for (final s in sum.sales) {
    if (s['void'] == true) {
      sum.voids++;
      continue;
    }
    final p = salePayments(s);
    if (p.cashless != 0) {
      final ct = (s['cashlessType'] as String?)?.isNotEmpty == true ? s['cashlessType'] as String : 'キャッシュレス';
      sum.cashlessBy[ct] = (sum.cashlessBy[ct] ?? 0) + p.cashless;
    }
    final t = s['totals'] as Map;
    final isReturn = s['kind'] == 'return';
    if (isReturn) {
      sum.returnsCount++;
      sum.returnsAmount -= _i(t['total']);
    } else {
      sum.count++;
    }
    sum.total += _i(t['total']);
    sum.cash += p.cash;
    sum.cashless += p.cashless;
    sum.depositUsed += p.deposit;
    sum.discount += _i(t['discount']) + _i(t['lineDiscount']);
    for (final r in (t['byRate'] as List)) {
      final rate = _i(r['rate']);
      final x = sum.rates[rate] ?? (amount: 0, tax: 0);
      sum.rates[rate] = (amount: x.amount + _i(r['amount']), tax: x.tax + _i(r['tax']));
    }
    for (final l in (s['lines'] as List)) {
      final name = l['name'] as String;
      final it = sum.items[name] ?? (name: name, unit: l['unit'] as String, qty: 0, count: 0, amount: 0);
      sum.items[name] = (
        name: name,
        unit: it.unit,
        qty: it.qty + (l['unit'] == 'open' ? (isReturn ? -1 : 1) : _n(l['qty'])),
        count: it.count + (isReturn ? 0 : 1),
        amount: it.amount + (l['itemAmount'] != null ? _i(l['itemAmount']) : _i(l['amount'])),
      );
    }
  }
  return sum;
}

// ---------------- 検索 ----------------

const _readings = [
  ['手羽中', 'てばなか'], ['手羽先', 'てばさき'], ['手羽元', 'てばもと'], ['手羽', 'てば'], ['焼き鳥', 'やきとり'], ['焼鳥', 'やきとり'],
  ['唐揚げ', 'からあげ'], ['唐揚', 'からあげ'], ['砂肝', 'すなぎも'], ['骨付き', 'ほねつき'], ['骨付', 'ほねつき'], ['鶏ガラ', 'とりがら'],
  ['挽肉', 'ひきにく'], ['挽き肉', 'ひきにく'], ['合挽', 'あいびき'], ['鶏', 'とり'], ['肉', 'にく'], ['胸', 'むね'], ['腿', 'もも'],
  ['皮', 'かわ'], ['肝', 'きも'], ['心臓', 'はつ'], ['軟骨', 'なんこつ'], ['卵', 'たまご'], ['玉子', 'たまご'], ['丸', 'まる'],
  ['豚', 'ぶた'], ['牛', 'ぎゅう'], ['鴨', 'かも'], ['串', 'くし'], ['袋', 'ふくろ'], ['個', 'こ'], ['羽', 'わ'], ['味付', 'あじつけ'],
  ['塩', 'しお'], ['揚', 'あげ'], ['焼', 'やき'], ['煮', 'に'], ['惣菜', 'そうざい'], ['生', 'なま'], ['冷凍', 'れいとう'], ['国産', 'こくさん'],
];

/// 半角カナ→全角カナ（NFKC の代わり）
const _hankaku = 'ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ';
const _zenkaku = 'ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン';
const _dakuten = {'カ': 'ガ', 'キ': 'ギ', 'ク': 'グ', 'ケ': 'ゲ', 'コ': 'ゴ', 'サ': 'ザ', 'シ': 'ジ', 'ス': 'ズ', 'セ': 'ゼ', 'ソ': 'ゾ', 'タ': 'ダ', 'チ': 'ヂ', 'ツ': 'ヅ', 'テ': 'デ', 'ト': 'ド', 'ハ': 'バ', 'ヒ': 'ビ', 'フ': 'ブ', 'ヘ': 'ベ', 'ホ': 'ボ', 'ウ': 'ヴ'};
const _handakuten = {'ハ': 'パ', 'ヒ': 'ピ', 'フ': 'プ', 'ヘ': 'ペ', 'ホ': 'ポ'};

/// 検索用に文字をそろえる（全角英数→半角、半角カナ→全角、カタカナ→ひらがな、小文字、空白を除く）
String searchKey(String? s) {
  final out = StringBuffer();
  final runes = (s ?? '').runes.toList();
  for (var i = 0; i < runes.length; i++) {
    var c = runes[i];
    if (c >= 0xFF01 && c <= 0xFF5E) c -= 0xFEE0; // 全角英数記号
    var ch = String.fromCharCode(c);
    final hk = _hankaku.indexOf(ch);
    if (hk >= 0) {
      ch = _zenkaku[hk];
      if (i + 1 < runes.length) {
        final next = String.fromCharCode(runes[i + 1]);
        if (next == 'ﾞ' && _dakuten[ch] != null) { ch = _dakuten[ch]!; i++; }
        else if (next == 'ﾟ' && _handakuten[ch] != null) { ch = _handakuten[ch]!; i++; }
      }
    }
    var code = ch.codeUnitAt(0);
    if (code >= 0x30A1 && code <= 0x30F6) ch = String.fromCharCode(code - 0x60); // カタカナ→ひらがな
    if (ch.trim().isEmpty || ch == '　') continue;
    out.write(ch.toLowerCase());
  }
  return out.toString();
}

String autoReading(String name) {
  var r = name;
  for (final x in _readings) {
    r = r.split(x[0]).join(x[1]);
  }
  return r;
}

/// 商品が検索語に合うか（名前・よみ・商品コード・カテゴリ。よくある漢字は読みでも）
bool matchProduct(Json p, String q) {
  final k = searchKey(q);
  if (k.isEmpty) return true;
  for (final v in [p['name'], p['kana'], p['code'], p['category'], autoReading((p['name'] ?? '') as String)]) {
    if (v != null && searchKey(v.toString()).contains(k)) return true;
  }
  return false;
}
