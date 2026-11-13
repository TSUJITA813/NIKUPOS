// レジ締め・入出金の計算（Web版 js/calc.js の drawerSummary・countCash と同じ考え方）

import 'app_state.dart' show yen;
import 'calc.dart';

/// お金の種類（金種）
const denoms = [10000, 5000, 2000, 1000, 500, 100, 50, 10, 5, 1];

/// 入出金の区分
const cashMoveKinds = {'float': '釣銭準備金', 'in': '入金', 'out': '出金', 'exchange': '両替'};

/// 出金・入金の勘定科目（Web版と同じ）
const outAccounts = ['消耗品費', '仕入高', '雑費', '通信費', '旅費交通費', '荷造運賃', '事業主貸', '普通預金'];
const inAccounts = ['普通預金', '事業主借', '雑収入'];

int _i(Object? v) => v == null ? 0 : v is num ? v.toInt() : (num.tryParse('$v') ?? 0).toInt();

/// 金種ごとの枚数 → 合計
int countCash(Map<String, Object?> counts) {
  var s = 0;
  for (final d in denoms) {
    s += d * _i(counts['$d']);
  }
  return s;
}

/// レジの中の現金のまとめ（1台ぶん）
class DrawerSummary {
  final DaySummary sum;
  int depositInCash = 0, depositInCashless = 0, depositRefundCash = 0, depositRefundCashless = 0;
  int wholesaleCash = 0, cashIn = 0, cashOut = 0;

  /// その日に記録した釣銭準備金（なければ 0）
  int float = 0;
  bool hasFloat = false;
  DrawerSummary(this.sum);

  /// 売上・前受金・入出金によるレジの現金の増減
  int get drawerCash => sum.cash + depositInCash - depositRefundCash + wholesaleCash + cashIn - cashOut;
}

/// その日の、この端末（dev）のレジのまとめ。dev が null なら全端末
DrawerSummary drawerSummary({
  required List<Json> sales,
  required List<Json> reservations,
  required List<Json> cashmoves,
  List<Json> slips = const [],
  List<Json> receipts = const [],
  required String date,
  String? dev,
}) {
  bool mine(Json x, [String key = 'dev']) => dev == null || ((x[key] ?? '') as String) == dev;
  final d = DrawerSummary(summarizeDay(sales.where((s) => mine(s)).toList(), date));
  for (final r in reservations) {
    final dep = _i(r['deposit']);
    if (dep == 0) continue;
    final cashless = r['depositMethod'] == 'cashless';
    if (r['depositDate'] == date && mine(r, 'depositDev')) {
      if (cashless) {
        d.depositInCashless += dep;
      } else {
        d.depositInCash += dep;
      }
    }
    if (r['depositRefundDate'] == date && mine(r, 'refundDev')) {
      if (cashless) {
        d.depositRefundCashless += dep;
      } else {
        d.depositRefundCash += dep;
      }
    }
  }
  // Web版の卸売（配達の現金回収・入金）も、届いていればレジの現金に含める
  for (final s in slips) {
    if (s['date'] == date && s['status'] == 'delivered' && s['payment'] == 'cash' && mine(s, 'deliveredDev')) {
      d.wholesaleCash += _i((s['totals'] as Map?)?['total']);
    }
  }
  for (final r in receipts) {
    if (r['date'] == date && r['method'] == 'cash' && mine(r)) d.wholesaleCash += _i(r['amount']);
  }
  for (final m in cashmoves) {
    if (m['date'] != date || !mine(m)) continue;
    if (m['kind'] == 'in') d.cashIn += _i(m['amount']);
    if (m['kind'] == 'out') d.cashOut += _i(m['amount']);
    if (m['kind'] == 'float') {
      d.float = _i(m['amount']);
      d.hasFloat = true;
    }
  }
  return d;
}

/// 釣銭準備金の初期値：その日の記録 → 前回の精算で残した額 → 端末の設定
({int amount, String from}) defaultFloat({required List<Json> cashmoves, required List<Json> closings, required String date, required String dev, Object? setting}) {
  final f = cashmoves.where((m) => m['date'] == date && (m['dev'] ?? '') == dev && m['kind'] == 'float').toList()
    ..sort((a, b) => (a['at'] as String).compareTo(b['at'] as String));
  if (f.isNotEmpty) return (amount: _i(f.last['amount']), from: 'その日の記録');
  final last = closings.where((c) => (c['dev'] ?? '') == dev && (c['date'] as String).compareTo(date) < 0 && c['keep'] != null).toList()
    ..sort((a, b) => (a['at'] as String).compareTo(b['at'] as String));
  if (last.isNotEmpty) return (amount: _i(last.last['keep']), from: '前回のレジ締めで残した額');
  return (amount: _i(setting), from: '端末の設定');
}

/// レジ締めの記録（Web版の closings と同じ形）
Json buildClosing({
  required DrawerSummary dr,
  required int float,
  required Map<String, int> counts,
  required Map<String, int> terminal,
  required int keep,
  required String date,
  required String dev,
  required String staff,
  DateTime? now,
}) {
  final s = dr.sum;
  final expected = float + dr.drawerCash;
  final counted = countCash(counts);
  return {
    'date': date,
    'dev': dev,
    'at': (now ?? DateTime.now()).toUtc().toIso8601String(),
    'staff': staff,
    'float': float,
    'expected': expected,
    'counted': counted,
    'diff': counted - expected,
    'denoms': {for (final e in counts.entries) if (e.value > 0) e.key: e.value},
    'sales': {
      'total': s.total,
      'count': s.count,
      'cash': s.cash,
      'cashless': s.cashless,
      'returns': {'count': s.returnsCount, 'amount': s.returnsAmount},
      'discount': s.discount,
      'voids': s.voids,
    },
    'cashlessBy': Map<String, int>.from(s.cashlessBy),
    'terminal': Map<String, int>.from(terminal),
    'depositIn': dr.depositInCash,
    'depositRefund': dr.depositRefundCash,
    'wholesaleCash': dr.wholesaleCash,
    'cashIn': dr.cashIn,
    'cashOut': dr.cashOut,
    'keep': keep,
  };
}

String signedYen(num v) => v > 0 ? '+${yen(v)}' : v < 0 ? '-${yen(-v)}' : '±0円';
