// NIKUPOS（Flutter版）：鶏肉店のPOSレジ
//  開発中は Android 向けにビルド。将来は iPhone・iPad・Windows にも対応する。

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'core/app_state.dart';
import 'core/sound.dart';
import 'core/sync.dart';
import 'core/backend.dart';
import 'core/store.dart';
import 'ui/common.dart';
import 'ui/shell.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final backend = await openBackend();
  final state = AppState(Store(backend));
  await state.init();
  state.attachSync((st) => CloudSync(st.store, onRemote: st.remoteChanged, onStatus: st.remoteChanged));
  if (kIsWeb) {
    state.tab.value = 3; // 管理画面は「管理」から
    // 開発用：手元（localhost）で開いたときだけ、?testServer=… でテスト用サーバーにつなげる
    final ts = Uri.base.queryParameters['testServer'];
    if (ts != null && (Uri.base.host == 'localhost' || Uri.base.host == '127.0.0.1') && !(state.sync?.enabled ?? false)) {
      state.sync!.useTestServer(ts);
    }
  }
  await Sound.init();
  runApp(NikuposApp(state: state));
}

ThemeData nikuposTheme() {
  final scheme = ColorScheme.fromSeed(seedColor: accent, primary: accent, surface: Colors.white);
  return ThemeData(
    colorScheme: scheme,
    scaffoldBackgroundColor: bg,
    useMaterial3: true,
    inputDecorationTheme: const InputDecorationTheme(isDense: true),
    filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(minimumSize: const Size(64, 48), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)))),
    outlinedButtonTheme: OutlinedButtonThemeData(style: OutlinedButton.styleFrom(minimumSize: const Size(48, 48), padding: const EdgeInsets.symmetric(horizontal: 8), foregroundColor: ink, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)))),
  );
}

class NikuposApp extends StatelessWidget {
  final AppState state;
  const NikuposApp({super.key, required this.state});
  @override
  Widget build(BuildContext context) {
    return AppScope(
      state: state,
      child: MaterialApp(
        title: kIsWeb ? 'NIKUPOS 管理画面' : 'NIKUPOS',
        debugShowCheckedModeBanner: false,
        theme: nikuposTheme(),
        locale: const Locale('ja', 'JP'),
        supportedLocales: const [Locale('ja', 'JP')],
        localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
        home: const RootPage(),
      ),
    );
  }
}
