// 保存先を選ぶ（端末は SQLite、ブラウザ（管理画面）は IndexedDB）
export 'backend_io.dart' if (dart.library.js_interop) 'backend_web.dart';
