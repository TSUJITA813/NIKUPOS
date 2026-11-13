// ブラウザ（管理画面）での保存：IndexedDB
// 一度受け取ったクラウドのデータを残しておき、次に開いたときは新しい分だけ受け取る
import 'dart:convert';

import 'package:idb_shim/idb_browser.dart';

import 'store.dart';

Future<Backend> openBackend() async {
  final db = await idbFactoryBrowser.open('nikupos', version: 1, onUpgradeNeeded: (VersionChangeEvent e) {
    final d = e.database;
    if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs');
  });
  return WebBackend(db);
}

class WebBackend implements Backend {
  final Database db;
  WebBackend(this.db);

  @override
  Future<Map<String, String>> loadKv() async {
    final tx = db.transaction('kv', idbModeReadOnly);
    final st = tx.objectStore('kv');
    final out = <String, String>{};
    await for (final c in st.openCursor(autoAdvance: true)) {
      out[c.key as String] = c.value as String;
    }
    await tx.completed;
    return out;
  }

  @override
  Future<void> putKv(String key, String value) async {
    final tx = db.transaction('kv', idbModeReadWrite);
    await tx.objectStore('kv').put(value, key);
    await tx.completed;
  }

  @override
  Future<Map<String, List<Json>>> loadDocs() async {
    final tx = db.transaction('docs', idbModeReadOnly);
    final st = tx.objectStore('docs');
    final out = <String, List<Json>>{};
    await for (final c in st.openCursor(autoAdvance: true)) {
      final k = c.key as String;
      (out[k.substring(0, k.indexOf('|'))] ??= []).add(jsonDecode(c.value as String) as Json);
    }
    await tx.completed;
    return out;
  }

  @override
  Future<void> putDoc(String col, Json doc) async {
    final tx = db.transaction('docs', idbModeReadWrite);
    await tx.objectStore('docs').put(jsonEncode(doc), '$col|${doc['id']}');
    await tx.completed;
  }

  @override
  Future<void> deleteDoc(String col, String id) async {
    final tx = db.transaction('docs', idbModeReadWrite);
    await tx.objectStore('docs').delete('$col|$id');
    await tx.completed;
  }
}
