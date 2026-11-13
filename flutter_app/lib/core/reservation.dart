// 予約・取り置き（Web版と同じ形のデータ）
//  受付方法：電話（phone）・FAX（fax）・店頭（store）・その他（other）

import 'calc.dart';

const channelLabels = {'phone': '電話', 'fax': 'FAX', 'store': '店頭', 'other': 'その他'};
const statusLabels = {'reserved': '予約中', 'ready': '準備済', 'done': '受渡済', 'cancelled': '取消'};

bool isActiveReservation(Json r) => r['status'] == 'reserved' || r['status'] == 'ready';

/// 予約の概算金額（グラム売りは予定重量で計算）
int reservationEstimate(Json r, String mode) =>
    ((r['items'] as List?) ?? const []).cast<Json>().fold(0, (s, it) => s + lineAmount(it, mode));

class PrepItem {
  final String productId, name, unit;
  num qty = 0;
  int reservations = 0;
  PrepItem(this.productId, this.name, this.unit);
}

/// 仕込み集計：その日の受取予定（取消・受渡済を除く）を商品ごとに合計（Web版 prepSummary と同じ）
({int count, List<PrepItem> items}) prepSummary(List<Json> reservations, String date) {
  final map = <String, PrepItem>{};
  var count = 0;
  for (final r in reservations) {
    if (r['date'] != date || !isActiveReservation(r)) continue;
    count++;
    for (final it in (r['items'] as List).cast<Json>()) {
      final k = '${it['productId']}|${it['unit']}';
      final x = map.putIfAbsent(k, () => PrepItem('${it['productId']}', it['name'] as String, it['unit'] as String));
      x.qty += it['unit'] == 'open' ? 1 : it['qty'] as num;
      x.reservations++;
    }
  }
  return (count: count, items: map.values.toList());
}

/// 電話番号・FAX番号をそろえる（数字だけ。全角も可）
String normPhone(String? s) {
  final b = StringBuffer();
  for (final c in (s ?? '').runes) {
    if (c >= 0x30 && c <= 0x39) b.writeCharCode(c);
    if (c >= 0xFF10 && c <= 0xFF19) b.writeCharCode(c - 0xFF10 + 0x30);
  }
  return b.toString();
}

/// 電話番号（またはFAX番号）から、これまでの予約を新しい順に探す（電話で受けたときの呼び出し）
List<Json> findCustomer(List<Json> reservations, String phone) {
  final p = normPhone(phone);
  if (p.length < 4) return const [];
  final hits = reservations.where((r) {
    final a = normPhone(r['phone'] as String?), f = normPhone(r['fax'] as String?);
    return (a.isNotEmpty && (a == p || a.endsWith(p))) || (f.isNotEmpty && (f == p || f.endsWith(p)));
  }).toList()
    ..sort((a, b) => ((b['createdAt'] ?? b['date'] ?? '') as String).compareTo((a['createdAt'] ?? a['date'] ?? '') as String));
  return hits;
}

/// 予約の商品の数量の表示（例：1,200g（予定）・3個・金額 ¥1,000）
String itemQtyLabel(Json it) {
  if (it['unit'] == 'g') return '${_num(it['qty'] as num)}g';
  if (it['unit'] == 'open') return '金額 ¥${_num(it['price'] as num)}';
  return '${it['qty']}個';
}

String _num(num n) => n.round().toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
