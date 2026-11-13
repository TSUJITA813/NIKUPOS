// NIKUPOS（Flutter版）：鶏肉店のPOSレジ
//  開発中は Android 向けにビルド。将来は iPhone・iPad・Windows にも対応する。

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'core/app_state.dart';
import 'core/sound.dart';
import 'core/store.dart';
import 'ui/common.dart';
import 'ui/shell.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final backend = SqliteBackend();
  await backend.open();
  final state = AppState(Store(backend));
  await state.init();
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
        title: 'NIKUPOS',
        debugShowCheckedModeBanner: false,
        theme: nikuposTheme(),
        locale: const Locale('ja', 'JP'),
        supportedLocales: const [Locale('ja', 'JP')],
        localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
        home: const HomeShell(),
      ),
    );
  }
}
