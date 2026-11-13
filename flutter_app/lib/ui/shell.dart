// 画面の枠（スマートフォン：下にタブ、タブレット：左にタブ）

import 'dart:async';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';

import '../core/app_state.dart';
import 'admin.dart';
import 'common.dart';
import 'device_settings.dart';
import 'register.dart';
import 'reservations.dart';
import '../core/profit.dart' show ymd;
import '../core/reservation.dart';
import 'sales.dart';
import 'sync_settings.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  Timer? timer;
  DateTime now = DateTime.now();

  void _onTab() => setState(() {});

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final s = AppScope.read(context);
    s.tab.removeListener(_onTab);
    s.tab.addListener(_onTab);
  }

  @override
  void initState() {
    super.initState();
    timer = Timer.periodic(const Duration(seconds: 20), (_) {
      if (!mounted) return;
      final s = AppScope.read(context);
      final was = s.adminId != null;
      if (was && !s.isAdmin) toast(context, '一定時間操作がなかったため、管理画面からログアウトしました');
      setState(() => now = DateTime.now());
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  static const _dest = [
    (Icons.point_of_sale, 'レジ'),
    (Icons.event_note, '予約'),
    (Icons.receipt_long, '売上'),
    (Icons.lock_outline, '管理'),
  ];

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final tablet = useTabletLayout(context, s);
    final index = s.tab.value;
    // 管理画面（ブラウザ）ではレジを出さない
    final shown = kIsWeb ? const [1, 2, 3] : const [0, 1, 2, 3];
    final pages = const [RegisterPage(), ReservationsPage(), SalesPage(), AdminPage()];
    final body = IndexedStack(index: index, children: [for (var i = 0; i < pages.length; i++) shown.contains(i) ? pages[i] : const SizedBox.shrink()]);
    final selected = shown.indexOf(index).clamp(0, shown.length - 1);
    final today = ymd(DateTime.now());
    final todayResv = s.reservations.where((r) => r['date'] == today && isActiveReservation(r)).length;
    Widget icon(int i) {
      final ic = Icon(_dest[i].$1);
      return i == 1 && todayResv > 0 ? Badge(key: const ValueKey('resvBadge'), label: Text('$todayResv'), child: ic) : ic;
    }
    void go(int i) => s.tab.value = shown[i];
    final appBar = AppBar(
      backgroundColor: accent,
      foregroundColor: Colors.white,
      toolbarHeight: tablet ? 52 : 48,
      title: Text('🐔 ${s.settings['storeName']}${kIsWeb ? '　管理画面' : ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
      actions: [
        const SyncIndicator(),
        IconButton(
          key: const ValueKey('soundToggle'),
          tooltip: s.soundOn ? '操作音：オン（タップで消す）' : '操作音：オフ（タップで鳴らす）',
          icon: Icon(s.soundOn ? Icons.volume_up : Icons.volume_off),
          onPressed: () {
            s.setSound(on: !s.soundOn);
            toast(context, s.soundOn ? '操作音をオンにしました' : '操作音をオフにしました');
          },
        ),
        if (!kIsWeb)
          IconButton(
            key: const ValueKey('deviceSettings'),
            tooltip: 'この端末の設定（操作音・画面・釣銭準備金）',
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => const DeviceSettingsPage())),
          ),
        Padding(
          padding: const EdgeInsets.only(right: 12),
          child: Center(child: Text('${now.month}/${now.day} ${timeStr(now)}', style: const TextStyle(fontSize: 15))),
        ),
      ],
    );
    return Listener(
      onPointerDown: (_) => s.touch(),
      child: tablet
          ? Scaffold(
              appBar: appBar,
              body: Row(children: [
                NavigationRail(
                  selectedIndex: selected,
                  labelType: NavigationRailLabelType.all,
                  onDestinationSelected: go,
                  destinations: [for (final i in shown) NavigationRailDestination(icon: icon(i), label: Text(_dest[i].$2))],
                ),
                const VerticalDivider(width: 1, color: line),
                Expanded(child: body),
              ]),
            )
          : Scaffold(
              appBar: appBar,
              body: body,
              bottomNavigationBar: NavigationBar(
                height: 62,
                selectedIndex: selected,
                onDestinationSelected: go,
                destinations: [for (final i in shown) NavigationDestination(key: ValueKey('nav-${_dest[i].$2}'), icon: icon(i), label: _dest[i].$2)],
              ),
            ),
    );
  }
}

/// 管理画面（ブラウザ）：まずクラウドにつなぐ（お店のデータはクラウドにある）
class WebConnectPage extends StatelessWidget {
  const WebConnectPage({super.key});
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(backgroundColor: accent, foregroundColor: Colors.white, title: const Text('🐔 NIKUPOS 管理画面', style: TextStyle(fontWeight: FontWeight.w800))),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: Card(
              elevation: 0,
              color: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: const BorderSide(color: line)),
              child: const Padding(
                padding: EdgeInsets.all(20),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Text('お店のクラウドにつなぐ', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                  SizedBox(height: 6),
                  Text('レジ（Androidアプリ・Web版）と同じお店のアカウントでつなぐと、売上・予約・商品・設定を見たり変えたりできます。つないだあと、管理者のID・パスワードでログインします。', style: TextStyle(color: muted)),
                  SizedBox(height: 8),
                  SyncSettings(firstRun: true),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// 最初の画面（管理画面でクラウドにつないでいなければ、つなぐ画面）
class RootPage extends StatelessWidget {
  const RootPage({super.key});
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    if (kIsWeb && !(s.sync?.enabled ?? false)) return const WebConnectPage();
    // 管理画面（ブラウザ）は、管理者のID・パスワードでログインするまで何も見せない
    if (kIsWeb && !s.isAdmin) {
      return Scaffold(
        appBar: AppBar(backgroundColor: accent, foregroundColor: Colors.white, title: Text('🐔 ${s.settings['storeName']}　管理画面', style: const TextStyle(fontWeight: FontWeight.w800))),
        body: const AdminPage(),
      );
    }
    return const HomeShell();
  }
}
