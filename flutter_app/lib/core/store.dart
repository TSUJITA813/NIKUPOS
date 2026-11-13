// データの保存。端末内の SQLite に、Web版と同じ形（JSON）で保存する。
//  kv   ：商品マスタ・設定・番号・保留など（キーと値）
//  docs ：売上・操作ログなどの記録（種類ごと、IDごと）
// 書き込みは保存が終わるまで待てる（会計の完了は保存が終わってから表示する）。

import 'dart:convert';
import 'dart:math';

import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import 'types.dart';
export 'types.dart';


/// 保存先（本番は SQLite、テストはメモリ）
abstract class Backend {
  Future<Map<String, String>> loadKv();
  Future<void> putKv(String key, String value);
  Future<Map<String, List<Json>>> loadDocs();
  Future<void> putDoc(String col, Json doc);
  Future<void> deleteDoc(String col, String id);
}

class SqliteBackend implements Backend {
  late Database db;

  Future<void> open() async {
    final dir = await getDatabasesPath();
    db = await openDatabase(
      p.join(dir, 'nikupos.db'),
      version: 1,
      onCreate: (db, v) async {
        await db.execute('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
        await db.execute('CREATE TABLE docs (col TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, m TEXT, PRIMARY KEY (col, id))');
        await db.execute('CREATE INDEX docs_col ON docs (col)');
      },
    );
  }

  @override
  Future<Map<String, String>> loadKv() async {
    final rows = await db.query('kv');
    return {for (final r in rows) r['key'] as String: r['value'] as String};
  }

  @override
  Future<void> putKv(String key, String value) =>
      db.insert('kv', {'key': key, 'value': value}, conflictAlgorithm: ConflictAlgorithm.replace);

  @override
  Future<Map<String, List<Json>>> loadDocs() async {
    final out = <String, List<Json>>{};
    final rows = await db.query('docs', orderBy: 'id');
    for (final r in rows) {
      (out[r['col'] as String] ??= []).add(jsonDecode(r['json'] as String) as Json);
    }
    return out;
  }

  @override
  Future<void> putDoc(String col, Json doc) => db.insert(
      'docs', {'col': col, 'id': doc['id'], 'json': jsonEncode(doc), 'm': doc['_m']},
      conflictAlgorithm: ConflictAlgorithm.replace);

  @override
  Future<void> deleteDoc(String col, String id) => db.delete('docs', where: 'col = ? AND id = ?', whereArgs: [col, id]);
}

class MemoryBackend implements Backend {
  final kv = <String, String>{};
  final docs = <String, Map<String, String>>{};
  @override
  Future<Map<String, String>> loadKv() async => Map.of(kv);
  @override
  Future<void> putKv(String key, String value) async => kv[key] = value;
  @override
  Future<Map<String, List<Json>>> loadDocs() async =>
      {for (final e in docs.entries) e.key: e.value.values.map((s) => jsonDecode(s) as Json).toList()};
  @override
  Future<void> putDoc(String col, Json doc) async => (docs[col] ??= {})[doc['id'] as String] = jsonEncode(doc);
  @override
  Future<void> deleteDoc(String col, String id) async => docs[col]?.remove(id);
}

// ---------------- 初期データ ----------------

const _defaultProducts = [
  ['もも肉', '生肉', 'g', 158, 8, '#e8846b', 1300, true],
  ['むね肉', '生肉', 'g', 98, 8, '#f1a98f', 750, true],
  ['ささみ', '生肉', 'g', 128, 8, '#f4c1ad', 1000, true],
  ['手羽先', '生肉', 'g', 118, 8, '#e8846b', 950, true],
  ['手羽元', '生肉', 'g', 98, 8, '#f1a98f', 750, true],
  ['ひき肉', '生肉', 'g', 108, 8, '#f4c1ad', 850, true],
  ['砂肝', '生肉', 'g', 128, 8, '#c96a5a', 1000, true],
  ['レバー', '生肉', 'g', 98, 8, '#a8564a', 700, true],
  ['鶏皮', '生肉', 'g', 68, 8, '#f4c1ad', 450, true],
  ['唐揚げ', '惣菜', 'g', 248, 8, '#d9a441', 0, false],
  ['焼き鳥 もも', '惣菜', 'pc', 120, 8, '#b8743a', 0, false],
  ['焼き鳥 ねぎま', '惣菜', 'pc', 130, 8, '#b8743a', 0, false],
  ['つくね', '惣菜', 'pc', 140, 8, '#b8743a', 0, false],
  ['チキンカツ', '惣菜', 'pc', 200, 8, '#d9a441', 0, false],
  ['手羽先唐揚げ', '惣菜', 'pc', 90, 8, '#d9a441', 0, false],
  ['鶏ガラ', 'その他', 'pc', 100, 8, '#9aa3ab', 80, true],
  ['卵（10個）', 'その他', 'pc', 280, 8, '#e9d27a', 0, false],
  ['その他食品', 'その他', 'open', 0, 8, '#8fa3b8', 0, false],
  ['レジ袋', 'その他', 'pc', 5, 10, '#7f8c8d', 0, false],
];

List<Json> defaultProducts() => [
      for (var i = 0; i < _defaultProducts.length; i++)
        {
          'id': 'p${i + 1}',
          'name': _defaultProducts[i][0],
          'category': _defaultProducts[i][1],
          'unit': _defaultProducts[i][2],
          'price': _defaultProducts[i][3],
          'taxRate': _defaultProducts[i][4],
          'color': _defaultProducts[i][5],
          'order': i,
          'wsPrice': _defaultProducts[i][6],
          'trackStock': _defaultProducts[i][7],
          'minStock': 0,
        }
    ];

Json defaultSettings() => {
      'storeName': '鶏肉の店',
      'address': '',
      'tel': '',
      'invoiceNo': '',
      'footer': 'お買い上げありがとうございました',
      'categories': ['生肉', '惣菜', 'その他'],
      'rounding': 'floor',
      'cashlessTypes': ['クレジット', '電子マネー', 'QR決済'],
      'deviceCode': '',
      'fixedCosts': <Json>[],
    };

// ---------------- 保存の窓口 ----------------

class Store {
  final Backend backend;
  Store(this.backend);

  late List<Json> products;
  late Json settings;
  late Json counters;
  List<Json> holds = [];
  final Map<String, List<Json>> _docs = {};
  final Map<String, String> _kvCache = {};

  static const collections = ['sales', 'logs', 'cashmoves', 'reservations'];

  Future<void> load() async {
    final kv = await backend.loadKv();
    _kvCache.addAll(kv);
    products = kv['products'] != null ? (jsonDecode(kv['products']!) as List).cast<Json>() : defaultProducts();
    settings = {...defaultSettings(), if (kv['settings'] != null) ...(jsonDecode(kv['settings']!) as Json)};
    counters = kv['counters'] != null ? jsonDecode(kv['counters']!) as Json : {};
    holds = kv['holds'] != null ? (jsonDecode(kv['holds']!) as List).cast<Json>() : [];
    final docs = await backend.loadDocs();
    for (final c in collections) {
      _docs[c] = docs[c] ?? [];
    }
  }

  String? kv(String key) => _kvCache[key];
  Future<void> setKv(String key, String value) {
    _kvCache[key] = value;
    return backend.putKv(key, value);
  }

  Future<void> saveProducts() => setKv('products', jsonEncode(products));
  Future<void> saveSettings() => setKv('settings', jsonEncode(settings));
  Future<void> saveHolds() => setKv('holds', jsonEncode(holds));

  List<Json> all(String col) => _docs[col]!;
  List<Json> get sales => all('sales');

  /// 追加・更新（保存が終わるまで待てる）
  Future<void> put(String col, Json doc) {
    doc['_m'] = DateTime.now().toUtc().toIso8601String();
    final list = _docs[col]!;
    final i = list.indexWhere((x) => x['id'] == doc['id']);
    if (i >= 0) {
      list[i] = doc;
    } else {
      list.add(doc);
    }
    return backend.putDoc(col, doc);
  }

  Future<void> delete(String col, String id) {
    _docs[col]!.removeWhere((x) => x['id'] == id);
    return backend.deleteDoc(col, id);
  }

  static final _rand = Random.secure();

  /// Web版と同じ形のID（記号＋時刻＋乱数）
  static String newId(String prefix) {
    final t = DateTime.now().millisecondsSinceEpoch.toRadixString(36);
    final r = List.generate(4, (_) => _rand.nextInt(36).toRadixString(36)).join();
    return '$prefix$t$r';
  }

  /// 取引番号（端末の記号があれば頭に付ける。例：A-12）
  Future<({int no, String noLabel})> makeNo(String key) async {
    final n = ((counters[key] ?? 0) as num).toInt() + 1;
    counters[key] = n;
    await setKv('counters', jsonEncode(counters));
    final dev = (settings['deviceCode'] ?? '') as String;
    return (no: n, noLabel: dev.isEmpty ? '$n' : '$dev-$n');
  }
}
