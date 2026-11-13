// 端末（Android・iPhone・Windows）での保存：SQLite
import 'dart:convert';

import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import 'store.dart';

Future<Backend> openBackend() async {
  final b = SqliteBackend();
  await b.open();
  return b;
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

